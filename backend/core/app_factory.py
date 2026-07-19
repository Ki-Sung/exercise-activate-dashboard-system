"""FastAPI 앱 팩토리.

이 모듈은 최상위에 `app` 변수를 두지 않고 `create_app()` 함수만 노출한다.
실제 `app = create_app()` 대입은 Vercel 엔트리포인트인 `api/index.py` 에서만 한다.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import get_settings
from backend.routers import activities, health, summary


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Garmin Running Dashboard API",
        docs_url="/api/py/docs",
        redoc_url="/api/py/redoc",
        openapi_url="/api/py/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins or ["http://localhost:3000"],
        allow_methods=["GET"],
        allow_headers=["X-API-Key", "Content-Type"],
    )

    app.include_router(health.router)
    app.include_router(summary.router)
    app.include_router(activities.router)

    return app
