"""최근 활동 목록 응답 모델."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class ActivityOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    activity_id: int
    activity_name: str
    activity_type: str
    start_time_local: datetime
    start_date: date
    distance_km: float
    duration_s: float
    moving_duration_s: float | None = None
    calories: int
    avg_hr: int | None = None
    max_hr: int | None = None
    avg_pace_s_per_km: float | None = None
    elevation_gain_m: float | None = None
    avg_pace_label: str
    duration_label: str
