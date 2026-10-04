"""
用户画像 API：GET 读原文 + 快捷问题；PUT 保存用户编辑后的画像文件。
"""
from fastapi import APIRouter
from pydantic import BaseModel

from ...agent.profile import load_profile, save_profile, build_quick_report_prompt

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    content: str


@router.get("/{user_id}")
async def get_profile(user_id: str):
    return {
        "user_id": user_id,
        "content": load_profile(user_id),
        "quick_report_prompt": build_quick_report_prompt(user_id),
    }


@router.put("/{user_id}")
async def put_profile(user_id: str, body: ProfileUpdate):
    save_profile(user_id, body.content)
    return {"ok": True, "user_id": user_id}
