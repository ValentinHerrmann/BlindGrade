"""Pydantic schemas for auth endpoints."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    invite_token: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    email: str
    role: str


class TokenClaims(BaseModel):
    sub: str          # teacher_id (UUID string)
    email: str
    role: str
    exp: int          # Unix timestamp
    jti: str | None = None  # JWT ID — used for refresh token revocation
