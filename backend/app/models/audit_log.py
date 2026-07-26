"""AuditLog model — immutable compliance record, never soft-deleted."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Nullable FK — ON DELETE SET NULL so deleting a teacher account does NOT
    # cascade-delete or block removal of audit records.
    teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Immutable snapshot — survives teacher account deletion for compliance.
    teacher_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(
        Enum(
            "LOGIN",
            "EXPORT",
            "DELETE",
            "VIEW",
            "EXTEND_RETENTION",
            "CREATE_USER",
            name="audit_action",
        ),
        nullable=False,
    )
    target_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True  # SHA-256 of affected exam_id or pseudonym_hmac
    )
    ip_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True  # SHA-256 of request IP
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # AuditLog rows are NEVER soft-deleted.

    def __repr__(self) -> str:
        return (
            f"AuditLog(id={self.id!r}, action={self.action!r}, "
            f"teacher={self.teacher_email!r})"
        )
