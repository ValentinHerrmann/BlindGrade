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
from app.models.teacher import Teacher
from app.schemas.exam import ExerciseCreate, ExerciseResponse, ExerciseUpdate

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
    half = len(re.findall(r"\\hBE\b", latex_content))
    quart = len(re.findall(r"\\qBE\b", latex_content))

    return full * 1.0 + half * 0.5 + quart * 0.25


@router.get("", response_model=list[ExerciseResponse])
async def list_exercises(
    topic_tag: str | None = None,
    search: str | None = None,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> list[ExerciseResponse]:
    """List all exercises in the teacher's exercise library."""
    query = select(Exercise).where(
        or_(Exercise.teacher_id == teacher.id, Exercise.teacher_id.is_(None))
    )

    if topic_tag:
        query = query.where(Exercise.topic_tag == topic_tag)

    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            or_(
                Exercise.name.ilike(search_pattern),
                Exercise.latex_body.ilike(search_pattern),
                Exercise.topic_tag.ilike(search_pattern),
            )
        )

    query = query.order_by(Exercise.name.asc())
    result = await db.execute(query)
    exercises = result.scalars().all()

    return [
        ExerciseResponse(
            id=ex.id,
            teacher_id=ex.teacher_id,
            name=ex.name,
            topic_tag=ex.topic_tag,
            latex_body=ex.latex_body,
            max_points=ex.max_points,
            version=ex.version,
            order_index=ex.order_index,
            question_type=ex.question_type,
            correct_answers=ex.correct_answers,
            penalty=ex.penalty,
        )
        for ex in exercises
    ]


@router.post("", response_model=ExerciseResponse, status_code=status.HTTP_201_CREATED)
async def create_exercise(
    body: ExerciseCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Create a new exercise in the teacher's library."""
    computed_score = parse_exercise_score(body.latex_body) if body.latex_body else body.max_points

    ex = Exercise(
        teacher_id=teacher.id,
        name=body.name,
        topic_tag=body.topic_tag,
        latex_body=body.latex_body,
        max_points=computed_score,
        version=1,
        question_type=body.question_type,
        correct_answers=body.correct_answers,
        penalty=body.penalty,
    )
    db.add(ex)
    await db.flush()

    return ExerciseResponse(
        id=ex.id,
        teacher_id=ex.teacher_id,
        name=ex.name,
        topic_tag=ex.topic_tag,
        latex_body=ex.latex_body,
        max_points=ex.max_points,
        version=ex.version,
        order_index=ex.order_index,
        question_type=ex.question_type,
        correct_answers=ex.correct_answers,
        penalty=ex.penalty,
    )


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

    return ExerciseResponse(
        id=ex.id,
        teacher_id=ex.teacher_id,
        name=ex.name,
        topic_tag=ex.topic_tag,
        latex_body=ex.latex_body,
        max_points=ex.max_points,
        version=ex.version,
        order_index=ex.order_index,
        question_type=ex.question_type,
        correct_answers=ex.correct_answers,
        penalty=ex.penalty,
    )


@router.patch("/{exercise_id}", response_model=ExerciseResponse)
async def update_exercise(
    exercise_id: uuid.UUID,
    body: ExerciseUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
) -> ExerciseResponse:
    """Update a library exercise. Increments version counter."""
    result = await db.execute(select(Exercise).where(Exercise.id == exercise_id))
    ex = result.scalar_one_or_none()
    if not ex:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")

    if body.name is not None:
        ex.name = body.name
    if body.topic_tag is not None:
        ex.topic_tag = body.topic_tag
    if body.latex_body is not None:
        ex.latex_body = body.latex_body
        ex.max_points = parse_exercise_score(body.latex_body)
    elif body.max_points is not None:
        ex.max_points = body.max_points

    ex.version += 1
    await db.flush()

    return ExerciseResponse(
        id=ex.id,
        teacher_id=ex.teacher_id,
        name=ex.name,
        topic_tag=ex.topic_tag,
        latex_body=ex.latex_body,
        max_points=ex.max_points,
        version=ex.version,
        order_index=ex.order_index,
        question_type=ex.question_type,
        correct_answers=ex.correct_answers,
        penalty=ex.penalty,
    )


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
