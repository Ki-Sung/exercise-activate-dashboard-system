"""환경변수 로딩. 값은 절대 로그에 찍지 않는다."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    api_key: str
    allowed_origins: list[str]

    @property
    def rest_url(self) -> str:
        return f"{self.supabase_url}/rest/v1"

    @classmethod
    def load(cls) -> "Settings":
        return cls(
            supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
            supabase_service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            api_key=os.environ.get("DASHBOARD_API_KEY", ""),
            allowed_origins=[
                o.strip()
                for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
                if o.strip()
            ],
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.load()
