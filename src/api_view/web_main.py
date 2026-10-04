"""
FastAPI 应用入口
CORS 全开、路由注册、startup/shutdown 事件
"""
import sys
import os
from pathlib import Path
from contextlib import asynccontextmanager

# 确保项目根目录在 path 中
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .api.chat import router as chat_router
from .api.history import router as history_router
from .web_config import close_mongo_client
from ..agent.log_utils import web_logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    web_logger.info("Starting ERP Agent Web Server...")
    yield
    # Shutdown
    web_logger.info("Shutting down ERP Agent Web Server...")
    await close_mongo_client()


app = FastAPI(
    title="DeepAgent 智能采购助手",
    description="基于 Harness Engineering 架构的电子元器件采购智能助手 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 全开（开发环境）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(chat_router)
app.include_router(history_router)

# 文件下载目录（图表等生成文件）
DOWNLOAD_DIR = Path(__file__).resolve().parent.parent / "download"
DOWNLOAD_DIR.mkdir(exist_ok=True)

# 只有位图按 inline 返回，便于 <img> 直接渲染；
# 刻意不含 SVG：同源返回的 SVG 可携带脚本，属于 XSS 面。
INLINE_IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """提供生成文件（图表 PNG / 报告 等）的 HTTP 访问。

    图片以正确 media type 内联返回，其余按附件下载。
    """
    base = DOWNLOAD_DIR.resolve()
    target = (base / filename).resolve()
    # 防目录穿越：解析后必须直接位于下载目录内（含符号链接逃逸）
    if target.parent != base or not target.is_file():
        raise HTTPException(status_code=404, detail=f"文件不存在: {filename}")

    media_type = INLINE_IMAGE_TYPES.get(target.suffix.lower())
    if media_type:
        return FileResponse(path=str(target), media_type=media_type)
    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type="application/octet-stream",
    )


@app.get("/")
async def root():
    return {"message": "DeepAgent 智能采购助手 API", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
