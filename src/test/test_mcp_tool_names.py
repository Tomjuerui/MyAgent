"""
双 MCP Server 工具名冲突检查

MultiServerMCPClient 合并 erp(:9000) 与 webintel(:9002) 两个 server 的工具。
两个 server 一旦出现同名工具，langchain-mcp-adapters 合并时会覆盖/歧义，
子 Agent 的子串匹配（loader.py:218 `if pattern in tool.name`）也会误挂载。

本脚本断言：合并后工具名唯一，且 webintel 的 3 个工具完整可见。

用法:
    python -m src.test.test_mcp_tool_names
"""
import asyncio
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent.env_utils import load_env

load_env()

EXPECTED_WEBINTEL_TOOLS = {
    "mcp_browser_navigate",
    "mcp_extract_table",
    "mcp_take_screenshot",
}


async def check_tool_names():
    from langchain_mcp_adapters.client import MultiServerMCPClient

    erp_url = os.getenv("MCP_SERVER_URL", "http://localhost:9000")
    webintel_url = os.getenv("WEBINTEL_MCP_URL", "http://localhost:9002/mcp")
    print(f"[1] erp={erp_url}/sse  webintel={webintel_url}")

    client = MultiServerMCPClient(
        {
            "erp": {"url": f"{erp_url}/sse", "transport": "sse"},
            "webintel": {"url": webintel_url, "transport": "streamable_http"},
        }
    )

    tools = await client.get_tools()
    names = [t.name for t in tools]
    print(f"[2] 合并后工具总数: {len(names)}")

    duplicates = [name for name, count in Counter(names).items() if count > 1]
    assert not duplicates, f"工具名冲突: {duplicates}"
    print("[3] ✓ 无重名")

    missing = EXPECTED_WEBINTEL_TOOLS - set(names)
    assert not missing, f"webintel 工具缺失: {missing}"
    print(f"[4] ✓ webintel 3 个工具齐全: {sorted(EXPECTED_WEBINTEL_TOOLS)}")

    # 子串匹配回归：ecosystem-crawler 的 tools 模式必须精确圈中这 3 个
    for pattern in EXPECTED_WEBINTEL_TOOLS:
        matched = [n for n in names if pattern in n]
        assert matched == [pattern], f"子串匹配 {pattern} 命中异常: {matched}"
    print("[5] ✓ 子串匹配精确（无多余命中）")

    print("\n✓ 工具名冲突检查通过")


if __name__ == "__main__":
    asyncio.run(check_tool_names())
