"""
用户画像子系统：磁盘 Markdown 文件读写 + LLM 自动提炼 + 快捷问题模板组装

画像文件路径：data/users/{user_id}/profile.md
- 读取侧：新会话首条消息注入画像块（chat.py 调用 build_injection_block）
- 写入侧：对话结束后台任务用 LLM 提炼「追踪主题 + 输出偏好」合并写回
- 编辑侧：GET/PUT /api/profile/{user_id} 直接读写文件
"""
import json
import re
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROFILE_DIR = PROJECT_ROOT / "data" / "users"

DEFAULT_PROFILE = """# 用户画像
<!-- 系统自动提炼 + 手动编辑。保存后下一个新会话生效。 -->

## 追踪主题
（尚未提炼。继续对话，系统会自动识别你在追踪的技术方向。）

## 输出偏好
- 图表类型: 柱状图
- 输出格式: Markdown + 表格
- 语言: 中文

## 备注
（用户自由补充，不会被自动提炼覆盖）
"""

_EXTRACT_PROMPT = """你是用户画像提炼器。根据以下对话片段，提炼用户的「技术追踪主题」和「输出偏好」。

对话片段：
{messages_text}

只输出一个 JSON 对象，格式：
{{"topics": ["主题1"], "preferences": {{"chart_type": "bar/line/pie/scatter", "output_format": "markdown/table/json", "language": "zh/en"}}}}

规则：
- topics：用户正在追踪/关注的技术方向或对象（如 "Agent 框架"、"某开源项目发版"），没有则为 []
- preferences：仅当对话中出现明确偏好时填写对应字段，否则省略该字段
- 只从对话中提取，禁止编造
"""


def get_profile_path(user_id: str) -> Path:
    return PROFILE_DIR / user_id / "profile.md"


def load_profile(user_id: str) -> str:
    path = get_profile_path(user_id)
    if path.exists():
        return path.read_text(encoding="utf-8")
    return DEFAULT_PROFILE


def save_profile(user_id: str, content: str) -> None:
    path = get_profile_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _extract_section(content: str, heading: str) -> list[str]:
    m = re.search(rf"##\s*{re.escape(heading)}\s*\n(.*?)(?=\n##\s|\Z)", content, re.DOTALL)
    if not m:
        return []
    return [ln.lstrip("- ").strip() for ln in m.group(1).splitlines()
            if ln.strip().startswith("-")]


def _extract_pref(content: str, key: str) -> Optional[str]:
    m = re.search(rf"-\s*{re.escape(key)}\s*[:：]\s*(.+)", content)
    return m.group(1).strip() if m else None


def _merge_profile(current: str, topics: list[str], prefs: dict[str, Any]) -> str:
    notes_m = re.search(r"##\s*备注\s*\n(.*)", current, re.DOTALL)
    notes = notes_m.group(1).strip() if notes_m else ""

    chart = prefs.get("chart_type") or _extract_pref(current, "图表类型") or "柱状图"
    fmt = prefs.get("output_format") or _extract_pref(current, "输出格式") or "Markdown + 表格"
    lang = prefs.get("language") or _extract_pref(current, "语言") or "中文"

    lines = [
        "# 用户画像",
        "<!-- 系统自动提炼 + 手动编辑。保存后下一个新会话生效。 -->",
        "",
        "## 追踪主题",
    ]
    if topics:
        lines.extend(f"- {t}" for t in topics)
    else:
        lines.append("（尚未提炼。继续对话，系统会自动识别你在追踪的技术方向。）")
    lines += ["", "## 输出偏好", f"- 图表类型: {chart}", f"- 输出格式: {fmt}",
              f"- 语言: {lang}", "", "## 备注"]
    lines.append(notes if notes else "（用户自由补充，不会被自动提炼覆盖）")
    return "\n".join(lines) + "\n"


def _messages_to_text(messages: list[dict]) -> str:
    parts = []
    for m in messages[-20:]:
        role = "用户" if m.get("role") == "user" else "助手"
        content = str(m.get("content", "")).strip()
        if content:
            parts.append(f"{role}: {content[:500]}")
    return "\n".join(parts)


def _parse_json(raw: str) -> Optional[dict]:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return None


async def extract_and_update_profile(user_id: str, messages: list[dict]) -> bool:
    """用 LLM 提炼对话中的追踪主题与输出偏好，合并写回画像文件。失败返回 False。"""
    text = _messages_to_text(messages)
    if not text.strip():
        return False
    try:
        from .config import get_llm
        resp = await get_llm().ainvoke(_EXTRACT_PROMPT.format(messages_text=text))
        raw = getattr(resp, "content", "") or ""
        data = _parse_json(raw)
        if data is None:
            return False
        topics = data.get("topics") or []
        prefs = data.get("preferences") or {}
        current = load_profile(user_id)
        save_profile(user_id, _merge_profile(current, topics, prefs))
        return True
    except Exception:
        return False


def build_quick_report_prompt(user_id: str) -> str:
    """根据画像组装「快速生成研报」的快捷问题文案。"""
    content = load_profile(user_id)
    topics = [t for t in _extract_section(content, "追踪主题") if not t.startswith("（")]
    chart = _extract_pref(content, "图表类型") or "图表"
    if topics:
        target = "、".join(topics)
        return f"追踪 {target} 的最新发版动态与社区舆情，生成带{chart}的研报，每条结论附来源链接"
    return "分析上周主流 Agent 框架（LangGraph / CrewAI / AutoGen）的发版动态，生成带图表的研报"


def build_injection_block(user_id: str) -> str:
    """组装新会话首条消息前注入的画像块。"""
    content = load_profile(user_id)
    return f"【用户画像（本会话生效）】\n{content}\n\n---\n"
