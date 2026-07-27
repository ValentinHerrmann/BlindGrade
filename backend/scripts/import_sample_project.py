"""
Script to import sample LaTeX project exams into BlindGrade database.

Usage:
    python backend/scripts/import_sample_project.py [--project-dir ./latex-sample-project] [--teacher-email admin@blindgrade.local]
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

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
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
    m = re.search(rf"\\{cmd_name}\{(.*?)\}", tex, re.DOTALL)
    return m.group(1).strip() if m else None


async def import_sample_project(project_dir: Path, teacher_email: str) -> None:
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with async_session() as session:
        # Fetch or verify teacher
        res = await session.execute(select(Teacher).where(Teacher.email == teacher_email))
        teacher = res.scalar_one_or_none()
        if not teacher:
            print(f"Error: Teacher with email '{teacher_email}' not found in database.")
            print("Please register or create this teacher account first.")
            return

        kas_dir = project_dir / "KAs"
        if not kas_dir.exists():
            print(f"Error: KAs directory not found in '{project_dir}'.")
            return

        ka_files = sorted(list(kas_dir.glob("*.tex")))
        print(f"Found {len(ka_files)} exam files in {kas_dir}.")

        # Cache of existing library exercises by name/path
        exercise_cache: dict[str, Exercise] = {}

        imported_exams = 0
        imported_exercises = 0

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
                print(f"Skipping '{title}' (already imported).")
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
                input_path = project_dir / f"{rel_input}.tex"
                if not input_path.exists():
                    input_path = project_dir / rel_input

                if not input_path.exists():
                    print(f"  Warning: exercise file '{rel_input}' not found in '{project_dir}'. Skipping.")
                    continue

                ex_name = input_path.stem
                if ex_name not in exercise_cache:
                    # Check DB for exercise by name & teacher_id
                    db_ex_res = await session.execute(
                        select(Exercise).where(Exercise.teacher_id == teacher.id, Exercise.name == ex_name)
                    )
                    db_ex = db_ex_res.scalar_one_or_none()

                    if not db_ex:
                        ex_content = input_path.read_text(encoding="utf-8")
                        score = parse_exercise_score(ex_content)
                        topic = rel_input.split("/")[0] if "/" in rel_input else None

                        group_id = None
                        variant_key = None
                        if "_" in ex_name:
                            parts = ex_name.split("_", 1)
                            group_name = f"{topic or ''} {parts[0]}".strip()
                            variant_key = parts[1]

                            # Check/create ExerciseGroup
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
                                    topic_tag=topic,
                                )
                                session.add(group)
                                await session.flush()
                            group_id = group.id

                        db_ex = Exercise(
                            teacher_id=teacher.id,
                            name=ex_name,
                            topic_tag=topic,
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
                        imported_exercises += 1

                    exercise_cache[ex_name] = db_ex

                exercise = exercise_cache[ex_name]

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

        print(f"\nSuccessfully imported {imported_exams} exams and {imported_exercises} new exercises into library.")

    await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="Import sample LaTeX project exams into BlindGrade.")
    parser.add_argument("--project-dir", default="./latex-sample-project", help="Path to latex-sample-project")
    parser.add_argument("--teacher-email", default="admin@blindgrade.local", help="Email of teacher account")
    args = parser.parse_args()

    project_path = Path(args.project_dir).resolve()
    asyncio.run(import_sample_project(project_path, args.teacher_email))


if __name__ == "__main__":
    main()
