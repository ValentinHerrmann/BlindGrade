"""Add teacher_id and version to exercises, make exam_id nullable, and create exam_exercises table.

Revision ID: 0003_live_link_exercise_library
Revises: 0002_add_latex_fields
Create Date: 2026-07-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_live_link_exercise_library"
down_revision: Union[str, None] = "0002_add_latex_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exercises", sa.Column("teacher_id", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=True))
    op.add_column("exercises", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.alter_column("exercises", "exam_id", nullable=True)
    op.create_index("ix_exercises_teacher_id", "exercises", ["teacher_id"])

    op.create_table(
        "exam_exercises",
        sa.Column("exam_id", sa.UUID(), sa.ForeignKey("exams.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("exercise_id", sa.UUID(), sa.ForeignKey("exercises.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_exam_exercises_exam_id", "exam_exercises", ["exam_id"])
    op.create_index("ix_exam_exercises_exercise_id", "exam_exercises", ["exercise_id"])


def downgrade() -> None:
    op.drop_table("exam_exercises")
    op.drop_index("ix_exercises_teacher_id", table_name="exercises")
    op.alter_column("exercises", "exam_id", nullable=False)
    op.drop_column("exercises", "version")
    op.drop_column("exercises", "teacher_id")
