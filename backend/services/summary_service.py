"""일/주/월 요약 비즈니스 로직."""
from __future__ import annotations

from datetime import date, timedelta

from backend.db.supabase import fetch_rows
from backend.schemas.summary import SummaryOut
from backend.services.formatting import attach_labels


async def get_daily_summary(days: int) -> list[SummaryOut]:
    since = (date.today() - timedelta(days=days)).isoformat()
    rows = await fetch_rows(
        "v_daily_summary",
        {"select": "*", "period_start": f"gte.{since}", "order": "period_start.desc"},
    )
    return [SummaryOut.model_validate(attach_labels(row)) for row in rows]


async def get_weekly_summary(weeks: int) -> list[SummaryOut]:
    rows = await fetch_rows(
        "v_weekly_summary",
        {"select": "*", "order": "period_start.desc", "limit": str(weeks)},
    )
    return [SummaryOut.model_validate(attach_labels(row)) for row in rows]


async def get_monthly_summary(months: int) -> list[SummaryOut]:
    rows = await fetch_rows(
        "v_monthly_summary",
        {"select": "*", "order": "period_start.desc", "limit": str(months)},
    )
    return [SummaryOut.model_validate(attach_labels(row)) for row in rows]
