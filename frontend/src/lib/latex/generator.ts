/**
 * LaTeX Template Generator.
 *
 * Generates LaTeX document string with TikZ corner fiducial markers for OMR homography alignment,
 * QR code embedding (pseudonym ID + version), human-readable fallback codes, and option shuffling.
 */

import QRCode from 'qrcode';

export async function generateQrDataUrl(text: string, version?: string, fallbackCode?: string): Promise<string> {
  const payload = version && fallbackCode ? `BG:${text}:${version}:${fallbackCode}` : text;
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'H' });
}

export interface ExamConfig {
  title: string;
  courseName?: string;
  preamble?: string;
  pseudonymId: string;
  version: string; // 'A', 'B', 'C', etc.
  fallbackCode: string;
  exercises: {
    title: string;
    latexBody?: string;
    type: 'free_text' | 'mc' | 'sc' | 'tf';
    points: number;
    options?: string[];
    correctAnswers?: number[];
  }[];
}

/**
 * Deterministically shuffle array based on string seed (version letter/id).
 */
export function shuffleOptions<T>(items: T[], seed: string): { shuffled: T[]; mapping: number[] } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  const random = () => {
    let t = (h += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 85), t | 7);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const indexed = items.map((item, idx) => ({ item, idx }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }

  return {
    shuffled: indexed.map((x) => x.item),
    mapping: indexed.map((x) => x.idx),
  };
}

/**
 * Generate pure TikZ drawing code for QR code barcode without filesystem or data URL dependencies.
 */
export function generateQrTikz(
  pseudonymId: string,
  version: string,
  fallbackCode: string
): string {
  const payload = `BG:${pseudonymId}:${version}:${fallbackCode}`;
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const data = qr.modules.data;

  let tikz = `\\begin{tikzpicture}[scale=0.08]\n`;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) {
        const y = size - 1 - row;
        const x = col;
        tikz += `  \\fill[black] (${x},${y}) rectangle (${x + 1},${y + 1});\n`;
      }
    }
  }
  tikz += `\\end{tikzpicture}`;
  return tikz;
}

/**
 * Build clean LaTeX string for the exam cover page and questions with ArUco fiducial corner markers.
 */
export async function generateLatex(config: ExamConfig): Promise<string> {
  const qrTikz = generateQrTikz(config.pseudonymId, config.version, config.fallbackCode);

  let exerciseBlocks = '';

  config.exercises.forEach((ex, idx) => {
    exerciseBlocks += `\n\\section*{Question ${idx + 1}: ${ex.title || `Exercise ${idx + 1}`} (${ex.points} points)}\n`;

    if (ex.latexBody && ex.latexBody.trim()) {
      exerciseBlocks += `${ex.latexBody}\n\n`;
    }

    if (ex.type === 'free_text') {
      exerciseBlocks += `\\vspace{4cm}\n\\hrule\n`;
    } else if (ex.options && ex.options.length > 0) {
      // Deterministically shuffle options based on version if multiple versions
      const { shuffled } = shuffleOptions(ex.options, `${config.version}-${idx}`);
      exerciseBlocks += `\\begin{enumerate}[label=\\square]\n`;
      shuffled.forEach((opt) => {
        exerciseBlocks += `  \\item ${opt}\n`;
      });
      exerciseBlocks += `\\end{enumerate}\n`;
    }
  });

  const customPreamble = config.preamble ? `${config.preamble}\n` : '';

  return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=2cm]{geometry}
\\usepackage{enumitem}
\\usepackage{amsmath,amssymb}
\\usepackage{tikz}
${customPreamble}
% TikZ Fiducial Corner Markers for OMR Homography
\\newcommand{\\FiducialMarker}[2]{%
  \\begin{tikzpicture}[remember picture,overlay]
    \\node[anchor=#1] at (#2) {
      \\begin{tikzpicture}
        \\fill[black] (0,0) rectangle (0.6,0.6);
        \\fill[white] (0.15,0.15) rectangle (0.45,0.45);
        \\fill[black] (0.25,0.25) rectangle (0.35,0.35);
      \\end{tikzpicture}
    };
  \\end{tikzpicture}%
}

\\begin{document}

% Fiducial Markers on 4 Corners
\\FiducialMarker{north west}{current page.north west}
\\FiducialMarker{north east}{current page.north east}
\\FiducialMarker{south west}{current page.south west}
\\FiducialMarker{south east}{current page.south east}

\\begin{center}
  {\\Huge \\textbf{${config.title}}}\\\\
  \\vspace{0.3cm}
  {\\Large Version ${config.version}}\\\\
  \\vspace{0.5cm}

  % Pure TikZ QR Code
  ${qrTikz}\\\\
  \\vspace{0.3cm}
  {\\Large \\texttt{FALLBACK: ${config.version}-${config.fallbackCode}}}
\\end{center}

\\vspace{1cm}
\\hrule
\\vspace{0.5cm}

${exerciseBlocks}

\\end{document}
`;
}
