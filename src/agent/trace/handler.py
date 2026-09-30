"""
LangChain 回调 → TraceCollector 的适配层。

挂载方式（chat.py）：
    handler = LangChainTraceHandler(collector)
    config["callbacks"] = [handler]

为什么用 callback 而不是在 astream 循环里手工埋点：
LangChain 的 run_id / parent_run_id 本身就是一棵树，节点名、模型名、usage
都能从这里拿到；手工埋点只能靠 namespace 猜父子关系，且拿不到 token。
"""
from __future__ import annotations

import json
from typing import Any, Dict, Optional
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler

from .collector import RAW_CHAIN, RAW_LLM, RAW_TOOL, TraceCollector
from .models import STATUS_ERROR, STATUS_OK


def _as_id(value: Any) -> str:
    """run_id 可能是 UUID，统一成 str"""
    if value is None:
        return ""
    return str(value)


def _name_of(serialized: Optional[Dict[str, Any]], default: str = "") -> str:
    """从 serialized 里取可读名字：优先 name，其次 id 列表末位"""
    if isinstance(serialized, dict):
        name = serialized.get("name")
        if name:
            return str(name)
        ids = serialized.get("id")
        if isinstance(ids, list) and ids:
            return str(ids[-1])
        if isinstance(ids, str) and ids:
            return str(ids)
    return default


def _agent_of(metadata: Optional[Dict[str, Any]], node: Optional[str] = None) -> str:
    """从 langgraph_checkpoint_ns 推断归属 agent。

    子图形如 "procurement-analyst:6b7b0e2f-..."，取冒号前一段。
    主图的 ns 首段就是节点/中间件任务名（"model"、"TodoListMiddleware.after_model"），
    必须排除，否则会把节点名当成 agent 显示成 "model · model" 这种重复。
    """
    md = metadata or {}
    ns = md.get("langgraph_checkpoint_ns") or ""
    if not ns:
        return "main"
    head = str(ns).split(":")[0]
    if not head:
        return "main"
    # 中间件任务名带点号 → 主图内部，不是子 Agent
    if "." in head:
        return "main"
    # 与当前节点同名 → 主图节点自己的命名空间
    if node and head == node:
        return "main"
    # 形如 6b7b0e2f-1c2d-... 的无名命名空间
    if len(head) >= 32 and "-" in head:
        return "main"
    return head


def _node_of(metadata: Optional[Dict[str, Any]]) -> Optional[str]:
    md = metadata or {}
    node = md.get("langgraph_node")
    return str(node) if node else None


def _model_of(serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any]) -> str:
    """尽力拿模型名：invocation_params → serialized → kwargs"""
    inv = kwargs.get("invocation_params")
    if isinstance(inv, dict):
        for key in ("model", "model_name", "model_id", "deployment_name"):
            if inv.get(key):
                return str(inv[key])
    md = kwargs.get("metadata") or {}
    for key in ("ls_model_name", "model_name", "model"):
        if md.get(key):
            return str(md[key])
    if isinstance(serialized, dict):
        kw = serialized.get("kwargs")
        if isinstance(kw, dict):
            for key in ("model", "model_name"):
                if kw.get(key):
                    return str(kw[key])
    return ""


def _extract_usage(response: Any) -> Dict[str, int]:
    """四路 fallback 提取 token 用量。

    1. generations[0][0].message.usage_metadata     —— LangChain 标准
    2. llm_output["token_usage"]                    —— OpenAI 兼容（DashScope 走这条）
    3. generations[0][0].message.response_metadata  —— 兜底
    4. 都没有 → 全 0（collector 侧会记 missing_usage，避免"看着是 0"的误判）
    """
    empty = {"in": 0, "out": 0, "total": 0}
    if response is None:
        return empty

    # 1) usage_metadata
    try:
        gens = getattr(response, "generations", None) or []
        if gens and gens[0]:
            msg = gens[0][0].message
            um = getattr(msg, "usage_metadata", None)
            if isinstance(um, dict) and um:
                tin = int(um.get("input_tokens") or um.get("prompt_tokens") or 0)
                tout = int(um.get("output_tokens") or um.get("completion_tokens") or 0)
                total = int(um.get("total_tokens") or (tin + tout))
                if tin or tout or total:
                    return {"in": tin, "out": tout, "total": total}

            # 3) response_metadata
            rm = getattr(msg, "response_metadata", None)
            if isinstance(rm, dict):
                tu = rm.get("token_usage") or rm.get("usage")
                if isinstance(tu, dict):
                    tin = int(tu.get("prompt_tokens") or tu.get("input_tokens") or 0)
                    tout = int(tu.get("completion_tokens") or tu.get("output_tokens") or 0)
                    total = int(tu.get("total_tokens") or (tin + tout))
                    if tin or tout or total:
                        return {"in": tin, "out": tout, "total": total}
    except Exception:
        pass

    # 2) llm_output
    try:
        llm_output = getattr(response, "llm_output", None)
        if isinstance(llm_output, dict):
            tu = llm_output.get("token_usage") or llm_output.get("usage")
            if isinstance(tu, dict):
                tin = int(tu.get("prompt_tokens") or tu.get("input_tokens") or 0)
                tout = int(tu.get("completion_tokens") or tu.get("output_tokens") or 0)
                total = int(tu.get("total_tokens") or (tin + tout))
                if tin or tout or total:
                    return {"in": tin, "out": tout, "total": total}
    except Exception:
        pass

    return empty


def _preview(value: Any, limit: int = 500) -> str:
    """把任意入参/出参压成一行预览文本"""
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            text = str(value)
    text = text.replace("\n", " ").strip()
    return text[:limit]


class LangChainTraceHandler(AsyncCallbackHandler):
    """把 LangChain 的 run 回调翻译成 span 事件。

    刻意不实现 on_llm_new_token：流式 token 回调用量巨大且不带 usage，
    只会拖慢链路采集。
    """

    def __init__(self, collector: TraceCollector):
        super().__init__()
        self.collector = collector

    # ===== chain（图 / 节点 / 框架包装层）=====

    async def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, **kwargs):
        try:
            metadata = kwargs.get("metadata") or {}
            node = _node_of(metadata)
            agent = _agent_of(metadata, node)
            self.collector.start_span(
                span_id=_as_id(run_id),
                parent_id=_as_id(parent_run_id),
                kind=RAW_CHAIN,
                name=_name_of(serialized, "chain"),
                node=node,
                agent=agent,
            )
        except Exception:
            pass

    async def on_chain_end(self, outputs, *, run_id, parent_run_id=None, **kwargs):
        try:
            self.collector.end_span(_as_id(run_id), STATUS_OK, result_preview=_preview(outputs))
        except Exception:
            pass

    async def on_chain_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        try:
            self.collector.end_span(_as_id(run_id), STATUS_ERROR, error=_preview(error, 300))
        except Exception:
            pass

    # ===== llm =====

    async def on_llm_start(self, serialized, prompts, *, run_id, parent_run_id=None, **kwargs):
        try:
            metadata = kwargs.get("metadata") or {}
            node = _node_of(metadata)
            model = _model_of(serialized, kwargs)
            name = f"llm · {model}" if model else "llm"
            preview = _preview(prompts, 500) if prompts else ""
            self.collector.start_span(
                span_id=_as_id(run_id),
                parent_id=_as_id(parent_run_id),
                kind=RAW_LLM,
                name=name,
                node=node,
                agent=_agent_of(metadata, node),
                model=model or None,
                args_preview=preview,
            )
        except Exception:
            pass

    async def on_llm_end(self, response, *, run_id, parent_run_id=None, **kwargs):
        try:
            usage = _extract_usage(response)
            text = ""
            try:
                gens = getattr(response, "generations", None) or []
                if gens and gens[0]:
                    text = getattr(gens[0][0], "text", "") or ""
            except Exception:
                pass
            self.collector.end_span(
                _as_id(run_id),
                STATUS_OK,
                result_preview=text,
                tokens_in=usage["in"],
                tokens_out=usage["out"],
                tokens_total=usage["total"],
            )
        except Exception:
            pass

    async def on_llm_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        try:
            self.collector.end_span(_as_id(run_id), STATUS_ERROR, error=_preview(error, 300))
        except Exception:
            pass

    # ===== tool =====

    async def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, **kwargs):
        try:
            metadata = kwargs.get("metadata") or {}
            node = _node_of(metadata)
            name = _name_of(serialized, "tool")
            inputs = kwargs.get("inputs")
            preview = input_str if isinstance(input_str, str) and input_str else _preview(inputs)
            self.collector.start_span(
                span_id=_as_id(run_id),
                parent_id=_as_id(parent_run_id),
                kind=RAW_TOOL,
                name=name,
                node=node,
                agent=_agent_of(metadata, node),
                args_preview=preview,
            )
        except Exception:
            pass

    async def on_tool_end(self, output, *, run_id, parent_run_id=None, **kwargs):
        try:
            self.collector.end_span(_as_id(run_id), STATUS_OK, result_preview=_preview(output))
        except Exception:
            pass

    async def on_tool_error(self, error, *, run_id, parent_run_id=None, **kwargs):
        try:
            self.collector.end_span(_as_id(run_id), STATUS_ERROR, error=_preview(error, 300))
        except Exception:
            pass
