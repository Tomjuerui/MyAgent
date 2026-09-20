# Agent 执行链路 Trace 可视化 — 实施方案

> 目标：回答四个问题 —— **谁调用了谁**（调用树）、**每一步花了多久**（耗时）、**哪一步失败了**（错误定位）、**每一步花了多少 token**（成本归因）。

---

## 1. 现状与结论

### 1.1 现在有什么

`src/api_view/api/chat.py` 的 `stream_chat_response()` 已经消费
`astream(stream_mode=["messages","values","custom"], subgraphs=True)`，
并发出 12 类 SSE 事件：`thinking / phase / todo_update / interrupt / tool_start / tool_args / tool_result / tool_end / token / review_result / done / error`。

前端已有 `HarnessPhaseBar`、`TodoListPanel`、`ToolCallDisplay`。

### 1.2 为什么现有数据不够

现有事件是一条**平铺的时间序列**，只有"发生了什么"，没有三样东西：

| 缺失 | 后果 |
|---|---|
| `parent_id`（父子关系） | 无法回答"谁调用了谁"，子 Agent 委派看不出来 |
| `start/end` 时间戳 | 无法回答"哪一步慢"，只有先后顺序没有耗时 |
| `tokens` | 无法回答"花了多少"，token 只在 LLM 调用结束那一刻出现 |

### 1.3 技术选型：LangChain Callback Handler（不是手写事件埋点）

| 方案 | 评价 |
|---|---|
| **A. `AsyncCallbackHandler` 挂 `config["callbacks"]`** | **采用**。LangChain 的 `run_id / parent_run_id` 天然就是一棵树，自动覆盖 chain / llm / tool 三层，不用在 `astream` 循环里猜父子关系；`on_llm_end(response)` 能拿到 usage |
| B. 在 `astream` 循环里手工推断 span | 只能靠 `namespace` 元组 + 消息类型，拿不到节点名、拿不到 token，父子关系靠猜 |
| C. 接 Langfuse / LangSmith | 最快，但数据出网、且拿不到"嵌在自己产品里的链路面板"。本次做自建，后续可并行接 OTel 导出 |

**关键判断**：LangChain 的 callback 体系本身已经维护了 run 树，我们要做的不是"造树"，而是**给这棵树做降噪 + 补时间戳 + 补 token**。

---

## 2. 数据模型

文件：`src/agent/trace/models.py`（已建）

一次对话 turn = 一个 `run`，其内是一棵 span 树：

```
run                                   一次 SSE 请求（含 resume）
└── graph                             LangGraph 顶层执行
    ├── node  agent (main)            主 agent 节点
    │   ├── llm  qwen-plus            ★ token 只在这里产生
    │   └── tool  task                子 Agent 委派也是 tool
    │       └── node agent (analyst)  子图内部节点，agent 标记为 analyst
    │           ├── llm  qwen-plus
    │           └── tool  query_orders
    └── node  tools
        └── tool  get_suppliers
```

### Span 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `span_id` / `parent_id` | str | 树结构（parent 已做降噪重挂） |
| `kind` | enum | `run` / `graph` / `node` / `llm` / `tool` |
| `name` | str | 展示名：节点名 / 工具名 / `llm:qwen-plus` |
| `node` | str? | LangGraph 节点名（`langgraph_node`） |
| `agent` | str | 归属 agent：`main` 或子 agent 名（委派链可见） |
| `model` | str? | 模型名（llm span） |
| `start_ms` / `end_ms` / `duration_ms` | int | 耗时 |
| `status` | enum | `running` / `ok` / `error` / `interrupted` |
| `tokens_in/out/total` | int | **自身** token（仅 llm 有值） |
| `subtree_in/out/total` | int | **含所有后代**的累计，节点/根用它展示"这一步总共烧了多少" |
| `error` | str? | 失败原因 |
| `args_preview` / `result_preview` | str? | 截断后的入参/出参（默认 500 字） |
| `depth` / `seq` | int | 前端渲染缩进与稳定排序 |

---

## 3. 核心难点与解法

### 3.1 噪音过滤（降噪 + 重挂父子）

LangGraph 会在节点外包 `RunnableSequence / RunnableLambda / ChatPromptTemplate` 等中间层，
直接全量采集会得到几十层无意义嵌套。

**采集时不丢、输出时压实的三段式算法**（`collector.finalize()`）：

1. **全量记录**：所有 callback run 都存进 `_runs`，保留原始 `parent_run_id`
2. **保留判定**：
   - `llm` / `tool` → 一律保留
   - `chain` → 有 `langgraph_node` 且 `(agent, node)` 组合未在祖先链上出现过 → 保留为 `node`；
     挂在 root 下的顶层 chain → 保留为 `graph`
   - 其余（Prompt 模板、Lambda 等）→ 标记为噪音
3. **重挂**：噪音节点被删除后，把其子 span 的 `parent_id` 指向**最近的保留祖先**，
   保证树不断裂、且噪音层的耗时天然被父 span 覆盖

> 判重用 `(agent, node)` 而非单看 `node`：主图和子图的节点名都是 `agent` / `tools`，
> 只看 node 名会把子图节点误判成重复而丢掉，导致子 Agent 链路消失。

### 3.2 子 Agent 归属

从 `metadata["langgraph_checkpoint_ns"]` 取值，形如 `procurement-analyst:6b7b0e2f...`：
取 `:` 前一段作为 agent 名；为空或纯 UUID 时归 `main`。

### 3.3 token 提取（多来源 fallback）

`on_llm_end(response: LLMResult)` 依次尝试，取第一个命中：

1. `response.generations[0][0].message.usage_metadata` → `input_tokens / output_tokens / total_tokens`（LangChain 标准）
2. `response.llm_output["token_usage"]` → `prompt_tokens / completion_tokens / total_tokens`（OpenAI 兼容，DashScope 走这条）
3. `response.generations[0][0].message.response_metadata["token_usage"]` → 同上
4. 都没有 → 记 0，并在 stats 里累加 `missing_usage` 计数，避免"看起来 0 token"造成误判

**不订阅 `on_llm_new_token`**：流式 token 回调量巨大，且不带 usage，只会拖慢链路。

### 3.4 耗时口径

`start_ms` 记在 `*_start`，`end_ms` 记在 `*_end` / `*_error`。
中断时（HITL）未闭合的 span 不丢弃 —— `finalize(interrupted=True)` 会把仍 `running` 的
span 标记为 `interrupted` 并补 `end_ms = now`，这样甘特图能画出"卡在审批等待"这一段。

---

## 4. 后端改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/agent/trace/models.py` | **已建**。Span 数据模型 + 序列化 |
| 2 | `src/agent/trace/collector.py` | **新建**。`TraceCollector`：全量记录 → 降噪压实 → 建树 → 子树 token 累加 → 统计。零框架依赖，可单测 |
| 3 | `src/agent/trace/handler.py` | **新建**。`LangChainTraceHandler(AsyncCallbackHandler)`：chain/llm/tool 六类回调 → collector 调用，附带 usage 提取与 agent 归属推断 |
| 4 | `src/agent/trace/__init__.py` | **新建**。导出 |
| 5 | `src/api_view/api/chat.py` | 接入 handler（约 4 处）；新增 SSE `trace` 事件；结束时落库 |
| 6 | `src/api_view/agent_loader.py` | 新增 `save_trace()` / `get_trace()` / `list_trace_runs()`；`delete_conversation()` 连带清理 |
| 7 | `src/api_view/api/chat.py` | 新增 `GET /api/chat/{thread_id}/trace` 路由 |

### 4.1 `chat.py` 接入点（按行号）

```
L59   config = agent_loader.create_config(thread_id)
      ↓
      run_id = str(uuid.uuid4())
      collector = TraceCollector(thread_id=thread_id, run_id=run_id)
      handler = LangChainTraceHandler(collector)
      config = agent_loader.create_config(thread_id)
      config["callbacks"] = [handler]        # ← LangGraph 会传播到子图与所有 Runnable
```

```
L88   async for namespace, chunk_type, chunk in agent_loader.agent.astream(...)
      ↓ 循环体末尾追加（实时推送增量）
      for op, span in collector.drain():
          yield sse_event("trace", {"op": op, "span": span.to_dict()})
```

```
L176  中断 return 前      → collector.finalize(interrupted=True) + save_trace + drain 余数
L315  正常结束前          → collector.finalize() + save_trace + drain 余数
L325  except 分支         → collector.finalize(interrupted=True) + save_trace（保证异常也有链路可查）
```

### 4.2 SSE 新增事件

```jsonc
event: trace
data: {"op":"start","span":{...}}          // span 开始
data: {"op":"end","span":{...}}            // span 结束（带 duration / tokens / error）
```

前端用 `Map<span_id, Span>` 累积：收到 `start` 插入，收到 `end` 就地 patch。
流式过程中未闭合的 span 用 `status=running` 渲染脉冲条，实现"看着它跑"的效果。

### 4.3 落库设计（MongoDB `agent_traces`）

```jsonc
{
  "thread_id": "...",
  "run_id":    "...",
  "started_at": "2026-09-20T10:30:00",
  "ended_at":   "2026-09-20T10:30:12",
  "status": "ok | error | interrupted",
  "spans": [ {...}, {...} ],
  "stats": {
    "duration_ms": 12480,
    "llm_calls": 4, "tool_calls": 7, "error_count": 0,
    "tokens_in": 8120, "tokens_out": 1042, "tokens_total": 9162,
    "max_depth": 5, "missing_usage": 0
  }
}
```

索引：`{thread_id: 1, started_at: -1}`、`{run_id: 1}`（unique）。
一个 turn 一份文档，resume 产生新 `run_id`，可回放完整审批链路。

### 4.4 API 契约

```
GET /api/chat/{thread_id}/trace              → 最近一次 run
GET /api/chat/{thread_id}/trace?run_id=xxx   → 指定 run
GET /api/chat/{thread_id}/trace/runs         → 该会话的 run 列表（轻量）
```

---

## 5. 前端改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/lib/types.ts` | 新增 `TraceSpan`、`SSETraceEvent`，并入 `SSEEvent` 联合类型 |
| 2 | `src/lib/api.ts` | 新增 `fetchTrace(threadId, runId?)` |
| 3 | `src/hooks/useChat.ts` | 新增 `traceSpans` state + `case "trace"` 分支（Map 累积、patch）；新会话时清空 |
| 4 | `src/components/trace/TracePanel.tsx` | **新建**。链路面板（汇总条 + 树形甘特） |
| 5 | `src/components/chat/ChatArea.tsx` | 顶部工具栏加"执行链路"开关，右侧抽屉挂载面板 |
| 6 | `src/app/page.tsx` | 透传 props |

### 5.1 TracePanel 交互

- **顶部汇总条**：总耗时 / 总 token（入+出）/ LLM 次数 / 工具次数 / 错误数
- **主体 = 树形 + 甘特合一**：
  - 每行按 `depth` 缩进，左侧 kind 徽标 + 名称（`analyst · get_suppliers`）
  - 右侧横向条：`left = (start - runStart) / total * 100%`，`width = duration / total * 100%`
    同一时刻的调用天然形成瀑布图，谁并行谁串行一眼可见
  - `running` → 呼吸动画条；`error` → 红色 + 悬浮显示 `error`；`interrupted` → 琥珀色虚线
  - LLM 行显示 `tokens`，父节点行显示 `subtree_tokens`（灰字，标 `含子项`）
  - 点击行折叠/展开子树；点击名称展开 `args_preview` / `result_preview`
- **空状态**：未采集到 span 时提示"callback 未生效"，便于排查

不引入新依赖（无 ReactFlow），纯 Tailwind + CSS 百分比定位。

---

## 6. 中断与异常场景

| 场景 | 处理 |
|---|---|
| HITL 审批中断 | `interrupts` 分支 finalize 时 `interrupted=True`，未闭合 span 标 `interrupted` 并补 `end_ms`；链路照样落库 |
| resume 恢复 | 新 `run_id`，新文档；前端按 run 切换查看 |
| 工具抛异常 | `on_tool_error` → `status=error` + `error=str(e)`，父节点继续走完，最终 stats 记 `error_count` |
| 顶层异常 | `except` 分支照样 finalize + 落库，保证"失败的那次也有链路" |
| callback 未生效 | 面板空状态提示；不抛错、不影响主对话流程（所有 trace 调用包 try/except） |

**原则**：Trace 是可观测旁路，**任何 trace 异常都不得中断对话**。

---

## 7. 验证方案

环境无本地 venv（依赖全在 Docker），因此分两层验证：

1. **静态**：`python -m py_compile` 全量编译
2. **逻辑单测（重点）**：`collector.py` 零框架依赖，写一个 mock 脚本
   `scripts/test_trace_collector.py`，用假 run 序列（含噪音层、子图、错误、未闭合）
   直接驱动 collector，断言：
   - 噪音层被剔除且父子重挂正确
   - `duration_ms` 计算正确
   - 子树 token 累加正确（子图 token 归到父节点）
   - 中断时未闭合 span 被标 `interrupted`
   - 序列化字段完整
3. **前端**：`npx tsc --noEmit` 类型检查 + `next build` 编译

> 端到端（真实 qwen 调用）需要你本地起 Docker + 填 API Key 后验证。

---

## 8. 实施步骤

| 阶段 | 内容 | 产出 |
|---|---|---|
| S1 | `models.py`（已完成）→ `collector.py` → 单测通过 | 链路核心逻辑可用且已验证 |
| S2 | `handler.py` + `chat.py` 接入 + 落库 + API 路由 | 后端可产出 trace 数据 |
| S3 | 前端 types / api / hook / TracePanel / 挂载 | 面板可见 |
| S4 | 编译校验 + 汇总 | 交付说明 |

---

## 9. 风险与兜底

| 风险 | 兜底 |
|---|---|
| LangGraph 未把 `config["callbacks"]` 传播到子图/LLM | 若实测子图 span 缺失，改为在 `create_main_agent()` 里给 model 与 tools 预挂 handler（`llm.callbacks`） |
| DashScope 不回 usage | 四路 fallback + `missing_usage` 计数；实在没有则 token 显示 `—` 而非 0 |
| 长会话 span 数爆炸（几百个） | 落库截断 `args/result` 500 字；前端默认折叠 depth ≥ 3 |
| trace 落库拖慢响应 | 落库放在流结束后一次性写，不在热路径 |
