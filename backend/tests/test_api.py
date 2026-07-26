"""Phase 3 API integration tests (Exams, Students, Submissions, Admin, Retention)."""
from __future__ import annotations

import base64
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.teacher import Teacher
from app.services.crypto import hash_password, generate_invite_token, hash_token
from app.models.invite import InviteToken


async def _create_teacher_and_login(client: AsyncClient, db: AsyncSession, email: str, role: str = "teacher") -> None:
    raw_token = generate_invite_token()
    db.add(InviteToken(token_hash=hash_token(raw_token), expires_at=date.today() + timedelta(days=1)))
    await db.commit()

    login_resp = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Password123!", "invite_token": raw_token},
    )
    client.cookies.update(login_resp.cookies)

    # Set role if admin
    if role == "admin":
        from sqlalchemy import update
        await db.execute(update(Teacher).where(Teacher.email == email).values(role="admin"))
        await db.commit()
        # Re-login to get updated token
        login_resp2 = await client.post("/api/v1/auth/login", json={"email": email, "password": "Password123!"})
        client.cookies.update(login_resp2.cookies)


@pytest.mark.asyncio
async def test_exam_crud_flow(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "examteacher@example.com")

    # Create exam
    retention_date = (date.today() + timedelta(days=365)).isoformat()
    resp = await client.post(
        "/api/v1/exams",
        json={
            "title": "Algorithms 101",
            "latex_template": "\\documentclass{article}",
            "retention_until": retention_date,
            "exercises": [
                {"order_index": 1, "max_points": 10.0, "question_type": "free_text"},
                {"order_index": 2, "max_points": 5.0, "question_type": "mc", "penalty": -1.0},
            ],
        },
    )
    assert resp.status_code == 201
    exam = resp.json()
    exam_id = exam["id"]
    assert exam["title"] == "Algorithms 101"
    assert len(exam["exercises"]) == 2

    # Get exam
    get_resp = await client.get(f"/api/v1/exams/{exam_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["title"] == "Algorithms 101"

    # List exams
    list_resp = await client.get("/api/v1/exams")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    # Soft delete exam
    del_resp = await client.delete(f"/api/v1/exams/{exam_id}")
    assert del_resp.status_code == 204

    # Deleted exam is inaccessible (returns 401 per API security contract)
    get_del_resp = await client.get(f"/api/v1/exams/{exam_id}")
    assert get_del_resp.status_code == 401


@pytest.mark.asyncio
async def test_student_and_submission_upload(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "studentteacher@example.com")

    # Create exam
    e_resp = await client.post(
        "/api/v1/exams",
        json={"title": "Data Structures", "retention_until": "2027-12-31"},
    )
    exam_id = e_resp.json()["id"]

    # Upload Student Identity
    pseudonym_hmac = "a" * 64
    st_resp = await client.post(
        f"/api/v1/exams/{exam_id}/students",
        json={
            "pseudonym_hmac": pseudonym_hmac,
            "pii_ciphertext_b64": base64.b64encode(b"EncryptedPII").decode(),
            "iv_b64": base64.b64encode(b"123456789012").decode(),
            "encryption_salt_b64": base64.b64encode(b"1234567890123456").decode(),
        },
    )
    assert st_resp.status_code == 201

    # Upload Submission
    sub_resp = await client.post(
        f"/api/v1/exams/{exam_id}/submissions",
        json={
            "pseudonym_hmac": pseudonym_hmac,
            "scan_ciphertext_b64": base64.b64encode(b"EncryptedScan").decode(),
            "scan_iv_b64": base64.b64encode(b"123456789012").decode(),
            "total_score": 85.5,
        },
    )
    assert sub_resp.status_code == 201
    sub_id = sub_resp.json()["id"]

    # Download Submission
    get_sub = await client.get(f"/api/v1/exams/{exam_id}/submissions/{sub_id}")
    assert get_sub.status_code == 200
    assert get_sub.json()["total_score"] == 85.5

    # GDPR Student Erasure
    erase_resp = await client.delete(f"/api/v1/exams/{exam_id}/students/{pseudonym_hmac}")
    assert erase_resp.status_code == 204


@pytest.mark.asyncio
async def test_admin_stats_k_anonymity(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "admin@example.com", role="admin")

    e_resp = await client.post(
        "/api/v1/exams",
        json={"title": "Stats Exam", "retention_until": "2027-12-31"},
    )
    exam_id = e_resp.json()["id"]

    # Less than 5 submissions -> suppressed
    stats1 = await client.get(f"/api/v1/admin/stats/{exam_id}")
    assert stats1.status_code == 200
    assert stats1.json()["k_anonymity_satisfied"] is False
    assert stats1.json()["mean_score"] is None


@pytest.mark.asyncio
async def test_admin_can_create_teacher_user(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "admin-create@example.com", role="admin")

    create_resp = await client.post(
        "/api/v1/admin/users",
        json={
            "email": "newteacher@example.com",
            "password": "StrongPassw0rd!",
            "role": "teacher",
        },
    )
    assert create_resp.status_code == 201
    body = create_resp.json()
    assert body["email"] == "newteacher@example.com"
    assert body["role"] == "teacher"

    # Verify created account can authenticate
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "newteacher@example.com", "password": "StrongPassw0rd!"},
    )
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.cookies


@pytest.mark.asyncio
async def test_non_admin_cannot_create_users(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "regular-teacher@example.com", role="teacher")

    resp = await client.post(
        "/api/v1/admin/users",
        json={
            "email": "blocked@example.com",
            "password": "StrongPassw0rd!",
            "role": "teacher",
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_create_user_duplicate_email_conflict(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "admin-duplicate@example.com", role="admin")

    first = await client.post(
        "/api/v1/admin/users",
        json={
            "email": "dup@example.com",
            "password": "StrongPassw0rd!",
            "role": "teacher",
        },
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/admin/users",
        json={
            "email": "dup@example.com",
            "password": "StrongPassw0rd!",
            "role": "teacher",
        },
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_exercise_versions_and_variants(client: AsyncClient, db: AsyncSession) -> None:
    await _create_teacher_and_login(client, db, "exerciseteacher@example.com")

    # Create base exercise
    create_res = await client.post(
        "/api/v1/exercises",
        json={
            "name": "Typ1_Vererbung",
            "topic_tag": "_Vererbung",
            "latex_body": "\\begin{Aufgabe}[10] Vererbung \\BE \\hBE \\end{Aufgabe}",
            "variant_key": "Moebel",
        },
    )
    assert create_res.status_code == 201
    ex1 = create_res.json()
    assert ex1["version"] == 1
    assert ex1["max_points"] == 10.0
    assert ex1["variant_key"] == "Moebel"
    ex1_id = ex1["id"]

    # Create new version (correction)
    ver_res = await client.post(
        f"/api/v1/exercises/{ex1_id}/new-version",
        json={
            "latex_body": "\\begin{Aufgabe}[12] Vererbung Updated \\BE \\hBE \\qBE \\end{Aufgabe}",
        },
    )
    assert ver_res.status_code == 201
    ex1_v2 = ver_res.json()
    assert ex1_v2["version"] == 2
    assert ex1_v2["max_points"] == 12.0
    assert ex1_v2["is_current"] is True

    # Create parallel variant (Fahrzeug)
    var_res = await client.post(
        f"/api/v1/exercises/{ex1_id}/new-variant",
        json={
            "name": "Typ1_Fahrzeug",
            "topic_tag": "_Vererbung",
            "latex_body": "\\begin{Aufgabe}[10] Fahrzeug \\BE \\end{Aufgabe}",
            "variant_key": "Fahrzeug",
        },
    )
    assert var_res.status_code == 201
    variant_ex = var_res.json()
    assert variant_ex["variant_key"] == "Fahrzeug"
    assert variant_ex["exercise_group_id"] == ex1["exercise_group_id"]

    # Check usage (should be 0 exams initially)
    usage_res = await client.get(f"/api/v1/exercises/{ex1_id}/usage")
    assert usage_res.status_code == 200
    assert usage_res.json()["exam_count"] == 0

    # Link exercise to an exam
    retention_date = (date.today() + timedelta(days=365)).isoformat()
    exam_res = await client.post(
        "/api/v1/exams",
        json={
            "title": "Exam with exercise",
            "retention_until": retention_date,
            "exercise_ids": [ex1_id],
        },
    )
    assert exam_res.status_code == 201

    # Check usage now (should be 1 exam)
    usage_res2 = await client.get(f"/api/v1/exercises/{ex1_id}/usage")
    assert usage_res2.status_code == 200
    assert usage_res2.json()["exam_count"] == 1
    assert usage_res2.json()["exams"][0]["title"] == "Exam with exercise"

    # Delete exercise
    del_res = await client.delete(f"/api/v1/exercises/{ex1_id}")
    assert del_res.status_code == 204

    # Get exercise should return 404
    get_res = await client.get(f"/api/v1/exercises/{ex1_id}")
    assert get_res.status_code == 404


@pytest.mark.asyncio
async def test_compile_endpoint_requires_auth(client: AsyncClient, db: AsyncSession) -> None:
    # Unauthenticated request fails with 401
    unauth_res = await client.post("/api/v1/compile/latex", json={"latex": "\\documentclass{article}"})
    assert unauth_res.status_code == 401

    # Authenticated request passes auth check
    await _create_teacher_and_login(client, db, "compileteacher@example.com")
    from unittest.mock import patch
    with patch("app.routers.compile.compile_latex", return_value=b"%PDF-1.4 fake"):
        auth_res = await client.post("/api/v1/compile/latex", json={"latex": "\\documentclass{article}"})
        assert auth_res.status_code == 200
        assert auth_res.content == b"%PDF-1.4 fake"


