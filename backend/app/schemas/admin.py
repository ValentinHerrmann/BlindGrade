"""Pydantic schemas for Admin endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    teacher_id: uuid.UUID | None
    teacher_email: str
    action: str
    target_hash: str | None
    ip_hash: str | None
    created_at: datetime


class ClassStatsResponse(BaseModel):
    exam_id: uuid.UUID
    total_submissions: int
    mean_score: float | None
    std_dev: float | None
    k_anonymity_satisfied: bool
    suppressed_reason: str | None = None
