"""
TraceCollector 逻辑单测（不需要 LangChain / MongoDB / Docker）

模拟一段真实 LangGraph 的 callback run 序列，验证：
  1. 框架噪音层被剔除，且子 span 正确重挂到最近的保留祖先
  2. 主图与子图的同名节点（都叫 agent）不会互相误判吞掉
  3. 耗时计算正确
  4. token 归因正确（自身 tokens + 含后代的 subtree_tokens）
  5. 中断时未闭合 span 被标记
  6. 错误冒泡与统计

运行：python scripts/test_trace_collector.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.agent.trace.collector import RAW_CHAIN, RAW_LLM, RAW_TOOL, TraceCollector
from src.agent.trace.models import (
    KIND_GRAPH,
    KIND_LLM,
    KIND_NODE,
    KIND_RUN,
    KIND_TOOL,
    STATUS_ERROR,
    STATUS_INTERRUPTED,
    STATUS_OK,
)

RESULTS = []


def check(name: str, cond: bool, detail: str = ""):
    RESULTS.append((name, bool(cond), detail))
    flag = "PASS" if cond else "FAIL"
    print(f"[{flag}] {name}" + (f"  <- {detail}" if detail and not cond else ""))


class Clock:
    """可控时钟，保证耗时可精确断言"""

    def __init__(self, t=1_000_000):
        self.t = t

    def __call__(self):
        return self.t

    def tick(self, n):
        self.t += n
        return self.t


def build():
    """构造一次典型调用：
    graph
    └── node agent (main)
        ├── llm qwen-plus                （被噪音层包着）
        ├── tool task → 委派 analyst
        │   └── node agent (analyst)
        │       ├── llm qwen-plus
        │       └── tool query_orders    （失败）
        └── node tools
            └── tool get_suppliers       （未闭合 → 中断）
    """
    clk = Clock()
    col = TraceCollector(thread_id="t-1", run_id="r-1", clock=clk)

    # --- 顶层图 ---
    clk.tick(10)
    col.start_span("A", None, RAW_CHAIN, name="procurement-main-agent")

    # --- 主图 agent 节点 ---
    clk.tick(20)
    col.start_span("B", "A", RAW_CHAIN, name="agent", node="agent", agent="main")

    # --- 节点内的框架包装层（同 agent+node，应被判为噪音）---
    clk.tick(5)
    col.start_span("B1", "B", RAW_CHAIN, name="RunnableSequence", node="agent", agent="main")

    # --- LLM（挂在噪音层下，应重挂到 B）---
    clk.tick(5)
    col.start_span("L1", "B1", RAW_LLM, name="llm · qwen-plus", node="agent", agent="main", model="qwen-plus")
    clk.tick(2_800)
    col.end_span("L1", STATUS_OK, tokens_in=1_000, tokens_out=200)

    # --- 委派子 Agent（tool）---
    clk.tick(50)
    col.start_span("T1", "B1", RAW_TOOL, name="task", node="agent", agent="main")

    # --- 子图 agent 节点：node 同为 "agent"，但 agent=analyst，必须保留 ---
    clk.tick(20)
    col.start_span(
        "C", "T1", RAW_CHAIN, name="agent", node="agent", agent="procurement-analyst"
    )
    clk.tick(10)
    col.start_span("L2", "C", RAW_LLM, name="llm · qwen-plus", node="agent", agent="procurement-analyst", model="qwen-plus")
    clk.tick(600)
    col.end_span("L2", STATUS_OK, tokens_in=500, tokens_out=80)

    clk.tick(20)
    col.start_span("T2", "C", RAW_TOOL, name="query_orders", node="agent", agent="procurement-analyst")
    clk.tick(500)
    col.end_span("T2", STATUS_ERROR, error="HTTPConnection timeout")

    clk.tick(30)
    col.end_span("C", STATUS_OK)
    clk.tick(10)
    col.end_span("T1", STATUS_OK)

    clk.tick(20)
    col.end_span("B1", STATUS_OK)
    clk.tick(10)
    col.end_span("B", STATUS_OK)

    # --- tools 节点 ---
    clk.tick(50)
    col.start_span("D", "A", RAW_CHAIN, name="tools", node="tools", agent="main")
    clk.tick(30)
    col.start_span("T3", "D", RAW_TOOL, name="get_suppliers", node="tools", agent="main")
    # 故意不 end —— 模拟 HITL 中断

    return col


def main():
    col = build()
    payload = col.finalize(interrupted=True)
    spans = payload["spans"]
    by_id = {s["span_id"]: s for s in spans}
    stats = payload["stats"]

    print(f"\n共 {len(spans)} 个 span：")
    for s in spans:
        mark = "  " * s["depth"]
        print(
            f"  {mark}{s['kind']:<6} {s['name']:<22} "
            f"{str(s['duration_ms']) + 'ms':>9}  tok={s['subtree_total']:<6} {s['status']}"
        )
    print()

    # 1. 噪音剔除
    check("噪音层 RunnableSequence 被剔除", "B1" not in by_id, f"实际 span: {list(by_id)}")
    check("span 总数 = 10", len(spans) == 10, f"实际 {len(spans)}")

    # 2. 重挂 + 子图不被误吞
    check("LLM 重挂到主图 agent 节点", by_id["L1"]["parent_id"] == "B", by_id["L1"]["parent_id"])
    check("tool task 重挂到主图 agent 节点", by_id["T1"]["parent_id"] == "B", by_id["T1"]["parent_id"])
    check("子图 agent 节点未被同名判重吞掉", "C" in by_id)
    check("子图归属 agent=procurement-analyst", by_id["C"]["agent"] == "procurement-analyst", by_id["C"]["agent"])
    check("子图节点 parent 是委派 tool", by_id["C"]["parent_id"] == "T1", by_id["C"]["parent_id"])

    # 3. 耗时
    check("LLM 耗时 = 2800ms", by_id["L1"]["duration_ms"] == 2_800, str(by_id["L1"]["duration_ms"]))

    # 4. token 归因
    check("LLM 自身 token = 1200", by_id["L1"]["tokens_total"] == 1_200, str(by_id["L1"]["tokens_total"]))
    check("子图节点 subtree = 580", by_id["C"]["subtree_total"] == 580, str(by_id["C"]["subtree_total"]))
    check("委派 tool subtree = 580", by_id["T1"]["subtree_total"] == 580, str(by_id["T1"]["subtree_total"]))
    check("主图 agent 节点 subtree = 1780", by_id["B"]["subtree_total"] == 1_780, str(by_id["B"]["subtree_total"]))
    check("根节点 subtree = 1780", by_id[col.root_id]["subtree_total"] == 1_780)

    # 5. 中断
    check("未闭合 tool 标记为 interrupted", by_id["T3"]["status"] == STATUS_INTERRUPTED, by_id["T3"]["status"])
    check("未闭合 tool 仍计入耗时", by_id["T3"]["duration_ms"] is not None)

    # 6. 错误
    check("失败 tool status=error", by_id["T2"]["status"] == STATUS_ERROR)
    check("失败 tool 保留错误原因", "timeout" in (by_id["T2"]["error"] or ""), by_id["T2"]["error"])
    check("错误冒泡到子图节点", "timeout" in (by_id["C"]["error"] or ""), by_id.get("C", {}).get("error"))

    # 7. 统计
    check("stats.error_count = 1", stats["error_count"] == 1, str(stats["error_count"]))
    check("stats.llm_calls = 2", stats["llm_calls"] == 2, str(stats["llm_calls"]))
    check("stats.tool_calls = 3", stats["tool_calls"] == 3, str(stats["tool_calls"]))
    check("stats.tokens_total = 1780", stats["tokens_total"] == 1_780, str(stats["tokens_total"]))
    check("stats.max_depth = 5", stats["max_depth"] == 5, str(stats["max_depth"]))
    # run status 优先级：error > interrupted > ok（有失败必须优先暴露）
    check("stats.interrupted_count = 3", stats["interrupted_count"] == 3, str(stats["interrupted_count"]))
    check("run status 错误优先于中断", stats["status"] == STATUS_ERROR, stats["status"])

    # 单独验证：只有中断没有错误时，status 应为 interrupted
    col3 = TraceCollector(thread_id="t-2", run_id="r-2", clock=Clock())
    col3.start_span("X", None, RAW_TOOL, name="hitl_wait")
    p3 = col3.finalize(interrupted=True)
    check("纯中断场景 status = interrupted", p3["stats"]["status"] == STATUS_INTERRUPTED, p3["stats"]["status"])

    # 8. 序列化完整性
    required = {
        "span_id", "parent_id", "kind", "name", "start_ms", "end_ms", "duration_ms",
        "status", "node", "agent", "model", "tokens_in", "tokens_out", "tokens_total",
        "subtree_in", "subtree_out", "subtree_total", "error", "args_preview",
        "result_preview", "depth", "seq",
    }
    missing = required - set(by_id["L1"].keys())
    check("序列化字段完整", not missing, f"缺失 {missing}")

    # 9. 增量事件（SSE 推送）
    col2 = build()
    events = col2.drain()
    check("产生了增量事件", len(events) > 0, str(len(events)))
    check("事件结构为 (op, span)", all(op in ("start", "end") and isinstance(d, dict) for op, d in events))

    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{'=' * 52}")
    print(f"通过 {len(RESULTS) - len(failed)}/{len(RESULTS)}")
    if failed:
        print("失败项：")
        for n in failed:
            print(f"  - {n}")
        sys.exit(1)
    print("全部通过")


if __name__ == "__main__":
    main()
