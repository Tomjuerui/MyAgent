"""
三域结构化 API 采集工具（API 优先通道）

github.com / news.ycombinator.com / arxiv.org 三个白名单域都有官方结构化 API，
一次 httpx GET 即可拿到干净 JSON，无需无头浏览器。URL 全部由代码构造（模型只传
owner / repo / query 等字符串），因此 SSRF / 域名白名单 / HITL 审批三层闸门天然不需要。

DEMO_MODE=true 时直接返回内置 mock 常量（与 docker/mock-web/html 假数据对齐），
零网络依赖，离线演示不再经过 nginx + 浏览器链路。
"""
import json
import os
import xml.etree.ElementTree as ET
from urllib.parse import quote

import httpx
from langchain_core.tools import tool

from ..log_utils import agent_logger

# GitHub API 强制要求 User-Agent 头，否则 403；未认证限速 60 req/h（演示够用）
_GH_HEADERS = {
    "User-Agent": "DevEco-Intelligence/1.0",
    "Accept": "application/vnd.github+json",
}
_TIMEOUT = 15.0
_ARXIV_NS = {"atom": "http://www.w3.org/2005/Atom"}


def _demo_mode() -> bool:
    return os.getenv("DEMO_MODE", "false").strip().lower() in ("1", "true", "yes")


def _err(source: str, detail: str) -> str:
    """结构化错误返回，让 crawler 识别「API 拿不到 → 回退浏览器」。"""
    return json.dumps({"error": detail, "source": source}, ensure_ascii=False)


# ===== DEMO_MODE 内置 mock 数据（与 docker/mock-web/html 假页面对齐）=====
_DEMO_GITHUB_RELEASES = {
    "langchain-ai/langgraph": [
        {"tag_name": "0.6.0", "name": "v0.6.0", "published_at": "2026-09-18",
         "html_url": "https://github.com/langchain-ai/langgraph/releases/tag/0.6.0",
         "body": "Durable execution improvements; new checkpoint backend interface"},
        {"tag_name": "0.5.4", "name": "v0.5.4", "published_at": "2026-09-05",
         "html_url": "https://github.com/langchain-ai/langgraph/releases/tag/0.5.4",
         "body": "Interrupt payload validation; smaller state snapshots"},
        {"tag_name": "0.5.0", "name": "v0.5.0", "published_at": "2026-08-21",
         "html_url": "https://github.com/langchain-ai/langgraph/releases/tag/0.5.0",
         "body": "First stable 0.5 line; node-level retry policies"},
        {"tag_name": "0.4.12", "name": "v0.4.12", "published_at": "2026-08-07",
         "html_url": "https://github.com/langchain-ai/langgraph/releases/tag/0.4.12",
         "body": "Thread listing pagination; fixes for async streaming"},
        {"tag_name": "0.4.9", "name": "v0.4.9", "published_at": "2026-07-24",
         "html_url": "https://github.com/langchain-ai/langgraph/releases/tag/0.4.9",
         "body": "Time-travel debugging API; store namespace isolation"},
    ],
    "crewai/crewai": [
        {"tag_name": "0.152.0", "name": "v0.152.0", "published_at": "2026-09-22",
         "html_url": "https://github.com/crewAIInc/crewAI/releases/tag/0.152.0",
         "body": "Flow-first API promoted to default; crew memory backends"},
        {"tag_name": "0.140.0", "name": "v0.140.0", "published_at": "2026-09-08",
         "html_url": "https://github.com/crewAIInc/crewAI/releases/tag/0.140.0",
         "body": "Hierarchical process rework; per-task guardrails"},
        {"tag_name": "0.130.0", "name": "v0.130.0", "published_at": "2026-08-25",
         "html_url": "https://github.com/crewAIInc/crewAI/releases/tag/0.130.0",
         "body": "Tool caching; training-data export hooks"},
        {"tag_name": "0.121.0", "name": "v0.121.0", "published_at": "2026-08-11",
         "html_url": "https://github.com/crewAIInc/crewAI/releases/tag/0.121.0",
         "body": "Async kickoff for crews; structured output enforcement"},
        {"tag_name": "0.110.0", "name": "v0.110.0", "published_at": "2026-07-28",
         "html_url": "https://github.com/crewAIInc/crewAI/releases/tag/0.110.0",
         "body": "Agent-level rate limiting; knowledge source plugins"},
    ],
    "microsoft/autogen": [
        {"tag_name": "0.9.0", "name": "v0.9.0", "published_at": "2026-09-15",
         "html_url": "https://github.com/microsoft/autogen/releases/tag/0.9.0",
         "body": "Core/AgentChat split stabilised; distributed runtime preview"},
        {"tag_name": "0.8.0", "name": "v0.8.0", "published_at": "2026-09-01",
         "html_url": "https://github.com/microsoft/autogen/releases/tag/0.8.0",
         "body": "GraphFlow orchestration; typed message envelopes"},
        {"tag_name": "0.7.0", "name": "v0.7.0", "published_at": "2026-08-18",
         "html_url": "https://github.com/microsoft/autogen/releases/tag/0.7.0",
         "body": "Observability hooks; selectors for team composition"},
        {"tag_name": "0.6.0", "name": "v0.6.0", "published_at": "2026-08-04",
         "html_url": "https://github.com/microsoft/autogen/releases/tag/0.6.0",
         "body": "Memory protocol; tool-use retries"},
        {"tag_name": "0.5.0", "name": "v0.5.0", "published_at": "2026-07-21",
         "html_url": "https://github.com/microsoft/autogen/releases/tag/0.5.0",
         "body": "Async-first agent runtime; cancellation support"},
    ],
}

_DEMO_HN_STORIES = [
    {"title": "Show HN: A durable execution engine for LLM agents",
     "url": "https://news.ycombinator.com/item?id=40000001",
     "points": 487, "num_comments": 132, "created_at": "2026-09-30"},
    {"title": "Why agent frameworks keep reinventing workflow engines",
     "url": "https://news.ycombinator.com/item?id=40000002",
     "points": 351, "num_comments": 208, "created_at": "2026-09-30"},
    {"title": "Ask HN: How do you evaluate multi-agent systems in production?",
     "url": "https://news.ycombinator.com/item?id=40000003",
     "points": 274, "num_comments": 166, "created_at": "2026-09-29"},
    {"title": "The hidden cost of tool-calling retries",
     "url": "https://news.ycombinator.com/item?id=40000004",
     "points": 198, "num_comments": 74, "created_at": "2026-09-29"},
    {"title": "A minimal MCP server in 200 lines",
     "url": "https://news.ycombinator.com/item?id=40000005",
     "points": 163, "num_comments": 51, "created_at": "2026-09-28"},
]

_DEMO_ARXIV_PAPERS = [
    {
        "title": "Durable Execution for Multi-Agent LLM Systems",
        "summary": ("We study checkpointing strategies for long-running multi-agent LLM pipelines. "
                    "Persisting a node's result before scheduling its successors bounds recovery time "
                    "to a single node's execution rather than an entire run, reducing re-executed model "
                    "calls by 34-71% after a mid-run failure. Per-tool rate limiting removes the retry "
                    "storms that dominate token spend under flaky tool backends."),
        "published": "2026-09-12",
        "id": "http://arxiv.org/abs/2401.00001",
    },
]

_DEMO_GITHUB_REPOS = [
    {"full_name": "langchain-ai/langgraph", "html_url": "https://github.com/langchain-ai/langgraph",
     "stargazers_count": 24500, "description": "Build resilient language agents as graphs.",
     "language": "Python", "license": "MIT",
     "open_issues_count": 412, "pushed_at": "2026-09-25"},
    {"full_name": "crewAIInc/crewAI", "html_url": "https://github.com/crewAIInc/crewAI",
     "stargazers_count": 31000, "description": "Framework for orchestrating role-playing, autonomous AI agents.",
     "language": "Python", "license": "MIT",
     "open_issues_count": 386, "pushed_at": "2026-09-28"},
    {"full_name": "microsoft/autogen", "html_url": "https://github.com/microsoft/autogen",
     "stargazers_count": 42000, "description": "A programming framework for agentic AI.",
     "language": "Python", "license": "MIT",
     "open_issues_count": 1290, "pushed_at": "2026-08-10"},
]


@tool
def fetch_github_releases(owner: str, repo: str, per_page: int = 5) -> str:
    """获取 GitHub 仓库的 Releases 列表（API 优先通道，无需浏览器）。

    优先使用本工具获取发版信息；仅在目标不是 GitHub Releases（如博客正文）时回退 mcp_browser_navigate。

    Args:
        owner: 仓库所有者，如 "langchain-ai"
        repo: 仓库名，如 "langgraph"
        per_page: 返回条数（默认 5，最多 30）

    Returns:
        JSON 字符串：{repo, count, releases: [{tag_name, name, published_at, html_url, body}]}
    """
    if _demo_mode():
        releases = _DEMO_GITHUB_RELEASES.get(f"{owner.lower()}/{repo.lower()}")
        if not releases:
            return _err("github", f"DEMO_MODE 无 {owner}/{repo} 的预置数据")
        return json.dumps(
            {"repo": f"{owner}/{repo}", "count": len(releases[:per_page]),
             "releases": releases[:per_page]},
            ensure_ascii=False,
        )

    url = f"https://api.github.com/repos/{owner}/{repo}/releases?per_page={per_page}"
    try:
        resp = httpx.get(url, headers=_GH_HEADERS, timeout=_TIMEOUT)
        if resp.status_code != 200:
            return _err("github", f"HTTP {resp.status_code}")
        raw = resp.json()
        releases = [
            {
                "tag_name": r.get("tag_name", ""),
                "name": r.get("name", "") or r.get("tag_name", ""),
                "published_at": (r.get("published_at") or "")[:10],
                "html_url": r.get("html_url", ""),
                "body": " ".join((r.get("body") or "").split())[:500],
            }
            for r in raw if isinstance(r, dict)
        ]
        agent_logger.info(f"fetch_github_releases: {owner}/{repo} -> {len(releases)} releases")
        return json.dumps(
            {"repo": f"{owner}/{repo}", "count": len(releases), "releases": releases},
            ensure_ascii=False,
        )
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return _err("github", f"请求异常: {e}")
    except Exception as e:
        agent_logger.error(f"fetch_github_releases error: {e}")
        return _err("github", f"解析异常: {e}")


@tool
def fetch_hackernews_top(stories_count: int = 10, query: str = "") -> str:
    """获取 HackerNews 热帖列表（Algolia API，无需浏览器）。

    Args:
        stories_count: 返回条数（默认 10）
        query: 可选关键词过滤（如 "AI"、"agent"），为空则取首页热帖

    Returns:
        JSON 字符串：{count, stories: [{title, url, points, num_comments, created_at}]}
    """
    if _demo_mode():
        stories = _DEMO_HN_STORIES[:stories_count]
        return json.dumps(
            {"count": len(stories), "stories": stories}, ensure_ascii=False
        )

    tags = "front_page" if not query else "story"
    url = f"https://hn.algolia.com/api/v1/search?tags={tags}&hitsPerPage={stories_count}"
    if query:
        url += f"&query={quote(query)}"
    try:
        resp = httpx.get(url, timeout=_TIMEOUT)
        if resp.status_code != 200:
            return _err("hackernews", f"HTTP {resp.status_code}")
        hits = resp.json().get("hits", [])
        stories = [
            {
                "title": h.get("title", "") or h.get("story_title", ""),
                "url": h.get("url", "") or f"https://news.ycombinator.com/item?id={h.get('objectID', '')}",
                "points": h.get("points", 0),
                "num_comments": h.get("num_comments", 0),
                "created_at": (h.get("created_at") or "")[:10],
            }
            for h in hits if isinstance(h, dict)
        ]
        agent_logger.info(f"fetch_hackernews_top: {len(stories)} stories")
        return json.dumps({"count": len(stories), "stories": stories}, ensure_ascii=False)
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return _err("hackernews", f"请求异常: {e}")
    except Exception as e:
        agent_logger.error(f"fetch_hackernews_top error: {e}")
        return _err("hackernews", f"解析异常: {e}")


def _parse_arxiv_atom(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    papers = []
    for entry in root.findall("atom:entry", _ARXIV_NS):
        papers.append({
            "title": " ".join((entry.findtext("atom:title", default="", namespaces=_ARXIV_NS) or "").split()),
            "summary": " ".join((entry.findtext("atom:summary", default="", namespaces=_ARXIV_NS) or "").split()),
            "published": (entry.findtext("atom:published", default="", namespaces=_ARXIV_NS) or "")[:10],
            "id": entry.findtext("atom:id", default="", namespaces=_ARXIV_NS) or "",
        })
    return papers


@tool
def fetch_arxiv_papers(query: str, max_results: int = 5) -> str:
    """检索 arXiv 论文摘要（export API，无需浏览器）。

    Args:
        query: 检索关键词，如 "multi-agent LLM"、"agent orchestration"
        max_results: 返回条数（默认 5）

    Returns:
        JSON 字符串：{query, count, papers: [{title, summary, published, id}]}
    """
    if _demo_mode():
        papers = _DEMO_ARXIV_PAPERS[:max_results]
        return json.dumps(
            {"query": query, "count": len(papers), "papers": papers}, ensure_ascii=False
        )

    url = f"https://export.arxiv.org/api/query?search_query=all:{quote(query)}&start=0&max_results={max_results}"
    try:
        resp = httpx.get(url, timeout=_TIMEOUT)
        if resp.status_code != 200:
            return _err("arxiv", f"HTTP {resp.status_code}")
        papers = _parse_arxiv_atom(resp.text)
        agent_logger.info(f"fetch_arxiv_papers: '{query}' -> {len(papers)} papers")
        return json.dumps(
            {"query": query, "count": len(papers), "papers": papers}, ensure_ascii=False
        )
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return _err("arxiv", f"请求异常: {e}")
    except Exception as e:
        agent_logger.error(f"fetch_arxiv_papers error: {e}")
        return _err("arxiv", f"解析异常: {e}")


@tool
def search_github_repos(query: str, per_page: int = 5) -> str:
    """在 GitHub 搜索仓库（框架名 → 精确 owner/repo 映射）。

    当用户只给了框架名（如 "LangGraph"、"agent framework"）而没有精确仓库路径时，
    先用本工具发现候选仓库的 full_name，再用 fetch_github_releases 获取发版数据。

    Args:
        query: 搜索关键词，如 "langgraph"、"agent framework"
        per_page: 返回条数（默认 5，最多 30）

    Returns:
        JSON 字符串：{query, count, repos: [{full_name, html_url, stargazers_count, description, language, license, open_issues_count, pushed_at}]}
    """
    if _demo_mode():
        repos = _DEMO_GITHUB_REPOS[:per_page]
        return json.dumps(
            {"query": query, "count": len(repos), "repos": repos}, ensure_ascii=False
        )

    url = (f"https://api.github.com/search/repositories?q={quote(query)}"
           f"&sort=stars&order=desc&per_page={per_page}")
    try:
        resp = httpx.get(url, headers=_GH_HEADERS, timeout=_TIMEOUT)
        if resp.status_code != 200:
            return _err("github", f"HTTP {resp.status_code}")
        items = resp.json().get("items", [])
        repos = [
            {
                "full_name": it.get("full_name", ""),
                "html_url": it.get("html_url", ""),
                "stargazers_count": it.get("stargazers_count", 0),
                "description": " ".join((it.get("description") or "").split())[:200],
                "language": it.get("language") or "",
                "license": (it.get("license") or {}).get("spdx_id") or "",
                "open_issues_count": it.get("open_issues_count", 0),
                "pushed_at": (it.get("pushed_at") or "")[:10],
            }
            for it in items if isinstance(it, dict)
        ]
        agent_logger.info(f"search_github_repos: '{query}' -> {len(repos)} repos")
        return json.dumps(
            {"query": query, "count": len(repos), "repos": repos}, ensure_ascii=False
        )
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return _err("github", f"请求异常: {e}")
    except Exception as e:
        agent_logger.error(f"search_github_repos error: {e}")
        return _err("github", f"解析异常: {e}")


@tool
def fetch_github_repo_meta(owner: str, repo: str) -> str:
    """查询单个 GitHub 仓库的合规/维护度元信息（API 直连，无需浏览器）。

    用于技术选型白皮书的「安全合规」与「维护度」维度取证：
    License 类型、归档状态、最近推送时间、Issue 规模。

    Args:
        owner: 仓库 owner（如 langchain-ai）
        repo: 仓库名（如 langgraph）

    Returns:
        JSON 字符串：{full_name, license, stargazers_count, forks_count,
        open_issues_count, pushed_at, archived, default_branch, html_url}
    """
    if _demo_mode():
        hit = next(
            (r for r in _DEMO_GITHUB_REPOS if r["full_name"].lower().endswith(f"/{repo.lower()}")),
            None,
        )
        if not hit:
            return _err("github", f"mock 数据无 {owner}/{repo}")
        return json.dumps({
            "full_name": hit["full_name"],
            "license": hit.get("license", "MIT"),
            "stargazers_count": hit.get("stargazers_count", 0),
            "forks_count": 0,
            "open_issues_count": hit.get("open_issues_count", 0),
            "pushed_at": hit.get("pushed_at", "2026-01-01"),
            "archived": False,
            "default_branch": "main",
            "html_url": hit.get("html_url", ""),
        }, ensure_ascii=False)

    url = f"https://api.github.com/repos/{quote(owner)}/{quote(repo)}"
    try:
        resp = httpx.get(url, headers=_GH_HEADERS, timeout=_TIMEOUT)
        if resp.status_code != 200:
            return _err("github", f"HTTP {resp.status_code}")
        it = resp.json()
        return json.dumps({
            "full_name": it.get("full_name", ""),
            "license": (it.get("license") or {}).get("spdx_id") or "",
            "stargazers_count": it.get("stargazers_count", 0),
            "forks_count": it.get("forks_count", 0),
            "open_issues_count": it.get("open_issues_count", 0),
            "pushed_at": (it.get("pushed_at") or "")[:10],
            "archived": bool(it.get("archived", False)),
            "default_branch": it.get("default_branch", ""),
            "html_url": it.get("html_url", ""),
        }, ensure_ascii=False)
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return _err("github", f"请求异常: {e}")
    except Exception as e:
        agent_logger.error(f"fetch_github_repo_meta error: {e}")
        return _err("github", f"解析异常: {e}")
