"""Audit log write helper."""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.services.crypto import hash_ip


async def write(
    db: AsyncSession,
    *,
    teacher_id: uuid.UUID | None,
    teacher_email: str,
    action: str,
    target_id: str | None = None,
    request_ip: str | None = None,
) -> AuditLog:
    """
    Append an immutable audit entry.

    *target_id* is SHA-256 hashed before storage.
    *request_ip* is SHA-256 hashed before storage.
    """
    import hashlib

    target_hash: str | None = None
    if target_id is not None:
        target_hash = hashlib.sha256(target_id.encode()).hexdigest()

    entry = AuditLog(
        teacher_id=teacher_id,
        teacher_email=teacher_email,
        action=action,
        target_hash=target_hash,
        ip_hash=hash_ip(request_ip or ""),
    )
    db.add(entry)
    # Caller is responsible for commit (session is managed by get_db dependency)
    return entry
