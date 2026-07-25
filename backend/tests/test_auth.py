"""Phase 1 auth integration tests."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invite import InviteToken
from app.services.crypto import hash_token, generate_invite_token


async def _create_invite(db: AsyncSession, *, days: int = 7) -> str:
    """Helper: insert an invite token, return the raw token string."""
    raw = generate_invite_token()
    invite = InviteToken(
        token_hash=hash_token(raw),
        expires_at=datetime.now(tz=timezone.utc) + timedelta(days=days),
    )
    db.add(invite)
    await db.commit()
    return raw


@pytest.mark.asyncio
async def test_register_with_valid_invite(client: AsyncClient, db: AsyncSession) -> None:
    raw_token = await _create_invite(db)
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "teacher@example.com", "password": "s3cr3t!!", "invite_token": raw_token},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "teacher@example.com"
    assert body["role"] == "teacher"
    # Access token must be in httpOnly cookie, NOT in response body
    assert "access_token" not in body
    assert "access_token" in resp.cookies


@pytest.mark.asyncio
async def test_register_with_invalid_invite(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "bad@example.com", "password": "s3cr3t!!", "invite_token": "not-a-real-token"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_register_with_expired_invite(client: AsyncClient, db: AsyncSession) -> None:
    raw_token = await _create_invite(db, days=-1)  # Already expired
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "exp@example.com", "password": "s3cr3t!!", "invite_token": raw_token},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_register_with_used_invite(client: AsyncClient, db: AsyncSession) -> None:
    raw_token = await _create_invite(db)
    # Use it once
    await client.post(
        "/api/v1/auth/register",
        json={"email": "first@example.com", "password": "s3cr3t!!", "invite_token": raw_token},
    )
    # Try to reuse
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "second@example.com", "password": "s3cr3t!!", "invite_token": raw_token},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_success_and_cookie(client: AsyncClient, db: AsyncSession) -> None:
    raw_token = await _create_invite(db)
    await client.post(
        "/api/v1/auth/register",
        json={"email": "login@example.com", "password": "s3cr3t!!", "invite_token": raw_token},
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "login@example.com", "password": "s3cr3t!!"},
    )
    assert resp.status_code == 200
    assert "access_token" in resp.cookies
    assert "refresh_token" in resp.cookies
    body = resp.json()
    assert "access_token" not in body  # Never in body


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, db: AsyncSession) -> None:
    raw_token = await _create_invite(db)
    await client.post(
        "/api/v1/auth/register",
        json={"email": "wrongpw@example.com", "password": "correct", "invite_token": raw_token},
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "wrongpw@example.com", "password": "WRONG"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_protected_endpoint_without_cookie(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/compile/latex", json={"latex": "\\documentclass{article}"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_logout_clears_cookies(client: AsyncClient, db: AsyncSession) -> None:
    raw_token = await _create_invite(db)
    await client.post(
        "/api/v1/auth/register",
        json={"email": "logout@example.com", "password": "s3cr3t!!", "invite_token": raw_token},
    )
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "logout@example.com", "password": "s3cr3t!!"},
    )
    assert "access_token" in resp.cookies

    logout_resp = await client.post("/api/v1/auth/logout")
    assert logout_resp.status_code == 204
