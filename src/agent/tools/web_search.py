"""
Web 搜索工具（零依赖直抓 Bing RSS，不消耗 LLM token）

- 检索是纯 HTTP GET，返回结构化 JSON；总结由主 Agent 在自身回合完成，工具内不调用任何 LLM。
- 引擎顺序：Bing RSS（format=rss，链接为真实 URL）→ Bing CN RSS；全部失败返回结构化错误。
- 选 Bing RSS 而非 DuckDuckGo：DDG HTML 端点会返回 202 反爬 challenge（实测），RSS 稳定且字段干净。
- DEMO_MODE=true 时返回内置 mock（与 webintel_api.py 约定一致），离线演示/单测不依赖网络。
"""
import json
import re
import html as _html
from urllib.parse import quote

import httpx
from langchain_core.tools import tool

from ..log_utils import agent_logger
from ..env_utils import get_env

_UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}
_TIMEOUT = 20.0

_DEMO_RESULTS = [
    {"title": "贴片电容(MLCC)价格趋势与市场分析", "url": "https://example.com/mlcc-trend",
     "snippet": "AI 服务器与新能源车拉动高容值 MLCC 需求，高端产品价格上行（离线演示数据）"},
    {"title": "2026 电子元器件采购白皮书", "url": "https://example.com/procurement-2026",
     "snippet": "通用型 MLCC 去库存结束，交期回升至 8 周以上（离线演示数据）"},
    {"title": "MLCC 供需与涨价逻辑", "url": "https://example.com/mlcc-supply",
     "snippet": "日系厂商产能向高端倾斜，中低端价格企稳（离线演示数据）"},
]


def _demo_mode() -> bool:
    return get_env("DEMO_MODE", "false").strip().lower() in ("1", "true", "yes")


def _clean(text: str) -> str:
    """去标签 + 解 HTML 实体 + 合并空白。"""
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(_html.unescape(text).split())


def _tag(item: str, name: str) -> str:
    m = re.search(rf"<{name}>(.*?)</{name}>", item, re.S)
    return m.group(1) if m else ""


def _parse_bing_rss(xml_text: str) -> list[dict]:
    """解析 Bing RSS（format=rss）：每个 <item> 取 title / link / description。"""
    results = []
    for item in re.findall(r"<item>(.*?)</item>", xml_text, re.S):
        url = _tag(item, "link").strip()
        if not url:
            continue
        results.append({
            "title": _clean(_tag(item, "title")),
            "url": url,
            "snippet": _clean(_tag(item, "description")),
        })
    return results


_ENGINES = [
    ("bing", "https://www.bing.com/search?q={q}&format=rss", _parse_bing_rss),
    ("bing-cn", "https://cn.bing.com/search?q={q}&format=rss", _parse_bing_rss),
]


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """搜索互联网获取实时信息。

    Args:
        query: 搜索查询内容，例如"贴片电容市场价格趋势 2026"
        max_results: 返回条数（默认 5）

    Returns:
        JSON 字符串：{query, count, results: [{title, url, snippet}]}
    """
    if _demo_mode():
        return json.dumps(
            {"query": query, "count": len(_DEMO_RESULTS[:max_results]),
             "results": _DEMO_RESULTS[:max_results]},
            ensure_ascii=False,
        )

    q = quote(query)
    for name, tmpl, parser in _ENGINES:
        try:
            resp = httpx.get(tmpl.format(q=q), headers=_UA, timeout=_TIMEOUT,
                             follow_redirects=True)
            if resp.status_code != 200:
                agent_logger.warning(f"web_search: {name} HTTP {resp.status_code}")
                continue
            results = parser(resp.text)[:max_results]
            if not results:
                agent_logger.warning(f"web_search: {name} 解析 0 条，尝试下一引擎")
                continue
            agent_logger.info(f"web_search: '{query[:50]}' -> {len(results)} 条（{name}）")
            return json.dumps(
                {"query": query, "count": len(results), "results": results},
                ensure_ascii=False,
            )
        except httpx.TimeoutException:
            agent_logger.warning(f"web_search: {name} 超时，尝试下一引擎")
            continue
        except Exception as e:
            agent_logger.warning(f"web_search: {name} 异常 {e}，尝试下一引擎")
            continue
    return json.dumps(
        {"error": "所有搜索引擎均失败", "source": "web_search"}, ensure_ascii=False
    )
