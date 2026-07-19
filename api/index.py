"""
Vercel Python 엔트리포인트.

Vercel 은 `/api` 디렉토리 안의 `.py` 파일 중 top-level `app`(또는 `handler`) 을
가진 파일을 파일 경로 그대로 라우팅되는 Vercel Function 으로 인식한다
(이 파일 → `/api/index`, `vercel.json` 의 rewrites 가 `/api/py/*` 를 여기로 보낸다).

실제 백엔드 로직(라우터/서비스/DB/스키마/설정)은 모두 리포지토리 루트의
`backend/` 패키지에 있다. 이 파일은 Vercel 이 요구하는 위치에 두는
최소한의 진입점(스위치) 역할만 하고, 로직은 전혀 담지 않는다.

    backend/
      routers/    # URL, 쿼리 파라미터, 인증 연결
      services/   # 비즈니스 로직 (포맷팅, 조회 조합)
      db/         # Supabase(PostgREST) 접근
      schemas/    # 응답 Pydantic 모델
      core/       # 설정(config), 인증(security), 앱 팩토리(app_factory)
"""
from __future__ import annotations

import os
import sys

# Vercel 런타임에서 project root 가 sys.path 에 없는 경우에 대한 방어.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from backend.core.app_factory import create_app  # noqa: E402

app = create_app()

__all__ = ["app"]
