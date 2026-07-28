/**
 * LaTeX syntax highlighter for static/read-only code displays.
 * Tokenizes LaTeX string and outputs HTML with syntax-highlighted <span> tags.
 */

export interface LatexToken {
  type: 'comment' | 'keyword' | 'macro' | 'bracket' | 'string' | 'number' | 'plain';
  text: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function tokenizeLatex(code: string): LatexToken[] {
  const tokens: LatexToken[] = [];
  let pos = 0;

  while (pos < code.length) {
    const sub = code.slice(pos);

    // Comment
    const commentMatch = sub.match(/^%.*/);
    if (commentMatch) {
      tokens.push({ type: 'comment', text: commentMatch[0] });
      pos += commentMatch[0].length;
      continue;
    }

    // Keyword (\begin, \end)
    const keywordMatch = sub.match(/^\\(?:begin|end)\b/);
    if (keywordMatch) {
      tokens.push({ type: 'keyword', text: keywordMatch[0] });
      pos += keywordMatch[0].length;
      continue;
    }

    // Macro / Command (\cmdname or \.)
    const macroMatch = sub.match(/^\\(?:[a-zA-Z]+|.)/);
    if (macroMatch) {
      tokens.push({ type: 'macro', text: macroMatch[0] });
      pos += macroMatch[0].length;
      continue;
    }

    // Brackets
    const bracketMatch = sub.match(/^[{}[\]]/);
    if (bracketMatch) {
      tokens.push({ type: 'bracket', text: bracketMatch[0] });
      pos += bracketMatch[0].length;
      continue;
    }

    // Math strings ($...$ or $$...$$)
    const mathMatch = sub.match(/^\$+/);
    if (mathMatch) {
      tokens.push({ type: 'string', text: mathMatch[0] });
      pos += mathMatch[0].length;
      continue;
    }

    // Numbers
    const numberMatch = sub.match(/^\d+(?:\.\d+)?/);
    if (numberMatch) {
      tokens.push({ type: 'number', text: numberMatch[0] });
      pos += numberMatch[0].length;
      continue;
    }

    // Plain text (consume 1 char or rest of plain text up to next special char)
    const plainMatch = sub.match(/^[^%\\{}[\]$\d]+/);
    if (plainMatch) {
      tokens.push({ type: 'plain', text: plainMatch[0] });
      pos += plainMatch[0].length;
    } else {
      tokens.push({ type: 'plain', text: code[pos] });
      pos += 1;
    }
  }

  return tokens;
}

export function highlightLatexToHtml(code: string): string {
  const tokens = tokenizeLatex(code);
  return tokens
    .map((t) => {
      const escaped = escapeHtml(t.text);
      if (t.type === 'plain') return escaped;
      return `<span class="token-${t.type}">${escaped}</span>`;
    })
    .join('');
}
