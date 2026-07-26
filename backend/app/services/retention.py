"""Retention service — soft-delete exams past their GDPR retention date."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models.exam import Exam
from app.models.scan_submission import ScanSubmission
from app.models.student_identity import StudentIdentity


async def run(*, dry_run: bool = False) -> int:
    """
    1. Soft-delete all Exam rows where retention_until < today and deleted_at IS NULL.
    2. Hard-delete expired soft-deleted StudentIdentity and ScanSubmission records where retention_until < today.

    Writes AuditLog rows for system cleanup actions.
    Returns total count of affected rows.
    """
    today = date.today()
    now = datetime.now(tz=timezone.utc)
    count = 0

    async with AsyncSessionLocal() as db:
        # 1. Soft-delete expired exams
        result = await db.execute(
            select(Exam).where(
                Exam.retention_until < today,
                Exam.deleted_at.is_(None),
            )
        )
        exams = result.scalars().all()
        exam_count = len(exams)

        # 2. Find expired soft-deleted StudentIdentities
        expired_students_res = await db.execute(
            select(StudentIdentity).where(
                StudentIdentity.retention_until < today,
                StudentIdentity.deleted_at.isnot(None),
            )
        )
        expired_students = expired_students_res.scalars().all()

        # 3. Find expired soft-deleted ScanSubmissions
        expired_submissions_res = await db.execute(
            select(ScanSubmission).where(
                ScanSubmission.retention_until < today,
                ScanSubmission.deleted_at.isnot(None),
            )
        )
        expired_submissions = expired_submissions_res.scalars().all()

        total_affected = exam_count + len(expired_students) + len(expired_submissions)

        if dry_run:
            return total_affected

        for exam in exams:
            exam.deleted_at = now

        for student in expired_students:
            await db.delete(student)

        for submission in expired_submissions:
            await db.delete(submission)

        # Bulk write audit entries
        from app.models.audit_log import AuditLog
        import hashlib

        audit_entries = [
            AuditLog(
                teacher_id=None,  # System actor
                teacher_email="system:retention-cron",
                action="DELETE",
                target_hash=hashlib.sha256(str(exam.id).encode()).hexdigest(),
                ip_hash=None,
            )
            for exam in exams
        ]
        db.add_all(audit_entries)
        await db.commit()

    return total_affected
