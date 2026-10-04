"""
Langfuse 旁路接入：有 key 才启用，构造失败静默降级。

与自研 LangChainTraceHandler 并行挂在 config["callbacks"] 上：
- Langfuse 负责「事后深查/成本/评测」的全量快照（完整 prompt/输出，批量上报服务端）
- 自研 handler 负责「实时前端链路」（SSE 推 span，落 MongoDB）

Langfuse SDK 自带后台队列批量上报，web 常驻进程无需手动 flush。
"""
import os

from ..log_utils import web_logger


def build_langfuse_handler():
    """构造 Langfuse callback handler；未配置 key 或构造失败返回 None。"""
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        return None
    try:
        from langfuse.langchain import CallbackHandler
        return CallbackHandler()
    except Exception as e:
        web_logger.warning(f"Langfuse handler unavailable, observability disabled: {e}")
        return None
