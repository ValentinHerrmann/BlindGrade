"""Add latex metadata and body fields to exams and exercises tables.

Revision ID: 0002_add_latex_fields
Revises: 0001_initial
Create Date: 2026-07-26
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_latex_fields"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("testart", sa.String(100), nullable=True))
    op.add_column("exams", sa.Column("klasse", sa.String(50), nullable=True))
    op.add_column("exams", sa.Column("datum", sa.String(100), nullable=True))
    op.add_column("exams", sa.Column("nr", sa.String(10), nullable=True))
    op.add_column("exams", sa.Column("fach", sa.String(100), nullable=True))
    op.add_column("exams", sa.Column("lehrernachname", sa.String(100), nullable=True))
    op.add_column("exams", sa.Column("info_text", sa.Text(), nullable=True))

    op.add_column("exercises", sa.Column("name", sa.String(200), nullable=True))
    op.add_column("exercises", sa.Column("latex_body", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("exercises", "latex_body")
    op.drop_column("exercises", "name")

    op.drop_column("exams", "info_text")
    op.drop_column("exams", "lehrernachname")
    op.drop_column("exams", "fach")
    op.drop_column("exams", "nr")
    op.drop_column("exams", "datum")
    op.drop_column("exams", "klasse")
    op.drop_column("exams", "testart")
