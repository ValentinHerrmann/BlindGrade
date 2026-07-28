export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const part1Url = new URL('/core/busytex/busytex.wasm.part1', url.origin);
  const part2Url = new URL('/core/busytex/busytex.wasm.part2', url.origin);

  const [res1, res2] = await Promise.all([
    env.ASSETS.fetch(part1Url),
    env.ASSETS.fetch(part2Url)
  ]);

  if (!res1.ok || !res2.ok) {
    return new Response('WASM parts not found', { status: 404 });
  }

  const { readable, writable } = new TransformStream();

  (async () => {
    try {
      await res1.body.pipeTo(writable, { preventClose: true });
      await res2.body.pipeTo(writable);
    } catch (err) {
      console.error('Streaming error:', err);
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/wasm',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
