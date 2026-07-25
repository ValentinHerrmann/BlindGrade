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
from sqlalchemy import select, update

from app.config import settings  # noqa: F401 — validates config at import


@click.group()
def cli() -> None:
    """BlindGrade management commands."""


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
            record = InviteToken(
                token_hash=token_hash,
                created_by=created_by_uuid,
                expires_at=expires_at,
            )
            db.add(record)
            await db.commit()

    asyncio.run(_insert())

    click.echo(f"\n{'='*60}")
    click.echo(f"Invite token (share this ONCE — not stored):\n\n  {raw_token}\n")
    click.echo(f"Expires: {expires_at.isoformat()}")
    click.echo(f"{'='*60}\n")


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
