// Setup WASM & Large Asset fetch interceptor for Cloudflare Pages chunking
const globalScope: any = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
const originalFetch = globalScope.fetch;

interface ManifestEntry {
  chunks: string[];
  gzipped: boolean;
}

let chunkManifestPromise: Promise<Record<string, ManifestEntry>> | null = null;

async function getChunkManifest(): Promise<Record<string, ManifestEntry>> {
  if (!chunkManifestPromise) {
    chunkManifestPromise = originalFetch('/core/busytex/chunk-manifest.json')
      .then(res => res.ok ? res.json() : {})
      .catch(() => ({}));
  }
  return chunkManifestPromise;
}

globalScope.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const requestTarget = args[0];
  const urlStr = typeof requestTarget === 'string'
    ? requestTarget
    : (requestTarget && typeof requestTarget === 'object' && 'url' in requestTarget ? (requestTarget as any).url : String(requestTarget));

  try {
    const parsedUrl = new URL(urlStr, globalScope.location ? globalScope.location.href : 'http://localhost');
    const pathname = parsedUrl.pathname;
    const manifest = await getChunkManifest();

    const entry = manifest[pathname];
    if (entry && entry.chunks && entry.chunks.length > 0) {
      if (entry.chunks.length === 1) {
        const response = await originalFetch(entry.chunks[0], args[1]);
        if (response.ok) {
          const body = entry.gzipped && typeof DecompressionStream !== 'undefined'
            ? response.body?.pipeThrough(new DecompressionStream('gzip'))
            : response.body;

          const contentType = pathname.endsWith('.wasm') ? 'application/wasm' : (response.headers.get('content-type') || 'application/octet-stream');
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
              ...Object.fromEntries(response.headers.entries()),
              'Content-Type': contentType
            }
          });
        }
      } else {
        const responses = await Promise.all(entry.chunks.map(chunkUrl => originalFetch(chunkUrl, args[1])));
        const allOk = responses.every(r => r.ok);
        if (allOk) {
          const combinedStream = new ReadableStream({
            async start(controller) {
              for (const res of responses) {
                if (res.body) {
                  const reader = res.body.getReader();
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    controller.enqueue(value);
                  }
                }
              }
              controller.close();
            }
          });

          const body = entry.gzipped && typeof DecompressionStream !== 'undefined'
            ? combinedStream.pipeThrough(new DecompressionStream('gzip'))
            : combinedStream;

          const contentType = pathname.endsWith('.wasm') ? 'application/wasm' : (responses[0].headers.get('content-type') || 'application/octet-stream');
          return new Response(body, {
            status: 200,
            statusText: 'OK',
            headers: {
              'Content-Type': contentType
            }
          });
        }
      }
    }
  } catch (err) {
    // Fall through to originalFetch on error
  }

  return originalFetch(...args);
};

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
