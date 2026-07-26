"""Exercise model."""
from __future__ import annotations

import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"), nullable=True, index=True
    )
    exam_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"), nullable=True, index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_points: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    topic_tag: Mapped[str | None] = mapped_column(String(200), nullable=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    latex_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    exercise_group_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("exercise_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    variant_key: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=True)
    question_type: Mapped[str] = mapped_column(
        Enum("free_text", "mc", "sc", "tf", name="question_type"),
        nullable=False,
        default="free_text",
    )
    correct_answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    penalty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    def __repr__(self) -> str:
        return f"Exercise(id={self.id!r}, name={self.name!r}, topic={self.topic_tag!r})"
