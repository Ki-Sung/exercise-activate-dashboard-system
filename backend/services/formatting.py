"""사람이 읽는 포맷(페이스, 소요시간) 변환. 순수 함수만 둔다."""
from __future__ import annotations

from typing import Any


def pace_label(pace_s_per_km: float | None) -> str:
    if not pace_s_per_km:
        return "-"
    minutes, seconds = divmod(int(round(pace_s_per_km)), 60)
    return f"{minutes}:{seconds:02d}"


def duration_label(duration_s: float | None) -> str:
    hours, rest = divmod(int(duration_s or 0), 3600)
    return f"{hours}:{rest // 60:02d}:{rest % 60:02d}"


def attach_labels(row: dict[str, Any]) -> dict[str, Any]:
    """뷰에서 받은 dict 에 페이스/소요시간 라벨을 덧붙인다.
    요약 뷰는 total_duration_s, 활동 뷰는 duration_s 를 쓴다.
    """
    row["avg_pace_label"] = pace_label(row.get("avg_pace_s_per_km"))
    row["duration_label"] = duration_label(row.get("total_duration_s") or row.get("duration_s"))
    return row
