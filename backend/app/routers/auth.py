"""Auth router — /api/v1/auth/*"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_teacher
from app.models.invite import InviteToken
from app.models.refresh_token import RefreshToken
from app.models.teacher import Teacher
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest
from app.services import audit as audit_svc
from app.services.crypto import hash_password, hash_token, needs_rehash, verify_password
from app.services.jwt import create_access_token, create_refresh_token, decode_token

router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie names
ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"

_COOKIE_KWARGS = dict(httponly=True, secure=True, samesite="strict")


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    refresh_max_age: int,
) -> None:
    response.set_cookie(ACCESS_COOKIE, access_token, max_age=15 * 60, **_COOKIE_KWARGS)  # type: ignore[arg-type]
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=refresh_max_age,
        path="/api/v1/auth/refresh",
        **_COOKIE_KWARGS,  # type: ignore[arg-type]
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth/refresh")


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """
    Create a teacher account.

    Requires a valid, unexpired, unused invite_token.
    On success, sets auth cookies and returns { email, role }.
    """
    now = datetime.now(tz=timezone.utc)

    # Validate invite token
    token_hash = hash_token(body.invite_token)
    result = await db.execute(
        select(InviteToken).where(
            InviteToken.token_hash == token_hash,
            InviteToken.used_by.is_(None),
            InviteToken.expires_at > now,
        )
    )
    invite = result.scalar_one_or_none()
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, expired, or already-used invite token.",
            headers={"code": "ERR_INVALID_INVITE"},
        )

    # Check email uniqueness
    existing = await db.execute(select(Teacher).where(Teacher.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Registration failed.",  # Don't reveal email existence
            headers={"code": "ERR_REGISTRATION_FAILED"},
        )

    teacher = Teacher(
        email=body.email,
        password_hash=hash_password(body.password),
        role="teacher",
    )
    db.add(teacher)
    await db.flush()  # Get teacher.id before commit

    # Mark invite as used
    invite.used_by = teacher.id

    await audit_svc.write(
        db,
        teacher_id=teacher.id,
        teacher_email=teacher.email,
        action="LOGIN",
        request_ip=request.client.host if request.client else None,
    )

    # Issue tokens
    access_token = create_access_token(teacher.id, teacher.email, teacher.role)
    refresh_jwt, jti = create_refresh_token(teacher.id, teacher.email, teacher.role)
    from app.config import settings

    refresh_token_record = RefreshToken(
        jti=jti,
        teacher_id=teacher.id,
        expires_at=datetime.now(tz=timezone.utc)
        # timedelta applied at decode; store expiry matching JWT
        # We decode to get exp from the jwt
    )
    # Derive expiry from the token itself
    decoded = decode_token(refresh_jwt)
    refresh_token_record.expires_at = datetime.fromtimestamp(decoded["exp"], tz=timezone.utc)
    db.add(refresh_token_record)

    _set_auth_cookies(
        response,
        access_token,
        refresh_jwt,
        refresh_max_age=settings.REFRESH_TOKEN_TTL_DAYS * 86400,
    )
    return AuthResponse(email=teacher.email, role=teacher.role)


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """
    Verify credentials, set httpOnly access + refresh cookies.

    Response body contains only { email, role } — never the token value.
    """
    result = await db.execute(select(Teacher).where(Teacher.email == body.email))
    teacher = result.scalar_one_or_none()

    # Constant-time: always call verify_password even if teacher not found
    dummy_hash = "$argon2id$v=19$m=65536,t=3,p=4$fakesaltfakesalt$fakehashfakehashfakehashfakehash"
    password_ok = verify_password(body.password, teacher.password_hash if teacher else dummy_hash)

    if not teacher or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
            headers={"code": "ERR_INVALID_CREDENTIALS"},
        )

    # Rehash if parameters changed
    if needs_rehash(teacher.password_hash):
        teacher.password_hash = hash_password(body.password)

    access_token = create_access_token(teacher.id, teacher.email, teacher.role)
    refresh_jwt, jti = create_refresh_token(teacher.id, teacher.email, teacher.role)

    decoded = decode_token(refresh_jwt)
    rt = RefreshToken(
        jti=jti,
        teacher_id=teacher.id,
        expires_at=datetime.fromtimestamp(decoded["exp"], tz=timezone.utc),
    )
    db.add(rt)

    await audit_svc.write(
        db,
        teacher_id=teacher.id,
        teacher_email=teacher.email,
        action="LOGIN",
        request_ip=request.client.host if request.client else None,
    )

    from app.config import settings

    _set_auth_cookies(
        response,
        access_token,
        refresh_jwt,
        refresh_max_age=settings.REFRESH_TOKEN_TTL_DAYS * 86400,
    )
    return AuthResponse(email=teacher.email, role=teacher.role)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """
    Issue new access + refresh cookies, revoke the old refresh token.

    Detects concurrent use (token theft) if the token is already revoked.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expired. Please log in again.",
    )
    if not refresh_token:
        raise credentials_exc

    try:
        payload = decode_token(refresh_token)
    except jwt.InvalidTokenError:
        raise credentials_exc

    if payload.get("type") != "refresh":
        raise credentials_exc

    jti = payload.get("jti")
    if not jti:
        raise credentials_exc

    result = await db.execute(select(RefreshToken).where(RefreshToken.jti == jti))
    rt = result.scalar_one_or_none()
    if rt is None or rt.revoked:
        # Possible token theft — revoke all tokens for this teacher
        if rt is not None:
            teacher_id = rt.teacher_id
            # Revoke all refresh tokens for this teacher
            from sqlalchemy import update

            await db.execute(
                update(RefreshToken)
                .where(RefreshToken.teacher_id == teacher_id, RefreshToken.revoked.is_(False))
                .values(revoked=True)
            )
        raise credentials_exc

    # Revoke old token
    rt.revoked = True

    teacher_id = uuid.UUID(payload["sub"])
    result2 = await db.execute(select(Teacher).where(Teacher.id == teacher_id))
    teacher = result2.scalar_one_or_none()
    if teacher is None:
        raise credentials_exc

    # Issue new tokens
    new_access = create_access_token(teacher.id, teacher.email, teacher.role)
    new_refresh_jwt, new_jti = create_refresh_token(teacher.id, teacher.email, teacher.role)
    decoded = decode_token(new_refresh_jwt)
    new_rt = RefreshToken(
        jti=new_jti,
        teacher_id=teacher.id,
        expires_at=datetime.fromtimestamp(decoded["exp"], tz=timezone.utc),
    )
    db.add(new_rt)

    from app.config import settings

    _set_auth_cookies(
        response,
        new_access,
        new_refresh_jwt,
        refresh_max_age=settings.REFRESH_TOKEN_TTL_DAYS * 86400,
    )
    return AuthResponse(email=teacher.email, role=teacher.role)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    _teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Clear auth cookies and revoke refresh token."""
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            jti = payload.get("jti")
            if jti:
                result = await db.execute(select(RefreshToken).where(RefreshToken.jti == jti))
                rt = result.scalar_one_or_none()
                if rt:
                    rt.revoked = True
        except jwt.InvalidTokenError:
            pass  # Best-effort revocation
    _clear_auth_cookies(response)
