"""add grade and subject columns to exercises and exercise_groups

Revision ID: 0007_add_grade_subject
Revises: 0006_student_identity_purge
Create Date: 2026-07-27
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0007_add_grade_subject"
down_revision = "0006_student_identity_purge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "exercises",
        sa.Column("grade", sa.String(length=50), nullable=True),
    )
    op.create_index(op.f("ix_exercises_grade"), "exercises", ["grade"], unique=False)
    op.add_column(
        "exercises",
        sa.Column("subject", sa.String(length=100), nullable=True),
    )
    op.create_index(op.f("ix_exercises_subject"), "exercises", ["subject"], unique=False)

    op.add_column(
        "exercise_groups",
        sa.Column("grade", sa.String(length=50), nullable=True),
    )
    op.create_index(op.f("ix_exercise_groups_grade"), "exercise_groups", ["grade"], unique=False)
    op.add_column(
        "exercise_groups",
        sa.Column("subject", sa.String(length=100), nullable=True),
    )
    op.create_index(op.f("ix_exercise_groups_subject"), "exercise_groups", ["subject"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_exercise_groups_subject"), table_name="exercise_groups")
    op.drop_column("exercise_groups", "subject")
    op.drop_index(op.f("ix_exercise_groups_grade"), table_name="exercise_groups")
    op.drop_column("exercise_groups", "grade")

    op.drop_index(op.f("ix_exercises_subject"), table_name="exercises")
    op.drop_column("exercises", "subject")
    op.drop_index(op.f("ix_exercises_grade"), table_name="exercises")
    op.drop_column("exercises", "grade")
