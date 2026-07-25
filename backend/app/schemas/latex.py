"""Pydantic model for LaTeX compilation requests.

SECURITY: __repr__ is overridden to prevent LaTeX source from appearing in:
  - Exception tracebacks
  - Framework debug logging
  - APM / Sentry error reports
  - Any log at any level in any environment

There is no env-var toggle for this. The redaction is unconditional.
"""
from __future__ import annotations

from pydantic import BaseModel, field_validator


class LaTeXRequest(BaseModel):
    latex: str

    @field_validator("latex")
    @classmethod
    def check_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("LaTeX source must not be empty.")
        return v

    def __repr__(self) -> str:
        # Intentionally does NOT include the latex field value.
        return "LaTeXRequest(<redacted>)"

    def __str__(self) -> str:
        return self.__repr__()
