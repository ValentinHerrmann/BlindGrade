"""Request body size enforcement middleware."""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings


class BodyLimitMiddleware(BaseHTTPMiddleware):
    """
    Enforce per-route request body size limits.

    Rejects oversized requests with HTTP 413 *before* the body is fully read.
    """

    def _get_limit(self, path: str, method: str) -> int:
        if method not in ("POST", "PATCH", "PUT"):
            return settings.BODY_LIMIT_DEFAULT
        if path.startswith("/api/v1/compile"):
            return settings.BODY_LIMIT_COMPILE
        if "/submissions" in path and method == "POST":
            return settings.BODY_LIMIT_SUBMISSION
        if "/students" in path and method == "POST":
            return settings.BODY_LIMIT_STUDENTS
        return settings.BODY_LIMIT_DEFAULT

    async def dispatch(self, request: Request, call_next: object) -> Response:
        limit = self._get_limit(request.url.path, request.method)
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > limit:
            return JSONResponse(
                status_code=413,
                content={"detail": "Payload too large.", "code": "ERR_PAYLOAD_TOO_LARGE"},
            )
        # Stream body and enforce actual size
        body = b""
        async for chunk in request.stream():
            body += chunk
            if len(body) > limit:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "Payload too large.", "code": "ERR_PAYLOAD_TOO_LARGE"},
                )

        # Re-inject body so downstream handlers can read it
        async def receive() -> dict:  # type: ignore[return]
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive  # type: ignore[attr-defined]
        return await call_next(request)  # type: ignore[operator,return-value]
