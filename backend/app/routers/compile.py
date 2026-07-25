"""Compile router — POST /api/v1/compile/latex"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.dependencies import get_current_teacher
from app.middleware.rate_limit import limiter
from app.models.teacher import Teacher
from app.schemas.latex import LaTeXRequest
from app.services.latex import CompilationError, compile_latex

router = APIRouter(prefix="/compile", tags=["compile"])


@router.post("/latex")
@limiter.limit("10/minute")
async def compile_latex_endpoint(
    request: Request,  # Required by slowapi for rate limiting
    body: LaTeXRequest,
    _teacher: Teacher = Depends(get_current_teacher),
) -> Response:
    """
    Compile LaTeX source to PDF via Tectonic.

    Rate limited: 10 req/min per IP.
    Body limit: 2 MB (enforced by BodyLimitMiddleware).
    LaTeX source is NEVER logged — see LaTeXRequest.__repr__ and latex service.
    """
    try:
        pdf_bytes = await compile_latex(body.latex)
    except TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Compilation timed out.",
            headers={"code": "ERR_COMPILE_TIMEOUT"},
        )
    except CompilationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
            headers={"code": "ERR_COMPILE_FAILED"},
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=\"output.pdf\""},
    )
