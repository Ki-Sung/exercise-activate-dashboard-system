"""환경변수 로딩 및 검증. 값은 절대 로그에 찍지 않는다."""
from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")

# 배치가 매번 되돌아보는 기간(일).
# 가민은 활동명/거리 수정이 사후에 일어날 수 있으므로 롤링 윈도우로 재동기화한다.
DEFAULT_LOOKBACK_DAYS = 14

# 재시도 정책
MAX_ATTEMPTS = 7          # 요청하신 "배치당 7회"
BACKOFF_BASE_S = 2.0      # 2, 4, 8, 16, 32, 64 ...
BACKOFF_CAP_S = 120.0     # 상한
JITTER_RATIO = 0.5        # Full/Equal jitter 계수


class ConfigError(RuntimeError):
    pass


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"필수 환경변수 누락: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    garmin_token_b64: str | None  # 최초 부트스트랩용(그 이후엔 DB의 토큰 사용)
    slot: str
    lookback_days: int

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            supabase_url=_require("SUPABASE_URL").rstrip("/"),
            supabase_service_key=_require("SUPABASE_SERVICE_ROLE_KEY"),
            garmin_token_b64=os.environ.get("GARMIN_TOKEN_B64") or None,
            slot=os.environ.get("BATCH_SLOT", "manual"),
            lookback_days=int(os.environ.get("LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS)),
        )
