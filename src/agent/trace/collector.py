"""
TraceCollector：把 callback 产生的原始 run 流，压实成一棵可读的 span 树。

四步走
------
1. 全量记录：所有 run 都进 _runs，保留原始父子关系（含框架噪音）
2. 保留判定：只保留 llm / tool / 有 langgraph_node 的 chain，其余视为噪音
3. 重挂父子：噪音被剔除后，子 span 挂到最近的保留祖先，树不断裂
4. token 归因：span 自身 token + 含后代的 subtree token（节点展示用后者）

为什么判重要看 (agent, node) 而不是单看 node
--------------------------------------------
主图和子图的节点名都叫 agent / tools，只比 node 名会把子 Agent 的整段链路
当成"重复"吃掉，导致"谁调用了谁"里的委派关系消失。

本模块不依赖 LangChain / LangGraph，可以用假的 run 序列直接驱动测试。
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .models import (
    KIND_GRAPH,
    KIND_LLM,
    KIND_NODE,
    KIND_REVIEW,
    KIND_RUN,
    KIND_TOOL,
    STATUS_ERROR,
    STATUS_INTERRUPTED,
    STATUS_OK,
    STATUS_RUNNING,
    Span,
    now_ms,
)

# callback 侧传入的原始 kind
RAW_CHAIN = "chain"
RAW_LLM = "llm"
RAW_TOOL = "tool"
RAW_REVIEW = "review"


class TraceCollector:
    """一次对话 turn 的 span 收集器。"""

    def __init__(
        self,
        thread_id: str = "",
        run_id: Optional[str] = None,
        root_name: str = "本轮提问",
        preview_limit: int = 500,
        clock=None,
    ):
        self.thread_id = thread_id
        self.run_id = run_id or str(uuid.uuid4())
        self.preview_limit = preview_limit
        # 可注入时钟：测试里用固定时间做精确断言，生产用真实时间
        self._now = clock or now_ms

        self._runs: Dict[str, Span] = {}
        self._retained: set = set()
        self._events: List[Tuple[str, Dict[str, Any]]] = []
        self._seq = 0
        self._finalized = False

        self.started_ms = self._now()
        self.root_id = f"run-{uuid.uuid4().hex[:12]}"

        root = Span(
            span_id=self.root_id,
            parent_id=None,
            kind=KIND_RUN,
            name=root_name,
            start_ms=self.started_ms,
            seq=self._next_seq(),
            status=STATUS_RUNNING,
        )
        self._runs[self.root_id] = root
        self._retained.add(self.root_id)
        self._emit("start", root)

    # ---------- 内部工具 ----------

    def _next_seq(self) -> int:
        self._seq += 1
        return self._seq

    def _emit(self, op: str, span: Span) -> None:
        self._events.append((op, span.to_dict()))

    def _clip(self, text: Optional[str]) -> Optional[str]:
        if text is None:
            return None
        s = text if isinstance(text, str) else str(text)
        s = s.replace("\n", " ").strip()
        if len(s) > self.preview_limit:
            return s[: self.preview_limit] + "…"
        return s or None

    def _resolve_parent(self, parent_id: Optional[str]) -> str:
        """原始父 id → 一定存在于 _runs 的父 id（缺失时挂到 root）"""
        if not parent_id:
            return self.root_id
        pid = str(parent_id)
        return pid if pid in self._runs else self.root_id

    def _ancestor_has_same_node(self, parent_id: str, agent: str, node: str) -> bool:
        """祖先链上是否已存在同 (agent, node) 的 chain run。

        用于吃掉节点内部的 RunnableSequence / Lambda 等重复包装层。
        """
        cur = parent_id
        for _ in range(64):  # 防御性上限，正常树深远小于此
            run = self._runs.get(cur)
            if run is None:
                return False
            if run.kind in (KIND_NODE, KIND_GRAPH, KIND_RUN) and run.agent == agent and run.node == node:
                return True
            if run.parent_id is None:
                return False
            cur = run.parent_id
        return False

    # ---------- 采集 ----------

    def start_span(
        self,
        span_id: str,
        parent_id: Optional[str] = None,
        kind: str = RAW_CHAIN,
        name: str = "",
        node: Optional[str] = None,
        agent: Optional[str] = None,
        model: Optional[str] = None,
        args_preview: Optional[str] = None,
    ) -> Optional[Span]:
        """开始一个 span。返回创建的 Span；若判定为框架噪音则返回 None。"""
        sid = str(span_id)
        if sid in self._runs:
            return self._runs[sid] if sid in self._retained else None

        pid = self._resolve_parent(parent_id)
        parent = self._runs[pid]
        agent = agent or parent.agent or "main"

        # --- 保留判定 + kind 归一化 ---
        if kind == RAW_LLM:
            eff_kind = KIND_LLM
            retain = True
        elif kind == RAW_TOOL:
            eff_kind = KIND_TOOL
            retain = True
        elif kind == RAW_REVIEW:
            # Harness 评审轮：chat.py 在 custom 流里手动开/关，非 callback 来源
            eff_kind = KIND_REVIEW
            retain = True
        else:  # RAW_CHAIN
            if parent.span_id == self.root_id:
                eff_kind = KIND_GRAPH
                retain = True
            elif node:
                # 同 (agent, node) 的祖先已存在 → 这是节点内部的包装层，丢弃
                retain = not self._ancestor_has_same_node(pid, agent, node)
                eff_kind = KIND_NODE
            else:
                eff_kind = KIND_NODE
                retain = False

        eff_name = name or node or (f"{kind}" if kind else "span")
        if eff_kind == KIND_NODE and node:
            eff_name = node

        span = Span(
            span_id=sid,
            parent_id=pid,
            kind=eff_kind,
            name=eff_name,
            start_ms=self._now(),
            seq=self._next_seq(),
            node=node,
            agent=agent,
            model=model,
            args_preview=self._clip(args_preview),
        )
        self._runs[sid] = span

        if retain:
            self._retained.add(sid)
            self._emit("start", span)
            return span
        return None

    def end_span(
        self,
        span_id: str,
        status: str = STATUS_OK,
        error: Optional[str] = None,
        result_preview: Optional[str] = None,
        tokens_in: int = 0,
        tokens_out: int = 0,
        tokens_total: Optional[int] = None,
    ) -> Optional[Span]:
        """结束一个 span。噪音 span 也会被记账（token 要向上冒泡）。"""
        sid = str(span_id)
        span = self._runs.get(sid)
        if span is None:
            return None

        span.end_ms = self._now()
        span.status = status
        if error:
            span.error = self._clip(error)
        if result_preview is not None:
            span.result_preview = self._clip(result_preview)

        span.tokens_in = max(0, int(tokens_in or 0))
        span.tokens_out = max(0, int(tokens_out or 0))
        span.tokens_total = (
            int(tokens_total) if tokens_total is not None else span.tokens_in + span.tokens_out
        )

        # token 向上冒泡：噪音层的 token 也要算进最近的保留祖先
        if sid not in self._retained:
            self._bubble_tokens(span)
        elif status == STATUS_ERROR:
            self._bubble_error(span)

        if sid in self._retained:
            self._emit("end", span)
            return span
        return None

    def _bubble_tokens(self, span: Span) -> None:
        """噪音 span 的 token 累加到最近的保留祖先"""
        if not (span.tokens_in or span.tokens_out):
            return
        cur = span.parent_id
        for _ in range(64):
            run = self._runs.get(cur)
            if run is None:
                return
            if cur in self._retained:
                run.tokens_in += span.tokens_in
                run.tokens_out += span.tokens_out
                run.tokens_total += span.tokens_total
                self._emit("end", run)
                return
            cur = run.parent_id

    def _bubble_error(self, span: Span) -> None:
        """把错误标记透传给最近的保留祖先（祖先自身状态不变，仅补 error 文案）"""
        cur = span.parent_id
        for _ in range(64):
            run = self._runs.get(cur)
            if run is None or cur == self.root_id:
                return
            if cur in self._retained:
                if not run.error:
                    run.error = span.error
                    self._emit("end", run)
                return
            cur = run.parent_id

    # ---------- 增量输出 ----------

    def drain(self) -> List[Tuple[str, Dict[str, Any]]]:
        """取出并清空待发送的增量事件（供 SSE 实时推送）"""
        events = self._events
        self._events = []
        return events

    # ---------- 压实与统计 ----------

    def finalize(self, interrupted: bool = False) -> Dict[str, Any]:
        """压实成最终树，返回可落库的 payload（重复调用结果稳定，仅时间戳会刷新）"""
        now = self._now()
        root = self._runs[self.root_id]

        # 1. 收尾：未闭合的 span（root 单独处理，它从不 end_span）
        for sid, span in self._runs.items():
            if sid == self.root_id:
                continue
            if span.status == STATUS_RUNNING:
                span.end_ms = span.end_ms or now
                span.status = STATUS_INTERRUPTED if interrupted else STATUS_OK

        # 2. 重挂父子：噪音剔除后指向最近的保留祖先
        for sid in list(self._retained):
            if sid == self.root_id:
                continue
            cur = self._runs[sid].parent_id
            while cur and cur != self.root_id and cur not in self._retained:
                nxt = self._runs.get(cur)
                if nxt is None:
                    cur = self.root_id
                    break
                cur = nxt.parent_id or self.root_id
            self._runs[sid].parent_id = cur or self.root_id

        # 3. 计算 depth（从 root 逐层下推）
        children: Dict[str, List[str]] = defaultdict(list)
        for sid in self._retained:
            children[self._runs[sid].parent_id].append(sid)
        for lst in children.values():
            lst.sort(key=lambda s: (self._runs[s].start_ms, self._runs[s].seq))

        self._runs[self.root_id].depth = 0
        stack = [self.root_id]
        while stack:
            cur = stack.pop()
            for child in children.get(cur, []):
                self._runs[child].depth = self._runs[cur].depth + 1
                stack.append(child)

        # 4. token 归因：自身 → 含后代
        ordered = sorted(
            self._retained,
            key=lambda s: self._runs[s].depth,
            reverse=True,
        )
        for sid in ordered:
            span = self._runs[sid]
            span.subtree_in = span.tokens_in
            span.subtree_out = span.tokens_out
            span.subtree_total = span.tokens_total
        for sid in ordered:
            span = self._runs[sid]
            parent = self._runs.get(span.parent_id)
            if parent is not None and span.span_id != self.root_id:
                parent.subtree_in += span.subtree_in
                parent.subtree_out += span.subtree_out
                parent.subtree_total += span.subtree_total

        # 5. 输出排序：按开始时间，同级按注册顺序
        spans = [self._runs[sid] for sid in self._retained]
        spans.sort(key=lambda s: (s.start_ms, s.seq))

        # 6. 统计（root 的结束时间与状态最后由整体结果决定）
        max_end = max((s.end_ms or 0) for s in self._runs.values())
        root.end_ms = max(max_end, root.start_ms) if max_end else now

        stats = self._build_stats(spans, interrupted)
        root.status = stats["status"]

        self._finalized = True
        return {
            "thread_id": self.thread_id,
            "run_id": self.run_id,
            "started_at": datetime.fromtimestamp(self.started_ms / 1000).isoformat(timespec="milliseconds"),
            "ended_at": datetime.fromtimestamp(now / 1000).isoformat(timespec="milliseconds"),
            "status": stats["status"],
            "spans": [s.to_dict() for s in spans],
            "stats": stats,
        }

    def _build_stats(self, spans: List[Span], interrupted: bool) -> Dict[str, Any]:
        # root 不计入各类计数，避免"根 span 也是一次调用"的错觉
        body = [s for s in spans if s.span_id != self.root_id]

        llm_calls = sum(1 for s in body if s.kind == KIND_LLM)
        tool_calls = sum(1 for s in body if s.kind == KIND_TOOL)
        error_count = sum(1 for s in body if s.status == STATUS_ERROR)
        interrupted_count = sum(1 for s in body if s.status == STATUS_INTERRUPTED)
        missing_usage = sum(1 for s in body if s.kind == KIND_LLM and s.tokens_total == 0)

        root = self._runs[self.root_id]
        duration_ms = root.duration_ms or 0

        if error_count:
            status = STATUS_ERROR
        elif interrupted or interrupted_count:
            status = STATUS_INTERRUPTED
        else:
            status = STATUS_OK

        return {
            "status": status,
            "duration_ms": duration_ms,
            "span_count": len(spans),
            "llm_calls": llm_calls,
            "tool_calls": tool_calls,
            "error_count": error_count,
            "interrupted_count": interrupted_count,
            "missing_usage": missing_usage,
            "tokens_in": root.subtree_in,
            "tokens_out": root.subtree_out,
            "tokens_total": root.subtree_total,
            "max_depth": max((s.depth for s in spans), default=0),
        }

    # ---------- 便捷读取 ----------

    def iter_spans(self) -> Iterable[Span]:
        for sid in sorted(self._retained, key=lambda s: (self._runs[s].start_ms, self._runs[s].seq)):
            yield self._runs[sid]
