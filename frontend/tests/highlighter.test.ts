import { describe, it, expect } from 'vitest';
import { tokenizeLatex, highlightLatexToHtml, escapeHtml } from '../src/lib/latex/highlighter';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss & \'test\'")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss &amp; &#039;test&#039;&quot;)&lt;/script&gt;');
  });
});

describe('tokenizeLatex', () => {
  it('identifies comments starting with %', () => {
    const code = '% This is a comment';
    const tokens = tokenizeLatex(code);
    expect(tokens).toEqual([
      { type: 'comment', text: '% This is a comment' }
    ]);
  });

  it('identifies keywords \\begin and \\end', () => {
    const code = '\\begin{Aufgabe}\n\\end{Aufgabe}';
    const tokens = tokenizeLatex(code);
    expect(tokens.filter(t => t.type === 'keyword')).toEqual([
      { type: 'keyword', text: '\\begin' },
      { type: 'keyword', text: '\\end' }
    ]);
  });

  it('identifies macros and commands', () => {
    const code = '\\textbf{Hello} \\section{Test}';
    const tokens = tokenizeLatex(code);
    expect(tokens.filter(t => t.type === 'macro')).toEqual([
      { type: 'macro', text: '\\textbf' },
      { type: 'macro', text: '\\section' }
    ]);
  });

  it('identifies brackets and grouping symbols', () => {
    const code = '{ test [1] }';
    const tokens = tokenizeLatex(code);
    expect(tokens.filter(t => t.type === 'bracket')).toEqual([
      { type: 'bracket', text: '{' },
      { type: 'bracket', text: '[' },
      { type: 'bracket', text: ']' },
      { type: 'bracket', text: '}' }
    ]);
  });

  it('identifies inline math strings', () => {
    const code = '$x + y = 5$';
    const tokens = tokenizeLatex(code);
    expect(tokens.filter(t => t.type === 'string')).toEqual([
      { type: 'string', text: '$' },
      { type: 'string', text: '$' }
    ]);
  });

  it('identifies numeric tokens', () => {
    const code = 'Points: 10.5';
    const tokens = tokenizeLatex(code);
    expect(tokens.filter(t => t.type === 'number')).toEqual([
      { type: 'number', text: '10.5' }
    ]);
  });
});

describe('highlightLatexToHtml', () => {
  it('wraps LaTeX tokens in span elements with token classes', () => {
    const code = '% Comment\n\\begin{center}';
    const html = highlightLatexToHtml(code);
    expect(html).toContain('<span class="token-comment">% Comment</span>');
    expect(html).toContain('<span class="token-keyword">\\begin</span>');
    expect(html).toContain('<span class="token-bracket">{</span>');
    expect(html).toContain('center');
  });
});
