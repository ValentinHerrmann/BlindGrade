#!/usr/bin/env node
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
 * Usage:  node scripts/verify-sri.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// TODO: implement hash verification logic
// 1. Load sri-manifest.json
// 2. For each wasm entry: read static/wasm/<name>.wasm, compute sha256, compare
// 3. For each js entry: locate built chunk, compute sha384, compare
// 4. console.error + process.exit(1) on any mismatch

console.log('SRI verification script — implementation pending.');
