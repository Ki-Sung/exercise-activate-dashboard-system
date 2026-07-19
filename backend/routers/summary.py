"""일/주/월 요약 라우터. 요청 파싱과 인증만 담당하고, 로직은 service 계층에 위임한다."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.core.security import require_api_key
from backend.schemas.summary import SummaryOut
from backend.services.summary_service import (
    get_daily_summary,
    get_monthly_summary,
    get_weekly_summary,
)

router = APIRouter(
    prefix="/api/py/summary",
    tags=["summary"],
    dependencies=[Depends(require_api_key)],
)


@router.get("/daily", response_model=list[SummaryOut])
async def daily(days: int = Query(14, ge=1, le=90)) -> list[SummaryOut]:
    return await get_daily_summary(days)


@router.get("/weekly", response_model=list[SummaryOut])
async def weekly(weeks: int = Query(12, ge=1, le=52)) -> list[SummaryOut]:
    return await get_weekly_summary(weeks)


@router.get("/monthly", response_model=list[SummaryOut])
async def monthly(months: int = Query(12, ge=1, le=36)) -> list[SummaryOut]:
    return await get_monthly_summary(months)
