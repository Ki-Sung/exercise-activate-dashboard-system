"""Supabase(PostgREST) 저장소 계층. 이 API 서버는 읽기 전용이다."""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from backend.core.config import get_settings

_TIMEOUT = httpx.Timeout(15.0)


async def fetch_rows(table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    settings = get_settings()
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        res = await client.get(f"{settings.rest_url}/{table}", headers=headers, params=params)
    if res.status_code >= 400:
        raise HTTPException(status_code=502, detail="데이터 조회에 실패했습니다.")
    return res.json()
