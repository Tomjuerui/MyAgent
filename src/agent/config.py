"""
全局配置模块
LLM、Store、Checkpointer、沙箱连接参数
"""
import os
from urllib.parse import urlsplit
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


class ReasoningChatOpenAI(ChatOpenAI):
    """ChatOpenAI 子类：保留第三方网关的 reasoning_content。

    langchain-openai 的 ChatOpenAI 只实现官方 OpenAI 规范，不提取非标准字段
    reasoning_content（见 langchain_openai/chat_models/base.py 模块头 warning）。
    思考型模型（hy4-preview-f / deepseek-v4.1-flash）推理期 content 为空、内容
    全在 reasoning_content，若不保留则该字段被静默丢弃，前端在推理期长时间无
    任何输出。此处覆写 chunk 转换钩子（_stream/_astream 都经此），把
    reasoning_content 塞回 additional_kwargs，供 chat.py 透传为 reasoning 事件。
    """

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ):
        generation_chunk = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        if generation_chunk is not None:
            choices = chunk.get("choices") or []
            if choices:
                delta = choices[0].get("delta") or {}
                reasoning = delta.get("reasoning_content")
                if reasoning:
                    generation_chunk.message.additional_kwargs["reasoning_content"] = reasoning
        return generation_chunk


def get_llm(model: str | None = None) -> ChatOpenAI:
    """获取 LLM 实例（OpenAI 兼容接口，当前指向本地反代网关）。

    Args:
        model: 覆盖默认模型名（如评审器换快模型 kimi-k2.6）；
            为 None 时用 LLM_MODEL。
    """
    return ReasoningChatOpenAI(
        model=model or LLM_MODEL,
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

# 与 webintel-mcp 同源的白名单（供「域名感知审批」：白名单内自动放行，白名单外弹卡）。
# 必须与 docker-compose.yml 里 webintel-mcp 的 CRAWL_ALLOW_DOMAINS 保持一致，
# 否则会出现「前端不弹卡但 MCP 拦」或「前端弹卡但 MCP 放行」的不一致。
CRAWL_ALLOW_DOMAINS = get_env(
    "CRAWL_ALLOW_DOMAINS", "github.com,api.github.com,news.ycombinator.com,arxiv.org"
)
_CRAWL_ALLOW_SET = {d.strip().lower() for d in CRAWL_ALLOW_DOMAINS.split(",") if d.strip()}

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

# 停摆熔断器：连续多少步（模型调用后无任何新信息）即强制结束，防止"一直规划执行不推进"。
STALL_BREAKER_THRESHOLD = get_env_int("STALL_BREAKER_THRESHOLD", 3)
# 子 Agent 调用上限：主 Agent 的限流中间件不传播到子 Agent，需单独注入，
# 否则子 Agent（ecosystem-crawler / tech-analyst）可无上限循环（实测 99 次模型调用）。
SUBAGENT_MAX_MODEL_CALLS = get_env_int("SUBAGENT_MAX_MODEL_CALLS", 15)
SUBAGENT_MAX_TOOL_CALLS = get_env_int("SUBAGENT_MAX_TOOL_CALLS", 20)

# ============ 中断配置 ============
# 兜底层：白名单外域名时 WebIntel-MCP 会返回结构化 domain_not_allowed 错误，
# 子 Agent YAML 的 interrupt_on 是主拦截路径，这里是全局兜底。
# 注意：generate_document 已移出审批清单——研报/文档是对话任务的自然交付物，写文件不弹卡。
# mcp_browser_navigate 采用「域名感知」：白名单内自动放行（不弹卡），
# 白名单外才中断审批——真正的域名拦截仍在 webintel 闸门层兜底。
def _navigate_needs_approval(req) -> bool:
    """when 谓词：URL 域名不在白名单时返回 True（弹卡），否则自动放行。"""
    tool_call = getattr(req, "tool_call", None) or {}
    args = tool_call.get("args") if isinstance(tool_call, dict) else {}
    url = (args or {}).get("url", "")
    host = (urlsplit(url).hostname or "").lower()
    return host not in _CRAWL_ALLOW_SET


INTERRUPT_ON_TOOLS = {
    "order_create": {"allowed_decisions": ["approve", "reject"]},
    "order_update": {"allowed_decisions": ["approve", "reject"]},
    "mcp_browser_navigate": {
        "allowed_decisions": ["approve", "reject"],
        "when": _navigate_needs_approval,
    },
}
