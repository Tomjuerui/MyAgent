"""
文档生成工具（Harness — 沙箱内结构化文档输出）
支持生成 Markdown、HTML、CSV、JSON、纯文本报告。

核心设计（Harness 思想）：
- 所有文件必须先生成在 Docker 沙箱内（/workspace/output/）
- 用户需要下载时，通过 download_sandbox_file 工具从沙箱提取到本地
- 沙箱不可用时回退到本地生成

使用场景：
- 采购分析报告 → Markdown
- 供应商对比表 → CSV / HTML Table
- 数据导出 → JSON
- 会议纪要 → Markdown / HTML
"""
import os
import re
import json
import csv
import io
import hashlib
from pathlib import Path
from datetime import datetime
from langchain_core.tools import tool

from ..log_utils import agent_logger
from ..backends.sandbox_holder import get_sandbox, has_sandbox

# 沙箱内输出目录
SANDBOX_OUTPUT_DIR = "/workspace/output"
# 本地回退目录
LOCAL_DOWNLOAD_DIR = Path(__file__).parent.parent.parent / "download"


# 围栏代码块开/关行（``` 或 ~~~）
_FENCE_LINE = re.compile(r"^\s*(```|~~~)")
# ATX 标题漏空格，形如 '###一、' '####1.1'。首位排除空格/#/!：
# 7 个及以上的 # 本来就不是标题，#!/bin/bash 是 shebang 不是标题。
_ATX_MISSING_SPACE = re.compile(r"^(#{1,6})(?=[^\s#!])")


def repair_atx_headings(md: str) -> str:
    """修「ATX 标题漏空格」的坏 markdown：'###一、当日新增' → '### 一、当日新增'。

    CommonMark 要求 # 号后必须有空格/制表符或行尾，漏掉时整行按普通段落解析 ——
    在 VS Code / Typora / 前端 react-markdown 里都渲染不成标题，字号和正文一样。
    生成端时好时坏（带空格的那次正常），所以在落盘前归一化，而不是靠提示词约束模型。
    前端 frontend/src/components/chat/MarkdownRenderer.tsx 里的 repairAtxHeadings 是同一套规则。
    """
    if "#" not in md:
        return md
    lines = md.split("\n")
    changed = False
    in_fence = False
    for i, line in enumerate(lines):
        if _FENCE_LINE.match(line):
            in_fence = not in_fence
            continue
        # 代码块内的行首 # 是 shebang / 注释，补空格会把它变成标题
        if in_fence:
            continue
        match = _ATX_MISSING_SPACE.match(line)
        if not match:
            continue
        lines[i] = f"{match.group(1)} {line[match.end(1):]}"
        changed = True
    return "\n".join(lines) if changed else md


def _doc_digest(title: str, fmt: str, content: str) -> str:
    """按 (标题, 格式, 内容) 算稳定摘要，作为文件名的一部分。

    用摘要替代时间戳命名：同一份内容重复生成时落到同一个文件名，从而可复用，
    不再每次落一份新文件 + 新下载链接（实测一次研报任务 generate_document 被调 4 次）。
    """
    h = hashlib.sha1()
    h.update(f"{fmt}\x00{title}\x00{content}".encode("utf-8", "replace"))
    return h.hexdigest()[:12]


@tool
def generate_document(
    title: str,
    content: str,
    format: str = "markdown",
    filename: str = "",
) -> str:
    """生成结构化文档文件（Markdown/HTML/CSV/JSON/纯文本）。

    将分析结果、报告、数据表格等输出为可下载的文件。

    Args:
        title: 文档标题
        content: 文档内容。根据格式不同：
            - markdown: Markdown 格式文本
            - html: HTML 格式（自动包装完整页面）
            - csv: CSV 格式（每行一条记录，逗号分隔）
            - json: JSON 格式字符串
            - text: 纯文本
        format: 输出格式（markdown/html/csv/json/text），默认 markdown
        filename: 文件名（不含扩展名，默认自动生成）

    Returns:
        文件路径和下载链接
    """
    format = format.lower().strip()

    # 生成文件名：用内容摘要（而非时间戳）→ 同 (标题,格式,内容) 得到同名文件，可复用
    auto_named = not filename
    if auto_named:
        safe_title = "".join(c if c.isalnum() or c in "-_" else "_" for c in title[:30])
        filename = f"{safe_title}_{_doc_digest(title, format, content)}"

    # 仅对「自动命名（含内容摘要）」复用：同内容已生成过就直接返回，不再落新文件 + 新链接。
    # 显式传 filename 的调用（模型自定名）不复用，避免不同内容撞名误复用。
    if auto_named:
        ext = {"md": "md", "markdown": "md", "html": "html",
               "csv": "csv", "json": "json", "txt": "txt", "text": "txt"}.get(format, "txt")
        existing = LOCAL_DOWNLOAD_DIR / f"{filename}.{ext}"
        try:
            if existing.exists() and existing.stat().st_size > 0:
                return (
                    f"✅ 文档已存在（复用同内容文档，未重复生成）\n"
                    f"标题: {title}\n"
                    f"格式: {format}\n"
                    f"下载链接: /api/download/{filename}.{ext}"
                )
        except OSError:
            pass

    try:
        if format == "markdown" or format == "md":
            return _generate_markdown(title, content, filename)
        elif format == "html":
            return _generate_html(title, content, filename)
        elif format == "csv":
            return _generate_csv(title, content, filename)
        elif format == "json":
            return _generate_json(title, content, filename)
        elif format == "text" or format == "txt":
            return _generate_text(title, content, filename)
        else:
            return f"不支持的格式: {format}。支持: markdown, html, csv, json, text"
    except Exception as e:
        agent_logger.error(f"Document generation error: {e}")
        return f"文档生成失败: {str(e)}"


def _generate_markdown(title: str, content: str, filename: str) -> str:
    """生成 Markdown 文档（优先写入沙箱）"""
    md_content = f"# {title}\n\n"
    md_content += f"*生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n"
    md_content += "---\n\n"
    md_content += repair_atx_headings(content)

    return _write_to_sandbox_or_local(f"{filename}.md", md_content, title, "Markdown")


def _generate_html(title: str, content: str, filename: str) -> str:
    """生成 HTML 文档（完整页面，含样式）"""
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 40px 20px;
            color: #333;
            line-height: 1.6;
        }}
        h1 {{
            color: #1a1a1a;
            border-bottom: 2px solid #2563EB;
            padding-bottom: 10px;
        }}
        .meta {{
            color: #666;
            font-size: 0.9em;
            margin-bottom: 30px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        th, td {{
            padding: 12px 15px;
            text-align: left;
            border: 1px solid #ddd;
        }}
        th {{
            background-color: #f5f5f5;
            font-weight: 600;
        }}
        tr:nth-child(even) {{
            background-color: #fafafa;
        }}
        code {{
            background: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.9em;
        }}
        .section {{
            margin: 20px 0;
        }}
    </style>
</head>
<body>
    <h1>{title}</h1>
    <div class="meta">生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</div>
    <div class="section">
        {content}
    </div>
</body>
</html>"""

    return _write_to_sandbox_or_local(f"{filename}.html", html, title, "HTML")


def _generate_csv(title: str, content: str, filename: str) -> str:
    """生成 CSV 文件（优先写入沙箱）"""
    # 构建 CSV 内容
    csv_content = ""
    try:
        data = json.loads(content) if content.strip().startswith("[") else None
        if isinstance(data, list) and len(data) > 0:
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
            csv_content = output.getvalue()
        else:
            csv_content = f"# {title}\n" + content
    except (json.JSONDecodeError, AttributeError):
        csv_content = f"# {title}\n" + content

    return _write_to_sandbox_or_local(f"{filename}.csv", csv_content, title, "CSV")


def _generate_json(title: str, content: str, filename: str) -> str:
    """生成 JSON 文件（优先写入沙箱）"""
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        data = {"title": title, "content": content, "generated_at": datetime.now().isoformat()}

    wrapper = {
        "title": title,
        "generated_at": datetime.now().isoformat(),
        "data": data,
    }
    json_content = json.dumps(wrapper, ensure_ascii=False, indent=2)

    return _write_to_sandbox_or_local(f"{filename}.json", json_content, title, "JSON")


def _generate_text(title: str, content: str, filename: str) -> str:
    """生成纯文本文件（优先写入沙箱）"""
    text = f"{'=' * 60}\n"
    text += f"  {title}\n"
    text += f"{'=' * 60}\n"
    text += f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    text += f"{'=' * 60}\n\n"
    text += content

    return _write_to_sandbox_or_local(f"{filename}.txt", text, title, "纯文本")


def _write_to_sandbox_or_local(filename: str, content: str, title: str, format_name: str) -> str:
    """核心写入逻辑：优先写入沙箱，回退到本地"""
    sandbox = get_sandbox()

    if sandbox is not None:
        try:
            # ✅ 写入沙箱 /workspace/output/ 目录
            sandbox_path = f"{SANDBOX_OUTPUT_DIR}/{filename}"
            sandbox.execute(f"mkdir -p {SANDBOX_OUTPUT_DIR}")
            sandbox.write_file(sandbox_path, content)
            file_size = len(content.encode("utf-8"))

            agent_logger.info(f"Document generated in sandbox: {sandbox_path} ({file_size} bytes)")

            # 自交付：沙箱写入成功后，同步一份到宿主机 download 目录并直接返回下载链接。
            # 否则链接是否可见取决于模型会不会再调 download_sandbox_file，实际经常漏掉
            # （与 chart_generator.py 的自交付模式保持一致）。
            download_url = ""
            try:
                LOCAL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
                safe_name = Path(filename).name or f"{title}.{format_name}"
                (LOCAL_DOWNLOAD_DIR / safe_name).write_text(content, encoding="utf-8")
                download_url = f"/api/download/{safe_name}"
            except Exception as e:
                agent_logger.warning(f"Document local delivery failed (non-fatal): {e}")

            lines = [
                f"✅ 文档已在沙箱中生成!",
                f"标题: {title}",
                f"格式: {format_name}",
                f"文件大小: {file_size / 1024:.1f} KB",
                f"沙箱路径: {sandbox_path}",
            ]
            if download_url:
                lines.append(f"下载链接: {download_url}")
            else:
                lines.append(
                    f"💡 如需下载到本地，请使用 download_sandbox_file 工具，"
                    f"传入沙箱路径: {sandbox_path}"
                )
            return "\n".join(lines)
        except Exception as e:
            agent_logger.warning(f"Sandbox write failed ({e}), falling back to local")

    # 回退：写入本地
    LOCAL_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_path = LOCAL_DOWNLOAD_DIR / filename
    file_path.write_text(content, encoding="utf-8")
    file_size = file_path.stat().st_size
    download_url = f"/api/download/{file_path.name}"

    agent_logger.info(f"Document generated locally: {file_path.name} ({file_size} bytes)")
    return (
        f"✅ 文档生成成功!\n"
        f"标题: {title}\n"
        f"格式: {format_name}\n"
        f"文件大小: {file_size / 1024:.1f} KB\n"
        f"下载链接: {download_url}\n"
        f"本地路径: {file_path}"
    )


@tool
def generate_table_report(
    title: str,
    headers: str,
    rows: str,
    format: str = "markdown",
) -> str:
    """生成表格报告（支持 Markdown / HTML / CSV 格式）。

    专门用于将结构化数据（如供应商列表、元器件清单、订单明细）
    输出为格式化的表格文件。

    Args:
        title: 报告标题
        headers: 表头 JSON 数组字符串，如 ["供应商", "价格", "评分"]
        rows: 数据行 JSON 二维数组字符串，如 [["立创微", 25.5, "A"], ["风华", 28.0, "B"]]
        format: 输出格式（markdown/html/csv），默认 markdown

    Returns:
        文件路径和下载链接
    """
    try:
        header_list = json.loads(headers) if isinstance(headers, str) else headers
        row_list = json.loads(rows) if isinstance(rows, str) else rows
    except json.JSONDecodeError as e:
        return f"数据格式错误: {e}。headers 和 rows 必须是有效的 JSON 数组。"

    if not isinstance(header_list, list) or not isinstance(row_list, list):
        return "错误: headers 必须是一维数组，rows 必须是二维数组"

    format = format.lower().strip()

    # 不传 filename：交给 generate_document 用内容摘要命名 → 同内容可复用，不再每次新文件
    if format in ("markdown", "md"):
        content = _build_md_table(header_list, row_list)
        return generate_document.invoke({
            "title": title, "content": content, "format": "markdown"
        })
    elif format == "html":
        content = _build_html_table(header_list, row_list)
        return generate_document.invoke({
            "title": title, "content": content, "format": "html"
        })
    elif format == "csv":
        data = [dict(zip(header_list, row)) for row in row_list]
        content = json.dumps(data, ensure_ascii=False)
        return generate_document.invoke({
            "title": title, "content": content, "format": "csv"
        })
    else:
        return f"不支持的格式: {format}。支持: markdown, html, csv"


def _build_md_table(headers: list, rows: list) -> str:
    """构建 Markdown 表格"""
    lines = []
    # 表头
    lines.append("| " + " | ".join(str(h) for h in headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    # 数据行
    for row in rows:
        cells = [str(c) for c in row]
        # 补齐列数
        while len(cells) < len(headers):
            cells.append("")
        lines.append("| " + " | ".join(cells[:len(headers)]) + " |")
    return "\n".join(lines)


def _build_html_table(headers: list, rows: list) -> str:
    """构建 HTML 表格"""
    lines = ["<table>"]
    lines.append("  <thead><tr>")
    for h in headers:
        lines.append(f"    <th>{h}</th>")
    lines.append("  </tr></thead>")
    lines.append("  <tbody>")
    for row in rows:
        lines.append("    <tr>")
        for c in row:
            lines.append(f"      <td>{c}</td>")
        lines.append("    </tr>")
    lines.append("  </tbody>")
    lines.append("</table>")
    return "\n".join(lines)
