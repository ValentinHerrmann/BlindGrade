"""FastAPI application factory, middleware registration, lifespan."""
from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.middleware.body_limit import BodyLimitMiddleware
from app.middleware.cors import add_cors_middleware
from app.middleware.csp import CSPMiddleware
from app.middleware.rate_limit import limiter
from app.routers import admin, auth, compile, exams, exercises, students, submissions


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan — run startup/shutdown logic here."""
    # Future: warm up DB connection pool, verify Tectonic binary exists, etc.
    yield
    # Shutdown: close engine
    from app.database import engine
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="BlindGrade API",
        version="0.1.0",
        description="Privacy-first anonymous exam grading backend.",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # Rate limiter state
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

    # Middleware — registration order matters (last added = outermost)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CSPMiddleware)
    add_cors_middleware(app)  # Must be after BodyLimit so CORS headers appear on 413 too

    # Routers
    API_PREFIX = "/api/v1"
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(compile.router, prefix=API_PREFIX)
    app.include_router(exams.router, prefix=API_PREFIX)
    app.include_router(exercises.router, prefix=API_PREFIX)
    app.include_router(students.router, prefix=API_PREFIX)
    app.include_router(submissions.router, prefix=API_PREFIX)
    app.include_router(admin.router, prefix=API_PREFIX)

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()
