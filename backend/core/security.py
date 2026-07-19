"""인증 의존성. 개인용 단일 사용자 전제로 X-API-Key 헤더만 검사한다.
여러 사용자로 확장할 땐 Supabase Auth 의 JWT 검증으로 교체하면 된다.
"""
from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from backend.core.config import get_settings


def require_api_key(x_api_key: str = Header(default="")) -> None:
    settings = get_settings()
    if not settings.api_key or not hmac.compare_digest(x_api_key, settings.api_key):
        # 타이밍 공격 방지를 위해 compare_digest 사용
        raise HTTPException(status_code=401, detail="유효하지 않은 API 키입니다.")
