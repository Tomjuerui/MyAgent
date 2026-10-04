"""
画像子系统单元测试（plain script，无 pytest）。
运行：python src/test/test_profile.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # 加 src 到 path

from agent.profile import (
    _merge_profile, _extract_section, _extract_pref,
    build_quick_report_prompt, save_profile, load_profile, DEFAULT_PROFILE,
)


def test_merge_updates_topics_and_prefs():
    merged = _merge_profile(DEFAULT_PROFILE, ["Agent 框架"], {"chart_type": "line"})
    assert "## 追踪主题" in merged
    assert "- Agent 框架" in merged
    assert "- 图表类型: line" in merged
    assert "## 备注" in merged


def test_merge_keeps_existing_notes():
    current = DEFAULT_PROFILE.replace(
        "（用户自由补充，不会被自动提炼覆盖）", "我只关注 LangGraph"
    )
    merged = _merge_profile(current, [], {})
    assert "我只关注 LangGraph" in merged


def test_extract_section_and_pref():
    assert _extract_pref(DEFAULT_PROFILE, "图表类型") == "柱状图"
    assert _extract_section(DEFAULT_PROFILE, "追踪主题") == []


def test_quick_prompt_from_topics():
    save_profile("test-unit-quick", DEFAULT_PROFILE.replace(
        "（尚未提炼。继续对话，系统会自动识别你在追踪的技术方向。）",
        "- Agent 框架\n- LangGraph"
    ))
    prompt = build_quick_report_prompt("test-unit-quick")
    assert "Agent 框架" in prompt and "LangGraph" in prompt
    assert "研报" in prompt


def test_save_load_roundtrip():
    save_profile("test-unit-rt", "自定义内容")
    assert load_profile("test-unit-rt") == "自定义内容"


if __name__ == "__main__":
    test_merge_updates_topics_and_prefs()
    test_merge_keeps_existing_notes()
    test_extract_section_and_pref()
    test_quick_prompt_from_topics()
    test_save_load_roundtrip()
    print("all profile tests passed")
