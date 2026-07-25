"""Migration zero — create all tables.

Revision ID: 0001_initial
Revises: None
Create Date: 2026-07-25
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Enum types ---
    teacher_role = sa.Enum("teacher", "admin", name="teacher_role")
    compilation_status = sa.Enum("pending", "compiled", "failed", name="compilation_status")
    question_type = sa.Enum("free_text", "mc", "sc", "tf", name="question_type")
    audit_action = sa.Enum(
        "LOGIN", "EXPORT", "DELETE", "VIEW", "EXTEND_RETENTION", name="audit_action"
    )

    op.create_table(
        "teachers",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", teacher_role, nullable=False, server_default="teacher"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_teachers_email", "teachers", ["email"], unique=True)

    op.create_table(
        "invite_tokens",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("used_by", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("jti", sa.String(36), primary_key=True),
        sa.Column("teacher_id", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_refresh_tokens_teacher_id", "refresh_tokens", ["teacher_id"])

    op.create_table(
        "exams",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("teacher_id", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("latex_template", sa.Text(), nullable=False, server_default=""),
        sa.Column("compilation_status", compilation_status, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("retention_until", sa.Date(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_exams_teacher_id", "exams", ["teacher_id"])
    # Partial index for active (non-deleted) exams
    op.create_index(
        "ix_exams_active",
        "exams",
        ["deleted_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "exercises",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("exam_id", sa.UUID(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("max_points", sa.Float(), nullable=False),
        sa.Column("topic_tag", sa.String(200), nullable=True),
        sa.Column("question_type", question_type, nullable=False, server_default="free_text"),
        sa.Column("correct_answers", sa.JSON(), nullable=True),
        sa.Column("penalty", sa.Float(), nullable=False, server_default="0.0"),
    )
    op.create_index("ix_exercises_exam_id", "exercises", ["exam_id"])

    op.create_table(
        "student_identities",
        sa.Column("pseudonym_hmac", sa.String(64), primary_key=True),
        sa.Column("exam_id", sa.UUID(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pii_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("iv", sa.LargeBinary(), nullable=False),
        sa.Column("encryption_salt", sa.LargeBinary(), nullable=False),
    )
    op.create_index("ix_student_identities_exam_id", "student_identities", ["exam_id"])
    op.create_index(
        "uq_student_identities_hmac_exam",
        "student_identities",
        ["pseudonym_hmac", "exam_id"],
        unique=True,
    )

    op.create_table(
        "scan_submissions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("exam_id", sa.UUID(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "pseudonym_hmac",
            sa.String(64),
            sa.ForeignKey("student_identities.pseudonym_hmac", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("total_score", sa.Float(), nullable=True),
        sa.Column("scan_path", sa.String(1000), nullable=True),
        sa.Column("scan_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("scan_iv", sa.LargeBinary(), nullable=False),
        sa.Column("annotation_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("annotation_iv", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_scan_submissions_exam_id", "scan_submissions", ["exam_id"])
    op.create_index("ix_scan_submissions_pseudonym", "scan_submissions", ["pseudonym_hmac"])
    op.create_index(
        "ix_scan_submissions_active",
        "scan_submissions",
        ["deleted_at"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.UUID(), primary_key=True),
        # ON DELETE SET NULL — deleting a teacher does NOT delete audit rows
        sa.Column("teacher_id", sa.UUID(), sa.ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("teacher_email", sa.String(255), nullable=False),
        sa.Column("action", audit_action, nullable=False),
        sa.Column("target_hash", sa.String(64), nullable=True),
        sa.Column("ip_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_audit_logs_teacher_id", "audit_logs", ["teacher_id"])


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("scan_submissions")
    op.drop_table("student_identities")
    op.drop_table("exercises")
    op.drop_table("exams")
    op.drop_table("refresh_tokens")
    op.drop_table("invite_tokens")
    op.drop_table("teachers")

    # Drop enum types
    for name in ["audit_action", "question_type", "compilation_status", "teacher_role"]:
        sa.Enum(name=name).drop(op.get_bind(), checkfirst=True)
