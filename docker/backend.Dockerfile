# ============================================================
# ERP Agent 后端镜像（Mock ERP / MCP Server / Backend API 共用）
# 三个服务同一镜像、不同启动命令，见 docker-compose.yml
# ============================================================
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# 中文字体（Matplotlib 图表生成需要 WenQuanYi）
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖，充分利用构建缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 再拷贝源码
COPY src ./src

RUN mkdir -p src/download

EXPOSE 8000 8081 9000

CMD ["python", "-m", "src.api_view.web_main"]
