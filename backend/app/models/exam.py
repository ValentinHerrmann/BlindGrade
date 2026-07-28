"""Exam model."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


from typing import TYPE_CHECKING
from sqlalchemy.orm import Mapped, mapped_column, relationship

if TYPE_CHECKING:
    from app.models.exercise import Exercise


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    latex_template: Mapped[str] = mapped_column(Text, nullable=False, default="")
    compilation_status: Mapped[str] = mapped_column(
        Enum("pending", "compiled", "failed", name="compilation_status"),
        nullable=False,
        default="pending",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    retention_until: Mapped[date] = mapped_column(Date, nullable=False)
    is_public: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    testart: Mapped[str | None] = mapped_column(String(100), nullable=True)
    klasse: Mapped[str | None] = mapped_column(String(50), nullable=True)
    datum: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nr: Mapped[str | None] = mapped_column(String(10), nullable=True)
    fach: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lehrernachname: Mapped[str | None] = mapped_column(String(100), nullable=True)
    info_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    exercises: Mapped[list[Exercise]] = relationship("Exercise", backref="exam", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"Exam(id={self.id!r}, title={self.title!r})"
