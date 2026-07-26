"""Unit tests for /api/v1/user endpoints (student data purge and restore)."""
from __future__ import annotations

import base64
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scan_submission import ScanSubmission
from app.models.student_identity import StudentIdentity
from tests.test_api import _create_teacher_and_login


@pytest.mark.asyncio
async def test_purge_and_restore_student_data(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "purgeteacher@example.com")

    # 1. Create exam
    e_resp = await client.post(
        "/api/v1/exams",
        json={"title": "Purge Test Exam", "retention_until": "2027-12-31"},
    )
    assert e_resp.status_code == 201
    exam_id = e_resp.json()["id"]

    # 2. Add student identity & submission
    pseudo_hmac = "b" * 64
    st_resp = await client.post(
        f"/api/v1/exams/{exam_id}/students",
        json={
            "pseudonym_hmac": pseudo_hmac,
            "pii_ciphertext_b64": base64.b64encode(b"PII").decode(),
            "iv_b64": base64.b64encode(b"123456789012").decode(),
            "encryption_salt_b64": base64.b64encode(b"1234567890123456").decode(),
        },
    )
    assert st_resp.status_code == 201

    sub_resp = await client.post(
        f"/api/v1/exams/{exam_id}/submissions",
        json={
            "pseudonym_hmac": pseudo_hmac,
            "scan_ciphertext_b64": base64.b64encode(b"Scan").decode(),
            "scan_iv_b64": base64.b64encode(b"123456789012").decode(),
            "total_score": 90.0,
        },
    )
    assert sub_resp.status_code == 201

    # 3. Call purge endpoint
    purge_resp = await client.post("/api/v1/user/purge-server-student-data")
    assert purge_resp.status_code == 200
    purge_body = purge_resp.json()
    assert purge_body["status"] == "ok"
    assert purge_body["purged_student_identities"] == 1
    assert purge_body["purged_submissions"] == 1
    expected_retention = (date.today() + timedelta(days=7)).isoformat()
    assert purge_body["retention_until"] == expected_retention

    # Verify student identity & submission are soft-deleted with retention date
    st_row = (await db.execute(select(StudentIdentity).where(StudentIdentity.pseudonym_hmac == pseudo_hmac))).scalar_one()
    assert st_row.deleted_at is not None
    assert st_row.retention_until == date.today() + timedelta(days=7)

    sub_row = (await db.execute(select(ScanSubmission).where(ScanSubmission.pseudonym_hmac == pseudo_hmac))).scalar_one()
    assert sub_row.deleted_at is not None
    assert sub_row.retention_until == date.today() + timedelta(days=7)

    # 4. Call restore endpoint
    restore_resp = await client.post("/api/v1/user/restore-server-data")
    assert restore_resp.status_code == 200
    restore_body = restore_resp.json()
    assert restore_body["status"] == "ok"
    assert restore_body["restored_student_identities"] == 1
    assert restore_body["restored_submissions"] == 1

    # Refresh session identity map
    db.expire_all()

    # Verify rows are restored (deleted_at and retention_until cleared)
    st_row_restored = (await db.execute(select(StudentIdentity).where(StudentIdentity.pseudonym_hmac == pseudo_hmac))).scalar_one()
    assert st_row_restored.deleted_at is None
    assert st_row_restored.retention_until is None
