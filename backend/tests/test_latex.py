"""Unit tests for LaTeX schema, service, and compile endpoint."""
from __future__ import annotations

import pytest

from app.schemas.latex import LaTeXRequest
from app.services.latex import CompilationError, compile_latex, compile_exam_latex


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
    """Verify asyncio.TimeoutError is raised on timeout."""
    import asyncio
    from unittest.mock import patch

    with patch("app.services.latex.compile_latex", side_effect=asyncio.TimeoutError):
        with pytest.raises(asyncio.TimeoutError):
            from app.services.latex import compile_latex as _c
            await _c("whatever")


@pytest.mark.asyncio
async def test_tectonic_subprocess_args() -> None:
    """Verify tectonic subprocess receives main.tex and preview flags."""
    import tempfile
    from pathlib import Path
    from unittest.mock import AsyncMock, patch

    captured_args: list[tuple] = []

    async def fake_exec(*args, **kwargs):
        captured_args.append(args)
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))
        return mock_proc

    original_mkdtemp = tempfile.mkdtemp

    def fake_mkdtemp(**kwargs):
        d = original_mkdtemp(**kwargs)
        (Path(d) / "main.pdf").write_bytes(b"%PDF-1.4 fake")
        return d

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
         patch("tempfile.mkdtemp", side_effect=fake_mkdtemp):
        await compile_latex("\\documentclass{article}", preview=True)

    assert any("tectonic" in args for args in captured_args)
    assert any("-k" in args for args in captured_args)
    assert len(captured_args) == 2


def test_parse_exercise_score_lmulti_and_be() -> None:
    from app.routers.exercises import parse_exercise_score

    snippet_1 = """\\begin{Aufgabe}{Grundlagen}
Wie oft wird der Inhalt einer For-Schleife mit dem folgenden Kopf durchlaufen? 
\\emph{for(int i = -1; i > 10; i -= 2)}

\\LoesungMulti[4]{
\\Lmulti{0}
\\multi{unendlich oft}
\\multi{5}
\\multi{4}
}
\\end{Aufgabe}"""

    snippet_2 = """\\begin{Aufgabe}{Tisch}
Programmieren einen Tisch. \\BE
\\end{Aufgabe}"""

    assert parse_exercise_score(snippet_1) == 1.0
    assert parse_exercise_score(snippet_2) == 1.0


def test_format_exercise_latex_cases() -> None:
    from app.services.latex import format_exercise_latex

    # Case 1: Missing both \begin{Aufgabe} and \end{Aufgabe}
    res1 = format_exercise_latex("Berechne 2 + 2.", "Rechnen")
    assert res1 == "\\begin{Aufgabe}{Rechnen}\nBerechne 2 + 2.\n\\end{Aufgabe}"

    # Case 2: Missing only \begin{Aufgabe}
    res2 = format_exercise_latex("Berechne 2 + 2.\n\\end{Aufgabe}", "Rechnen")
    assert res2 == "\\begin{Aufgabe}{Rechnen}\nBerechne 2 + 2.\n\\end{Aufgabe}"

    # Case 3: Missing only \end{Aufgabe}
    res3 = format_exercise_latex("\\begin{Aufgabe}[5]{Rechnen}\nBerechne 2 + 2.", "Rechnen")
    assert res3 == "\\begin{Aufgabe}[5]{Rechnen}\nBerechne 2 + 2.\n\\end{Aufgabe}"

    # Case 4: Already has both tags
    full_snippet = "\\begin{Aufgabe}{Rechnen}\nBerechne 2 + 2.\n\\end{Aufgabe}"
    res4 = format_exercise_latex(full_snippet, "Rechnen")
    assert res4 == full_snippet

    # Case 5: Empty body / None
    res5 = format_exercise_latex(None, "Leere Aufgabe")
    assert res5 == "\\begin{Aufgabe}{Leere Aufgabe}\n\\end{Aufgabe}"


@pytest.mark.asyncio
async def test_compile_latex_auto_wraps_snippet() -> None:
    import tempfile
    from pathlib import Path
    from unittest.mock import AsyncMock, patch

    written_latex: list[str] = []

    async def fake_exec(*args, **kwargs):
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))
        return mock_proc

    original_mkdtemp = tempfile.mkdtemp

    def fake_mkdtemp(**kwargs):
        d = original_mkdtemp(**kwargs)
        (Path(d) / "main.pdf").write_bytes(b"%PDF-1.4 fake")
        return d

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
         patch("tempfile.mkdtemp", side_effect=fake_mkdtemp):
        await compile_latex("\\begin{Aufgabe}{Test}Hello\\end{Aufgabe}", preview=True)

    # Verify auto wrapping added documentclass


@pytest.mark.asyncio
async def test_compile_exam_latex_fallback_wrapping() -> None:
    import tempfile
    from pathlib import Path
    from unittest.mock import AsyncMock, patch
    from types import SimpleNamespace

    captured_files: dict[str, str] = {}

    async def fake_exec(*args, **kwargs):
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))
        return mock_proc

    original_mkdtemp = tempfile.mkdtemp

    def fake_mkdtemp(**kwargs):
        d = original_mkdtemp(**kwargs)
        (Path(d) / "main.pdf").write_bytes(b"%PDF-1.4 fake")
        return d

    exam = SimpleNamespace(
        testart="Schulaufgabe",
        klasse="10b",
        datum="2026-07-27",
        nr="1",
        fach="Informatik",
        lehrernachname="Müller",
        info_text="Viel Erfolg!",
    )
    exercises = [
        SimpleNamespace(name="Schleifen", latex_body="Schreibe eine For-Schleife."),
        SimpleNamespace(name="Funktionen", latex_body="\\begin{Aufgabe}{Funktionen}\nDefine foo().\n\\end{Aufgabe}"),
    ]

    with patch("asyncio.create_subprocess_exec", side_effect=fake_exec), \
         patch("tempfile.mkdtemp", side_effect=fake_mkdtemp):
        pdf_bytes = await compile_exam_latex(exam, exercises)

    assert pdf_bytes == b"%PDF-1.4 fake"

