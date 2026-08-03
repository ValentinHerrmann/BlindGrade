"""
Script to import sample LaTeX project exams into BlindGrade database.

Usage:
    python backend/scripts/import_sample_project.py [--project-dir ./latex-sample-project] [--teacher-email x@x.x]
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Add backend directory to sys.path and load backend/.env if present
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))
env_file = backend_dir / ".env"
if env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(env_file, override=True)
    except ImportError:
        pass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.database import Base
from app.models.exam import Exam
from app.models.exam_exercise import ExamExercise
from app.models.exercise import Exercise
from app.models.exercise_group import ExerciseGroup
from app.models.teacher import Teacher


def parse_exercise_score(latex_content: str) -> float:
    """Parse max score from exercise latex content based on BE markers or Aufgabe override."""
    override = re.search(r"\\begin\{Aufgabe\}\[([\d.]+)\]", latex_content)
    if override:
        try:
            return float(override.group(1))
        except ValueError:
            pass

    full = len(re.findall(r"\\BE\b", latex_content))
    full += len(re.findall(r"\\Lmulti\b", latex_content))
    half = len(re.findall(r"\\hBE\b", latex_content))
    quart = len(re.findall(r"\\qBE\b", latex_content))

    return full * 1.0 + half * 0.5 + quart * 0.25


def extract_cmd(tex: str, cmd_name: str) -> str | None:
    """Extract content inside \\cmd_name{content}."""
    m = re.search(r"\\" + cmd_name + r"\{(.*?)\}", tex, re.DOTALL)
    return m.group(1).strip() if m else None


async def get_or_create_exercise(
    session: AsyncSession,
    teacher: Teacher,
    exercise_path: Path,
    project_dir: Path,
    exercise_cache: dict[str, Exercise],
) -> tuple[Exercise, bool]:
    """Get existing exercise or import new exercise into library."""
    ex_name = exercise_path.stem
    if ex_name in exercise_cache:
        return exercise_cache[ex_name], False

    # Check DB for existing exercise by name & teacher_id
    res = await session.execute(
        select(Exercise).where(Exercise.teacher_id == teacher.id, Exercise.name == ex_name)
    )
    db_ex = res.scalar_one_or_none()
    if db_ex:
        exercise_cache[ex_name] = db_ex
        return db_ex, False

    # Extract topic folder tag and strip leading underscore
    try:
        rel_path = exercise_path.relative_to(project_dir)
        topic_dir = rel_path.parts[0] if len(rel_path.parts) > 1 else None
    except ValueError:
        topic_dir = None

    topic_tag = topic_dir.lstrip("_") if topic_dir else None

    ex_content = exercise_path.read_text(encoding="utf-8")
    score = parse_exercise_score(ex_content)

    grade = "10"
    subject = "Informatik"

    group_id = None
    variant_key = None
    group_name = ex_name
    if "_" in ex_name:
        parts = ex_name.split("_", 1)
        group_name = f"{topic_tag or ''} {parts[0]}".strip()
        variant_key = parts[1]

        group_res = await session.execute(
            select(ExerciseGroup).where(
                ExerciseGroup.teacher_id == teacher.id,
                ExerciseGroup.name == group_name,
            )
        )
        group = group_res.scalar_one_or_none()
        if not group:
            group = ExerciseGroup(
                teacher_id=teacher.id,
                name=group_name,
                topic_tag=topic_tag,
                grade=grade,
                subject=subject,
            )
            session.add(group)
            await session.flush()
        group_id = group.id

    db_ex = Exercise(
        teacher_id=teacher.id,
        name=group_name,
        topic_tag=topic_tag,
        grade=grade,
        subject=subject,
        latex_body=ex_content,
        max_points=score,
        version=1,
        exercise_group_id=group_id,
        variant_key=variant_key,
        is_current=True,
        question_type="free_text",
    )
    session.add(db_ex)
    await session.flush()

    exercise_cache[ex_name] = db_ex
    return db_ex, True


async def import_sample_project(project_dir: Path, teacher_email: str) -> None:
    db_url = settings.DATABASE_URL
    if db_url == "sqlite+aiosqlite:///:memory:":
        local_db = project_dir.parent / "backend" / "blindgrade.db"
        db_url = f"sqlite+aiosqlite:///{local_db}"

    engine = create_async_engine(db_url)

    # Ensure tables exist and missing columns are present
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        def _migrate_sqlite_schema(connection):
            from sqlalchemy import inspect
            inspector = inspect(connection)
            if "exercises" in inspector.get_table_names():
                cols = {c["name"] for c in inspector.get_columns("exercises")}
                if "grade" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN grade VARCHAR(50)"))
                if "subject" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN subject VARCHAR(100)"))
                if "exercise_group_id" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN exercise_group_id CHAR(32)"))
                if "variant_key" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN variant_key VARCHAR(100)"))
                if "is_current" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN is_current BOOLEAN DEFAULT 1"))
                if "is_public" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN is_public BOOLEAN DEFAULT 0"))
                if "version" not in cols:
                    connection.execute(text("ALTER TABLE exercises ADD COLUMN version INTEGER DEFAULT 1"))
            if "exercise_groups" in inspector.get_table_names():
                cols = {c["name"] for c in inspector.get_columns("exercise_groups")}
                if "grade" not in cols:
                    connection.execute(text("ALTER TABLE exercise_groups ADD COLUMN grade VARCHAR(50)"))
                if "subject" not in cols:
                    connection.execute(text("ALTER TABLE exercise_groups ADD COLUMN subject VARCHAR(100)"))

        await conn.run_sync(_migrate_sqlite_schema)

    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with async_session() as session:
        # Fetch or create teacher
        res = await session.execute(select(Teacher).where(Teacher.email == teacher_email))
        teacher = res.scalar_one_or_none()
        if not teacher:
            print(f"Teacher '{teacher_email}' not found. Creating teacher account...")
            teacher = Teacher(
                email=teacher_email,
                password_hash="imported_teacher_hash",
                role="teacher",
            )
            session.add(teacher)
            await session.flush()
            print(f"Created teacher '{teacher_email}' (id: {teacher.id}).")

        exercise_cache: dict[str, Exercise] = {}
        imported_exercises = 0

        # Step 1: Scan topic directories and pre-import standalone exercises into library
        topic_dirs = [d for d in project_dir.iterdir() if d.is_dir() and d.name.startswith("_")]
        print(f"Found {len(topic_dirs)} topic directories in {project_dir}.")

        for topic_dir in sorted(topic_dirs, key=lambda p: p.name):
            for ex_path in sorted(list(topic_dir.glob("*.tex"))):
                _ex, created = await get_or_create_exercise(
                    session, teacher, ex_path, project_dir, exercise_cache
                )
                if created:
                    imported_exercises += 1

        print(f"Imported {imported_exercises} exercises into exercise library.")

        # Step 2: Import exams from KAs directory
        kas_dir = project_dir / "KAs"
        if not kas_dir.exists():
            print(f"Warning: KAs directory not found in '{project_dir}'.")
            await session.commit()
            return

        ka_files = sorted(list(kas_dir.glob("*.tex")))
        print(f"Found {len(ka_files)} exam files in {kas_dir}.")

        imported_exams = 0

        for ka_file in ka_files:
            content = ka_file.read_text(encoding="utf-8")

            testart = extract_cmd(content, "Testart")
            klasse = extract_cmd(content, "Klasse")
            datum = extract_cmd(content, "Datum")
            nr = extract_cmd(content, "Nr")
            fach = extract_cmd(content, "Fach") or "Informatik"
            lehrernachname = extract_cmd(content, "Lehrernachname") or "Her"
            info_text = extract_cmd(content, "Info")

            title = f"{testart or 'Exam'} {klasse or ''} ({ka_file.stem})".strip()

            # Check if exam already imported
            existing = await session.execute(
                select(Exam).where(Exam.teacher_id == teacher.id, Exam.title == title)
            )
            if existing.scalar_one_or_none():
                print(f"Skipping exam '{title}' (already imported).")
                continue

            exam = Exam(
                teacher_id=teacher.id,
                title=title,
                testart=testart,
                klasse=klasse,
                datum=datum,
                nr=nr,
                fach=fach,
                lehrernachname=lehrernachname,
                info_text=info_text,
                retention_until=date.today() + timedelta(days=365),
                compilation_status="pending",
            )
            session.add(exam)
            await session.flush()

            # Find all \input{...} lines
            inputs = re.findall(r"\\input\{([^}]+)\}", content)
            order_idx = 1

            for rel_input in inputs:
                cand_paths = [
                    project_dir / rel_input if rel_input.endswith(".tex") else project_dir / f"{rel_input}.tex",
                    project_dir / rel_input,
                ]
                input_path: Path | None = None
                for cand in cand_paths:
                    if cand.exists() and cand.is_file():
                        input_path = cand
                        break

                if not input_path:
                    # Search by stem (handling prefix additions like CA-10_ or CA-5_)
                    stem = Path(rel_input).stem
                    for p in project_dir.rglob("*.tex"):
                        if "KAs" not in p.parts:
                            if p.stem == stem or p.stem.endswith(f"_{stem}") or p.stem.endswith(stem):
                                input_path = p
                                break

                if not input_path or not input_path.exists():
                    print(f"  Warning: exercise file '{rel_input}' not found in '{project_dir}'. Skipping.")
                    continue

                exercise, created = await get_or_create_exercise(
                    session, teacher, input_path, project_dir, exercise_cache
                )
                if created:
                    imported_exercises += 1

                # Link exercise to exam via ExamExercise
                link = ExamExercise(
                    exam_id=exam.id,
                    exercise_id=exercise.id,
                    order_index=order_idx,
                )
                session.add(link)
                order_idx += 1

            await session.commit()
            imported_exams += 1
            print(f"Imported exam '{title}' with {order_idx - 1} exercises.")

        await session.commit()
        print(f"\nSuccessfully imported {imported_exams} exams and total {imported_exercises} new exercises into library.")

    await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Import sample LaTeX project exams into BlindGrade.")
    parser.add_argument("--project-dir", default="./latex-sample-project", help="Path to latex-sample-project")
    parser.add_argument("--teacher-email", default="x@x.x", help="Email of teacher account")
    args = parser.parse_args()

    project_path = Path(args.project_dir).resolve()
    asyncio.run(import_sample_project(project_path, args.teacher_email))


if __name__ == "__main__":
    main()
