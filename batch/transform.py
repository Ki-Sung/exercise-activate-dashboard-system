"""
가민 원본 payload → DB row 변환.

순수 함수로 분리한 이유: 네트워크 없이 단위 테스트가 가능해야 하기 때문.
(작성하신 원본 코드에서 activities[0] / activities[1] 이 섞여 있던 부분과,
 거리 0일 때 ZeroDivision 위험, 필드 누락 시 None 이 int() 로 들어가는 문제를 여기서 흡수한다.)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

RUN_TYPE_KEYS = {
    "running",
    "street_running",
    "treadmill_running",
    "trail_running",
    "indoor_running",
    "track_running",
    "virtual_run",
    "obstacle_run",
}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_local(value: str | None) -> str | None:
    """'2026-07-12 07:12:33' → ISO 문자열. 파싱 실패 시 None."""
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:19], fmt).isoformat()
        except ValueError:
            continue
    return None


def _parse_gmt(value: str | None) -> str | None:
    parsed = _parse_local(value)
    if not parsed:
        return None
    return datetime.fromisoformat(parsed).replace(tzinfo=timezone.utc).isoformat()


def pace_s_per_km(duration_s: float, distance_m: float) -> float | None:
    """페이스(초/km). 거리가 0이면 None — 나눗셈 방어."""
    if distance_m <= 0 or duration_s <= 0:
        return None
    return round(duration_s / (distance_m / 1000.0), 2)


def format_pace(seconds_per_km: float | None) -> str:
    if not seconds_per_km or seconds_per_km <= 0:
        return "-"
    minutes, seconds = divmod(int(round(seconds_per_km)), 60)
    return f"{minutes}:{seconds:02d}"


def to_activity_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    activity_id = _int_or_none(raw.get("activityId"))
    start_local = _parse_local(raw.get("startTimeLocal"))
    if activity_id is None or start_local is None:
        return None  # 식별자나 시작시각이 없으면 저장하지 않는다

    type_key = (raw.get("activityType") or {}).get("typeKey") or "unknown"
    distance_m = _num(raw.get("distance"))
    duration_s = _num(raw.get("duration"))

    return {
        "activity_id": activity_id,
        "activity_name": raw.get("activityName") or "이름 없음",
        "activity_type": type_key,
        "is_run": type_key in RUN_TYPE_KEYS,
        "start_time_local": start_local,
        "start_time_utc": _parse_gmt(raw.get("startTimeGMT")),
        "distance_m": round(distance_m, 2),
        "duration_s": round(duration_s, 2),
        "moving_duration_s": round(_num(raw.get("movingDuration")), 2) or None,
        "calories": int(_num(raw.get("calories"))),
        "avg_hr": _int_or_none(raw.get("averageHR")),
        "max_hr": _int_or_none(raw.get("maxHR")),
        "elevation_gain_m": round(_num(raw.get("elevationGain")), 2) or None,
        "avg_pace_s_per_km": pace_s_per_km(duration_s, distance_m),
        "raw": raw,
    }


def to_daily_row(stat_date: str, raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "stat_date": stat_date,
        "total_steps": _int_or_none(raw.get("totalSteps")),
        "total_kcal": _int_or_none(raw.get("totalKilocalories")),
        "active_kcal": _int_or_none(raw.get("activeKilocalories")),
        "resting_hr": _int_or_none(raw.get("restingHeartRate")),
        "raw": raw,
    }
