"""Pydantic schemas for Exam & Exercise endpoints."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class ExerciseCreate(BaseModel):
    id: uuid.UUID | None = None
    name: str = "Exercise"
    topic_tag: str | None = None
    grade: str | None = None
    subject: str | None = None
    latex_body: str = ""
    max_points: float = 0.0
    order_index: int = 1
    question_type: Literal["free_text", "mc", "sc", "tf"] = "free_text"
    correct_answers: dict | None = None
    penalty: float = 0.0
    exercise_group_id: uuid.UUID | None = None
    variant_key: str | None = None


class ExerciseUpdate(BaseModel):
    name: str | None = None
    topic_tag: str | None = None
    grade: str | None = None
    subject: str | None = None
    latex_body: str | None = None
    max_points: float | None = None
    exercise_group_id: uuid.UUID | None = None
    variant_key: str | None = None


class ExerciseGroupUpdate(BaseModel):
    name: str | None = None
    topic_tag: str | None = None
    grade: str | None = None
    subject: str | None = None


class ExerciseGroupResponse(BaseModel):
    id: uuid.UUID
    teacher_id: uuid.UUID
    name: str
    topic_tag: str | None = None
    grade: str | None = None
    subject: str | None = None
    created_at: datetime


class ExerciseResponse(BaseModel):
    id: uuid.UUID
    teacher_id: uuid.UUID | None = None
    name: str | None = None
    topic_tag: str | None = None
    grade: str | None = None
    subject: str | None = None
    latex_body: str | None = None
    max_points: float = 0.0
    version: int = 1
    exercise_group_id: uuid.UUID | None = None
    variant_key: str | None = None
    is_current: bool = True
    order_index: int = 1
    question_type: str = "free_text"
    correct_answers: dict | None = None
    penalty: float = 0.0


class ExamCreate(BaseModel):
    id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=500)
    latex_template: str = ""
    retention_until: date
    testart: str | None = None
    klasse: str | None = None
    datum: str | None = None
    nr: str | None = None
    fach: str | None = None
    lehrernachname: str | None = None
    info_text: str | None = None
    exercise_ids: list[uuid.UUID] = []
    exercises: list[ExerciseCreate] = []


class ExamUpdate(BaseModel):
    title: str | None = None
    latex_template: str | None = None
    retention_until: date | None = None
    testart: str | None = None
    klasse: str | None = None
    datum: str | None = None
    nr: str | None = None
    fach: str | None = None
    lehrernachname: str | None = None
    info_text: str | None = None
    exercise_ids: list[uuid.UUID] | None = None


class ExamResponse(BaseModel):
    id: uuid.UUID
    teacher_id: uuid.UUID
    title: str
    latex_template: str
    compilation_status: str
    created_at: datetime
    retention_until: date
    testart: str | None = None
    klasse: str | None = None
    datum: str | None = None
    nr: str | None = None
    fach: str | None = None
    lehrernachname: str | None = None
    info_text: str | None = None
    exercises: list[ExerciseResponse] = []


class ExamUsageItem(BaseModel):
    id: uuid.UUID
    title: str
    datum: str | None = None


class ExerciseUsageResponse(BaseModel):
    exam_count: int
    exams: list[ExamUsageItem] = []

