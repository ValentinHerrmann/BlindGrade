"""Alembic environment configuration."""
from logging.config import fileConfig
from configparser import NoSectionError

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.database import Base  # noqa: F401 — ensures all models are registered
# Import all models so Alembic autogenerate detects them
import app.models.teacher          # noqa: F401
import app.models.invite            # noqa: F401
import app.models.exam              # noqa: F401
import app.models.exercise          # noqa: F401
import app.models.student_identity  # noqa: F401
import app.models.scan_submission   # noqa: F401
import app.models.audit_log         # noqa: F401

config = context.config

# Use runtime DB config from environment-backed settings.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL_SYNC)

if config.config_file_name is not None:
    try:
        fileConfig(config.config_file_name)
    except (KeyError, NoSectionError):
        # Logging sections are optional for local/dev setups.
        pass

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_num_dim=64,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_num_dim=64,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
