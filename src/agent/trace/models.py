"""
Trace 数据模型：span 树的基本结构与序列化。

这里刻意不 import 任何 LangChain / LangGraph 的东西，方便脱离框架单独跑测试。

一次对话 turn = 一个 run，run 内是一棵 span 树：
    run
     └── graph (LangGraph 顶层执行)
          └── node (图节点，如 agent / tools，子图节点会带 agent 标记)
               ├── llm  (模型调用，唯一真正产生 token 的地方)
               └── tool (工具调用，子 Agent 委派也走这里)
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

# ===== span 类型 =====
KIND_RUN = "run"      # 一次 turn 的根
KIND_GRAPH = "graph"  # LangGraph 顶层执行
KIND_NODE = "node"    # 图节点（含子图内的节点）
KIND_LLM = "llm"      # 模型调用
KIND_TOOL = "tool"    # 工具调用

# ===== span 状态 =====
STATUS_RUNNING = "running"
STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_INTERRUPTED = "interrupted"

TERMINAL_STATUSES = (STATUS_OK, STATUS_ERROR, STATUS_INTERRUPTED)


def now_ms() -> int:
    """当前时间戳（毫秒）"""
    return int(time.time() * 1000)


@dataclass
class Span:
    """一次可观测的执行单元。

    tokens_*       : 本 span 自身产生的 token（只有 llm 有值）
    subtree_tokens : 含所有后代的累计 token（节点/图/根用这个展示"这一步总共烧了多少"）
    """

    span_id: str
    parent_id: Optional[str]
    kind: str
    name: str
    start_ms: int
    seq: int = 0

    end_ms: Optional[int] = None
    status: str = STATUS_RUNNING

    node: Optional[str] = None       # langgraph 节点名
    agent: str = "main"              # 归属 agent（main / 子 agent 名）
    model: Optional[str] = None      # 模型名（llm span）

    tokens_in: int = 0
    tokens_out: int = 0
    tokens_total: int = 0

    subtree_in: int = 0
    subtree_out: int = 0
    subtree_total: int = 0

    error: Optional[str] = None
    args_preview: Optional[str] = None
    result_preview: Optional[str] = None
    depth: int = 0

    @property
    def duration_ms(self) -> Optional[int]:
        if self.end_ms is None:
            return None
        return max(0, self.end_ms - self.start_ms)

    def apply(self, **fields) -> "Span":
        """就地更新若干字段（用于增量 patch）"""
        for k, v in fields.items():
            if hasattr(self, k):
                setattr(self, k, v)
        return self

    def to_dict(self) -> Dict[str, Any]:
        return {
            "span_id": self.span_id,
            "parent_id": self.parent_id,
            "kind": self.kind,
            "name": self.name,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "duration_ms": self.duration_ms,
            "status": self.status,
            "node": self.node,
            "agent": self.agent,
            "model": self.model,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "tokens_total": self.tokens_total,
            "subtree_in": self.subtree_in,
            "subtree_out": self.subtree_out,
            "subtree_total": self.subtree_total,
            "error": self.error,
            "args_preview": self.args_preview,
            "result_preview": self.result_preview,
            "depth": self.depth,
            "seq": self.seq,
        }
