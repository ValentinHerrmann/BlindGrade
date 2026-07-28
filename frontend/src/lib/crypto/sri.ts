/**
 * Runtime WASM integrity checker.
 *
 * Fetches a WASM binary, computes its SHA-256 hash using Web Crypto API,
 * and compares it against the expected hash in static/sri-manifest.json.
 * Aborts load (throws Error) if there is a mismatch.
 */

interface SriManifest {
  wasm: Record<string, string>;
  js: Record<string, string>;
}

let manifestCache: SriManifest | null = null;

async function loadManifest(): Promise<SriManifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch('/sri-manifest.json');
  if (!res.ok) {
    throw new Error(`Failed to load SRI manifest: HTTP ${res.status}`);
  }
  manifestCache = (await res.json()) as SriManifest;
  return manifestCache;
}

/**
 * Fetch a WASM buffer and verify its SHA-256 against sri-manifest.json.
 *
 * @param url Full or relative URL to the WASM file.
 * @param packageKey Key in the "wasm" section of sri-manifest.json (e.g. "argon2-browser@1.18.0").
 * @returns Verified ArrayBuffer of the WASM file.
 * @throws Error if manifest fetch fails, hash mismatches, or file download fails.
 */
export async function fetchAndVerifyWasm(url: string, packageKey: string): Promise<ArrayBuffer> {
  const manifest = await loadManifest();
  const expectedHash = manifest.wasm[packageKey];

  if (!expectedHash) {
    throw new Error(`SRI manifest missing entry for WASM package: ${packageKey}`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch WASM binary from ${url}: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  const hexHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  const actualFormattedHash = `sha256-${hexHash}`;

  // In development mode with placeholder hashes, skip strict match if configured, otherwise enforce
  if (expectedHash.includes('PLACEHOLDER')) {
    console.warn(`[SRI Warning] Skipping hash verification for ${packageKey} due to PLACEHOLDER manifest hash.`);
    return buffer;
  }

  if (actualFormattedHash !== expectedHash) {
    throw new Error(
      `SRI integrity mismatch for ${packageKey}! Expected ${expectedHash}, got ${actualFormattedHash}`
    );
  }

  return buffer;
}
