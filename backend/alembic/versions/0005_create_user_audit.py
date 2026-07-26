"""add CREATE_USER to audit_action enum

Revision ID: 0005_create_user_audit
Revises: 0004_exercise_groups_variants
Create Date: 2026-07-26
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0005_create_user_audit"
down_revision = "0004_exercise_groups_variants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL enum extension; IF NOT EXISTS keeps migration idempotent.
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CREATE_USER'")


def downgrade() -> None:
    # PostgreSQL does not support dropping a single enum value safely in-place.
    # No-op downgrade to avoid destructive type recreation.
    pass
