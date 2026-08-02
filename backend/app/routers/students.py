"""Students router — /api/v1/exams/{id}/students"""
from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_exam_for_teacher
from app.models.exam import Exam
from app.models.student_identity import StudentIdentity
from app.models.scan_submission import ScanSubmission
from app.schemas.student import StudentIdentityCreate, StudentIdentityResponse
from app.services import audit as audit_svc

router = APIRouter(prefix="/exams/{exam_id}/students", tags=["students"])


@router.post("", response_model=StudentIdentityResponse, status_code=status.HTTP_201_CREATED)
async def upload_student_identity(
    body: StudentIdentityCreate,
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> StudentIdentityResponse:
    """Upload encrypted student identity ciphertext. Handles upsert for duplicate pseudonym_hmac."""
    pii_bytes = base64.b64decode(body.pii_ciphertext_b64)
    iv_bytes = base64.b64decode(body.iv_b64)
    salt_bytes = base64.b64decode(body.encryption_salt_b64)

    # Check if student identity already exists
    result = await db.execute(
        select(StudentIdentity).where(StudentIdentity.pseudonym_hmac == body.pseudonym_hmac)
    )
    existing = result.scalar_one_or_none()

    if existing:
        if existing.exam_id != exam.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Student identity belongs to another exam.",
            )
        existing.pii_ciphertext = pii_bytes
        existing.iv = iv_bytes
        existing.encryption_salt = salt_bytes
        await db.flush()
        return StudentIdentityResponse(
            pseudonym_hmac=existing.pseudonym_hmac,
            exam_id=existing.exam_id,
            pii_ciphertext_b64=body.pii_ciphertext_b64,
            iv_b64=body.iv_b64,
            encryption_salt_b64=body.encryption_salt_b64,
        )

    identity = StudentIdentity(
        pseudonym_hmac=body.pseudonym_hmac,
        exam_id=exam.id,
        pii_ciphertext=pii_bytes,
        iv=iv_bytes,
        encryption_salt=salt_bytes,
    )
    db.add(identity)
    await db.flush()

    return StudentIdentityResponse(
        pseudonym_hmac=identity.pseudonym_hmac,
        exam_id=identity.exam_id,
        pii_ciphertext_b64=body.pii_ciphertext_b64,
        iv_b64=body.iv_b64,
        encryption_salt_b64=body.encryption_salt_b64,
    )


@router.delete("/{pseudonym_hmac}", status_code=status.HTTP_204_NO_CONTENT)
async def erase_student_identity(
    pseudonym_hmac: str,
    request: Request,
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    GDPR Art. 17 Erasure — hard delete student identity + cascade submissions.
    Appends an immutable audit log entry.
    """
    # Fetch identity
    result = await db.execute(
        select(StudentIdentity).where(
            StudentIdentity.pseudonym_hmac == pseudonym_hmac,
            StudentIdentity.exam_id == exam.id,
        )
    )
    identity = result.scalar_one_or_none()
    if identity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student identity not found.")

    # Hard delete student identity (cascade deletes submissions due to FK constraint)
    await db.delete(identity)

    # Record AuditLog entry with snapshot of teacher email
    teacher_result = await db.execute(
        select(Exam.teacher_id).where(Exam.id == exam.id)
    )
    from app.models.teacher import Teacher
    t_res = await db.execute(select(Teacher).where(Teacher.id == exam.teacher_id))
    teacher = t_res.scalar_one()

    await audit_svc.write(
        db,
        teacher_id=teacher.id,
        teacher_email=teacher.email,
        action="DELETE",
        target_id=pseudonym_hmac,
        request_ip=request.client.host if request.client else None,
    )
