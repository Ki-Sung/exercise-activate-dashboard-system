"""
FastAPI 백엔드 — Vercel Python Serverless Function 으로 배포된다.

레이어:
    router  → service → repository → Supabase(PostgREST)

보안:
- service_role 키는 이 서버(런타임)에만 존재한다. 브라우저/앱 번들에 절대 들어가지 않는다.
- 클라이언트는 X-API-Key 헤더로 인증한다(개인용 단일 사용자 전제).
  → 여러 사용자로 확장할 땐 Supabase Auth 의 JWT 검증으로 교체하면 된다.
- CORS 는 화이트리스트만 허용.
- 모든 엔드포인트는 읽기 전용.

Vercel 은 /api 아래 파일을 함수로 취급하므로, 의존 모듈 분리 없이 한 파일로 유지한다.
"""
from __future__ import annotations

import hmac
import os
from datetime import date, timedelta
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------- config
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
API_KEY = os.environ.get("DASHBOARD_API_KEY", "")
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
]

REST = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}


# ---------------------------------------------------------------- security
def require_api_key(x_api_key: str = Header(default="")) -> None:
    if not API_KEY or not hmac.compare_digest(x_api_key, API_KEY):
        # 타이밍 공격 방지를 위해 compare_digest 사용
        raise HTTPException(status_code=401, detail="유효하지 않은 API 키입니다.")


# ---------------------------------------------------------------- repository
async def _select(table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(f"{REST}/{table}", headers=HEADERS, params=params)
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail="데이터 조회에 실패했습니다.")
    return res.json()


# ---------------------------------------------------------------- service
def _decorate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """페이스를 사람이 읽는 포맷(m:ss/km)으로 덧붙인다."""
    for row in rows:
        pace = row.get("avg_pace_s_per_km")
        if pace:
            minutes, seconds = divmod(int(round(float(pace))), 60)
            row["avg_pace_label"] = f"{minutes}:{seconds:02d}"
        else:
            row["avg_pace_label"] = "-"
        duration = row.get("total_duration_s") or row.get("duration_s") or 0
        hours, rest = divmod(int(float(duration)), 3600)
        row["duration_label"] = f"{hours}:{rest // 60:02d}:{rest % 60:02d}"
    return rows


# ---------------------------------------------------------------- app
app = FastAPI(title="Garmin Running Dashboard API", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["X-API-Key", "Content-Type"],
)


@app.get("/api/py/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/py/summary/daily", dependencies=[Depends(require_api_key)])
async def daily(days: int = Query(14, ge=1, le=90)) -> list[dict[str, Any]]:
    since = (date.today() - timedelta(days=days)).isoformat()
    rows = await _select(
        "v_daily_summary",
        {"select": "*", "period_start": f"gte.{since}", "order": "period_start.desc"},
    )
    return _decorate(rows)


@app.get("/api/py/summary/weekly", dependencies=[Depends(require_api_key)])
async def weekly(weeks: int = Query(12, ge=1, le=52)) -> list[dict[str, Any]]:
    rows = await _select(
        "v_weekly_summary",
        {"select": "*", "order": "period_start.desc", "limit": str(weeks)},
    )
    return _decorate(rows)


@app.get("/api/py/summary/monthly", dependencies=[Depends(require_api_key)])
async def monthly(months: int = Query(12, ge=1, le=36)) -> list[dict[str, Any]]:
    rows = await _select(
        "v_monthly_summary",
        {"select": "*", "order": "period_start.desc", "limit": str(months)},
    )
    return _decorate(rows)


@app.get("/api/py/activities", dependencies=[Depends(require_api_key)])
async def activities(limit: int = Query(20, ge=1, le=100)) -> list[dict[str, Any]]:
    rows = await _select(
        "v_activities",
        {"select": "*", "order": "start_time_local.desc", "limit": str(limit)},
    )
    return _decorate(rows)
