"""
가민 커넥트 접근 계층.

핵심 설계:
- CI(GitHub Actions)에는 사람이 없다 → MFA 프롬프트가 뜨면 배치는 그냥 죽는다.
  따라서 "로컬에서 1회 MFA 로그인 → 토큰 발급 → DB 저장" 후
  배치는 항상 토큰으로만 로그인한다. (batch/bootstrap_token.py 참고)
- oauth2 토큰은 1시간짜리라 실행 중 자동 갱신된다.
  갱신된 토큰을 다시 DB에 되돌려 저장해야 다음 실행이 안전하다. → dump_tokens()
- oauth1 토큰은 약 1년 유효. 만료되면 bootstrap 을 다시 1회 돌리면 된다.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

from garminconnect import Garmin

from batch.retry_policy import call_with_retry

log = logging.getLogger(__name__)

_TOKEN_FILES = ("oauth1_token.json", "oauth2_token.json")


class TokenError(RuntimeError):
    pass


def _write_token_dir(tokens: dict[str, Any]) -> Path:
    """DB에서 읽은 토큰 dict → 임시 디렉토리(garth 포맷)로 복원."""
    tmp = Path(tempfile.mkdtemp(prefix="garmin_tokens_"))
    for name in _TOKEN_FILES:
        payload = tokens.get(name)
        if payload is None:
            raise TokenError(f"토큰에 {name} 이(가) 없습니다. bootstrap_token.py 를 다시 실행하세요.")
        (tmp / name).write_text(
            payload if isinstance(payload, str) else json.dumps(payload),
            encoding="utf-8",
        )
    return tmp


def read_token_dir(token_dir: Path) -> dict[str, str]:
    """garth 토큰 디렉토리 → DB 저장용 dict."""
    out: dict[str, str] = {}
    for name in _TOKEN_FILES:
        path = token_dir / name
        if path.exists():
            out[name] = path.read_text(encoding="utf-8")
    if not out:
        raise TokenError(f"{token_dir} 에서 토큰 파일을 찾지 못했습니다.")
    return out


def decode_token_b64(b64: str) -> dict[str, str]:
    """GARMIN_TOKEN_B64 시크릿 → 토큰 dict."""
    try:
        return json.loads(base64.b64decode(b64).decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TokenError("GARMIN_TOKEN_B64 디코딩 실패") from exc


def encode_token_b64(tokens: dict[str, str]) -> str:
    return base64.b64encode(json.dumps(tokens).encode("utf-8")).decode("ascii")


class GarminGateway:
    """가민 호출을 감싸는 얇은 게이트웨이. 모든 외부 호출은 재시도 정책을 통과한다."""

    def __init__(self, tokens: dict[str, Any]) -> None:
        self._token_dir = _write_token_dir(tokens)
        self._client = Garmin()

    def login(self) -> None:
        # 토큰만 사용 — 이메일/비밀번호는 배치 런타임에 존재하지 않는다.
        call_with_retry(self._client.login, tokenstore=str(self._token_dir))
        log.info("가민 로그인 성공 (토큰 기반)")

    def fetch_activities(self, start: date, end: date) -> list[dict[str, Any]]:
        """기간 내 활동 목록. 원본 코드의 get_activities(0, 10) 대신
        날짜 범위로 조회해 멱등성과 정확성을 확보한다."""
        activities = call_with_retry(
            self._client.get_activities_by_date,
            start.isoformat(),
            end.isoformat(),
        )
        log.info("활동 %d건 수신 (%s ~ %s)", len(activities), start, end)
        return activities or []

    def fetch_daily_stats(self, target: date) -> dict[str, Any] | None:
        try:
            return call_with_retry(self._client.get_stats_and_body, target.isoformat())
        except Exception as exc:  # 일자별 스탯 실패는 치명적이지 않음 → partial 처리
            log.warning("%s 일자 스탯 조회 실패: %s", target, type(exc).__name__)
            return None

    def dump_tokens(self) -> dict[str, str]:
        """세션 중 갱신되었을 수 있는 토큰을 회수한다."""
        self._client.garth.dump(str(self._token_dir))
        return read_token_dir(self._token_dir)
