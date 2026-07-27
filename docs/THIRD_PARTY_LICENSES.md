# Third-Party Dependencies and Subresource Integrity (SRI) Manifest

This document details all third-party software components, licenses, and Subresource Integrity (SRI) hashes used in Examance.

---

## 1. WebAssembly (WASM) Modules & Vendored Assets

| Package | Version | License | Integrity Hash (SHA-256) |
|---|---|---|---|
| **argon2-browser** | 1.18.0 | MIT | `sha256-PLACEHOLDER_FILL_AFTER_VENDORING` |
| **opencv.js** | 4.10.0 | Apache 2.0 | `sha256-PLACEHOLDER_FILL_AFTER_VENDORING` |
| **zxing-wasm** | 1.2.3 | MIT | `sha256-PLACEHOLDER_FILL_AFTER_VENDORING` |

*Integrity Verification:* All WASM modules are verified at runtime via `fetchAndVerifyWasm()` in `$lib/crypto/sri.ts`. Loading is immediately aborted if the computed SHA-256 hash fails to match `static/sri-manifest.json`.

---

## 2. Frontend JavaScript Libraries

| Library | Version | License | Purpose |
|---|---|---|---|
| **SvelteKit** | 2.5.0 | MIT | Static application framework |
| **Dexie.js** | 4.0.0 | Apache 2.0 | Typed IndexedDB wrapper |
| **fflate** | 0.8.2 | MIT | High-performance DEFLATE compression in workers |
| **qrcode** | 1.5.3 | MIT | QR code data URL generator |

---

## 3. Backend Python Packages

| Package | Version | License | Purpose |
|---|---|---|---|
| **FastAPI** | 0.111.0 | MIT | Web API framework |
| **SQLAlchemy** | 2.0.0 | MIT | Async ORM & database interface |
| **argon2-cffi** | 23.1.0 | MIT | Argon2id password hashing |
| **PyJWT** | 2.8.0 | MIT | Secure JWT encoding & decoding |
| **Tectonic** | Latest | MIT | Standalone LaTeX compiler invoked with `--untrusted` |
