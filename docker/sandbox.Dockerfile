# ============================================================
# Agent 代码执行沙箱镜像（erp-sandbox / myagent-sandbox:local）
#
# 基于 python:3.11-slim，额外预装中文字体。
# 原因：图表由 src/agent/tools/chart_generator.py 在沙箱容器内用 matplotlib
# 渲染 PNG，容器里没有 CJK 字体时 matplotlib 会静默回退到自带的 DejaVu Sans
# （无中日韩字形），标题/标签里的中文全部渲染成缺字方块。
#
# 注意：字体必须装在本镜像里。装到 backend 镜像（docker/backend.Dockerfile）
# 没有用 —— 渲染发生在沙箱容器，不是 backend 容器。
# ============================================================
FROM python:3.11-slim

# 中文字体（与 backend.Dockerfile 保持一致，WenQuanYi Micro Hei 约 5MB）
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
CMD ["sleep", "infinity"]
