"""
Management CLI commands.

Usage (from /app directory inside container):
    python -m app.cli create-invite [--expires-days 7]
    python -m app.cli run-retention [--dry-run]

Invoked by external cron (systemd timer / Kubernetes CronJob).
NOT by an in-process scheduler — avoids multi-worker duplication.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone

import click
from sqlalchemy import func, select, update
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.config import settings  # noqa: F401 — validates config at import


@click.group()
def cli() -> None:
    """Examance management commands."""


def _raise_schema_hint(exc: Exception) -> None:
    """Convert DB schema errors into actionable CLI guidance."""
    msg = str(exc).lower()
    if "no such table" in msg or "undefined table" in msg:
        raise click.ClickException(
            "Database schema is not initialized for the current DATABASE_URL.\n"
            f"Current DATABASE_URL: {settings.DATABASE_URL}\n"
            "Run migrations first, then retry:\n"
            "  docker compose up -d db redis backend\n"
            "  docker compose exec backend alembic upgrade head\n"
            "If you intentionally use local SQLite, run Alembic with matching env vars."
        )
    raise click.ClickException(f"Database operation failed: {exc}")


@cli.command("create-invite")
@click.option("--expires-days", default=7, show_default=True, help="Token validity in days.")
@click.option("--created-by", default=None, help="Admin teacher UUID (optional).")
def create_invite(expires_days: int, created_by: str | None) -> None:
    """
    Generate a one-time invite token and print it to stdout.

    The raw token is printed ONCE and never stored — only its SHA-256 hash is stored.
    Share the printed token securely with the new teacher.
    """
    import uuid

    from app.models.invite import InviteToken
    from app.services.crypto import generate_invite_token, hash_token

    raw_token = generate_invite_token()
    token_hash = hash_token(raw_token)
    expires_at = datetime.now(tz=timezone.utc) + timedelta(days=expires_days)

    created_by_uuid = uuid.UUID(created_by) if created_by else None

    async def _insert() -> None:
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            try:
                record = InviteToken(
                    token_hash=token_hash,
                    created_by=created_by_uuid,
                    expires_at=expires_at,
                )
                db.add(record)
                await db.commit()
            except (OperationalError, ProgrammingError) as exc:
                _raise_schema_hint(exc)

    asyncio.run(_insert())

    click.echo(f"\n{'='*60}")
    click.echo(f"Invite token (share this ONCE — not stored):\n\n  {raw_token}\n")
    click.echo(f"Expires: {expires_at.isoformat()}")
    click.echo(f"{'='*60}\n")


@cli.command("create-user")
@click.option("--email", required=True, help="User email.")
@click.option(
    "--role",
    type=click.Choice(["teacher", "admin"], case_sensitive=True),
    default="teacher",
    show_default=True,
    help="User role.",
)
@click.option(
    "--allow-admin",
    is_flag=True,
    default=False,
    help="Required when creating an admin account.",
)
@click.option(
    "--password",
    prompt=True,
    hide_input=True,
    confirmation_prompt=True,
    help="User password (min length: 12).",
)
def create_user(email: str, role: str, allow_admin: bool, password: str) -> None:
    """Create a teacher/admin account directly from CLI (for bootstrap and recovery)."""
    from app.models.teacher import Teacher
    from app.services.crypto import hash_password

    if len(password) < 12:
        raise click.ClickException("Password must be at least 12 characters long.")
    if role == "admin" and not allow_admin:
        raise click.ClickException("Refusing to create admin without --allow-admin.")

    typed_role = role if role == "admin" else "teacher"
    normalized_email = email.strip().lower()

    async def _insert() -> Teacher:
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            try:
                existing = await db.execute(
                    select(Teacher).where(func.lower(Teacher.email) == normalized_email)
                )
                if existing.scalar_one_or_none() is not None:
                    raise click.ClickException("A user with this email already exists.")

                teacher = Teacher(
                    email=normalized_email,
                    password_hash=hash_password(password),
                    role=typed_role,
                )
                db.add(teacher)
                await db.commit()
                await db.refresh(teacher)
                return teacher
            except (OperationalError, ProgrammingError) as exc:
                _raise_schema_hint(exc)

    created = asyncio.run(_insert())
    click.echo(f"Created user: {created.email} ({created.role}) id={created.id}")


@cli.command("set-password")
@click.option("--email", required=True, help="Existing user email.")
@click.option(
    "--password",
    prompt=True,
    hide_input=True,
    confirmation_prompt=True,
    help="New password (min length: 12).",
)
def set_password(email: str, password: str) -> None:
    """Reset password for an existing user account."""
    from app.models.teacher import Teacher
    from app.services.crypto import hash_password

    if len(password) < 12:
        raise click.ClickException("Password must be at least 12 characters long.")

    normalized_email = email.strip().lower()

    async def _update() -> None:
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            try:
                result = await db.execute(
                    select(Teacher).where(func.lower(Teacher.email) == normalized_email)
                )
                teacher = result.scalar_one_or_none()
                if teacher is None:
                    raise click.ClickException("No user found with this email.")

                teacher.password_hash = hash_password(password)
                await db.commit()
            except (OperationalError, ProgrammingError) as exc:
                _raise_schema_hint(exc)

    asyncio.run(_update())
    click.echo(f"Password updated for user: {normalized_email}")


@cli.command("run-retention")
@click.option("--dry-run", is_flag=True, default=False, help="Print actions without DB writes.")
def run_retention(dry_run: bool) -> None:
    """
    Soft-delete exams whose retention_until date has passed.

    Designed to be called by an EXTERNAL cron job (not in-process scheduler).
    Safe to run multiple times — idempotent (already deleted rows are skipped).
    """
    from app.models.exam import Exam
    from app.services.retention import run as _run

    count = asyncio.run(_run(dry_run=dry_run))

    if dry_run:
        click.echo(f"[dry-run] Would soft-delete {count} exam(s).")
    else:
        click.echo(f"Soft-deleted {count} exam(s) past retention date.")


if __name__ == "__main__":
    cli()
