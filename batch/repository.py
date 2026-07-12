"""
저장소 계층. Supabase 의 PostgREST 위에서 동작한다.
- service_role 키는 RLS 를 우회하므로 절대 프론트/모바일에 노출하지 않는다.
- 스키마가 public 이 아니므로 요청 헤더에 Content-Profile / Accept-Profile 을 지정한다.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from batch.retry_policy import call_with_retry

log = logging.getLogger(__name__)
TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class SupabaseRepository:
    def __init__(self, url: str, service_key: str, schema: str = "garmin") -> None:
        self._base = f"{url}/rest/v1"
        self._schema = schema
        self._client = httpx.Client(
            timeout=TIMEOUT,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Accept-Profile": schema,
                "Content-Profile": schema,
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SupabaseRepository":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ---------- 토큰 ----------
    def load_tokens(self) -> dict[str, Any] | None:
        res = call_with_retry(
            self._client.get,
            f"{self._base}/app_secrets",
            params={"key": "eq.garmin_tokens", "select": "value"},
        )
        res.raise_for_status()
        rows = res.json()
        return rows[0]["value"] if rows else None

    def save_tokens(self, tokens: dict[str, str]) -> None:
        res = call_with_retry(
            self._client.post,
            f"{self._base}/app_secrets",
            params={"on_conflict": "key"},
            headers={"Prefer": "resolution=merge-duplicates"},
            json=[{"key": "garmin_tokens", "value": tokens, "updated_at": "now()"}],
        )
        res.raise_for_status()
        log.info("갱신된 가민 토큰 저장 완료")

    # ---------- 활동 / 스탯 ----------
    def upsert_activities(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        res = call_with_retry(
            self._client.post,
            f"{self._base}/activities",
            params={"on_conflict": "activity_id"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows,
        )
        res.raise_for_status()
        return len(rows)

    def upsert_daily_stats(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        res = call_with_retry(
            self._client.post,
            f"{self._base}/daily_stats",
            params={"on_conflict": "stat_date"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=rows,
        )
        res.raise_for_status()
        return len(rows)

    # ---------- 실행 로그 ----------
    def log_run(self, payload: dict[str, Any]) -> None:
        try:
            res = self._client.post(f"{self._base}/sync_runs", json=[payload])
            res.raise_for_status()
        except httpx.HTTPError as exc:
            # 로그 저장 실패가 배치 자체를 죽이면 안 된다
            log.warning("sync_runs 기록 실패: %s", exc)
