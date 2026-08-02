"""Submissions router — /api/v1/exams/{id}/submissions"""
from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_exam_for_teacher
from app.models.exam import Exam
from app.models.scan_submission import ScanSubmission
from app.models.student_identity import StudentIdentity
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
            scan_iv_b64=base64.b64encode(s.scan_iv).decode() if s.scan_iv else None,
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
    # Ensure student identity exists first to satisfy foreign key constraint
    student_res = await db.execute(
        select(StudentIdentity).where(StudentIdentity.pseudonym_hmac == body.pseudonym_hmac)
    )
    if not student_res.scalar_one_or_none():
        db.add(
            StudentIdentity(
                pseudonym_hmac=body.pseudonym_hmac,
                exam_id=exam.id,
                pii_ciphertext=b"\x00",
                iv=b"\x00" * 12,
                encryption_salt=b"\x00" * 16,
            )
        )
        await db.flush()

    scan_bytes = base64.b64decode(body.scan_ciphertext_b64) if body.scan_ciphertext_b64 else None
    scan_iv = base64.b64decode(body.scan_iv_b64) if body.scan_iv_b64 else b""
    ann_bytes = base64.b64decode(body.annotation_ciphertext_b64) if body.annotation_ciphertext_b64 else None
    ann_iv = base64.b64decode(body.annotation_iv_b64) if body.annotation_iv_b64 else None

    # Handle submission upsert if ID already exists
    if body.id:
        sub_res = await db.execute(
            select(ScanSubmission).where(ScanSubmission.id == body.id)
        )
        existing_sub = sub_res.scalar_one_or_none()
        if existing_sub:
            if existing_sub.exam_id != exam.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Submission belongs to another exam.",
                )
            existing_sub.pseudonym_hmac = body.pseudonym_hmac
            if body.total_score is not None:
                existing_sub.total_score = body.total_score
            if scan_bytes is not None:
                existing_sub.scan_ciphertext = scan_bytes
                existing_sub.scan_iv = scan_iv
            if ann_bytes is not None:
                existing_sub.annotation_ciphertext = ann_bytes
                existing_sub.annotation_iv = ann_iv
            await db.flush()
            return SubmissionResponse(
                id=existing_sub.id,
                exam_id=existing_sub.exam_id,
                pseudonym_hmac=existing_sub.pseudonym_hmac,
                total_score=existing_sub.total_score,
                scan_ciphertext_b64=body.scan_ciphertext_b64,
                scan_iv_b64=body.scan_iv_b64,
                annotation_ciphertext_b64=body.annotation_ciphertext_b64,
                annotation_iv_b64=body.annotation_iv_b64,
                created_at=existing_sub.created_at,
            )

    kwargs = {
        "exam_id": exam.id,
        "pseudonym_hmac": body.pseudonym_hmac,
        "total_score": body.total_score,
        "scan_ciphertext": scan_bytes,
        "scan_iv": scan_iv,
        "annotation_ciphertext": ann_bytes,
        "annotation_iv": ann_iv,
    }
    if body.id:
        kwargs["id"] = body.id
    sub = ScanSubmission(**kwargs)
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


@router.delete("/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_submission(
    sub_id: uuid.UUID,
    exam: Exam = Depends(get_exam_for_teacher),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Soft-delete a scan submission by ID."""
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

    sub.deleted_at = datetime.now(timezone.utc)
    await db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

