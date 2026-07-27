"""add missing columns idempotently

Revision ID: 0008_add_missing_columns
Revises: 0007_add_grade_subject
Create Date: 2026-07-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision: str = "0008_add_missing_columns"
down_revision: Union[str, None] = "0007_add_grade_subject"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


async def upgrade() -> None:
    conn = op.get_bind()
    await conn.execute(
        text("""
        DO $$
        BEGIN
            -- Exams: latex_template
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'latex_template'
            ) THEN
                ALTER TABLE exams ADD COLUMN latex_template TEXT;
            END IF;

            -- Exams: retention_until
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'retention_until'
            ) THEN
                ALTER TABLE exams ADD COLUMN retention_until DATE;
            END IF;

            -- Exams: testart
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'testart'
            ) THEN
                ALTER TABLE exams ADD COLUMN testart VARCHAR(100);
            END IF;

            -- Exams: klasse
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'klasse'
            ) THEN
                ALTER TABLE exams ADD COLUMN klasse VARCHAR(100);
            END IF;

            -- Exams: datum
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'datum'
            ) THEN
                ALTER TABLE exams ADD COLUMN datum DATE;
            END IF;

            -- Exams: nr
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'nr'
            ) THEN
                ALTER TABLE exams ADD COLUMN nr VARCHAR(50);
            END IF;

            -- Exams: fach
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'fach'
            ) THEN
                ALTER TABLE exams ADD COLUMN fach VARCHAR(100);
            END IF;

            -- Exams: lehrernachname
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'lehrernachname'
            ) THEN
                ALTER TABLE exams ADD COLUMN lehrernachname VARCHAR(200);
            END IF;

            -- Exams: info_text
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'info_text'
            ) THEN
                ALTER TABLE exams ADD COLUMN info_text TEXT;
            END IF;

            -- Exams: exercise_group_id
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'exercise_group_id'
            ) THEN
                ALTER TABLE exams ADD COLUMN exercise_group_id UUID;
            END IF;

            -- Exams: variant_key
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'variant_key'
            ) THEN
                ALTER TABLE exams ADD COLUMN variant_key VARCHAR(50);
            END IF;

            -- Exams: variant_hash
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exams' AND column_name = 'variant_hash'
            ) THEN
                ALTER TABLE exams ADD COLUMN variant_hash VARCHAR(64);
            END IF;

            -- Exercises: exercise_group_id
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'exercise_group_id'
            ) THEN
                ALTER TABLE exercises ADD COLUMN exercise_group_id UUID;
            END IF;

            -- Exercises: variant_key
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'variant_key'
            ) THEN
                ALTER TABLE exercises ADD COLUMN variant_key VARCHAR(50);
            END IF;

            -- Exercises: is_current
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'is_current'
            ) THEN
                ALTER TABLE exercises ADD COLUMN is_current BOOLEAN DEFAULT true;
            END IF;

            -- Exercises: order_index
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'order_index'
            ) THEN
                ALTER TABLE exercises ADD COLUMN order_index INTEGER;
            END IF;

            -- Exercises: question_type
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'question_type'
            ) THEN
                ALTER TABLE exercises ADD COLUMN question_type VARCHAR(50) DEFAULT 'free_text';
            END IF;

            -- Exercises: correct_answers
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'correct_answers'
            ) THEN
                ALTER TABLE exercises ADD COLUMN correct_answers JSONB;
            END IF;

            -- Exercises: penalty
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'exercises' AND column_name = 'penalty'
            ) THEN
                ALTER TABLE exercises ADD COLUMN penalty DECIMAL(5,2) DEFAULT 0;
            END IF;

            -- ScanSubmissions: exercise_group_id
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'scan_submissions' AND column_name = 'exercise_group_id'
            ) THEN
                ALTER TABLE scan_submissions ADD COLUMN exercise_group_id UUID;
            END IF;

            -- ScanSubmissions: variant_key
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'scan_submissions' AND column_name = 'variant_key'
            ) THEN
                ALTER TABLE scan_submissions ADD COLUMN variant_key VARCHAR(50);
            END IF;
        END $$;
        """)
    )


async def downgrade() -> None:
    pass
