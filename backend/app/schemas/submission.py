"""Pydantic schemas for ScanSubmission endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SubmissionCreate(BaseModel):
    pseudonym_hmac: str = Field(min_length=64, max_length=64)
    scan_ciphertext_b64: str | None = None
    scan_iv_b64: str
    annotation_ciphertext_b64: str | None = None
    annotation_iv_b64: str | None = None
    total_score: float | None = None


class SubmissionScoreUpdate(BaseModel):
    total_score: float = Field(ge=0)


class SubmissionResponse(BaseModel):
    id: uuid.UUID
    exam_id: uuid.UUID
    pseudonym_hmac: str
    total_score: float | None
    scan_ciphertext_b64: str | None = None
    scan_iv_b64: str
    annotation_ciphertext_b64: str | None = None
    annotation_iv_b64: str | None = None
    created_at: datetime
