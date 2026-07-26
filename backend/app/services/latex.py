"""Async Tectonic LaTeX compilation service."""
from __future__ import annotations

import asyncio
import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PREVIEW_TIMEOUT_SECONDS = 30
COMPILE_TIMEOUT_SECONDS = 120

ASSETS_DIR = Path(__file__).resolve().parents[2] / "latex-assets"
if not ASSETS_DIR.exists():
    ASSETS_DIR = Path("latex-assets")


class CompilationError(Exception):
    """Raised when Tectonic exits non-zero or the process fails."""


async def compile_latex(
    latex_source: str,
    extra_files: dict[str, str] | None = None,
    preview: bool = True,
) -> bytes:
    """
    Compile *latex_source* with Tectonic and return raw PDF bytes.

    Copies sty/ and img/ from ASSETS_DIR into temp working directory.
    """
    tmpdir = Path(tempfile.mkdtemp(prefix="blindgrade-latex-"))
    timeout = PREVIEW_TIMEOUT_SECONDS if preview else COMPILE_TIMEOUT_SECONDS
    try:
        # Copy style and image assets if available
        if ASSETS_DIR.exists():
            for item in ASSETS_DIR.iterdir():
                dest = tmpdir / item.name
                if item.is_dir():
                    shutil.copytree(item, dest, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, dest)

        # Write extra files (e.g. exercise fragments)
        if extra_files:
            for rel_path, content in extra_files.items():
                target_path = tmpdir / rel_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(content, encoding="utf-8")

        tex_file = tmpdir / "main.tex"
        tex_file.write_text(latex_source, encoding="utf-8")

        cmd = [
            "tectonic",
            "-k",
            str(tex_file),
            "--outdir",
            str(tmpdir),
            "--keep-logs",
        ]

        passes = 2
        for pass_idx in range(passes):
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(tmpdir),
            )

            try:
                _stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                raise

            if proc.returncode != 0:
                err_snippet = stderr.decode(errors="replace")[:1000]
                logger.warning(
                    "Tectonic compilation pass %d failed (exit %d). stderr: %s",
                    pass_idx + 1,
                    proc.returncode,
                    err_snippet,
                )
                raise CompilationError(
                    f"Tectonic compilation pass {pass_idx + 1} failed (exit {proc.returncode}): {err_snippet}"
                )

        pdf_path = tmpdir / "main.pdf"
        if not pdf_path.exists():
            raise CompilationError("Tectonic succeeded but main.pdf not found.")

        return pdf_path.read_bytes()

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def compile_exam_latex(
    exam_model: Any,
    exercises: list[Any],
    show_answers: bool = False,
) -> bytes:
    """
    Build complete LaTeX document for an Exam model and compile it.
    """
    extra_files: dict[str, str] = {}
    exercise_inputs: list[str] = []

    for idx, ex in enumerate(exercises):
        filename = f"exercises/ex_{idx + 1}.tex"
        latex_body = ex.latex_body or f"\\begin{{Aufgabe}}{{{ex.name or f'Aufgabe {idx + 1}'}}}\n\\end{{Aufgabe}}"
        extra_files[filename] = latex_body
        exercise_inputs.append(f"\\input{{{filename}}}")

    opts = ["sans", "punkte"]
    if show_answers:
        opts.append("antworten")
    opts_str = ",".join(opts)

    testart = exam_model.testart or "Kurzarbeit"
    klasse = exam_model.klasse or ""
    datum = exam_model.datum or ""
    nr = exam_model.nr or "1"
    fach = exam_model.fach or "Informatik"
    lehrernachname = exam_model.lehrernachname or ""
    info_text = exam_model.info_text or ""

    inputs_str = "\n\n".join(exercise_inputs)

    main_tex = f"""\\documentclass[a4paper]{{article}}
\\usepackage[{opts_str}]{{sty/Schulaufgabe}}

\\Info{{{info_text}}}
\\Fach{{{fach}}}
\\Lehrernachname{{{lehrernachname}}}
\\usepackage{{bbding}}
\\usepackage{{pifont}}
\\usepackage{{fontspec}}
\\usepackage{{framed}}
\\usepackage{{enumitem}}

\\usetikzlibrary{{shapes.geometric, arrows}}
\\usepackage{{sty/tikz-uml}}

\\neverindent
\\WarningsOff

\\begin{{document}}
\\Testart{{{testart}}}
\\Klasse{{{klasse}}}
\\Datum{{{datum}}}
\\Nr{{{nr}}}

{inputs_str}

\\end{{document}}
"""

    return await compile_latex(main_tex, extra_files=extra_files, preview=False)
