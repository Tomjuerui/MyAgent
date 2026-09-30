"""
全局配置模块
LLM、Store、Checkpointer、沙箱连接参数
"""
import os
from langchain_openai import ChatOpenAI
from .env_utils import get_env, get_env_int

# ============ LLM 配置 ============
# 默认走本地反代网关 workbuddy2api-hub（http://127.0.0.1:8788/v1）
# 换模型：改 .env 的 LLM_MODEL 即可（hy4-preview-f / hy3 / deepseek-v4.1-flash / glm-5.3 ...）
# 原阿里云 DashScope 配置如下，需要切回时取消注释并注释掉本地反代默认值：
# LLM_MODEL = get_env("LLM_MODEL", "qwen-plus")
# LLM_BASE_URL = get_env("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
# LLM_API_KEY = get_env("LLM_API_KEY", "") or get_env("DASHSCOPE_API_KEY", "")
LLM_MODEL = get_env("LLM_MODEL", "hy4-preview-f")
LLM_BASE_URL = get_env("LLM_BASE_URL", "http://127.0.0.1:8788/v1")
LLM_API_KEY = get_env("LLM_API_KEY", "")
LLM_TEMPERATURE = 0.1
# hy4/hy3 都是思考型模型，思维链与正文共用输出额度（上游上限 64k），
# 4096 会被思维链吃满导致 content 为空
LLM_MAX_TOKENS = get_env_int("LLM_MAX_TOKENS", 16384)


def get_llm() -> ChatOpenAI:
    """获取 LLM 实例（OpenAI 兼容接口，当前指向本地反代网关）"""
    return ChatOpenAI(
        model=LLM_MODEL,
        base_url=LLM_BASE_URL,
        api_key=LLM_API_KEY or "EMPTY",
        temperature=LLM_TEMPERATURE,
        max_tokens=LLM_MAX_TOKENS,
        # OpenAI 兼容接口默认不在流式响应中返回 usage，不加这项 trace 采集拿不到 token
        stream_usage=True,
    )


# ============ MongoDB 配置 ============
MONGODB_URI = get_env("MONGODB_URI", "mongodb://localhost:27017")
MONGODB_DB_NAME = get_env("MONGODB_DB_NAME", "erp_agent")

# ============ MCP Server 配置 ============
MCP_SERVER_URL = get_env("MCP_SERVER_URL", "http://localhost:9000")
MCP_SSE_URL = f"{MCP_SERVER_URL}/sse"

# WebIntel-MCP（独立进程的只读网页采集 MCP，streamable-http :9002）
# Docker 内走服务名；本地开发指向 localhost
WEBINTEL_MCP_URL = get_env("WEBINTEL_MCP_URL", "http://localhost:9002/mcp")

# ============ 沙箱配置 ============
SANDBOX_IMAGE = get_env("SANDBOX_IMAGE", "python:3.11-slim")#Docker 镜像名称，具体是 Python 3.11 的 slim（精简）版本
SANDBOX_WORK_DIR = "/workspace"
SANDBOX_SKILLS_DIR = "/skills"
SANDBOX_MEMORIES_DIR = "/memories"

# ============ Store 命名空间 ============
SKILLS_STORE_NAMESPACE = ("persisted-skills",)
PREFERENCES_STORE_NAMESPACE = ("user-preferences",)

# ============ Agent 配置 ============
MAX_MODEL_CALLS = get_env_int("MAX_MODEL_CALLS", 50)
MAX_TOOL_CALLS = get_env_int("MAX_TOOL_CALLS", 30)
SUMMARIZATION_THRESHOLD = 0.85  # 85% 上下文窗口时触发摘要

# ============ 中断配置 ============
# 兜底层：白名单外域名时 WebIntel-MCP 会返回结构化 domain_not_allowed 错误，
# 子 Agent YAML 的 interrupt_on 是主拦截路径，这里是全局兜底（含文档生成）。
INTERRUPT_ON_TOOLS = {
    "order_create": {"allowed_decisions": ["approve", "reject"]},
    "order_update": {"allowed_decisions": ["approve", "reject"]},
    "mcp_browser_navigate": {"allowed_decisions": ["approve", "reject"]},
    "generate_document": {"allowed_decisions": ["approve", "reject"]},
}
