"""
Agent 执行链路 Trace 采集

- models.Span     : span 数据模型（零框架依赖）
- TraceCollector  : run 流 → span 树的压实（零框架依赖，可单测）
- LangChainTraceHandler : LangChain 回调适配（需要 langchain_core）
"""
from .models import Span
from .collector import TraceCollector

__all__ = ["Span", "TraceCollector"]


def __getattr__(name):
    """延迟导入 handler，避免没有 langchain 的环境 import 失败"""
    if name in ("LangChainTraceHandler", "handler"):
        from . import handler as _handler
        return getattr(_handler, "LangChainTraceHandler") if name == "LangChainTraceHandler" else _handler
    raise AttributeError(name)
