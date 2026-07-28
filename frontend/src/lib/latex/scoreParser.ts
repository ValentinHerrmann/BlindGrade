/**
 * Pure helper to parse exercise max_points from LaTeX content.
 *
 * Scoring rules:
 * - \begin{Aufgabe}[N] manual override (e.g. \begin{Aufgabe}[10]) -> returns N
 * - Count \BE -> +1.0
 * - Count \Lmulti -> +1.0
 * - Count \hBE -> +0.5
 * - Count \qBE -> +0.25
 */
export function parseExerciseScore(latex: string): number {
  if (!latex) return 0;

  const override = latex.match(/\\begin\{Aufgabe\}\[([\d.]+)\]/);
  if (override && override[1]) {
    const parsed = parseFloat(override[1]);
    if (!isNaN(parsed)) return parsed;
  }

  const beMatches = latex.match(/\\BE\b/g);
  const lmultiMatches = latex.match(/\\Lmulti\b/g);
  const halfMatches = latex.match(/\\hBE\b/g);
  const quartMatches = latex.match(/\\qBE\b/g);

  const full = (beMatches ? beMatches.length : 0) + (lmultiMatches ? lmultiMatches.length : 0);
  const half = halfMatches ? halfMatches.length : 0;
  const quart = quartMatches ? quartMatches.length : 0;

  return full * 1.0 + half * 0.5 + quart * 0.25;
}

/**
 * Ensures LaTeX content is wrapped in \begin{Aufgabe}{<title>} ... \end{Aufgabe}.
 * - If \begin{Aufgabe} is missing, prepends \begin{Aufgabe}{<title>}.
 * - If \end{Aufgabe} is missing, appends \end{Aufgabe}.
 */
export function formatExerciseLatex(latexBody: string | undefined | null, title: string): string {
  let body = latexBody || "";
  let prefix = "";
  let suffix = "";

  if (!body.includes("\\begin{Aufgabe}")) {
    prefix = `\\begin{Aufgabe}{${title}}\n`;
  }
  if (!body.includes("\\end{Aufgabe}")) {
    if (body.length > 0 && !body.endsWith("\n")) {
      suffix = "\n\\end{Aufgabe}";
    } else {
      suffix = "\\end{Aufgabe}";
    }
  }

  return `${prefix}${body}${suffix}`;
}
