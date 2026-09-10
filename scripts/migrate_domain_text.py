"""
一次性领域文案迁移脚本：摩托车零部件场景 → 电子元器件场景
规则按顺序应用（长词优先），仅覆盖 src 下文档/提示词/技能文件，不触碰代码逻辑。
运行：python scripts/migrate_domain_text.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# 应用顺序即优先级：先替换长词/复合词，再替换短词
RULES = [
    ("摩托车零部件", "电子元器件"),
    ("摩托车发动机配件", "主控芯片与电源器件"),
    ("零部件", "元器件"),
    ("零件", "元器件"),
    ("发动机系统", "主控芯片"),
    ("制动系统", "被动元件"),
    ("电气系统", "连接器"),
    ("火花塞", "贴片电容"),
    ("刹车片", "温湿度传感器"),
    ("滤芯", "贴片电阻"),
    ("传动系统配件", "连接器与被动元件"),
    ("华胜机械", "立创微电子"),
    ("恒达配件", "风华电子"),
    ("博世", "立创微"),
    ("电装", "风华"),
]

TARGETS = (
    list((ROOT / "src" / "agent" / "memory").glob("*.py"))
    + list((ROOT / "src" / "agent" / "memory").glob("*.md"))
    + list((ROOT / "src" / "agent").glob("*.yaml"))
    + list((ROOT / "src" / "agent" / "subagents" / "configs").glob("*.yaml"))
    + list((ROOT / "src" / "agent" / "tools").glob("*.py"))
    + list((ROOT / "src" / "mcp_server").glob("*.py"))
    + list((ROOT / "src" / "mcp_server" / "tools").glob("*.py"))
    + list((ROOT / "src" / "api_view").glob("*.py"))
    + list((ROOT / "src" / "test").glob("*.py"))
    + list((ROOT / "src" / "skills").rglob("*.md"))
    + list((ROOT / "src" / "skills").rglob("*.py"))
)


def main() -> int:
    changed = 0
    for path in TARGETS:
        text = path.read_text(encoding="utf-8")
        new_text = text
        hits = {}
        for old, new in RULES:
            if old in new_text:
                hits[old] = new_text.count(old)
                new_text = new_text.replace(old, new)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            changed += 1
            print(f"[migrated] {path.relative_to(ROOT)}  {hits}")
    print(f"\n共迁移 {changed} 个文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
