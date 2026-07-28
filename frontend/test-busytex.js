import { BusyTexRunner } from 'texlyre-busytex';
import fs from 'fs';
import path from 'path';

async function run() {
  const runner = new BusyTexRunner({
    busytexBasePath: path.resolve('./static/core/busytex'),
    preloadDataPackages: [
      path.resolve('./static/core/busytex/texlive-basic.js'),
      path.resolve('./static/core/busytex/texlive-recommended.js'),
      path.resolve('./static/core/busytex/texlive-extra.js')
    ]
  });

  console.log("Loading runner...");
  await runner.initialize();

  const latexSource = `\\documentclass[a4paper]{article}
\\usepackage[sans,punkte]{sty/Schulaufgabe}
\\usepackage{bbding}
\\usepackage{pifont}
\\usepackage{fontspec}
\\usepackage{framed}
\\usepackage{enumitem}
\\usetikzlibrary{shapes.geometric, arrows}
\\usepackage{sty/tikz-uml}
\\neverindent
\\WarningsOff
\\begin{document}
\\Testart{Vorschau}
\\Klasse{10a}
\\Datum{Vorschau}
\\Nr{1}

\\begin{Aufgabe}{}
\\end{Aufgabe}

\\end{document}`;

  // Load additional files
  const indexStr = fs.readFileSync('./static/latex-assets/index.json', 'utf-8');
  const assetPaths = JSON.parse(indexStr);

  const additionalFiles = [];
  for (const asset of assetPaths) {
    const content = fs.readFileSync(`./static/latex-assets/${asset}`);
    additionalFiles.push({ path: asset, content: new Uint8Array(content) });
    if (asset.startsWith('sty/') && asset.endsWith('.sty')) {
      additionalFiles.push({ path: asset.replace('sty/', ''), content: new Uint8Array(content) });
    }
  }

  console.log("Compiling...");
  const result = await runner.compile({
    input: latexSource,
    additionalFiles
  });

  if (result.success) {
    console.log("Success! PDF bytes:", result.pdf.length);
  } else {
    console.log("Failed!");
    console.log(result.log.slice(-2000));
  }
  process.exit(0);
}

run().catch(err => console.error(err));
