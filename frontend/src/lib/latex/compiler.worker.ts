import '../../../scripts/fetch-interceptor.js';

import { BusyTexRunner, XeLatex, isPackageCached } from 'texlyre-busytex';

let runner: BusyTexRunner | null = null;
let xelatex: XeLatex | null = null;

async function initRunner(onStatus: (status: string) => void) {
  if (!runner) {
    const packages = [
      '/core/busytex/texlive-basic.js',
      '/core/busytex/texlive-recommended.js',
      '/core/busytex/texlive-extra.js'
    ];
    
    let allCached = true;
    for (const pkg of packages) {
      if (!(await isPackageCached(pkg))) {
        allCached = false;
        break;
      }
    }
    
    if (!allCached) {
      onStatus('downloading');
    } else {
      onStatus('compiling');
    }

    runner = new BusyTexRunner({ 
      busytexBasePath: '/core/busytex',
      preloadDataPackages: packages
    });
    await runner.initialize();
    xelatex = new XeLatex(runner);
  } else {
    onStatus('compiling');
  }
}

let compileQueue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent) => {
  const { id, latexSource } = e.data;
  
  compileQueue = compileQueue.then(async () => {
    try {
      await initRunner((status) => {
        self.postMessage({ id, status });
      });
      
      if (!xelatex) {
        throw new Error("XeLatex engine failed to initialize");
      }

      // Fetch asset index
      const indexRes = await fetch('/latex-assets/index.json');
      if (!indexRes.ok) {
        console.warn("Failed to load latex-assets index.json. Assets may be missing.");
      }
      const assetPaths: string[] = indexRes.ok ? await indexRes.json() : [];

      // Fetch all assets
      const filesArrays = await Promise.all(
        assetPaths.map(async (path) => {
          const res = await fetch(`/latex-assets/${path}`);
          const buffer = await res.arrayBuffer();
          const content = new Uint8Array(buffer);
          const files = [{ path, content }];
          
          // LaTeX's \RequirePackage{struktex} looks in the root or TEXINPUTS.
          // If it's a sty file, put a copy at the root so it can be found.
          if (path.startsWith('sty/') && path.endsWith('.sty')) {
            files.push({ path: path.replace('sty/', ''), content });
          }
          
          return files;
        })
      );
      const additionalFiles = filesArrays.flat();

      const result = await xelatex.compile({
        input: latexSource,
        additionalFiles
      });
      
      console.log("Compilation finished. PDF Bytes:", result.pdf?.length);
      if (!result.success) {
        console.error("Compilation LOG error:", result.log);
      }

      if (result.success && result.pdf) {
        self.postMessage({ id, success: true, pdfBytes: result.pdf });
      } else {
        self.postMessage({ id, success: false, error: result.log || "Compilation failed" });
      }
    } catch (error: any) {
      self.postMessage({ id, success: false, error: error.message || "Unknown error in compilation worker" });
    }
  });
};
