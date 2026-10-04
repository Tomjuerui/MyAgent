"""
中间件: 同一轮内只读工具结果去重

为什么需要
----------
采集类工具（fetch_* / search_github_repos / mcp_browser_navigate / web_search …）
都是无状态直连 HTTP，模型同一轮里换个 per_page、换个大小写就会再打一发真实请求。
实测轨迹（erp_agent.agent_traces）：
- thread 366c1f6c：单源任务 fetch_hackernews_top 打了 8 枪
- thread cc9a3906：langgraph/crewAI/autogen 三个仓库各 fetch_github_releases 两遍
这些工具是幂等只读的，同一轮内 (工具名, 参数) 相同必然得到相同结果，重复调用纯属浪费
真实网络往返 + 后续每次模型调用的输入 token（重复结果还会堆进 transcript 抬高地平线）。

作用域
------
按 (thread_id, 本轮 user 消息 id, 工具名, 规范化参数) 缓存 → 只在本轮内生效。
轮次边界取「最近一条 user 消息 id」而非 before_agent：实测 before_agent 会在同一轮内触发多次
（Harness/评审回路让 agent 图跑多遍），无脑清空会把同轮的重复调用也清掉。
跨轮数据可能已变化，必须重新采集，故不做跨轮缓存。
key 里带 thread_id：AgentLoader 是单例共享 Agent，多会话并发时不会把 A 的结果串给 B。

只管只读工具
------------
写类工具（generate_document / generate_chart / order_* / 沙箱写文件…）不在白名单，
反复调用是另一类问题（由 generate_chart 自身幂等处理），不能在这里吞掉。
错误结果也不缓存，保证「失败后换来源/换参数重试」仍然有效。
"""
import json
from typing import Any, Awaitable, Callable

from langchain_core.messages import ToolMessage
from langchain.agents.middleware import AgentMiddleware, Runtime, ToolCallRequest
from langgraph.types import Command

from ..log_utils import middleware_logger

# 幂等只读工具白名单：同一轮内相同参数重复调用必然得到相同结果
DEDUP_TOOLS = {
    "fetch_github_releases",
    "fetch_hackernews_top",
    "fetch_arxiv_papers",
    "search_github_repos",
    "mcp_browser_navigate",
    "mcp_extract_table",
    "web_search",
    "web_fetch",
}


class ToolDedupMiddleware(AgentMiddleware):
    """同轮内只读工具结果去重（命中缓存时不真调工具）。"""

    def __init__(self, tools: set[str] | None = None):
        self._tools = set(tools) if tools is not None else set(DEDUP_TOOLS)
        self._cache: dict[str, str] = {}
        self._epoch: str = ""
        self.tools = []

    @property
    def name(self) -> str:
        return "ToolDedupMiddleware"

    def _sync_epoch(self, state: Any) -> str:
        """按「最近一条 user 消息 id」判定轮次边界；变了才清缓存。

        不要在每个 before_agent 里无脑清空：实测 before_agent 会在同一轮内触发多次
        （Harness/评审回路会让 agent 图跑多遍，thread p2-dir1-008 一轮内触发 2 次，且第 2 次
        清掉了 cache=1 的条目），无脑清空会让「同轮重复调用」永远命中不了，等于没去重。
        """
        epoch = _last_human_id(state)
        if epoch and epoch != self._epoch:
            self._cache.clear()
            self._epoch = epoch
        return self._epoch

    def before_agent(self, state: Any, runtime: Runtime) -> dict[str, Any] | None:
        self._sync_epoch(state)
        return None

    def _thread_id(self, request: ToolCallRequest) -> str:
        try:
            cfg = getattr(request.runtime, "config", None) or {}
            return str((cfg.get("configurable") or {}).get("thread_id", ""))
        except Exception:
            return ""

    def _key(self, request: ToolCallRequest) -> str | None:
        """命中返回缓存 key；非白名单工具时返回 None（直接放行）。"""
        tc = request.tool_call or {}
        name = tc.get("name", "")
        if name not in self._tools:
            return None
        epoch = self._sync_epoch(getattr(request, "state", None))
        args = _normalize_args(name, tc.get("args") or {})
        args_json = _json_dumps(args)
        return f"{self._thread_id(request)}|{epoch}|{name}|{args_json}"

    @staticmethod
    def _is_error(result: Any) -> bool:
        """错误结果不缓存，让失败后的换来源/换参数重试仍然生效。"""
        if isinstance(result, ToolMessage) and getattr(result, "status", None) == "error":
            return True
        content = getattr(result, "content", None)
        if isinstance(content, str):
            head = content.lstrip()[:32]
            return head.startswith('{"error') or head.startswith("{'error")
        return False

    def _cached_message(self, request: ToolCallRequest, content: str) -> ToolMessage:
        tc = request.tool_call or {}
        return ToolMessage(
            content=content,
            tool_call_id=tc.get("id", ""),
            name=tc.get("name"),
        )

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        key = self._key(request)
        if key is None:
            return await handler(request)

        cached = self._cache.get(key)
        if cached is not None:
            middleware_logger.info(
                f"ToolDedup: cache hit, skip real call -> {request.tool_call.get('name')}"
            )
            return self._cached_message(request, cached)

        result = await handler(request)
        if key not in self._cache and not self._is_error(result):
            if isinstance(result, ToolMessage) and isinstance(result.content, str):
                self._cache[key] = result.content
        return result

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command[Any]],
    ) -> ToolMessage | Command[Any]:
        key = self._key(request)
        if key is None:
            return handler(request)

        cached = self._cache.get(key)
        if cached is not None:
            middleware_logger.info(
                f"ToolDedup: cache hit, skip real call -> {request.tool_call.get('name')}"
            )
            return self._cached_message(request, cached)

        result = handler(request)
        if key not in self._cache and not self._is_error(result):
            if isinstance(result, ToolMessage) and isinstance(result.content, str):
                self._cache[key] = result.content
        return result


def _json_dumps(obj: Any) -> str:
    """稳定序列化：key 排序 + 中文不转义；不可序列化时退化为 repr。"""
    try:
        return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=repr)
    except Exception:
        return repr(obj)


def _last_human_id(state: Any) -> str:
    """取最近一条 user 消息的 id 作为「本轮」标识；取不到返回空串。"""
    try:
        msgs = state.get("messages") if isinstance(state, dict) else getattr(state, "messages", None)
    except Exception:
        return ""
    if not msgs:
        return ""
    for m in reversed(msgs):
        t = getattr(m, "type", None) or (m.get("role") if isinstance(m, dict) else None)
        if t in ("human", "user"):
            mid = getattr(m, "id", None) or (m.get("id") if isinstance(m, dict) else None)
            return str(mid) if mid else ""
    return ""


# 文本检索类参数：底层（GitHub Search / HN Algolia / arXiv / 搜索引擎）对大小写与
# 多余空白不敏感，故折叠后并入 key，让 "LangGraph" 与 "langgraph" 命中同一缓存。
# 只折叠文本参数：per_page / stories_count / max_results 是「取多少条」，不同值结果不同，
# 折叠会让 page=5 顶替 page=30 返回错数据，绝不能归一化。web_fetch 的 url 路径大小写敏感，也不折叠。
_TEXT_ARG_FIELDS = {
    "search_github_repos": ("query",),
    "fetch_arxiv_papers": ("query",),
    "fetch_hackernews_top": ("query",),
    "web_search": ("query",),
    "fetch_github_releases": ("owner", "repo"),
}


def _fold_text(value: Any) -> str:
    """折叠大小写与连续空白：'  LangGraph ' -> 'langgraph'。"""
    return " ".join(str(value).split()).lower()


def _normalize_args(name: str, args: Any) -> Any:
    """按工具折叠文本参数；无规则或非 dict 时原样返回。"""
    fields = _TEXT_ARG_FIELDS.get(name)
    if not fields or not isinstance(args, dict):
        return args
    out = dict(args)
    for field in fields:
        if isinstance(out.get(field), str):
            out[field] = _fold_text(out[field])
    return out
