/**
 * verify-sri.mjs
 *
 * Build-time SRI verification script.
 * Reads static/sri-manifest.json and verifies:
 *   - "wasm" section: each entry's hash matches the vendored blob in static/wasm/
 *   - "js" section: each entry's hash matches the built bundle in build/assets/
 *
 * Exits with code 1 on any mismatch (CI will catch this).
 *
 * Usage: node scripts/verify-sri.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const manifestPath = join(root, 'static', 'sri-manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`Manifest file not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
let hasErrors = false;

// 1. Verify WASM section
if (manifest.wasm) {
  for (const [pkg, expectedHash] of Object.entries(manifest.wasm)) {
    if (expectedHash.includes('PLACEHOLDER')) {
      console.warn(`[SRI Warning] ${pkg} has placeholder hash.`);
      continue;
    }
    // Clean name from package key
    const fileName = pkg.split('@')[0] + '.wasm';
    const wasmPath = join(root, 'static', 'wasm', fileName);
    if (!existsSync(wasmPath)) {
      console.error(`Missing WASM file for ${pkg} at ${wasmPath}`);
      hasErrors = true;
      continue;
    }
    const buffer = readFileSync(wasmPath);
    const hash = 'sha256-' + createHash('sha256').update(buffer).digest('hex');
    if (hash !== expectedHash) {
      console.error(`Mismatch for WASM ${pkg}: expected ${expectedHash}, got ${hash}`);
      hasErrors = true;
    } else {
      console.log(`✓ Verified WASM ${pkg}`);
    }
  }
}

// 2. Verify JS section
if (manifest.js) {
  const buildAssetsDir = join(root, 'build', 'assets');
  for (const [pkg, expectedHash] of Object.entries(manifest.js)) {
    if (expectedHash.includes('PLACEHOLDER')) {
      console.warn(`[SRI Warning] ${pkg} has placeholder hash.`);
      continue;
    }
    if (!existsSync(buildAssetsDir)) {
      console.warn(`[SRI Warning] Build assets dir not found at ${buildAssetsDir}. Skipping JS bundle check.`);
      continue;
    }
    // Search for asset file matching package name prefix
    const files = readdirSync(buildAssetsDir);
    const matchingFile = files.find((f) => f.startsWith(pkg.split('@')[0]));
    if (!matchingFile) {
      console.error(`Missing JS bundle for ${pkg} in ${buildAssetsDir}`);
      hasErrors = true;
      continue;
    }
    const buffer = readFileSync(join(buildAssetsDir, matchingFile));
    const hash = 'sha384-' + createHash('sha384').update(buffer).digest('base64');
    if (hash !== expectedHash) {
      console.error(`Mismatch for JS bundle ${pkg}: expected ${expectedHash}, got ${hash}`);
      hasErrors = true;
    } else {
      console.log(`✓ Verified JS ${pkg}`);
    }
  }
}

if (hasErrors) {
  console.error('SRI Verification failed.');
  process.exit(1);
} else {
  console.log('SRI verification complete.');
}
