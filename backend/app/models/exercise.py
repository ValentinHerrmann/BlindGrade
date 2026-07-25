"""Exercise model."""
from __future__ import annotations

import uuid

from sqlalchemy import Enum, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    max_points: Mapped[float] = mapped_column(Float, nullable=False)
    topic_tag: Mapped[str | None] = mapped_column(String(200), nullable=True)
    question_type: Mapped[str] = mapped_column(
        Enum("free_text", "mc", "sc", "tf", name="question_type"),
        nullable=False,
        default="free_text",
    )
    correct_answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    penalty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    def __repr__(self) -> str:
        return f"Exercise(id={self.id!r}, exam_id={self.exam_id!r}, order={self.order_index})"
