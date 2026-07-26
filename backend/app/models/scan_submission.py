"""ScanSubmission model — encrypted scan + annotation storage."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ScanSubmission(Base):
    __tablename__ = "scan_submissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pseudonym_hmac: Mapped[str] = mapped_column(
        ForeignKey("student_identities.pseudonym_hmac", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # Plaintext for stats
    scan_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)  # Hybrid Mode only
    scan_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    scan_iv: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    annotation_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    annotation_iv: Mapped[bytes | None] = mapped_column(LargeBinary(12), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retention_until: Mapped[date | None] = mapped_column(Date, nullable=True)

    def __repr__(self) -> str:
        return f"ScanSubmission(id={self.id!r}, exam={self.exam_id!r})"
