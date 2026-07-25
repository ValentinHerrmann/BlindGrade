"""Content Security Policy header injection middleware."""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings


class CSPMiddleware(BaseHTTPMiddleware):
    """Inject a strict Content-Security-Policy header on every response."""

    def _build_csp(self) -> str:
        backend_origins = "; ".join(
            f"connect-src 'self' {o}" for o in settings.CORS_ALLOWED_ORIGINS
        )
        # Inline styles are permitted only for SvelteKit hydration.
        # script-src 'self' — no eval, no inline scripts.
        return (
            "default-src 'none'; "
            "script-src 'self'; "
            f"connect-src 'self' {' '.join(settings.CORS_ALLOWED_ORIGINS)}; "
            "worker-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )

    async def dispatch(self, request: Request, call_next: object) -> Response:
        response: Response = await call_next(request)  # type: ignore[operator]
        response.headers["Content-Security-Policy"] = self._build_csp()
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response
