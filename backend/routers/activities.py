"""최근 활동 목록 라우터."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.core.security import require_api_key
from backend.schemas.activity import ActivityOut
from backend.services.activity_service import get_recent_activities

router = APIRouter(
    prefix="/api/py",
    tags=["activities"],
    dependencies=[Depends(require_api_key)],
)


@router.get("/activities", response_model=list[ActivityOut])
async def activities(limit: int = Query(20, ge=1, le=100)) -> list[ActivityOut]:
    return await get_recent_activities(limit)
