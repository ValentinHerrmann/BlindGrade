"""Async Tectonic LaTeX compilation service."""
from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

# Hard timeout for a single compilation job
COMPILE_TIMEOUT_SECONDS = 30


class CompilationError(Exception):
    """Raised when Tectonic exits non-zero or the process fails."""


async def compile_latex(latex_source: str) -> bytes:
    """
    Compile *latex_source* with Tectonic and return raw PDF bytes.

    Security properties:
    - ``--untrusted`` flag ALWAYS passed: disables \\write18, \\input outside
      working dir, and network access within Tectonic.
    - LaTeX source NEVER logged at any level, in any environment.
    - Temp directory ALWAYS removed in finally block (no leaks on timeout/exception).
    - 30-second hard timeout via asyncio.wait_for.

    Raises:
        CompilationError: if Tectonic exits non-zero.
        asyncio.TimeoutError: if compilation exceeds COMPILE_TIMEOUT_SECONDS.
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="blindgrade-latex-"))
    try:
        tex_file = tmpdir / "main.tex"
        tex_file.write_text(latex_source, encoding="utf-8")

        proc = await asyncio.create_subprocess_exec(
            "tectonic",
            "--untrusted",  # MANDATORY — disables shell escape, network, path traversal
            str(tex_file),
            "--outdir", str(tmpdir),
            "--keep-logs",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(tmpdir),
        )

        try:
            _stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=COMPILE_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise

        if proc.returncode != 0:
            # Log stderr (compilation diagnostics) but NOT the latex source
            logger.warning(
                "Tectonic compilation failed (exit %d). stderr: %s",
                proc.returncode,
                stderr.decode(errors="replace")[:2000],  # Truncate long diagnostics
            )
            raise CompilationError(f"Tectonic exited with code {proc.returncode}.")

        pdf_path = tmpdir / "main.pdf"
        if not pdf_path.exists():
            raise CompilationError("Tectonic succeeded but main.pdf not found.")

        return pdf_path.read_bytes()

    finally:
        # Always remove temp dir — no temp files left behind in any code path
        shutil.rmtree(tmpdir, ignore_errors=True)
