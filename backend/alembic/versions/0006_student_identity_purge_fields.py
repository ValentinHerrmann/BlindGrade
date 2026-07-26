"""add soft-delete and retention fields to student_identities and scan_submissions

Revision ID: 0006_student_identity_purge_fields
Revises: 0005_create_user_audit
Create Date: 2026-07-26
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0006_student_identity_purge_fields"
down_revision = "0005_create_user_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_identities",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "student_identities",
        sa.Column("retention_until", sa.Date(), nullable=True),
    )
    op.add_column(
        "scan_submissions",
        sa.Column("retention_until", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scan_submissions", "retention_until")
    op.drop_column("student_identities", "retention_until")
    op.drop_column("student_identities", "deleted_at")
