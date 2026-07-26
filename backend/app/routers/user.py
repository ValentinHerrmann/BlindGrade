"""User management router — /api/v1/user for storage policy actions (purge/restore)."""
from __future__ import annotations

from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_teacher
from app.models.exam import Exam
from app.models.scan_submission import ScanSubmission
from app.models.student_identity import StudentIdentity
from app.models.teacher import Teacher
from app.services import audit as audit_svc

router = APIRouter(prefix="/user", tags=["user"])


@router.post("/purge-server-student-data", status_code=status.HTTP_200_OK)
async def purge_server_student_data(
    request: Request,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Soft-delete all student identities and scan submissions belonging to the current teacher
    with a 7-day retention grace period before hard deletion.

    LaTeX exercise templates and exam structures remain intact.
    """
    now = datetime.now(timezone.utc)
    retention_until = date.today() + timedelta(days=7)

    # Get all exam IDs belonging to this teacher
    exam_ids_result = await db.execute(
        select(Exam.id).where(Exam.teacher_id == teacher.id)
    )
    exam_ids = exam_ids_result.scalars().all()

    if not exam_ids:
        return {
            "status": "ok",
            "purged_student_identities": 0,
            "purged_submissions": 0,
            "retention_until": retention_until.isoformat(),
        }

    # Soft-delete student identities
    students_update = (
        update(StudentIdentity)
        .where(
            StudentIdentity.exam_id.in_(exam_ids),
            StudentIdentity.deleted_at.is_(None),
        )
        .values(deleted_at=now, retention_until=retention_until)
    )
    students_res = await db.execute(students_update)
    purged_students_count = students_res.rowcount

    # Soft-delete scan submissions
    submissions_update = (
        update(ScanSubmission)
        .where(
            ScanSubmission.exam_id.in_(exam_ids),
            ScanSubmission.deleted_at.is_(None),
        )
        .values(deleted_at=now, retention_until=retention_until)
    )
    submissions_res = await db.execute(submissions_update)
    purged_submissions_count = submissions_res.rowcount

    # Audit log
    await audit_svc.write(
        db,
        teacher_id=teacher.id,
        teacher_email=teacher.email,
        action="DELETE",
        target_id=str(teacher.id),
        request_ip=request.client.host if request.client else None,
    )

    return {
        "status": "ok",
        "purged_student_identities": purged_students_count,
        "purged_submissions": purged_submissions_count,
        "retention_until": retention_until.isoformat(),
    }


@router.post("/restore-server-data", status_code=status.HTTP_200_OK)
async def restore_server_data(
    request: Request,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Restore soft-deleted student identities and scan submissions for the current teacher
    if they are within the 7-day retention grace period.
    """
    today = date.today()

    exam_ids_result = await db.execute(
        select(Exam.id).where(Exam.teacher_id == teacher.id)
    )
    exam_ids = exam_ids_result.scalars().all()

    if not exam_ids:
        return {
            "status": "ok",
            "restored_student_identities": 0,
            "restored_submissions": 0,
        }

    # Restore student identities
    students_update = (
        update(StudentIdentity)
        .where(
            StudentIdentity.exam_id.in_(exam_ids),
            StudentIdentity.deleted_at.isnot(None),
            StudentIdentity.retention_until >= today,
        )
        .values(deleted_at=None, retention_until=None)
    )
    students_res = await db.execute(students_update)
    restored_students_count = students_res.rowcount

    # Restore scan submissions
    submissions_update = (
        update(ScanSubmission)
        .where(
            ScanSubmission.exam_id.in_(exam_ids),
            ScanSubmission.deleted_at.isnot(None),
            ScanSubmission.retention_until >= today,
        )
        .values(deleted_at=None, retention_until=None)
    )
    submissions_res = await db.execute(submissions_update)
    restored_submissions_count = submissions_res.rowcount

    # Audit log
    await audit_svc.write(
        db,
        teacher_id=teacher.id,
        teacher_email=teacher.email,
        action="EXTEND_RETENTION",
        target_id=str(teacher.id),
        request_ip=request.client.host if request.client else None,
    )

    return {
        "status": "ok",
        "restored_student_identities": restored_students_count,
        "restored_submissions": restored_submissions_count,
    }
