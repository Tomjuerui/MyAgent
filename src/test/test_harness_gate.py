"""harness_gate 确定性审计单元测试（纯函数，无框架依赖）"""
import sys
import os
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent import harness_gate  # noqa: E402


def test_case1_url_not_in_facts():
    """回答引用了事实库之外的 URL → passed=False 且点名该 URL"""
    facts = [{"tool": "fetch_github_repo_meta", "args": "", "result":
              '{"license": "MIT", "html_url": "https://github.com/langchain-ai/langgraph"}'}]
    text = ("### risk_warnings\nLicense 均为 MIT。\n\n"
            "来源: https://github.com/langchain-ai/langgraph 与 https://github.com/ghost/repo")
    res = harness_gate.audit_report(facts, text)
    assert res["passed"] is False
    assert "https://github.com/ghost/repo" in res["missing_urls"]
    assert "https://github.com/langchain-ai/langgraph" not in res["missing_urls"]
    assert res["risk_missing"] is False
    print("[1] case1 URL 追溯 OK")


def test_case2_risk_section_missing():
    """无风险节 → risk_missing=True；图表缺失 → chart_missing 非空"""
    facts = [{"tool": "fetch_github_releases", "args": "", "result":
              '{"html_url": "https://github.com/a/b/releases/tag/1.0"}'}]
    text = "对比结论：A 优于 B。来源: https://github.com/a/b/releases/tag/1.0"
    res = harness_gate.audit_report(facts, text)
    assert res["risk_missing"] is True
    assert "<无图片链接>" in res["chart_missing"]
    assert res["passed"] is False
    print("[2] case2 风险节/图表缺失 OK")


def test_case3_full_pass():
    """URL 可追溯 + 图表文件真实存在非空 + 风险节非空 → passed=True"""
    with tempfile.NamedTemporaryFile(dir=harness_gate.DOWNLOAD_DIR, suffix=".png",
                                     delete=False) as f:
        f.write(b"not-empty")
        tmp_name = f.name
    try:
        facts = [{"tool": "search_github_repos", "args": "", "result":
                  '{"repos": [{"html_url": "https://github.com/langchain-ai/langgraph"}]}'}]
        text = ("### risk_warnings\nLicense 传染性：无。\n\n"
                "来源: https://github.com/langchain-ai/langgraph\n\n"
                f"雷达图: /api/download/{os.path.basename(tmp_name)}")
        res = harness_gate.audit_report(facts, text)
        assert res["passed"] is True, res
        assert res["missing_urls"] == [] and res["chart_missing"] == []
        print("[3] case3 全通过 OK")
    finally:
        os.unlink(tmp_name)


if __name__ == "__main__":
    test_case1_url_not_in_facts()
    test_case2_risk_section_missing()
    test_case3_full_pass()
    print("ALL PASS")
