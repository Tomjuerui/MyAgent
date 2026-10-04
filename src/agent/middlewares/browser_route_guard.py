"""
中间件: 浏览器采集路由硬拦截（把「API 优先」从提示升级为机制）

为什么需要
----------
提示词已写明「GitHub / HN / arXiv 走 fetch_* 结构化 API，浏览器仅兜底」，但实测
（thread p2-dir1-003）模型在「发现/排行」类任务上仍打了 16 次 mcp_browser_navigate，
全是 github.com/search、/topics/*、各 repo 主页——提示词管不住工具路由。

本中间件在「开浏览器的采集工具」真正执行前解析 URL：
- 能映射到结构化 API 的（github 搜索/releases、HN 首页等）→ 直接改派 API 工具并返回结果，
  模型立刻拿到数据，且 0 次真实浏览器访问；
- 属 API 已覆盖域但无对应接口的（如 GitHub Trending）→ 返回结构化提示，引导改用 API 工具；
- 其余（博客正文、官网、issues/blob 等）原样放行，仍走原有域名白名单 + HITL 审批。

拦截对象是所有 mcp_browser_* 前缀工具 + mcp_extract_table / mcp_take_screenshot
（它们同样传 url 开浏览器；只拦 navigate 会被模型绕过，见 _BROWSER_PREFIX 注释）。

只读、无副作用：拦截时不开浏览器、不改工作区，最坏情况（解析异常）退化为放行。
"""
import asyncio
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit, parse_qs

from langchain_core.messages import ToolMessage
from langchain.agents.middleware import AgentMiddleware, Runtime, ToolCallRequest
from langgraph.types import Command

from ..log_utils import middleware_logger

# 拦截范围：所有 mcp_browser_* 前缀工具，外加同样「传 url 开浏览器」的采集工具。
# 实测（p2-dir1-005）只拦 navigate 会被绕过——模型改用 mcp_take_screenshot /
# mcp_extract_table 打开同一个 github URL，再为读回 PNG 白烧 5 次 execute + 4 次 read_file。
_BROWSER_PREFIX = "mcp_browser_"
_EXTRA_BROWSER_TOOLS = {"mcp_extract_table", "mcp_take_screenshot"}
_GITHUB_HOSTS = {"github.com", "www.github.com"}
_GH_RESERVED_FIRST = {
    "search", "topics", "trending", "orgs", "settings", "features", "about",
    "pricing", "marketplace", "sponsors", "collections", "events", "explore",
    "notifications", "issues", "pulls", "new", "login", "join", "codespaces",
    "dashboard", "apps", "site", "security", "contact", "enterprise", "readme",
}
_HN_HOSTS = {"news.ycombinator.com", "hn.algolia.com"}


def _split(url: str):
    parts = urlsplit(url)
    return (parts.hostname or "").lower().strip("."), [s for s in parts.path.split("/") if s], parse_qs(parts.query)


def resolve_redirect(url: str) -> tuple | None:
    """返回 ('call', 工具名, kwargs, 说明) / ('hint', 提示文案) / None（放行）。"""
    host, segs, q = _split(url)

    if host in _GITHUB_HOSTS:
        first = segs[0] if segs else ""
        # 仓库搜索 → search_github_repos
        if first == "search" and segs[1:2] in ([], ["repositories"]):
            query = (q.get("q") or [""])[0].strip()
            if query:
                return ("call", "search_github_repos", {"query": query, "per_page": 30},
                        f"github.com/search 已改派 search_github_repos(query='{query}')")
        # 主题页 → search_github_repos（topic 还原成关键词）
        if first == "topics" and len(segs) >= 2:
            topic = segs[1].replace("-", " ")
            return ("call", "search_github_repos", {"query": topic, "per_page": 30},
                    f"github.com/topics/{segs[1]} 已改派 search_github_repos(query='{topic}')")
        # releases 页 / repo 主页 → fetch_github_releases
        if len(segs) >= 3 and segs[2] == "releases" and segs[0] not in _GH_RESERVED_FIRST:
            return ("call", "fetch_github_releases", {"owner": segs[0], "repo": segs[1], "per_page": 30},
                    f"github.com/{segs[0]}/{segs[1]}/releases 已改派 fetch_github_releases")
        if len(segs) == 2 and segs[0] not in _GH_RESERVED_FIRST:
            return ("call", "fetch_github_releases", {"owner": segs[0], "repo": segs[1], "per_page": 30},
                    f"github.com/{segs[0]}/{segs[1]} 已改派 fetch_github_releases"
                    f"（repo 星标/简介请用 search_github_repos）")
        # Trending：GitHub 无官方 API，只能引导
        if first == "trending":
            return ("hint",
                    "GitHub Trending 没有官方结构化 API，无法浏览该页。"
                    "请改用 search_github_repos(query='<领域关键词>', per_page=30) 获取按 star 降序的仓库榜。")
        return None

    if host == "api.github.com":
        # /repos/{owner}/{repo}/releases → segs = [repos, owner, repo, releases]
        if segs[:1] == ["repos"] and len(segs) >= 4 and segs[3] == "releases":
            return ("call", "fetch_github_releases", {"owner": segs[1], "repo": segs[2], "per_page": 30},
                    f"api.github.com/repos/{segs[1]}/{segs[2]}/releases 已改派 fetch_github_releases")
        if segs[:1] == ["search"] and segs[1:2] == ["repositories"]:
            query = (q.get("q") or [""])[0].strip()
            if query:
                return ("call", "search_github_repos", {"query": query, "per_page": 30},
                        f"api.github.com/search/repositories 已改派 search_github_repos")
        return ("hint",
                "该 GitHub API 端点没有对应的采集工具，请改用 search_github_repos / "
                "fetch_github_releases / fetch_hackernews_top 获取结构化数据。")

    if host in _HN_HOSTS:
        query = (q.get("q") or [""])[0].strip()
        kwargs = {"stories_count": 30, "query": query} if query else {"stories_count": 30}
        return ("call", "fetch_hackernews_top", kwargs,
                f"{host} 已改派 fetch_hackernews_top(stories_count=30)")

    return None


def _api_tool(name: str):
    """延迟导入，避免与 tools 包的循环依赖。"""
    from ..tools.webintel_api import search_github_repos, fetch_github_releases, fetch_hackernews_top
    return {
        "search_github_repos": search_github_repos,
        "fetch_github_releases": fetch_github_releases,
        "fetch_hackernews_top": fetch_hackernews_top,
    }[name]


class BrowserRouteGuardMiddleware(AgentMiddleware):
    """浏览器采集工具前置路由：API 可覆盖的 URL 改派 API 工具，不开浏览器。"""

    def __init__(self):
        self.tools = []
        self._intercepts = 0

    @property
    def name(self) -> str:
        return "BrowserRouteGuardMiddleware"

    def before_agent(self, state: Any, runtime: Runtime) -> dict[str, Any] | None:
        self._intercepts = 0
        return None

    def after_agent(self, state: Any, runtime: Runtime) -> dict[str, Any] | None:
        if self._intercepts:
            middleware_logger.info(
                f"BrowserRouteGuard: intercepted {self._intercepts} browser call(s) this turn"
            )
        return None

    def _spec_for(self, request: ToolCallRequest) -> tuple | None:
        tc = request.tool_call or {}
        name = tc.get("name", "")
        if not (name.startswith(_BROWSER_PREFIX) or name in _EXTRA_BROWSER_TOOLS):
            return None
        url = (tc.get("args") or {}).get("url") or ""
        if not url:
            return None
        try:
            return resolve_redirect(url)
        except Exception as e:
            middleware_logger.warning(f"BrowserRouteGuard: resolve failed for {url}: {e}")
            return None

    def _message(self, request: ToolCallRequest, spec: tuple, content: str) -> ToolMessage:
        tc = request.tool_call or {}
        return ToolMessage(content=content, tool_call_id=tc.get("id", ""), name=tc.get("name"))

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        spec = self._spec_for(request)
        if spec is None:
            return await handler(request)

        self._intercepts += 1
        url = (request.tool_call.get("args") or {}).get("url", "")
        if spec[0] == "call":
            _, tool_name, kwargs, note = spec
            middleware_logger.info(f"BrowserRouteGuard: {url} -> {tool_name}（不开浏览器）")
            try:
                content = await asyncio.to_thread(_api_tool(tool_name).invoke, kwargs)
                return self._message(request, spec, f"[路由拦截] 未执行浏览器访问 {url}。{note}\n\n{content}")
            except Exception as e:
                return self._message(
                    request, spec,
                    f"[路由拦截] 未执行浏览器访问 {url}。{note}，但调用 API 出错：{str(e)[:200]}。"
                    f"请直接调用 {tool_name} 工具重试。",
                )
        middleware_logger.info(f"BrowserRouteGuard: hint for {url}（不开浏览器）")
        return self._message(request, spec, f"[路由拦截] 未执行浏览器访问 {url}。{spec[1]}")

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command[Any]],
    ) -> ToolMessage | Command[Any]:
        spec = self._spec_for(request)
        if spec is None:
            return handler(request)

        self._intercepts += 1
        url = (request.tool_call.get("args") or {}).get("url", "")
        if spec[0] == "call":
            _, tool_name, kwargs, note = spec
            middleware_logger.info(f"BrowserRouteGuard: {url} -> {tool_name}（不开浏览器）")
            try:
                content = _api_tool(tool_name).invoke(kwargs)
                return self._message(request, spec, f"[路由拦截] 未执行浏览器访问 {url}。{note}\n\n{content}")
            except Exception as e:
                return self._message(
                    request, spec,
                    f"[路由拦截] 未执行浏览器访问 {url}。{note}，但调用 API 出错：{str(e)[:200]}。"
                    f"请直接调用 {tool_name} 工具重试。",
                )
        middleware_logger.info(f"BrowserRouteGuard: hint for {url}（不开浏览器）")
        return self._message(request, spec, f"[路由拦截] 未执行浏览器访问 {url}。{spec[1]}")
