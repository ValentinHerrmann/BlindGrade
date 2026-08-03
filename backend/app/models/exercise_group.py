"""ExerciseGroup model for grouping variants/versions of an exercise type."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.exercise import Exercise


class ExerciseGroup(Base):
    __tablename__ = "exercise_groups"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    topic_tag: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    grade: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    subject: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    exercises: Mapped[list[Exercise]] = relationship(
        "Exercise", back_populates="group", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"ExerciseGroup(id={self.id!r}, name={self.name!r}, topic={self.topic_tag!r})"
