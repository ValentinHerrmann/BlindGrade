"""Retention service — soft-delete exams past their GDPR retention date."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models.exam import Exam


async def run(*, dry_run: bool = False) -> int:
    """
    Soft-delete all Exam rows where retention_until < today and deleted_at IS NULL.

    Writes one AuditLog row per deletion (captures a system actor entry).
    Returns count of affected rows.

    Idempotent: already soft-deleted rows are excluded by the WHERE clause.
    """
    today = date.today()
    now = datetime.now(tz=timezone.utc)
    count = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Exam).where(
                Exam.retention_until < today,
                Exam.deleted_at.is_(None),
            )
        )
        exams = result.scalars().all()
        count = len(exams)

        if dry_run:
            return count

        for exam in exams:
            exam.deleted_at = now

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

    return count
