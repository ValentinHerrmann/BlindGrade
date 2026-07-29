// @ts-nocheck
(function () {
  const globalScope = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
  if (globalScope.__busytex_fetch_intercepted__) return;
  globalScope.__busytex_fetch_intercepted__ = true;

  const originalFetch = globalScope.fetch;
  let chunkManifestPromise = null;

  function getChunkManifest() {
    if (!chunkManifestPromise) {
      chunkManifestPromise = originalFetch('/core/busytex/chunk-manifest.json')
        .then(async (res) => {
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            return await res.json();
          }
          return {};
        })
        .catch(() => ({}));
    }
    return chunkManifestPromise;
  }

  globalScope.fetch = async function (...args) {
    const requestTarget = args[0];
    const urlStr = typeof requestTarget === 'string'
      ? requestTarget
      : (requestTarget && typeof requestTarget === 'object' && 'url' in requestTarget ? requestTarget.url : String(requestTarget));

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
              ? response.body.pipeThrough(new DecompressionStream('gzip'))
              : response.body;

            const contentType = pathname.endsWith('.wasm')
              ? 'application/wasm'
              : (pathname.endsWith('.js') ? 'application/javascript' : (response.headers.get('content-type') || 'application/octet-stream'));

            const headers = new Headers(response.headers);
            headers.delete('content-length');
            headers.delete('content-encoding');
            headers.set('Content-Type', contentType);

            return new Response(body, {
              status: response.status,
              statusText: response.statusText,
              headers: headers
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

            const contentType = pathname.endsWith('.wasm')
              ? 'application/wasm'
              : (pathname.endsWith('.js') ? 'application/javascript' : (responses[0].headers.get('content-type') || 'application/octet-stream'));

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
})();
