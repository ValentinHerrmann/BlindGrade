"""Application settings loaded from environment variables."""
from __future__ import annotations

import json
from typing import Annotated

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///:memory:"  # asyncpg URL for application (or SQLite in tests)
    DATABASE_URL_SYNC: str = ""  # psycopg2 URL for Alembic (derived if absent)

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT / Auth
    SECRET_KEY: str = "dev-secret-key-change-me-in-production-32-chars-long!"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL_MINUTES: int = 15
    REFRESH_TOKEN_TTL_DAYS: int = 7

    # CORS — required; app refuses to start if unset or empty
    CORS_ALLOWED_ORIGINS: list[str] = ["http://localhost:5173"]

    # Environment
    ENVIRONMENT: str = "production"

    # Body size limits (bytes)
    BODY_LIMIT_COMPILE: int = 2 * 1024 * 1024       # 2 MB
    BODY_LIMIT_SUBMISSION: int = 50 * 1024 * 1024   # 50 MB
    BODY_LIMIT_STUDENTS: int = 1 * 1024 * 1024      # 1 MB
    BODY_LIMIT_DEFAULT: int = 256 * 1024             # 256 KB

    @field_validator("CORS_ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> list[str]:
        if isinstance(v, str):
            return json.loads(v)
        return v  # type: ignore[return-value]

    @model_validator(mode="after")
    def require_cors_origins(self) -> "Settings":
        if not self.CORS_ALLOWED_ORIGINS:
            raise ValueError(
                "CORS_ALLOWED_ORIGINS must be set and non-empty. "
                "App refuses to start without an explicit origin allowlist."
            )
        return self

    @model_validator(mode="after")
    def derive_sync_url(self) -> "Settings":
        if not self.DATABASE_URL_SYNC:
            # Derive sync DB URL from async DB URL
            self.DATABASE_URL_SYNC = (
                self.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
                .replace("sqlite+aiosqlite://", "sqlite://")
            )
        return self

    @property
    def is_dev(self) -> bool:
        return self.ENVIRONMENT == "development"


settings = Settings()  # type: ignore[call-arg]
