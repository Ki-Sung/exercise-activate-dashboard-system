"""헬스체크. 인증이 필요 없는 유일한 엔드포인트."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/py", tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
