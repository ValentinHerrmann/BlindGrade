import { describe, it, expect } from 'vitest';
import { parseExerciseScore, formatExerciseLatex } from '../src/lib/latex/scoreParser';

describe('LaTeX Score Parser (parseExerciseScore)', () => {
  it('parses \\Lmulti tags as 1.0 point each', () => {
    const latex = `
\\begin{Aufgabe}{Grundlagen}
Wie oft wird der Inhalt einer For-Schleife mit dem folgenden Kopf durchlaufen?
\\emph{for(int i = 1; i < 10; i += 2)}

\\LoesungMulti[4]{
  \\Lmulti{5}
  \\multi{9}
  \\multi{10}
  \\multi{4}
}
\\end{Aufgabe}
    `;
    expect(parseExerciseScore(latex)).toBe(1.0);
  });

  it('parses multiple \\Lmulti tags', () => {
    const latex = `
\\begin{Aufgabe}{MC Multiple}
Wähle alle richtigen Aussagen:
\\LoesungMulti[2]{
  \\Lmulti{Option A}
  \\Lmulti{Option B}
  \\multi{Option C}
}
\\end{Aufgabe}
    `;
    expect(parseExerciseScore(latex)).toBe(2.0);
  });

  it('parses \\BE, \\hBE, and \\qBE tags', () => {
    const latex = `
\\begin{Aufgabe}{Punkte}
Teil A \\BE
Teil B \\hBE
Teil C \\qBE
\\end{Aufgabe}
    `;
    expect(parseExerciseScore(latex)).toBe(1.75);
  });

  it('respects manual score override \\begin{Aufgabe}[N]', () => {
    const latex = `
\\begin{Aufgabe}[5]{Overridden Score}
Teil A \\BE
\\end{Aufgabe}
    `;
    expect(parseExerciseScore(latex)).toBe(5);
  });

  it('returns 0 for empty or tagless latex', () => {
    expect(parseExerciseScore('')).toBe(0);
    expect(parseExerciseScore('Just text without score tags')).toBe(0);
  });
});

describe('formatExerciseLatex', () => {
  it('wraps un-wrapped latex in \\begin{Aufgabe} ... \\end{Aufgabe}', () => {
    const result = formatExerciseLatex('Berechne 2+2.', 'Test');
    expect(result).toContain('\\begin{Aufgabe}{Test}');
    expect(result).toContain('\\end{Aufgabe}');
  });
});
