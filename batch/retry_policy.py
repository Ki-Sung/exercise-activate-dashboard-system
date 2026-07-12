"""
재시도 정책: Exponential Backoff + Jitter

- 최대 7회 시도 (초회 1 + 재시도 6)
- 대기시간 = min(BASE * 2^(n-1), CAP) 에 Equal Jitter 적용
    sleep = half + random(0, half),  half = capped / 2
  => 동시 다발 재시도가 같은 순간에 몰리는 thundering herd 방지.
- 재시도 대상: 네트워크 오류 / 타임아웃 / 429 / 5xx
- 재시도 안 함: 인증 실패(401/403) → 토큰 문제이므로 즉시 실패시켜 알림받는 게 맞다.
"""
from __future__ import annotations

import logging
import random
from typing import Any, Callable, TypeVar

import requests
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_base,
)

from batch.config import BACKOFF_BASE_S, BACKOFF_CAP_S, JITTER_RATIO, MAX_ATTEMPTS

log = logging.getLogger(__name__)
T = TypeVar("T")

# 재시도해야 하는 예외
RETRYABLE = (
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.HTTPError,
    TimeoutError,
)

# 절대 재시도하면 안 되는 예외 (fail fast)
NON_RETRYABLE = (GarminConnectAuthenticationError,)


class WaitExponentialJitter(wait_base):
    """min(base * 2^(n-1), cap) 에 Equal Jitter."""

    def __init__(self, base: float, cap: float, ratio: float) -> None:
        self.base = base
        self.cap = cap
        self.ratio = ratio

    def __call__(self, retry_state: RetryCallState) -> float:
        n = max(retry_state.attempt_number, 1)
        capped = min(self.base * (2 ** (n - 1)), self.cap)
        fixed = capped * (1 - self.ratio)
        jitter = random.uniform(0, capped * self.ratio)
        return fixed + jitter


# 시도 횟수 집계용 (sync_runs.attempts 에 기록)
ATTEMPT_COUNTER = {"total": 0}


def _before_sleep(retry_state: RetryCallState) -> None:
    ATTEMPT_COUNTER["total"] += 1
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    log.warning(
        "재시도 %d/%d — %.1fs 후 재요청 (원인: %s)",
        retry_state.attempt_number,
        MAX_ATTEMPTS,
        retry_state.next_action.sleep if retry_state.next_action else 0,
        type(exc).__name__ if exc else "unknown",
    )


def with_retry(fn: Callable[..., T]) -> Callable[..., T]:
    """가민 API 호출 함수에 붙이는 데코레이터."""
    return retry(
        reraise=True,
        stop=stop_after_attempt(MAX_ATTEMPTS),
        wait=WaitExponentialJitter(BACKOFF_BASE_S, BACKOFF_CAP_S, JITTER_RATIO),
        retry=retry_if_exception_type(RETRYABLE),
        before_sleep=_before_sleep,
    )(fn)


def call_with_retry(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """일회성 호출용 헬퍼."""
    return with_retry(fn)(*args, **kwargs)
