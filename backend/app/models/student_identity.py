"""StudentIdentity model — server never sees the raw pseudonym_id."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StudentIdentity(Base):
    __tablename__ = "student_identities"

    # PK = HMAC(raw_uuid, per_exam_secret) — raw ID never leaves the client
    pseudonym_hmac: Mapped[str] = mapped_column(String(64), primary_key=True)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pii_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)  # AES-256-GCM
    iv: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)          # 12-byte GCM nonce
    encryption_salt: Mapped[bytes] = mapped_column(LargeBinary(16), nullable=False)  # Argon2id salt

    def __repr__(self) -> str:
        return f"StudentIdentity(hmac={self.pseudonym_hmac[:8]!r}..., exam={self.exam_id!r})"
