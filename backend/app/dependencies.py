"""FastAPI dependencies — auth + ownership verification."""
from __future__ import annotations

import uuid

import jwt
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.exam import Exam
from app.models.teacher import Teacher
from app.services.jwt import decode_token


async def get_current_teacher(
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> Teacher:
    """
    Read access token from httpOnly cookie (never from Authorization header).

    Returns the authenticated Teacher or raises 401.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not access_token:
        raise credentials_exc
    try:
        payload = decode_token(access_token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise credentials_exc

    if payload.get("type") != "access":
        raise credentials_exc

    teacher_id_str: str | None = payload.get("sub")
    if not teacher_id_str:
        raise credentials_exc

    try:
        teacher_id = uuid.UUID(teacher_id_str)
    except ValueError:
        raise credentials_exc

    result = await db.execute(select(Teacher).where(Teacher.id == teacher_id))
    teacher = result.scalar_one_or_none()
    if teacher is None:
        raise credentials_exc
    return teacher


async def get_admin_teacher(
    teacher: Teacher = Depends(get_current_teacher),
) -> Teacher:
    """Require admin role."""
    if teacher.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")
    return teacher


async def get_exam_for_teacher(
    exam_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> Exam:
    """
    Return the exam if it belongs to *teacher* and is not soft-deleted.

    Always raises 401 (not 404) for unauthorized access — never leaks resource existence.
    """
    result = await db.execute(
        select(Exam).where(
            Exam.id == exam_id,
            Exam.teacher_id == teacher.id,
            Exam.deleted_at.is_(None),
        )
    )
    exam = result.scalar_one_or_none()
    if exam is None:
        # 401 not 404 — per API contract: never leak resource existence
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    return exam
