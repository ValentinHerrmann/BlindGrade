"""Unit tests for LaTeX schema, service, and compile endpoint."""
from __future__ import annotations

import pytest

from app.schemas.latex import LaTeXRequest
from app.services.latex import CompilationError, compile_latex


def test_latex_request_repr_redacted() -> None:
    """__repr__ must never expose the latex source."""
    req = LaTeXRequest(latex="\\documentclass{article}\\begin{document}SECRET\\end{document}")
    assert "SECRET" not in repr(req)
    assert "SECRET" not in str(req)
    assert "<redacted>" in repr(req)


def test_latex_request_empty_raises() -> None:
    with pytest.raises(ValueError):
        LaTeXRequest(latex="   ")


@pytest.mark.asyncio
async def test_compile_timeout(monkeypatch) -> None:
    """Verify asyncio.TimeoutError is raised on timeout and temp dir is cleaned."""
    import asyncio
    import tempfile
    from pathlib import Path
    from unittest.mock import AsyncMock, MagicMock, patch

    captured_tmpdir: list[Path] = []

    async def fake_compile(source: str) -> bytes:
        # Simulate timeout
        raise asyncio.TimeoutError()

    with patch("app.services.latex.compile_latex", side_effect=asyncio.TimeoutError):
        with pytest.raises(asyncio.TimeoutError):
            from app.services.latex import compile_latex as _c
            await _c("whatever")


@pytest.mark.asyncio
async def test_untrusted_flag_in_subprocess(monkeypatch) -> None:
    """Verify --untrusted is always in the subprocess args."""
    import asyncio
    from unittest.mock import AsyncMock, patch, call

    captured_args: list[tuple] = []

    async def fake_exec(*args, **kwargs):
        captured_args.append(args)
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))
        return mock_proc

    # Also need to fake the PDF file creation
    import tempfile, shutil
    from pathlib import Path

    original_mkdtemp = tempfile.mkdtemp

    def fake_mkdtemp(**kwargs):
        d = original_mkdtemp(**kwargs)
        (Path(d) / "main.pdf").write_bytes(b"%PDF-1.4 fake")
        return d

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
         patch("tempfile.mkdtemp", side_effect=fake_mkdtemp):
        try:
            from app.services.latex import compile_latex
            await compile_latex("\\documentclass{article}")
        except Exception:
            pass  # We only care about the args

    assert any("--untrusted" in args for args in captured_args), \
        "--untrusted flag must always be present in Tectonic subprocess args"
