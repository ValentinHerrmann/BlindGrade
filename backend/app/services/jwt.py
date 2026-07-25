"""JWT helpers — encode/decode with explicit algorithm pinning."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import jwt

from app.config import settings

ALGORITHM = settings.JWT_ALGORITHM  # "HS256" — set at startup, never dynamic


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def create_access_token(teacher_id: uuid.UUID, email: str, role: str) -> str:
    """Return a signed JWT access token valid for ACCESS_TOKEN_TTL_MINUTES."""
    from datetime import timedelta

    exp = _now_utc() + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES)
    payload = {
        "sub": str(teacher_id),
        "email": email,
        "role": role,
        "exp": int(exp.timestamp()),
        "iat": int(_now_utc().timestamp()),
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(teacher_id: uuid.UUID, email: str, role: str) -> tuple[str, str]:
    """
    Return (signed_jwt, jti) for a refresh token valid for REFRESH_TOKEN_TTL_DAYS.

    *jti* is the token's unique ID — stored in DB for revocation.
    """
    from datetime import timedelta

    jti = str(uuid.uuid4())
    exp = _now_utc() + timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS)
    payload = {
        "sub": str(teacher_id),
        "email": email,
        "role": role,
        "exp": int(exp.timestamp()),
        "iat": int(_now_utc().timestamp()),
        "jti": jti,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM), jti


def decode_token(token: str) -> dict:
    """
    Decode and verify *token*.

    Raises jwt.ExpiredSignatureError, jwt.InvalidTokenError on failure.
    Algorithm is explicitly pinned — prevents algorithm-confusion attacks.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
