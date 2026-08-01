"""CORS middleware configuration — explicit origin allowlist, no wildcard."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings


def add_cors_middleware(app: FastAPI) -> None:
    """
    Register CORSMiddleware with an explicit origin allowlist.

    allow_credentials=True is required for httpOnly cookie auth.
    CORS_ALLOWED_ORIGINS must be non-empty (enforced by Settings validator).
    """
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ALLOWED_ORIGINS,
        allow_origin_regex=settings.CORS_ALLOWED_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

