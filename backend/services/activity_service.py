"""최근 활동 목록 비즈니스 로직."""
from __future__ import annotations

from backend.db.supabase import fetch_rows
from backend.schemas.activity import ActivityOut
from backend.services.formatting import attach_labels


async def get_recent_activities(limit: int) -> list[ActivityOut]:
    rows = await fetch_rows(
        "v_activities",
        {"select": "*", "order": "start_time_local.desc", "limit": str(limit)},
    )
    return [ActivityOut.model_validate(attach_labels(row)) for row in rows]
