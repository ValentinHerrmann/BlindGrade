"""Exercises library router — /api/v1/exercises/*"""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_teacher
from app.models.exercise import Exercise
from app.models.exam import Exam
from app.models.exam_exercise import ExamExercise
from app.models.teacher import Teacher
from app.schemas.exam import (
    ExamUsageItem,
    ExerciseCreate,
    ExerciseResponse,
    ExerciseUpdate,
    ExerciseUsageResponse,
)

from app.models.exercise_group import ExerciseGroup

router = APIRouter(prefix="/exercises", tags=["exercises"])


def parse_exercise_score(latex_content: str) -> float:
    """Parse max score from exercise latex content."""
    if not latex_content:
        return 0.0

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


def _to_res(ex: Exercise) -> ExerciseResponse:
    return ExerciseResponse(
        id=ex.id,
        teacher_id=ex.teacher_id,
        name=ex.name,
        topic_tag=ex.topic_tag,
        grade=ex.grade,
        subject=ex.subject,
        latex_body=ex.latex_body,
        max_points=ex.max_points,
        version=ex.version,
        exercise_group_id=ex.exercise_group_id,
        variant_key=ex.variant_key,
        is_current=ex.is_current,
        order_index=ex.order_index,
        question_type=ex.question_type,
        correct_answers=ex.correct_answers,
        penalty=ex.penalty,
    )


@router.get("", response_model=list[ExerciseResponse])
async def list_exercises(
    topic_tag: str | None = None,
    grade: str | None = None,
    subject: str | None = None,
    search: str | None = None,
    group_id: uuid.UUID | None = None,
    current_only: bool = True,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> list[ExerciseResponse]:
    """List all exercises in the teacher's exercise library."""
    query = select(Exercise).where(
        or_(Exercise.teacher_id == teacher.id, Exercise.teacher_id.is_(None))
    )

    if current_only:
        query = query.where(Exercise.is_current.is_(True))

    if group_id:
        query = query.where(Exercise.exercise_group_id == group_id)

    if topic_tag:
        query = query.where(Exercise.topic_tag == topic_tag)

    if grade:
        query = query.where(Exercise.grade == grade)

    if subject:
        query = query.where(Exercise.subject == subject)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                Exercise.name.ilike(search_pattern),
                Exercise.latex_body.ilike(search_pattern),
                Exercise.topic_tag.ilike(search_pattern),
                Exercise.grade.ilike(search_pattern),
                Exercise.subject.ilike(search_pattern),
                Exercise.variant_key.ilike(search_pattern),
            )
        )

    query = query.order_by(Exercise.name.asc(), Exercise.version.desc())
    result = await db.execute(query)
    exercises = result.scalars().all()

    return [_to_res(ex) for ex in exercises]


@router.post("", response_model=ExerciseResponse, status_code=status.HTTP_201_CREATED)
async def create_exercise(
    body: ExerciseCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Create a new exercise in the teacher's library."""
    computed_score = parse_exercise_score(body.latex_body) if body.latex_body else body.max_points

    group_id = body.exercise_group_id
    if not group_id:
        group = ExerciseGroup(
            teacher_id=teacher.id,
            name=body.name or "Untitled Group",
            topic_tag=body.topic_tag,
            grade=body.grade,
            subject=body.subject,
        )
        db.add(group)
        await db.flush()
        group_id = group.id

    kwargs = {
        "teacher_id": teacher.id,
        "name": body.name,
        "topic_tag": body.topic_tag,
        "grade": body.grade,
        "subject": body.subject,
        "latex_body": body.latex_body,
        "max_points": computed_score,
        "version": 1,
        "exercise_group_id": group_id,
        "variant_key": body.variant_key,
        "is_current": True,
        "question_type": body.question_type,
        "correct_answers": body.correct_answers,
        "penalty": body.penalty,
    }
    if body.id:
        kwargs["id"] = body.id
    ex = Exercise(**kwargs)
    db.add(ex)
    await db.flush()

    return _to_res(ex)


@router.get("/{exercise_id}", response_model=ExerciseResponse)
async def get_exercise(
    exercise_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Get an exercise from the library."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    ex = result.scalar_one_or_none()
    if not ex:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")

    return _to_res(ex)


@router.patch("/{exercise_id}", response_model=ExerciseResponse)
async def update_exercise(
    exercise_id: uuid.UUID,
    body: ExerciseUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Update a library exercise in place."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    ex = result.scalar_one_or_none()
    if not ex:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")

    if body.name is not None:
        ex.name = body.name
    if body.topic_tag is not None:
        ex.topic_tag = body.topic_tag
    if body.grade is not None:
        ex.grade = body.grade
    if body.subject is not None:
        ex.subject = body.subject
    if body.latex_body is not None:
        ex.latex_body = body.latex_body
        ex.max_points = parse_exercise_score(body.latex_body)
    elif body.max_points is not None:
        ex.max_points = body.max_points
    if body.exercise_group_id is not None:
        ex.exercise_group_id = body.exercise_group_id
    if body.variant_key is not None:
        ex.variant_key = body.variant_key

    await db.flush()
    return _to_res(ex)


@router.post("/{exercise_id}/new-version", response_model=ExerciseResponse, status_code=status.HTTP_201_CREATED)
async def create_new_version(
    exercise_id: uuid.UUID,
    body: ExerciseUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Create a new corrected version of an existing exercise (archives previous version)."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    old_ex = result.scalar_one_or_none()
    if not old_ex:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")

    # Mark old version as not current
    old_ex.is_current = False

    group_id = old_ex.exercise_group_id
    if not group_id:
        group = ExerciseGroup(
            teacher_id=teacher.id,
            name=old_ex.name or "Untitled Group",
            topic_tag=old_ex.topic_tag,
            grade=old_ex.grade,
            subject=old_ex.subject,
        )
        db.add(group)
        await db.flush()
        group_id = group.id
        old_ex.exercise_group_id = group_id

    new_latex = body.latex_body if body.latex_body is not None else old_ex.latex_body
    computed_score = parse_exercise_score(new_latex) if new_latex else old_ex.max_points

    new_ex = Exercise(
        teacher_id=teacher.id,
        name=body.name if body.name is not None else old_ex.name,
        topic_tag=body.topic_tag if body.topic_tag is not None else old_ex.topic_tag,
        grade=body.grade if body.grade is not None else old_ex.grade,
        subject=body.subject if body.subject is not None else old_ex.subject,
        latex_body=new_latex,
        max_points=computed_score,
        version=old_ex.version + 1,
        exercise_group_id=group_id,
        variant_key=body.variant_key or old_ex.variant_key,
        is_current=True,
        question_type=old_ex.question_type,
        correct_answers=old_ex.correct_answers,
        penalty=old_ex.penalty,
    )
    db.add(new_ex)
    await db.flush()

    return _to_res(new_ex)


@router.post("/{exercise_id}/new-variant", response_model=ExerciseResponse, status_code=status.HTTP_201_CREATED)
async def create_new_variant(
    exercise_id: uuid.UUID,
    body: ExerciseCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Create a new parallel variant (e.g. Möbel/Fahrzeug/Wildtier) under the same group."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    base_ex = result.scalar_one_or_none()
    if not base_ex:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")

    group_id = base_ex.exercise_group_id
    if not group_id:
        group = ExerciseGroup(
            teacher_id=teacher.id,
            name=base_ex.name or "Untitled Group",
            topic_tag=base_ex.topic_tag,
            grade=base_ex.grade,
            subject=base_ex.subject,
        )
        db.add(group)
        await db.flush()
        group_id = group.id
        base_ex.exercise_group_id = group_id

    computed_score = parse_exercise_score(body.latex_body) if body.latex_body else body.max_points

    variant_ex = Exercise(
        teacher_id=teacher.id,
        name=body.name or base_ex.name,
        topic_tag=body.topic_tag or base_ex.topic_tag,
        grade=body.grade or base_ex.grade,
        subject=body.subject or base_ex.subject,
        latex_body=body.latex_body,
        max_points=computed_score,
        version=1,
        exercise_group_id=group_id,
        variant_key=body.variant_key,
        is_current=True,
        question_type=body.question_type,
        correct_answers=body.correct_answers,
        penalty=body.penalty,
    )
    db.add(variant_ex)
    await db.flush()

    return _to_res(variant_ex)


@router.get("/{exercise_id}/usage", response_model=ExerciseUsageResponse)
async def get_exercise_usage(
    exercise_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseUsageResponse:
    """Get count and details of non-deleted exams referencing this exercise."""
    ex_res = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    ex = ex_res.scalar_one_or_none()
    if not ex:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")

    query = (
        select(Exam)
        .join(ExamExercise, ExamExercise.exam_id == Exam.id)
        .where(
            ExamExercise.exercise_id == exercise_id,
            Exam.deleted_at.is_(None),
            Exam.teacher_id == teacher.id,
        )
    )
    res = await db.execute(query)
    exams = list(res.scalars().all())

    if ex.exam_id and not any(e.id == ex.exam_id for e in exams):
        legacy_res = await db.execute(
            select(Exam).where(
                Exam.id == ex.exam_id,
                Exam.deleted_at.is_(None),
                Exam.teacher_id == teacher.id,
            )
        )
        legacy_exam = legacy_res.scalar_one_or_none()
        if legacy_exam:
            exams.append(legacy_exam)

    usage_items = [
        ExamUsageItem(id=exam.id, title=exam.title, datum=exam.datum)
        for exam in exams
    ]
    return ExerciseUsageResponse(exam_count=len(usage_items), exams=usage_items)


@router.delete("/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exercise(
    exercise_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an exercise from the library."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    ex = result.scalar_one_or_none()
    if ex:
        await db.delete(ex)

