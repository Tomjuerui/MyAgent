"""
图表生成工具（Harness — 沙箱内安全执行）
26种图表类型合并为单一工具，在 Docker 沙箱内执行 matplotlib 生成 PNG。

核心设计（Harness 思想）：
- 所有图表必须在 Docker 沙箱内生成（/workspace/charts/）
- 生成后由本工具提取到宿主机 src/download/，经 /api/download 暴露给前端
- 沙箱不可用时返回错误，不降级到宿主机执行
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path
from langchain_core.tools import tool

from ..log_utils import agent_logger
from ..backends.sandbox_holder import get_sandbox
from ..config import SANDBOX_IMAGE

# 生成物落盘目录，与 src/api_view/web_main.py 的 /api/download/{filename} 对应
DOWNLOAD_DIR = Path(__file__).parent.parent.parent / "download"

CHART_TYPES = [
    "bar", "horizontal_bar", "stacked_bar", "grouped_bar",
    "line", "multi_line", "area", "stacked_area",
    "pie", "donut",
    "scatter", "bubble",
    "histogram", "box_plot", "violin",
    "heatmap", "treemap",
    "radar", "polar",
    "waterfall", "funnel",
    "gauge", "kpi_card",
    "candlestick", "ohlc",
    "sankey",
]

def _chart_digest(
    chart_type: str, data_list: list, title: str,
    x_field: str, y_field: str, series_field: str,
) -> str:
    """图表内容指纹：类型/数据/标题/字段映射任一不同 → 不同图。

    用于输出文件名，使同图幂等复用（模型反复"再画一张确认"不再产生重复 PNG）。
    """
    payload = json.dumps(
        {
            "chart_type": chart_type,
            "data": data_list,
            "title": title,
            "x_field": x_field,
            "y_field": y_field,
            "series_field": series_field,
        },
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


CHART_SCRIPT = '''
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import json
import sys
import os

from matplotlib import font_manager

# 必须查实际已注册的字体族：rcParams 赋值不会抛异常，
# 只写 plt.rcParams['font.sans-serif'] = [font] 会永远"选中"不存在的字体，
# 中文静默回退到无 CJK 字形的 DejaVu Sans，渲染成缺字方块
_available_fonts = {f.name for f in font_manager.fontManager.ttflist}
for _font in ['WenQuanYi Micro Hei', 'Source Han Sans SC', 'Noto Sans CJK SC',
              'Microsoft YaHei', 'SimHei']:
    if _font in _available_fonts:
        plt.rcParams['font.sans-serif'] = [_font]
        print('FONT:' + _font)
        break
else:
    print('FONT:NONE')
plt.rcParams['axes.unicode_minus'] = False

params_path = sys.argv[1]
with open(params_path, 'r', encoding='utf-8') as f:
    params = json.load(f)

chart_type = params["chart_type"]
data = params["data"]
title = params["title"]
output_path = params["output_path"]
x_field = params.get("x_field", "label")
y_field = params.get("y_field", "value")
series_field = params.get("series_field", "")

fig, ax = plt.subplots(figsize=(12, 8))

try:
    if chart_type == "bar":
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        bars = ax.bar(labels, values, color='#2563EB', edgecolor='white')
        ax.bar_label(bars, fmt='%.1f', fontsize=9)

    elif chart_type == "horizontal_bar":
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        ax.barh(labels, values, color='#2563EB')

    elif chart_type == "grouped_bar" and series_field:
        series_names = list(set(item.get(series_field, "") for item in data))
        x_labels = list(set(item.get(x_field, "") for item in data))
        x_pos = np.arange(len(x_labels))
        width = 0.8 / max(len(series_names), 1)
        colors = plt.cm.Set2(np.linspace(0, 1, len(series_names)))
        for idx, series in enumerate(series_names):
            vals = [float(next((item.get(y_field, 0) for item in data
                     if item.get(x_field) == xl and item.get(series_field) == series), 0))
                    for xl in x_labels]
            ax.bar(x_pos + idx * width, vals, width, label=series, color=colors[idx])
        ax.set_xticks(x_pos + width * (len(series_names) - 1) / 2)
        ax.set_xticklabels(x_labels)
        ax.legend()

    elif chart_type == "stacked_bar" and series_field:
        series_names = list(set(item.get(series_field, "") for item in data))
        x_labels = list(set(item.get(x_field, "") for item in data))
        x_pos = np.arange(len(x_labels))
        bottom = np.zeros(len(x_labels))
        colors = plt.cm.Set2(np.linspace(0, 1, len(series_names)))
        for idx, series in enumerate(series_names):
            vals = [float(next((item.get(y_field, 0) for item in data
                     if item.get(x_field) == xl and item.get(series_field) == series), 0))
                    for xl in x_labels]
            ax.bar(x_pos, vals, bottom=bottom, label=series, color=colors[idx])
            bottom += np.array(vals)
        ax.set_xticks(x_pos)
        ax.set_xticklabels(x_labels)
        ax.legend()

    elif chart_type in ("line", "multi_line"):
        if series_field:
            series_names = list(set(item.get(series_field, "") for item in data))
            for series in series_names:
                series_data = [item for item in data if item.get(series_field) == series]
                labels = [item.get(x_field, str(i)) for i, item in enumerate(series_data)]
                values = [float(item.get(y_field, 0)) for item in series_data]
                ax.plot(labels, values, marker='o', label=series)
            ax.legend()
        else:
            labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
            values = [float(item.get(y_field, 0)) for item in data]
            ax.plot(labels, values, marker='o', color='#2563EB', linewidth=2)

    elif chart_type in ("area", "stacked_area"):
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        ax.fill_between(range(len(labels)), values, alpha=0.3, color='#2563EB')
        ax.plot(range(len(labels)), values, color='#2563EB', linewidth=2)
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, rotation=45, ha='right')

    elif chart_type == "pie":
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        ax.pie(values, labels=labels, autopct='%1.1f%%', startangle=90,
               colors=plt.cm.Set3(np.linspace(0, 1, len(labels))))

    elif chart_type == "donut":
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        ax.pie(values, labels=labels, autopct='%1.1f%%', startangle=90,
               pctdistance=0.85, colors=plt.cm.Set3(np.linspace(0, 1, len(labels))))
        centre = plt.Circle((0, 0), 0.70, fc='white')
        ax.add_artist(centre)

    elif chart_type == "scatter":
        x = [float(item.get("x", item.get(x_field, 0))) for item in data]
        y = [float(item.get("y", item.get(y_field, 0))) for item in data]
        ax.scatter(x, y, color='#2563EB', alpha=0.7, s=60)

    elif chart_type == "bubble":
        x = [float(item.get("x", item.get(x_field, 0))) for item in data]
        y = [float(item.get("y", item.get(y_field, 0))) for item in data]
        s = [float(item.get("size", 100)) for item in data]
        ax.scatter(x, y, s=s, color='#2563EB', alpha=0.5)

    elif chart_type == "histogram":
        values = [float(item.get(y_field, item.get("value", 0))) for item in data]
        ax.hist(values, bins=min(15, max(5, len(values)//3)), color='#2563EB', alpha=0.7, edgecolor='white')

    elif chart_type == "heatmap":
        values = [float(item.get(y_field, 0)) for item in data]
        n = int(len(values) ** 0.5) or 1
        matrix = np.array(values[:n*n]).reshape(n, n)
        im = ax.imshow(matrix, cmap='YlOrRd', aspect='auto')
        plt.colorbar(im, ax=ax)

    elif chart_type == "radar":
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        angles = np.linspace(0, 2 * np.pi, len(labels), endpoint=False).tolist()
        values_plot = values + values[:1]
        angles += angles[:1]
        ax = plt.subplot(111, polar=True)
        ax.plot(angles, values_plot, 'o-', color='#2563EB', linewidth=2)
        ax.fill(angles, values_plot, alpha=0.25, color='#2563EB')
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(labels)

    elif chart_type == "waterfall":
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        cumulative = 0
        colors_list = []
        bottoms = []
        for v in values:
            bottoms.append(cumulative if v >= 0 else cumulative + v)
            colors_list.append('#22C55E' if v >= 0 else '#EF4444')
            cumulative += v
        ax.bar(labels, [abs(v) for v in values], bottom=bottoms, color=colors_list, edgecolor='white')

    else:
        labels = [item.get(x_field, str(i)) for i, item in enumerate(data)]
        values = [float(item.get(y_field, 0)) for item in data]
        ax.bar(labels, values, color='#2563EB')

    ax.set_title(title, fontsize=14, fontweight='bold', pad=15)
    plt.xticks(rotation=45, ha='right')
    plt.tight_layout()

except Exception as e:
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.text(0.5, 0.5, f'Chart Error: {str(e)[:100]}', ha='center', va='center', fontsize=12, color='red')
    ax.set_title(title)

plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
plt.close()
print(f"OK:{output_path}")
'''


@tool
def generate_chart(
    chart_type: str,
    data: str,
    title: str = "数据图表",
    x_field: str = "label",
    y_field: str = "value",
    series_field: str = "",
) -> str:
    """在沙箱中生成数据可视化图表（支持26种类型）。

    图表在 Docker 沙箱中安全生成，生成后自动提取到宿主机下载目录，
    返回可直接在前端 Markdown 中引用的图片链接。

    Args:
        chart_type: 图表类型。支持: bar(柱状图), horizontal_bar(横向柱状图),
            stacked_bar(堆叠柱状图), grouped_bar(分组柱状图),
            line(折线图), multi_line(多折线), area(面积图), stacked_area(堆叠面积图),
            pie(饼图), donut(环形图), scatter(散点图), bubble(气泡图),
            histogram(直方图), box_plot(箱线图), violin(小提琴图),
            heatmap(热力图), treemap(矩形树图), radar(雷达图), polar(极坐标图),
            waterfall(瀑布图), funnel(漏斗图), gauge(仪表盘),
            candlestick(K线图), ohlc(OHLC图), sankey(桑基图), kpi_card(KPI卡片)
        data: 数据JSON字符串。格式: [{"label":"名称","value":数值}, ...]
            分组图: [{"supplier":"A","price":25,"part":"贴片电容"}, ...]
            散点图: [{"x":10,"y":20}, ...]
        title: 图表标题
        x_field: X轴/分类字段名（默认"label"）
        y_field: Y轴/数值字段名（默认"value"）
        series_field: 系列/分组字段名（分组图/多线图时使用，如"supplier"）

    Returns:
        图表沙箱路径，或错误信息
    """
    if chart_type not in CHART_TYPES:
        return f"不支持的图表类型: {chart_type}。支持: {', '.join(CHART_TYPES[:10])}... 共{len(CHART_TYPES)}种"

    try:
        data_list = json.loads(data) if isinstance(data, str) else data
        if not isinstance(data_list, list) or len(data_list) == 0:
            return "错误: data 必须是非空 JSON 列表"
    except json.JSONDecodeError as e:
        return f"数据格式错误: {e}。data 必须是有效的 JSON 列表。"

    sandbox = get_sandbox()
    if sandbox is None:
        return "错误: 沙箱不可用。请确保 Docker 沙箱容器已启动。"

    # 内容哈希命名：同图（同类型+同数据+同标题+同字段映射）复用同一文件名，天然幂等
    digest = _chart_digest(chart_type, data_list, title, x_field, y_field, series_field)
    output_name = f"chart_{chart_type}_{digest}.png"
    charts_dir = "/workspace/charts"
    output_path = f"{charts_dir}/{output_name}"

    # 幂等短路：宿主机下载目录已有同图 → 直接复用，不重跑 matplotlib
    existing = DOWNLOAD_DIR / output_name
    if existing.exists() and existing.stat().st_size > 0:
        image_url = f"/api/download/{output_name}"
        agent_logger.info(f"Chart cache hit (host): {output_name}")
        return "\n".join([
            "✅ 图表已生成!（复用已有同图）",
            f"标题: {title}",
            f"类型: {chart_type}",
            f"数据点: {len(data_list)}",
            f"图片链接: {image_url}",
            f"在回复中用 Markdown 引用该图（不要另存或改写链接）: ![{title}]({image_url})",
        ])

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    params_filename = f"_params_{timestamp}.json"
    script_filename = f"_chart_script_{timestamp}.py"
    params_path = f"{charts_dir}/{params_filename}"
    script_path = f"{charts_dir}/{script_filename}"

    # 构建执行参数
    params = {
        "chart_type": chart_type,
        "data": data_list,
        "title": title,
        "output_path": output_path,
        "x_field": x_field,
        "y_field": y_field,
        "series_field": series_field,
    }

    try:
        # 确保目录存在
        sandbox.execute(f"mkdir -p {charts_dir}")

        # 写入脚本和参数到沙箱
        sandbox.write_file(params_path, json.dumps(params, ensure_ascii=False))
        sandbox.write_file(script_path, CHART_SCRIPT)

        # 依赖探测：已装则直接 import（毫秒级），缺失才 pip。
        # 之前每次调用都无脑跑一次 pip，8 张图就多 8 个 pip 进程。
        sandbox.execute(
            "python -c 'import matplotlib, numpy' 2>/dev/null "
            "|| pip install -q matplotlib numpy 2>/dev/null || true",
            timeout=60,
        )

        # 在沙箱内执行图表生成
        result = sandbox.execute(f"python {script_path} {params_path}", timeout=30)

        # 清理临时文件
        sandbox.execute(f"rm -f {params_path} {script_path} 2>/dev/null || true")

        # 沙箱无中文字体：明确报错，而不是静默产出满是缺字方块的图
        if "FONT:NONE" in result.output:
            return (
                "错误: 沙箱环境缺少中文字体，图表中文会渲染成缺字方块。"
                f"请确认沙箱镜像自带字体（SANDBOX_IMAGE={SANDBOX_IMAGE}，"
                "见 docker/sandbox.Dockerfile）并已执行 "
                "`docker compose build sandbox && docker compose up -d sandbox`。"
            )

        # 检查输出是否成功
        if result.exit_code == 0 and "OK:" in result.output:
            # 验证文件存在
            if sandbox.file_exists(output_path):
                content = sandbox.read_file_bytes(output_path)
                file_size = len(content)
                agent_logger.info(
                    f"Chart generated in sandbox: {output_path} ({file_size} bytes)"
                )

                # 生成后立刻提取到宿主机下载目录：之前只把沙箱路径当文本返回，
                # 是否可见取决于模型会不会再调一次 download_sandbox_file，实际经常漏掉。
                image_url = ""
                try:
                    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
                    (DOWNLOAD_DIR / output_name).write_bytes(content)
                    # 相对路径：经前端 /api 重写打到后端，不写死 host/port
                    image_url = f"/api/download/{output_name}"
                except Exception as e:
                    agent_logger.warning(f"Chart extract to host failed: {e}")

                lines = [
                    "✅ 图表已生成!",
                    f"标题: {title}",
                    f"类型: {chart_type}",
                    f"数据点: {len(data_list)}",
                    f"文件大小: {file_size / 1024:.1f} KB",
                    f"沙箱路径: {output_path}",
                ]
                if image_url:
                    lines += [
                        f"图片链接: {image_url}",
                        f"在回复中用 Markdown 引用该图（不要另存或改写链接）: ![{title}]({image_url})",
                    ]
                else:
                    lines.append(
                        f"💡 提取到宿主机失败，如需下载请使用 download_sandbox_file 工具，"
                        f"传入沙箱路径: {output_path}"
                    )
                return "\n".join(lines)
            else:
                return f"图表生成后文件未找到: {output_path}"
        else:
            error_msg = result.output[:500] if result.output else "未知错误"
            return f"图表生成失败: {error_msg}"

    except Exception as e:
        agent_logger.error(f"Chart generation error: {e}")
        return f"图表生成异常: {str(e)}"
