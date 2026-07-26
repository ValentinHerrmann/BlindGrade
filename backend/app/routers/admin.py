"""Admin router — /api/v1/admin/*"""
from __future__ import annotations

import math
import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_admin_teacher
from app.models.audit_log import AuditLog
from app.models.scan_submission import ScanSubmission
from app.models.teacher import Teacher
from app.schemas.admin import AuditLogResponse, ClassStatsResponse

router = APIRouter(prefix="/admin", tags=["admin"])

# Minimum sample size for k-anonymity score statistics
K_ANONYMITY_THRESHOLD = 5


@router.get("/stats/{exam_id}", response_model=ClassStatsResponse)
async def get_exam_stats(
    exam_id: uuid.UUID,
    _admin: Teacher = Depends(get_admin_teacher),
    db: AsyncSession = Depends(get_db),
) -> ClassStatsResponse:
    """
    Get class statistics for an exam with server-side k≥5 anonymity enforcement.

    If count < 5, score details (mean, std_dev) are suppressed to protect privacy.
    """
    result = await db.execute(
        select(ScanSubmission.total_score).where(
            ScanSubmission.exam_id == exam_id,
            ScanSubmission.total_score.is_not(None),
            ScanSubmission.deleted_at.is_(None),
        )
    )
    scores = [r for r in result.scalars().all() if r is not None]
    count = len(scores)

    if count < K_ANONYMITY_THRESHOLD:
        return ClassStatsResponse(
            exam_id=exam_id,
            total_submissions=count,
            mean_score=None,
            std_dev=None,
            k_anonymity_satisfied=False,
            suppressed_reason=f"Class statistics suppressed: sample size ({count}) is less than k={K_ANONYMITY_THRESHOLD} threshold.",
        )

    mean = sum(scores) / count
    variance = sum((x - mean) ** 2 for x in scores) / count
    std_dev = math.sqrt(variance)

    return ClassStatsResponse(
        exam_id=exam_id,
        total_submissions=count,
        mean_score=round(mean, 2),
        std_dev=round(std_dev, 2),
        k_anonymity_satisfied=True,
    )


@router.get("/audit", response_model=list[AuditLogResponse])
async def list_audit_logs(
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: Teacher = Depends(get_admin_teacher),
    db: AsyncSession = Depends(get_db),
) -> list[AuditLogResponse]:
    """Get paginated audit logs (Admin only)."""
    result = await db.execute(
        select(AuditLog).order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)
    )
    logs = result.scalars().all()
    return [
        AuditLogResponse(
            id=log.id,
            teacher_id=log.teacher_id,
            teacher_email=log.teacher_email,
            action=log.action,
            target_hash=log.target_hash,
            ip_hash=log.ip_hash,
            created_at=log.created_at,
        )
        for log in logs
    ]
