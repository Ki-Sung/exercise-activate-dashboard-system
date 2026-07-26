"""Supabase(PostgREST) 저장소 계층. 이 API 서버는 읽기 전용이다."""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from backend.core.config import get_settings

_TIMEOUT = httpx.Timeout(30.0)
# Supabase 기본 max-rows 는 1000. Range 로 나눠 전부 가져온다.
_PAGE = 1000


async def fetch_rows(table: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    settings = get_settings()
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Prefer": "count=exact",
    }
    rows: list[dict[str, Any]] = []
    offset = 0

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        while True:
            page_headers = {
                **headers,
                "Range": f"{offset}-{offset + _PAGE - 1}",
            }
            res = await client.get(
                f"{settings.rest_url}/{table}",
                headers=page_headers,
                params=params,
            )
            if res.status_code >= 400:
                raise HTTPException(status_code=502, detail="데이터 조회에 실패했습니다.")

            chunk = res.json()
            if not isinstance(chunk, list):
                raise HTTPException(status_code=502, detail="데이터 조회에 실패했습니다.")
            rows.extend(chunk)

            # Content-Range: 0-999/1150  → 더 있으면 다음 페이지
            content_range = res.headers.get("content-range", "")
            total = _parse_total(content_range)
            if total is not None:
                if len(rows) >= total or len(chunk) == 0:
                    break
            elif len(chunk) < _PAGE:
                break

            offset += _PAGE

    return rows


def _parse_total(content_range: str) -> int | None:
    # "0-999/1150" or "*/0"
    if "/" not in content_range:
        return None
    total_s = content_range.rsplit("/", 1)[-1].strip()
    if total_s == "*":
        return None
    try:
        return int(total_s)
    except ValueError:
        return None
