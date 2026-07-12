"""
가민 → Supabase 동기화 배치.

실행:
    python -m batch.main                 # 기본 14일 롤링 윈도우
    python -m batch.main --days 365      # 최초 백필

GitHub Actions 가 09/12/18/22 KST 에 이 스크립트를 호출한다.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import date, timedelta

from batch.config import KST, Settings
from batch.garmin_client import GarminGateway, decode_token_b64
from batch.repository import SupabaseRepository
from batch.retry_policy import ATTEMPT_COUNTER
from batch.transform import to_activity_row, to_daily_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s :: %(message)s",
)
log = logging.getLogger("batch")

# 일자별 스탯은 최근 며칠만 (호출 수 절약: 하루당 1콜)
DAILY_STATS_DAYS = 7


def _today_kst() -> date:
    import datetime as _dt

    return _dt.datetime.now(KST).date()


def run(settings: Settings, lookback_days: int) -> int:
    started = time.monotonic()
    today = _today_kst()
    window_from = today - timedelta(days=lookback_days)

    status = "success"
    error: str | None = None
    seen = upserted = daily_upserted = 0

    with SupabaseRepository(settings.supabase_url, settings.supabase_service_key) as repo:
        try:
            # 1) 토큰 확보: DB 우선, 없으면 시크릿(최초 1회)
            tokens = repo.load_tokens()
            if not tokens:
                if not settings.garmin_token_b64:
                    raise RuntimeError(
                        "DB에도 시크릿에도 가민 토큰이 없습니다. bootstrap_token.py 를 먼저 실행하세요."
                    )
                log.info("DB에 토큰 없음 → GARMIN_TOKEN_B64 로 부트스트랩")
                tokens = decode_token_b64(settings.garmin_token_b64)

            # 2) 로그인
            gateway = GarminGateway(tokens)
            gateway.login()

            # 3) 활동 수집 (재시도 정책 내장)
            raw_activities = gateway.fetch_activities(window_from, today)
            seen = len(raw_activities)
            rows = [row for row in map(to_activity_row, raw_activities) if row]
            if len(rows) != seen:
                log.warning("변환 불가 활동 %d건 스킵", seen - len(rows))
                status = "partial"
            upserted = repo.upsert_activities(rows)

            # 4) 일자별 스탯 수집
            daily_rows = []
            for offset in range(DAILY_STATS_DAYS):
                target = today - timedelta(days=offset)
                stats = gateway.fetch_daily_stats(target)
                if stats:
                    daily_rows.append(to_daily_row(target.isoformat(), stats))
                else:
                    status = "partial"
            daily_upserted = repo.upsert_daily_stats(daily_rows)

            # 5) 갱신된 토큰 회수 → DB 반영 (다음 실행이 이걸 쓴다)
            repo.save_tokens(gateway.dump_tokens())

            log.info(
                "동기화 완료: 활동 %d/%d, 일자스탯 %d, 재시도 %d회",
                upserted, seen, daily_upserted, ATTEMPT_COUNTER["total"],
            )

        except Exception as exc:  # noqa: BLE001 — 최상위에서 잡아 로그 남기고 실패 처리
            status = "failed"
            error = f"{type(exc).__name__}: {exc}"
            log.exception("배치 실패")

        finally:
            repo.log_run(
                {
                    "slot": settings.slot,
                    "status": status,
                    "window_from": window_from.isoformat(),
                    "window_to": today.isoformat(),
                    "activities_seen": seen,
                    "activities_upserted": upserted,
                    "daily_upserted": daily_upserted,
                    "attempts": ATTEMPT_COUNTER["total"],
                    "duration_ms": int((time.monotonic() - started) * 1000),
                    "error": error,
                    "finished_at": "now()",
                }
            )

    return 0 if status != "failed" else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=None, help="되돌아볼 일수 (기본 14, 백필 시 365)")
    args = parser.parse_args()

    settings = Settings.load()
    return run(settings, args.days or settings.lookback_days)


if __name__ == "__main__":
    sys.exit(main())
