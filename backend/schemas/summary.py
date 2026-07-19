"""요약(일/주/월) 응답 모델. RORO 패턴 — 서비스 계층은 dict 대신 이 모델을 반환한다."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict


class SummaryOut(BaseModel):
    model_config = ConfigDict(extra="ignore")

    period_start: date
    period_end: date
    activity_count: int
    total_distance_km: float
    total_duration_s: float
    total_calories: int
    avg_pace_s_per_km: float | None = None
    max_hr: int | None = None  # 일간에만 존재
    activity_names: str | None = None  # 일간에만 존재
    avg_pace_label: str
    duration_label: str
