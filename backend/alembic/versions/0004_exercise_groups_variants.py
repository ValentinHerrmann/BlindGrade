"""Add exercise_groups table and exercise_group_id, variant_key, is_current to exercises.

Revision ID: 0004_exercise_groups_variants
Revises: 0003_live_link_exercise_library
Create Date: 2026-07-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_exercise_groups_variants"
down_revision: Union[str, None] = "0003_live_link_exercise_library"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "exercise_groups",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("teacher_id", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("topic_tag", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_exercise_groups_teacher_id", "exercise_groups", ["teacher_id"])
    op.create_index("ix_exercise_groups_topic_tag", "exercise_groups", ["topic_tag"])

    op.add_column("exercises", sa.Column("exercise_group_id", sa.UUID(), sa.ForeignKey("exercise_groups.id", ondelete="SET NULL"), nullable=True))
    op.add_column("exercises", sa.Column("variant_key", sa.String(length=100), nullable=True))
    op.add_column("exercises", sa.Column("is_current", sa.Boolean(), nullable=False, server_default="true"))
    op.create_index("ix_exercises_exercise_group_id", "exercises", ["exercise_group_id"])
    op.create_index("ix_exercises_variant_key", "exercises", ["variant_key"])


def downgrade() -> None:
    op.drop_index("ix_exercises_variant_key", table_name="exercises")
    op.drop_index("ix_exercises_exercise_group_id", table_name="exercises")
    op.drop_column("exercises", "is_current")
    op.drop_column("exercises", "variant_key")
    op.drop_column("exercises", "exercise_group_id")
    op.drop_table("exercise_groups")
