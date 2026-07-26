"""Submissions router — /api/v1/exams/{id}/submissions"""
from __future__ import annotations

import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_exam_for_teacher
from app.models.exam import Exam
from app.models.scan_submission import ScanSubmission
from app.schemas.submission import SubmissionCreate, SubmissionResponse, SubmissionScoreUpdate

router = APIRouter(prefix="/exams/{exam_id}/submissions", tags=["submissions"])


@router.get("", response_model=list[SubmissionResponse])
async def list_submissions(
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> list[SubmissionResponse]:
    """List all non-deleted submissions for an exam."""
    result = await db.execute(
        select(ScanSubmission).where(
            ScanSubmission.exam_id == exam.id,
            ScanSubmission.deleted_at.is_(None),
        )
    )
    subs = result.scalars().all()
    return [
        SubmissionResponse(
            id=s.id,
            exam_id=s.exam_id,
            pseudonym_hmac=s.pseudonym_hmac,
            total_score=s.total_score,
            scan_iv_b64=base64.b64encode(s.scan_iv).decode(),
            created_at=s.created_at,
        )
        for s in subs
    ]


@router.post("", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
async def upload_submission(
    body: SubmissionCreate,
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """Upload encrypted scan submission."""
    scan_bytes = base64.b64decode(body.scan_ciphertext_b64) if body.scan_ciphertext_b64 else None
    scan_iv = base64.b64decode(body.scan_iv_b64)
    ann_bytes = base64.b64decode(body.annotation_ciphertext_b64) if body.annotation_ciphertext_b64 else None
    ann_iv = base64.b64decode(body.annotation_iv_b64) if body.annotation_iv_b64 else None

    sub = ScanSubmission(
        exam_id=exam.id,
        pseudonym_hmac=body.pseudonym_hmac,
        total_score=body.total_score,
        scan_ciphertext=scan_bytes,
        scan_iv=scan_iv,
        annotation_ciphertext=ann_bytes,
        annotation_iv=ann_iv,
    )
    db.add(sub)
    await db.flush()

    return SubmissionResponse(
        id=sub.id,
        exam_id=sub.exam_id,
        pseudonym_hmac=sub.pseudonym_hmac,
        total_score=sub.total_score,
        scan_ciphertext_b64=body.scan_ciphertext_b64,
        scan_iv_b64=body.scan_iv_b64,
        annotation_ciphertext_b64=body.annotation_ciphertext_b64,
        annotation_iv_b64=body.annotation_iv_b64,
        created_at=sub.created_at,
    )


@router.get("/{sub_id}", response_model=SubmissionResponse)
async def get_submission(
    sub_id: uuid.UUID,
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """Download encrypted scan submission by ID."""
    result = await db.execute(
        select(ScanSubmission).where(
            ScanSubmission.id == sub_id,
            ScanSubmission.exam_id == exam.id,
            ScanSubmission.deleted_at.is_(None),
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found.")

    return SubmissionResponse(
        id=sub.id,
        exam_id=sub.exam_id,
        pseudonym_hmac=sub.pseudonym_hmac,
        total_score=sub.total_score,
        scan_ciphertext_b64=base64.b64encode(sub.scan_ciphertext).decode() if sub.scan_ciphertext else None,
        scan_iv_b64=base64.b64encode(sub.scan_iv).decode(),
        annotation_ciphertext_b64=base64.b64encode(sub.annotation_ciphertext).decode() if sub.annotation_ciphertext else None,
        annotation_iv_b64=base64.b64encode(sub.annotation_iv).decode() if sub.annotation_iv else None,
        created_at=sub.created_at,
    )


@router.patch("/{sub_id}/score", response_model=SubmissionResponse)
async def update_score(
    sub_id: uuid.UUID,
    body: SubmissionScoreUpdate,
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> SubmissionResponse:
    """Update plaintext total score for server-side statistics."""
    result = await db.execute(
        select(ScanSubmission).where(
            ScanSubmission.id == sub_id,
            ScanSubmission.exam_id == exam.id,
            ScanSubmission.deleted_at.is_(None),
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found.")

    sub.total_score = body.total_score
    await db.flush()

    return SubmissionResponse(
        id=sub.id,
        exam_id=sub.exam_id,
        pseudonym_hmac=sub.pseudonym_hmac,
        total_score=sub.total_score,
        scan_iv_b64=base64.b64encode(sub.scan_iv).decode(),
        created_at=sub.created_at,
    )
