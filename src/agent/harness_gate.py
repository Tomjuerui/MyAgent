"""
Harness 确定性审计：把 rubric 打分项 1/2/3 从 LLM 肉判升级为代码比对。

chat.py 每轮 astream 结束后调用 audit_report；未过则由外环（T9）注入返工指令
强制重新采集，而不是让模型只改文字糊弄评审。

本模块刻意不依赖 LangChain / 数据库，可脱离框架单测。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

# 事实类工具：chat.py 在 ToolMessage 流里把它们的返回累积进 facts 列表
FACT_TOOLS = {
    "fetch_github_releases", "fetch_hackernews_top", "fetch_arxiv_papers",
    "search_github_repos", "fetch_github_repo_meta", "mcp_extract_table",
}

_URL_RE = re.compile(r"https?://[^\s)\]]+")
_RISK_HEADING_RE = re.compile(r"risk[_ ]?warnings|风险警告", re.IGNORECASE)

# 与 src/agent/tools/chart_generator.py:21 的 DOWNLOAD_DIR 同源
# （/api/download/{filename} 静态服务目录），图表非空校验据此查文件。
# 注意：本文件在 agent/ 下比 chart_generator（agent/tools/）浅一层，故是 .parent.parent
DOWNLOAD_DIR = Path(__file__).parent.parent / "download"


def extract_urls(text: str) -> list[str]:
    """提取文本中所有 http(s) URL（去掉尾部标点）。"""
    return [u.rstrip(".,;，。；:：") for u in _URL_RE.findall(text or "")]


def _risk_section_ok(text: str) -> bool:
    """risk_warnings / 风险警告 标题存在，且该节到下个标题间有非空内容。"""
    m = _RISK_HEADING_RE.search(text)
    if not m:
        return False
    tail = text[m.end():]
    next_heading = re.search(r"^#{1,6}\s", tail, re.MULTILINE)
    section = tail[: next_heading.start()] if next_heading else tail
    return bool(section.strip())


def audit_report(facts: list[dict], final_text: str) -> dict[str, Any]:
    """三个确定性检查（对应 harness_config.yaml tech_selection rubric 的打分项）。

    Args:
        facts: chat.py 累加的采集事实 [{"tool": str, "args": str, "result": str}]
        final_text: 本轮 assistant_content（Markdown 报告正文）

    Returns:
        {passed: bool, missing_urls: [str], chart_missing: [str], risk_missing: bool}
    """
    facts_corpus = "\n".join(str(f.get("result", "")) for f in facts)
    cited_urls = extract_urls(final_text)

    # 打分项 1：回答中出现的 URL 必须能在采集事实中找到（子串匹配）
    missing_urls = [u for u in cited_urls if u not in facts_corpus]

    # 打分项 2：图表必须存在——报告含 /api/download/ 链接且文件存在非空；
    # 完全无图片链接也判缺失（报告里的下载链接是相对路径，http 正则提取不到，单独扫）
    _chart_rel = re.findall(r"/api/download/([^\s)\]]+)", final_text or "")
    chart_missing: list[str] = []
    for name in _chart_rel:
        f = DOWNLOAD_DIR / name
        if not (f.exists() and f.stat().st_size > 0):
            chart_missing.append(f"/api/download/{name}")
    if not _chart_rel and not any("/charts/" in u for u in cited_urls):
        chart_missing.append("<无图片链接>")

    # 打分项 3：风险警告节存在且非空
    risk_missing = not _risk_section_ok(final_text)

    passed = not missing_urls and not chart_missing and not risk_missing
    return {
        "passed": passed,
        "missing_urls": missing_urls,
        "chart_missing": chart_missing,
        "risk_missing": risk_missing,
    }
