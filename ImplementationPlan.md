# BlindGrade — Implementation Plan

> Derived from [`PLAN.md`](./PLAN.md). Where PLAN.md defines *what* and *why*, this document defines *how* — concrete technology choices, file structure, API contracts, data formats, and a task-level breakdown per phase.

---

## Table of Contents
1. [Technology Stack](#1-technology-stack)
2. [Repository Structure](#2-repository-structure)
3. [.bgproj Archive Format](#3-bgproj-archive-format)
4. [Database Schema (SQLAlchemy ORM)](#4-database-schema-sqlalchemy-orm)
5. [API Contract](#5-api-contract)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Phase 1 — Core Security, Cryptography & Auth](#phase-1--core-security-cryptography--auth)
8. [Phase 2 — Local Storage & Single-File Engine](#phase-2--local-storage--single-file-engine)
9. [Phase 3 — FastAPI Backend & Asynchronous Compiler](#phase-3--fastapi-backend--asynchronous-compiler)
10. [Phase 4 — Web Worker Pool, OMR & Hardware Routing](#phase-4--web-worker-pool-omr--hardware-routing)
11. [Phase 5 — UI Integration & End-to-End Validation](#phase-5--ui-integration--end-to-end-validation)
12. [Cross-Cutting Concerns](#12-cross-cutting-concerns)

---

## 1. Technology Stack

### Backend
| Concern | Choice | Reason |
|---|---|---|
| Web framework | **FastAPI** (Python 3.12) | Async-native, OpenAPI generation |
| ORM | **SQLAlchemy 2.x** (async) + **Alembic** | Type-safe, migrations |
| Database | **PostgreSQL 16** (Hybrid Mode) | Robust FK/cascade deletes for erasure |
| Password hashing | **argon2-cffi** | Server-side Argon2id |
| Auth | **PyJWT** (manual implementation) | Direct JWT control, no algorithm-confusion CVEs (replaces `python-jose` which has CVE-2024-33663/33664). `fastapi-users` dropped — thin manual auth layer preferred for full control over security-sensitive flows. |
| CORS | **FastAPI `CORSMiddleware`** | Explicit origin allowlist for Hybrid Mode cross-origin |
| Rate limiting | **slowapi** (Redis-backed in prod, in-memory in dev) | Compilation endpoint protection |
| LaTeX compiler | **Tectonic** (system binary, always invoked with `--untrusted`) | Self-contained, fast, `--untrusted` disables shell escape |
| Scheduled jobs | **External cron** (systemd timer or Kubernetes CronJob) calling a management CLI command | Avoids APScheduler multi-worker duplication problem |
| Task runner | **Makefile** + **uv** (package manager) | Fast installs |
| Containerisation | **Docker** + **docker-compose** | Dev parity with prod |

### Frontend
| Concern | Choice | Reason |
|---|---|---|
| Framework | **SvelteKit** (static adapter) | Small bundle, reactive, no VDOM overhead for canvas-heavy work |
| Language | **TypeScript** | Type safety across crypto/worker boundaries |
| IndexedDB | **Dexie.js v4** | Typed schema, observable queries |
| Crypto | **Web Crypto API** (native) + **argon2-browser** (WASM) | No third-party crypto code paths for AES |
| PDF rendering | **PDF.js** (Mozilla, vendored) | Render scan pages to canvas |
| QR generation | **qrcode** (npm) | Embed pseudonym + version in exam QR |
| QR scanning | **ZXing-wasm** | WASM QR decoder, SIMD-enabled |
| Computer vision | **OpenCV.js** (WASM build) | OMR fiducial + checkbox detection |
| Archive packing | **fflate** (pure JS, not WASM) | Streaming DEFLATE in workers |
| CSV export | **Native** (`Blob` + manual CSV serialization) | No external dependency needed for flat CSV output |
| State management | **Svelte stores** (built-in) | No external store needed at this scale |
| Build | **Vite** | Fast HMR, supports WASM |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | |

### Integrity Verification (SRI)

Two categories of third-party assets require separate handling:

**WASM Binaries** (verified via manual fetch-and-hash at load time):
```json
// static/sri-manifest.json → "wasm" section
{
  "wasm": {
    "argon2-browser@1.18.0": "sha256-...",
    "opencv.js@4.10.0": "sha256-...",
    "zxing-wasm@1.2.3": "sha256-..."
  }
}
```
At runtime, each WASM blob is fetched as `ArrayBuffer`, its SHA-256 is computed via `crypto.subtle.digest`, and compared against the manifest. Load is aborted on mismatch.

**JS Bundles** (verified via native `<script integrity="...">` attribute or import-map integrity):
```json
// static/sri-manifest.json → "js" section
{
  "js": {
    "fflate@0.8.2": "sha384-..."
  }
}
```
The Vite build step verifies all hashes against vendored copies and fails on mismatch.

---

## 2. Repository Structure

```
blindgrade/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI app factory, middleware, lifespan
│   │   ├── config.py              # Settings (pydantic-settings)
│   │   ├── database.py            # Async engine + session factory
│   │   ├── models/
│   │   │   ├── teacher.py
│   │   │   ├── invite.py          # Invite token model
│   │   │   ├── exam.py
│   │   │   ├── exercise.py
│   │   │   ├── student_identity.py
│   │   │   ├── scan_submission.py
│   │   │   └── audit_log.py
│   │   ├── schemas/               # Pydantic request/response models
│   │   │   └── latex.py           # LaTeXRequest with __repr__ redaction
│   │   ├── routers/
│   │   │   ├── auth.py            # /auth/*
│   │   │   ├── exams.py           # /exams/*
│   │   │   ├── students.py        # /students/*
│   │   │   ├── submissions.py     # /submissions/*
│   │   │   ├── compile.py         # /compile (stateless)
│   │   │   └── admin.py           # /admin/* (Admin role only)
│   │   ├── services/
│   │   │   ├── crypto.py          # Server-side Argon2id, HMAC helpers
│   │   │   ├── latex.py           # Async Tectonic wrapper (--untrusted)
│   │   │   ├── retention.py       # CLI command for cron-triggered soft-delete
│   │   │   └── audit.py           # Audit log write helper
│   │   ├── middleware/
│   │   │   ├── csp.py             # CSP header injection
│   │   │   ├── cors.py            # CORSMiddleware config with explicit origins
│   │   │   ├── body_limit.py      # Request body size enforcement
│   │   │   └── rate_limit.py      # slowapi setup
│   │   └── cli.py                 # Management commands (e.g., `run-retention`, `create-invite`)
│   ├── alembic/                   # DB migrations
│   ├── tests/
│   ├── Dockerfile
│   └── pyproject.toml
│
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── crypto/
│   │   │   │   ├── keyDerivation.ts    # Argon2id wrapper → master key
│   │   │   │   ├── sessionKey.ts       # Derive session key from master key + nonce
│   │   │   │   ├── aesGcm.ts          # Encrypt/decrypt blobs (Web Crypto)
│   │   │   │   └── hmac.ts            # Client-side HMAC for pseudonym IDs
│   │   │   ├── db/
│   │   │   │   ├── schema.ts           # Dexie schema definition
│   │   │   │   ├── db.ts              # Dexie instance + open/close
│   │   │   │   ├── hygiene.ts         # clear-on-close (best-effort), session timeout
│   │   │   │   └── migrations.ts      # Dexie version upgrades
│   │   │   ├── archive/
│   │   │   │   ├── packer.ts          # Chunked .bgproj export (streams)
│   │   │   │   ├── unpacker.ts        # Chunked .bgproj import (streams)
│   │   │   │   └── format.ts          # .bgproj header/manifest types
│   │   │   ├── workers/
│   │   │   │   ├── pool.ts            # Worker pool manager
│   │   │   │   ├── qrWorker.ts        # ZXing QR decode worker
│   │   │   │   ├── omrWorker.ts       # OpenCV OMR worker
│   │   │   │   ├── cryptoWorker.ts    # Off-main-thread encrypt/decrypt
│   │   │   │   └── packWorker.ts      # fflate compress/decompress worker
│   │   │   ├── hardware/
│   │   │   │   └── detect.ts          # CPU cores, memory estimate, SIMD probe, dynamic OOM fallback
│   │   │   ├── latex/
│   │   │   │   ├── compiler.ts        # WASM Tectonic (preferred) or server fallback
│   │   │   │   └── generator.ts       # Template → LaTeX string builder
│   │   │   ├── api/
│   │   │   │   └── client.ts          # Typed fetch wrapper (credentials: 'include' for httpOnly cookie)
│   │   │   ├── gdpr/
│   │   │   │   ├── erasure.ts         # Erase student record from IDB + server
│   │   │   │   ├── retention.ts       # expires_at check on project load
│   │   │   │   └── exportAudit.ts     # Log CSV export actions
│   │   │   └── analytics/
│   │   │       ├── stats.ts           # Histogram, std dev, mean
│   │   │       ├── kanonymity.ts      # k≥5 check before display
│   │   │       └── csvExport.ts       # Native CSV serialization for grade export
│   │   ├── routes/
│   │   │   ├── +layout.svelte
│   │   │   ├── +page.svelte           # Dashboard / project selection
│   │   │   ├── unlock/+page.svelte    # Password entry, key derivation
│   │   │   ├── exam/
│   │   │   │   ├── new/+page.svelte
│   │   │   │   └── [id]/
│   │   │   │       ├── +page.svelte   # Exam detail
│   │   │   │       ├── scan/+page.svelte
│   │   │   │       ├── grade/+page.svelte
│   │   │   │       └── stats/+page.svelte
│   │   │   └── settings/+page.svelte  # GDPR notices, breach guidance, timeout config
│   │   ├── stores/
│   │   │   ├── session.ts             # { masterKey, sessionKey, mode } — no access token (httpOnly cookie)
│   │   │   └── project.ts            # { exam, exercises, isDirty }
│   │   └── app.html
│   ├── static/
│   │   ├── wasm/                      # Vendored WASM blobs
│   │   └── sri-manifest.json          # Split: "wasm" and "js" sections
│   ├── tests/
│   ├── vite.config.ts
│   └── package.json
│
├── docs/
│   ├── DPA_template.md
│   ├── breach_response_checklist.md
│   └── THIRD_PARTY_LICENSES.md
│
├── docker-compose.yml
├── PLAN.md
└── ImplementationPlan.md
```

---

## 3. .bgproj Archive Format

A `.bgproj` file is a **DEFLATE-compressed bundle** encrypted with AES-256-GCM. The outer structure:

```
[4 bytes]  Magic: 0x42 0x47 0x50 0x4A  ("BGPJ")
[1 byte]   Format version: 0x01
[16 bytes] Argon2id salt (for key re-derivation)
[12 bytes] AES-GCM nonce (for outer envelope)
[8 bytes]  Ciphertext length (uint64 LE)
[N bytes]  AES-GCM ciphertext of the inner bundle
[16 bytes] AES-GCM authentication tag
```

### Nonce Freshness Requirement (CRITICAL)

AES-GCM is **catastrophically broken** on nonce reuse with the same key. Every export operation — even of the same project with the same password — **must generate a fresh random nonce** via `crypto.getRandomValues(new Uint8Array(12))`.

Since the same password + salt produces the same master key, the Argon2id salt **must also be regenerated on every export**. This guarantees that even re-exports of unchanged data produce a completely new (salt, key, nonce, ciphertext) tuple. The previous salt is discarded; only the new salt is embedded in the file header.

Additionally, each individual inner blob (scan images, PII ciphertexts stored in STUDENT/SUBMISSION records) **must use a freshly random 12-byte IV** per blob per export, generated via `crypto.getRandomValues`. Reusing IVs from a previous session or export is forbidden.

### Atomic Decryption Constraint

The outer AES-GCM authentication tag authenticates the **entire ciphertext as one unit**. The inner framed records have no per-record HMAC. This means:

* The **entire file must be decrypted and authenticated atomically** before any inner record is trusted.
* Partial/streaming decryption of individual records without first verifying the outer GCM tag is **not supported and must never be implemented**.
* If a future version needs partial access (e.g., reading only the manifest), a separate authenticated manifest envelope must be designed as a format-version bump.

### Inner Bundle Structure

The **inner bundle** (plaintext after decryption + authentication) is a sequential stream of framed records:

```
[4 bytes]  Record type (enum: MANIFEST=1, EXAM=2, EXERCISE=3, STUDENT=4, SUBMISSION=5, AUDITLOG=6)
[8 bytes]  Payload length (uint64 LE)
[N bytes]  JSON or binary payload
```

**MANIFEST record** (always first, JSON):
```json
{
  "version": "1.0",
  "created_at": "2026-07-25T18:00:00Z",
  "expires_at": "2027-08-31T00:00:00Z",
  "mode": "local",
  "exam_count": 2,
  "student_count": 58,
  "records_checksum": "<SHA-256 hex of all subsequent record bytes concatenated in order>"
}
```

**Manifest Verification:** After unpacking all records, the unpacker **must** compute `SHA-256` over the raw bytes of all records (type + length + payload, in the order they were read) and compare against `records_checksum`. If the checksum mismatches, the entire import is rejected. The `exam_count` and `student_count` fields are **informational hints only** (used for progress bar estimation) and **must not** be used to determine when to stop reading records. The unpacker reads until EOF of the inner bundle, then validates counts match actuals as a secondary integrity check.

**STUDENT record** payload:
```json
{
  "pseudonym_id": "uuid-v4",
  "fallback_code": "A-X7K2M9",
  "pii_ciphertext": "<base64>",
  "iv": "<base64>"
}
```

**SUBMISSION record** payload:
```json
{
  "id": "...",
  "exam_id": "...",
  "pseudonym_hash": "<HMAC-SHA256(pseudonym_id, archive_secret)>",
  "total_score": 42.5,
  "scan_iv": "<base64>",
  "scan_blob": "<base64 binary>"
}
```

> **Defence-in-depth pseudonym linkage:** SUBMISSION records store `pseudonym_hash` — an HMAC of the raw `pseudonym_id` keyed with an `archive_secret` derived from the master key (via HKDF with purpose string `"bgproj-link"`). The raw `pseudonym_id` appears only in STUDENT records. Even if the outer envelope is broken (weak password, future cryptographic advance), an attacker cannot directly link submissions to students without also recovering the archive_secret. The client resolves the linkage at import time by computing the HMAC for each student and matching against submission records.

> Inner blob encryption: scan blobs within SUBMISSION records are individually encrypted with per-blob IVs (fresh random, generated at export time). This provides a second layer if the outer envelope is somehow decrypted without the inner key material.

---

## 4. Database Schema (SQLAlchemy ORM)

```python
# Illustrative; actual models in backend/app/models/

class Teacher(Base):
    id: UUID (PK)
    email: str (unique, indexed)
    password_hash: str          # Argon2id
    role: Enum["teacher","admin"]
    created_at: datetime

class InviteToken(Base):
    id: UUID (PK)
    token_hash: str (unique)    # SHA-256 of the raw invite token
    created_by: UUID (FK → Teacher, nullable, ON DELETE SET NULL)
    used_by: UUID (FK → Teacher, nullable)  # Set on registration
    expires_at: datetime
    created_at: datetime

class Exam(Base):
    id: UUID (PK)
    teacher_id: UUID (FK → Teacher, cascade delete)
    title: str
    latex_template: str         # Plaintext — never contains PII
    compilation_status: Enum["pending","compiled","failed"]
    created_at: datetime
    retention_until: date       # GDPR Art. 5(1)(e)
    deleted_at: datetime | None # soft delete

class Exercise(Base):
    id: UUID (PK)
    exam_id: UUID (FK → Exam, cascade delete)
    order_index: int
    max_points: float
    topic_tag: str | None
    question_type: Enum["free_text","mc","sc","tf"]
    correct_answers: JSON | None  # For MC/SC/TF auto-scoring
    penalty: float              # Default 0.0; negative for wrong MC

class StudentIdentity(Base):
    pseudonym_hmac: str (PK)    # HMAC(raw_uuid, per_exam_secret) — server never sees raw ID
    exam_id: UUID (FK → Exam, cascade delete)
    pii_ciphertext: bytes       # AES-256-GCM encrypted PII
    iv: bytes                   # 12-byte GCM nonce
    encryption_salt: bytes      # 16-byte Argon2id salt used for this record

class ScanSubmission(Base):
    id: UUID (PK)
    exam_id: UUID (FK → Exam, cascade delete)
    pseudonym_hmac: str (FK → StudentIdentity, cascade delete)
    total_score: float | None   # Plaintext for server-side statistics
    scan_path: str | None       # Disk path (Hybrid Mode only)
    scan_ciphertext: bytes | None  # Stored inline for small submissions
    scan_iv: bytes
    annotation_ciphertext: bytes | None  # Encrypted JSON vector layer
    annotation_iv: bytes | None
    created_at: datetime
    deleted_at: datetime | None

class AuditLog(Base):
    id: UUID (PK)
    teacher_id: UUID | None (FK → Teacher, ON DELETE SET NULL)
    teacher_email: str          # Immutable snapshot — survives teacher account deletion
    action: Enum["LOGIN","EXPORT","DELETE","VIEW","EXTEND_RETENTION"]
    target_hash: str | None     # SHA-256 of affected exam_id or pseudonym_hmac
    ip_hash: str | None         # SHA-256 of request IP
    created_at: datetime
    # AuditLog rows are NEVER soft-deleted.
    # teacher_id is nullable + ON DELETE SET NULL so that deleting a teacher
    # account does NOT cascade-delete or block removal of audit records.
    # teacher_email preserves identity for compliance after account deletion.
```

**Migrations:** One Alembic migration per schema change. Migration zero creates all tables plus:
* `CREATE UNIQUE INDEX ON StudentIdentity(pseudonym_hmac, exam_id)`
* `CREATE INDEX ON Exam(deleted_at) WHERE deleted_at IS NULL` (partial index for active exams)

---

## 5. API Contract

Base URL: `/api/v1`

### Authentication Model

Access tokens are delivered as **httpOnly, Secure, SameSite=Strict cookies** — never exposed to JavaScript. This mitigates XSS-based token theft. The frontend API client uses `credentials: 'include'` on every `fetch()` call; it never reads or stores the token value in JavaScript.

| Property | Value | Rationale |
|---|---|---|
| Access token TTL | **15 minutes** | Limits window of abuse from a stolen token. Short TTL is tolerable because silent refresh is automatic. |
| Refresh token TTL | **7 days** | Stored as httpOnly cookie on `/auth/refresh` path only |
| Refresh rotation | **Yes** — each refresh issues a new refresh token and revokes the old | Detects concurrent use (token theft) |
| Revocation | Refresh tokens revoked via DB/Redis. Access tokens are **not individually revocable** (short TTL makes this an acceptable, documented trade-off). | |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None + **invite token** | Create teacher account. Body must include a valid `invite_token`. Tokens are one-time-use, created by admins via CLI (`python -m app.cli create-invite`). Rejects registration if token is expired, already used, or invalid. |
| POST | `/auth/login` | None | Sets `access_token` + `refresh_token` as httpOnly cookies. Response body contains only `{ "email": "...", "role": "..." }`. |
| POST | `/auth/refresh` | Refresh cookie | Sets new access + refresh cookies. Revokes old refresh token. |
| POST | `/auth/logout` | Access cookie | Clears both cookies. Revokes refresh token in DB/Redis. |

### Exams

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/exams` | Teacher | List own exams |
| POST | `/exams` | Teacher | Create exam |
| GET | `/exams/{id}` | Teacher (owner) | Get exam detail |
| PATCH | `/exams/{id}` | Teacher (owner) | Update exam |
| DELETE | `/exams/{id}` | Teacher (owner) | Soft-delete exam + cascade |

### Students & Submissions

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/exams/{id}/students` | Teacher (owner) | Upload encrypted `StudentIdentity` ciphertext |
| DELETE | `/exams/{id}/students/{pseudonym_hmac}` | Teacher (owner) | Erasure (Art. 17) — hard delete student + submissions |
| POST | `/exams/{id}/submissions` | Teacher (owner) | Upload encrypted scan ciphertext |
| GET | `/exams/{id}/submissions` | Teacher (owner) | List submission metadata (no ciphertext) |
| GET | `/exams/{id}/submissions/{sub_id}` | Teacher (owner) | Download encrypted scan ciphertext |
| PATCH | `/exams/{id}/submissions/{sub_id}/score` | Teacher (owner) | Update plaintext total_score |

### Compile (Stateless)

| Method | Path | Auth | Rate limit | Body limit | Description |
|---|---|---|---|---|---|
| POST | `/compile/latex` | Teacher | 10 req/min | **2 MB** | Body: `{ latex: string }`. Returns `application/pdf`. Tectonic invoked with `--untrusted`. Temp dir created + destroyed. LaTeX source **never logged at any level in any environment**. |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/stats` | Admin | Aggregate anonymized statistics (k≥5 enforced server-side) |
| GET | `/admin/audit` | Admin | Paginated audit log |

### Request Body Size Limits

All endpoints enforce maximum request body sizes via middleware:

| Endpoint pattern | Max body size |
|---|---|
| `POST /compile/latex` | 2 MB |
| `POST /exams/{id}/submissions` | 50 MB |
| `POST /exams/{id}/students` | 1 MB |
| All other POST/PATCH | 256 KB |

Requests exceeding the limit receive HTTP 413 (Payload Too Large) before the body is fully read.

### CORS Configuration

In Hybrid Mode, the SvelteKit frontend and FastAPI backend may be on different origins. CORS is configured explicitly:

```python
# middleware/cors.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,  # e.g., ["https://blindgrade.school.example"]
    allow_credentials=True,    # Required for httpOnly cookie auth
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)
```

`CORS_ALLOWED_ORIGINS` is a required configuration value — there is no wildcard default. If unset, the application refuses to start.

### Response Conventions
- All errors: `{ "detail": "...", "code": "ERR_CODE" }` — never leaks resource existence to unauthenticated callers (401 not 404).
- All timestamps: ISO 8601 UTC.
- Encrypted blobs: base64url-encoded in JSON, or raw binary with `Content-Type: application/octet-stream` for large scans.

---

## 6. Frontend Architecture

### Session Store Shape
```typescript
interface SessionStore {
  mode: 'local' | 'hybrid' | null;
  masterKey: CryptoKey | null;   // Derived by Argon2id — never serialized
  sessionKey: CryptoKey | null;  // Derived from masterKey + nonce
  sessionNonce: Uint8Array | null;
  lockedAt: number | null;       // Unix ms — for timeout
  isDirty: boolean;              // Unsaved IDB changes
  // NOTE: No accessToken field. Auth tokens live in httpOnly cookies
  // managed by the browser — JavaScript never touches them.
}
```

### IndexedDB Schema (Dexie)
```typescript
class BlindGradeDB extends Dexie {
  exams!: Table<ExamRecord>;           // plaintext metadata
  exercises!: Table<ExerciseRecord>;   // plaintext
  students!: Table<StudentRecord>;     // { pseudonym_id, fallback_code, pii_ct, iv } — ct = ciphertext
  submissions!: Table<SubmissionRecord>; // { id, exam_id, pseudonym_hash, total_score, scan_ct, scan_iv, ann_ct, ann_iv }
  auditLog!: Table<AuditEntry>;        // local audit entries merged into .bgproj
}
// All *_ct fields are Uint8Array (encrypted before IDB write, decrypted at point of use only).
//
// SECURITY NOTE: Encryption-at-rest in IDB is the PRIMARY protection against
// data leakage on shared machines. The beforeunload/visibilitychange IDB wipe
// (in hygiene.ts) is a BEST-EFFORT UX courtesy — it is NOT reliably fired on
// browser crashes, process kills, mobile tab discards, or OS-level force-quits.
// If the wipe fails, the encrypted-at-rest blobs remain safe because a new
// session cannot derive the key without the teacher's password.
```

### Hardware Detection (`detect.ts`)
```typescript
interface HardwareProfile {
  logicalCores: number;        // navigator.hardwareConcurrency
  estimatedRAMGB: number;      // navigator.deviceMemory ?? 2 (NOTE: intentionally imprecise, rounded to power-of-2 by browsers)
  simdSupported: boolean;      // WebAssembly.validate(simd_probe_bytes)
  fileSystemAccessAPI: boolean; // 'showSaveFilePicker' in window
}

// IMPORTANT: navigator.deviceMemory is rounded by browsers for fingerprinting resistance,
// and Firefox with privacy.resistFingerprinting returns a fixed value or omits it entirely.
// Therefore, the hardware profile is used ONLY as the initial pipeline selection.
//
// The scan processing pipeline must ALSO implement dynamic OOM detection:
// 1. Start with the profile-recommended mode (constrained or parallel).
// 2. Monitor performance.memory.usedJSHeapSize (Chrome) after each page processed.
// 3. If heap usage exceeds 70% of jsHeapSizeLimit, or if an IDB QuotaExceededError
//    or RangeError is caught, automatically downgrade to assembly-line mode mid-batch.
// 4. On Firefox/Safari (no performance.memory), start in assembly-line mode unless
//    deviceMemory >= 8 AND logicalCores >= 4.
```

### Worker Communication Protocol
All workers use a typed `MessageChannel` protocol:
```typescript
type WorkerRequest =
  | { type: 'QR_DECODE'; imageData: ImageData }
  | { type: 'OMR_PROCESS'; pageImageData: ImageData; examConfig: ExerciseConfig[] }
  | { type: 'ENCRYPT'; plaintext: Uint8Array; key: CryptoKey }
  | { type: 'DECRYPT'; ciphertext: Uint8Array; iv: Uint8Array; key: CryptoKey }
  | { type: 'PACK_CHUNK'; record: ArchiveRecord }
  | { type: 'UNPACK_CHUNK'; compressedBytes: Uint8Array };

// NOTE on CryptoKey transfer: CryptoKey objects are structured-cloneable per the
// W3C Web Crypto API spec (they implement the Serializable internal method).
// postMessage() clones (not transfers) them to the worker. The `extractable` flag
// is preserved during cloning — a non-extractable key remains non-extractable in
// the worker. This is safe and well-supported across browsers.
//
// Trade-off acknowledged: cloning the key means it exists in multiple memory spaces
// (main thread + each worker that received it). This is acceptable because all
// workers are same-origin (enforced by CSP worker-src 'self') and the key material
// is not directly accessible even in the worker (non-extractable).

type WorkerResponse =
  | { type: 'QR_RESULT'; pseudonymId: string; version: string }
  | { type: 'OMR_RESULT'; scores: ExerciseScore[] }
  | { type: 'ENCRYPTED'; ciphertext: Uint8Array; iv: Uint8Array }
  | { type: 'DECRYPTED'; plaintext: Uint8Array }
  | { type: 'CHUNK_PACKED'; bytes: Uint8Array }
  | { type: 'CHUNK_UNPACKED'; record: ArchiveRecord }
  | { type: 'ERROR'; message: string };
```

---

## Phase 1 — Core Security, Cryptography & Auth

**Goal:** Key derivation, session lifecycle, server auth with httpOnly cookies, IndexedDB hygiene, CSP, CORS. No UI beyond unlock screen.

### Backend tasks
- [x] Scaffold FastAPI app (`app/main.py`, `config.py`, `database.py`)
- [x] Implement `Teacher` model + `InviteToken` model + Alembic migration zero (all tables)
- [x] `cli.py`: management command `create-invite` — generates a random token, stores `SHA-256(token)` in `InviteToken` table, prints the raw token for the admin to share
- [x] `POST /auth/register` — requires `invite_token` in body; validates against `InviteToken` table (not expired, not used); on success creates teacher + marks token as used
- [x] `POST /auth/login` — verifies credentials with Argon2id; sets `access_token` (15-min, httpOnly, Secure, SameSite=Strict) + `refresh_token` (7-day, httpOnly, Secure, SameSite=Strict, Path=/api/v1/auth/refresh) cookies; response body contains only `{ email, role }`
- [x] `POST /auth/refresh` — reads refresh cookie, validates, issues new access + refresh cookies, revokes old refresh token (store revocation in DB or Redis)
- [x] `POST /auth/logout` — clears both cookies, revokes refresh token
- [x] JWT signing with `PyJWT`: `jwt.encode(payload, secret, algorithm="HS256")`, `jwt.decode(token, secret, algorithms=["HS256"])` — explicit algorithm pinning prevents algorithm confusion
- [x] Auth dependency: read access token from cookie (not header), decode, verify expiry, return teacher
- [x] Ownership check dependency: `get_current_teacher_and_verify_ownership(exam_id)`
- [x] `AuditLog` model (teacher_id nullable FK, teacher_email immutable string) + `audit.write()` helper; wire LOGIN action
- [x] CSP middleware (`csp.py`): `script-src 'self'; connect-src 'self' [backend-origin]; worker-src 'self'; style-src 'self' 'unsafe-inline'`
- [x] CORS middleware (`cors.py`): explicit `CORS_ALLOWED_ORIGINS` from config, `allow_credentials=True`, refuse startup if unset
- [x] Body size middleware (`body_limit.py`): per-route size limits (§5)
- [x] Dockerfile + docker-compose (postgres, backend, volumes)

### Frontend tasks
- [x] SvelteKit project init with TypeScript, Vite, static adapter
- [x] `sri-manifest.json` (split into `wasm` and `js` sections) + build-time verification script
- [x] Runtime WASM integrity checker: fetch blob → `crypto.subtle.digest('SHA-256', buffer)` → compare against manifest → abort on mismatch
- [x] `crypto/keyDerivation.ts`: `deriveKey(password, salt) → CryptoKey` using argon2-browser WASM
- [x] `crypto/sessionKey.ts`: `deriveSessionKey(masterKey, nonce) → CryptoKey` via HKDF (Web Crypto)
- [x] `crypto/aesGcm.ts`: `encrypt(key, plaintext) → { ct, iv }` and `decrypt(key, ct, iv) → plaintext` — every call generates a fresh random 12-byte IV via `crypto.getRandomValues`
- [x] `crypto/hmac.ts`: `hmacPseudonymId(rawId, examSecret) → string`
- [x] `stores/session.ts`: session store (no accessToken field) + session timeout (30-min inactivity → wipe masterKey + sessionKey from store + lock UI)
- [x] `db/schema.ts` + `db/db.ts`: Dexie instance with all stores
- [x] `db/hygiene.ts`:
  - Register `beforeunload` + `visibilitychange` → attempt IDB wipe; prompt if `isDirty`
  - Document in code comments: this is best-effort; encrypt-at-rest is the primary protection
- [x] Unlock page (`/unlock`): password input → `deriveKey` → `deriveSessionKey` → populate session store
- [x] `api/client.ts`: typed fetch wrapper with `credentials: 'include'` on all requests; on 401 response, attempt silent `POST /auth/refresh`; on refresh failure, redirect to login

### Verification
- Unit test `keyDerivation.ts`: same password + salt → same key (deterministic).
- Unit test `aesGcm.ts`: round-trip encrypt/decrypt; tampered ciphertext throws. Verify each call produces a unique IV.
- Unit test `hmac.ts`: different exam secrets produce different outputs.
- Integration test: register with valid invite → succeed; register with expired/used/invalid invite → 401.
- Integration test: login → access cookie set (httpOnly) → call protected endpoint → succeed → logout → cookie cleared → 401.
- Integration test: access token expires → silent refresh → new cookie → subsequent request succeeds.
- Manual: close tab mid-session on a shared browser profile; verify IDB contains only encrypted blobs; verify no JS variable holds the access token.

---

## Phase 2 — Local Storage & Single-File Engine

**Goal:** Full `.bgproj` round-trip (export/import) with mandatory encryption, erasure workflow, retention warnings.

### Frontend tasks
- [x] `db/migrations.ts`: implement Dexie version upgrade hooks for future schema changes
- [x] Write all IDB entries with encrypted blobs (`aesGcm.encrypt` before every IDB put)
- [x] `archive/format.ts`: TypeScript types for all record types + magic header constants + `ARCHIVE_SECRET_PURPOSE = "bgproj-link"` constant for HKDF
- [x] `archive/packer.ts`:
  - **Nonce freshness:** Generate fresh 16-byte Argon2id salt AND fresh 12-byte GCM nonce at the start of every export. Never reuse salt/nonce from a previous export.
  - Derive a fresh master key from password + new salt; derive archive_secret via HKDF for pseudonym hashing
  - Open file via `showSaveFilePicker()` (File System Access API)
  - Write magic header (with new salt + new nonce) + manifest first
  - Generate fresh random IV per inner blob (scan, PII ciphertext) during serialization
  - Stream each Dexie table record: fetch → serialize (hash pseudonym_id with archive_secret for SUBMISSION records) → compress chunk via `packWorker` → write to file stream
  - Compute running SHA-256 over all record bytes as they are written
  - After all records written, go back and patch the manifest's `records_checksum` field (or write checksum as a trailing CHECKSUM record)
  - Fallback if File System Access API unavailable: buffer in memory with segmented archives (`.bgproj.001`, `.bgproj.002`, etc.) with manifest
  - Emit progress events: `{ stage, current, total, heapUsedMB }`
- [x] `archive/unpacker.ts`:
  - Read file into `ReadableStream`
  - Parse header, verify magic + format version
  - Derive key from header salt + user password
  - Decrypt **entire** outer envelope atomically, verify GCM tag (no partial decryption)
  - Iterate records: decompress → parse → write to IDB (one at a time to bound RAM)
  - Compute running SHA-256 over all record bytes → compare to `records_checksum` at end → reject on mismatch
  - Verify `exam_count` / `student_count` match actual counts as secondary check
  - Resolve pseudonym linkage: for each STUDENT record, compute `HMAC(student.pseudonym_id, archive_secret)` and match against SUBMISSION `pseudonym_hash` values
  - Emit progress events
- [x] `workers/packWorker.ts`: fflate `deflate`/`inflate` with DEFLATE level 6
- [x] `gdpr/retention.ts`: on `.bgproj` load, compare `manifest.expires_at` to `Date.now()`; if expired, show blocking modal: "This project has exceeded its retention period. Delete or explicitly extend?"
- [x] `gdpr/erasure.ts`: `eraseStudent(pseudonymId)` → delete from IDB `students` + `submissions` stores → append `AUDITLOG` entry → set `isDirty = true`
- [x] Erasure UI: settings → "Manage Students" → per-student delete button + confirmation dialog
- [x] Clear-on-export: after successful pack, prompt "Clear local session data?" (default: Yes)

### Verification
- Integration test: create 30 mock students with 5 MB scan blobs each → export → import → verify all records intact and pseudonym linkage resolves.
- Test nonce freshness: export same project twice with same password → verify the two files have different salts, nonces, and ciphertexts (byte-level comparison).
- Test checksum: export valid archive → tamper with one record byte in the ciphertext → decrypt → verify SHA-256 mismatch rejects import.
- Test on a simulated 2 GB RAM environment (Chrome DevTools memory throttle).
- Test erasure: erase student → export → import → verify student absent, audit log present.
- Test retention: load a project with `expires_at` in the past → verify blocking modal fires.
- Test fallback: disable `showSaveFilePicker` via flag → verify segmented output.

---

## Phase 3 — FastAPI Backend & Asynchronous Compiler

**Goal:** All API endpoints live, sandboxed Tectonic compilation, retention cron, Hybrid Mode upload/download.

### Backend tasks
- [x] `routers/exams.py`: CRUD with ownership dependency; soft-delete sets `deleted_at`
- [x] `routers/students.py`:
  - `POST /exams/{id}/students`: store `pseudonym_hmac` + encrypted blobs
  - `DELETE /exams/{id}/students/{hmac}`: hard delete student + cascade submissions; write AUDIT DELETE (captures teacher_email snapshot)
- [x] `routers/submissions.py`: upload/download ciphertext; `PATCH score` endpoint
- [x] `schemas/latex.py`: Pydantic model `LaTeXRequest` with `__repr__` overridden to return `"LaTeXRequest(<redacted>)"` — prevents accidental payload exposure in any debug log, traceback, or error message at any log level in any environment
- [x] `services/latex.py`:
  - Async wrapper: `asyncio.create_subprocess_exec("tectonic", "--untrusted", "main.tex", cwd=tmpdir)`
  - **`--untrusted` flag is mandatory** — disables `\write18` (shell escape), `\input` from outside the working directory, and network access within Tectonic
  - Writes LaTeX to `tmp/{uuid}/main.tex` inside a temp dir
  - 30-second hard timeout via `asyncio.wait_for`
  - `shutil.rmtree(tmpdir)` in `finally` block (never leaks temp files)
  - **No logging of the LaTeX payload at any level, in any environment.** There is no env-var gate. The `LaTeXRequest` model's `__repr__` redaction ensures the payload cannot leak through framework debug logging, exception tracebacks, or Sentry-style error reporters.
  - Production hardening (optional): run Tectonic in a secondary container or `unshare --mount --net` namespace with read-only root filesystem, limiting blast radius even if `--untrusted` is bypassed by a future Tectonic bug
- [x] `routers/compile.py`: `POST /compile/latex` → validate body via `LaTeXRequest` → call `latex_service.compile()` → return PDF bytes. Rate limit: `@limiter.limit("10/minute")`
- [x] `services/retention.py`: **CLI management command** `run-retention` — queries `Exam` rows where `retention_until < today` and `deleted_at IS NULL`, soft-deletes them, writes AUDIT row per deletion. Invoked by an **external cron job** (e.g., `0 2 * * * cd /app && python -m app.cli run-retention`), NOT by an in-process scheduler. This eliminates the multi-worker duplication problem.
- [x] `routers/admin.py`: aggregate stats endpoint; enforce k≥5 server-side before returning group stats
- [x] `middleware/rate_limit.py`: slowapi setup with Redis backend for prod; in-memory for dev/test
- [x] Alembic migration: add `deleted_at` to `Exam` + `ScanSubmission`; create partial index `WHERE deleted_at IS NULL`; make `AuditLog.teacher_id` nullable with `ON DELETE SET NULL`; add `AuditLog.teacher_email` column
- [x] Docker Compose: add Redis service for rate limiting; add cron service (or systemd timer in the backend container) for retention job

### Verification
- Unit test `latex.py`: valid LaTeX → PDF bytes returned; timeout exceeded → `asyncio.TimeoutError` raised; temp dir absent after return in all branches (success, timeout, exception).
- Unit test: verify `repr(LaTeXRequest(latex="\\documentclass{...}"))` returns `"LaTeXRequest(<redacted>)"`.
- Unit test: verify `--untrusted` flag is present in the subprocess args.
- Unit test ownership: teacher A cannot access teacher B's exam (expect 401).
- Unit test erasure cascade: delete student → verify submission rows gone from DB; verify AuditLog row has teacher_email set.
- Unit test: delete teacher account → verify AuditLog rows survive with `teacher_id=NULL`, `teacher_email` intact.
- Integration test retention CLI: insert exam with `retention_until = yesterday` → run `python -m app.cli run-retention` → verify `deleted_at` set and audit row written. Run twice → verify idempotent (no duplicate audit rows).
- Load test compile endpoint: exceed rate limit → verify 429 response.
- Load test body size: POST 3 MB to `/compile/latex` → verify 413 before body fully read.
- CORS test: request from unlisted origin → verify browser blocks response.

---

## Phase 4 — Web Worker Pool, OMR & Hardware Routing

**Goal:** QR decode, OMR pipeline, hardware-adaptive worker pool with dynamic OOM fallback, fiducial marker support in LaTeX templates.

### Frontend tasks
- [x] `hardware/detect.ts`:
  - Probe `navigator.hardwareConcurrency`, `navigator.deviceMemory`, WASM SIMD
  - Return initial `HardwareProfile` for pipeline selection
  - Export `PipelineMonitor` class:
    - After each page processed, check `performance.memory.usedJSHeapSize` (Chrome) vs `performance.memory.jsHeapSizeLimit`
    - If usage > 70% of limit, or if a `QuotaExceededError` / `RangeError` is caught, emit `'downgrade'` event → pipeline switches to assembly-line mode mid-batch
    - On Firefox/Safari (no `performance.memory`): default to assembly-line unless `deviceMemory >= 8 && logicalCores >= 4`
- [x] `workers/pool.ts`:
  - `WorkerPool` class: `size = min(hardwareCores, 8)` in modern mode; `size = 1` in constrained mode
  - Generic `dispatch(request): Promise<response>` with per-type worker routing
  - Back-pressure queue: if all workers busy, queue tasks instead of spawning unboundedly
  - Listen for `PipelineMonitor` `'downgrade'` event → reduce pool size to 1 + drain queue
- [x] `workers/qrWorker.ts`: ZXing-wasm `readBarcodesFromImageData()`; returns `{ pseudonymId, fallbackCode, version }`
- [x] `workers/omrWorker.ts`:
  - Step 1: detect fiducial markers (ArUco or custom corner markers) → compute homography
  - Step 2: warp-perspective the page to a normalised coordinate system
  - Step 3: for each MC bounding box in `exerciseConfig`: sample pixel density → threshold → filled/empty
  - Step 4: compare to correct answer key for the detected `version`; compute score with penalty
- [x] `workers/cryptoWorker.ts`: offload `aesGcm.encrypt/decrypt` to worker for large blobs to avoid blocking UI thread. CryptoKey is passed via `postMessage` (structured clone — safe per W3C spec; see §6 note).
- [x] `latex/generator.ts`:
  - Build LaTeX string from `ExamConfig`
  - Inject ArUco fiducial markers at fixed corner positions (uses `aruco` LaTeX package or custom TikZ)
  - Embed QR code (pseudonym_id + version) via `qrcode` npm package → data URL → `\includegraphics`
  - Embed human-readable fallback code as large `\texttt{VERSION-XXXXXXXX}` on cover page
  - Seed-based MC option shuffling (`version` letter → deterministic permutation of answer options)
- [x] `latex/compiler.ts`:
  - Try WASM Tectonic build first; detect availability
  - Fall back to `POST /compile/latex` with LAN warning modal if WASM unavailable
- [x] Assembly-line scan pipeline (constrained mode):
  - `for page of scanPages`: renderPage → dispatch QR → dispatch OMR → encrypt blob → IDB put → release page canvas → trigger GC hint (`page = null`)
  - PipelineMonitor checks heap after each page
- [x] Parallel scan pipeline (modern mode):
  - Batch pages into groups of `workerPoolSize`; run groups concurrently
  - PipelineMonitor checks heap after each group; downgrade to assembly-line if triggered

### Verification
- Unit test `detect.ts`: mocked environments return correct profile (constrained vs modern).
- Unit test `PipelineMonitor`: mock `performance.memory` at 75% usage → verify `'downgrade'` event emitted.
- Unit test `pool.ts`: all workers busy → new task queued, not dropped; worker freed → queued task dispatched; downgrade event → pool shrinks to 1.
- Unit test `generator.ts`: generated LaTeX string contains fiducial marker commands and QR `\includegraphics`.
- Integration test OMR: generate exam with known MC answers, render page to canvas, feed to `omrWorker`, verify scores match expected.
- Stress test: 30 pages at 300 DPI → full pipeline → measure peak heap in constrained profile (must stay under 512 MB). Verify dynamic downgrade triggers if heap approaches limit.

---

## Phase 5 — UI Integration & End-to-End Validation

**Goal:** Full SvelteKit UI wired to all services; both modes verified end-to-end; GDPR flows tested; security audit.

### Frontend UI tasks
- [x] Dashboard (`/`): project list (from IDB or Hybrid Mode server); "Open .bgproj", "New Local Project", "Connect to Server"
- [x] Mode selector: shown on first launch; mode stored in `SessionStore`
- [x] Exam creation (`/exam/new`): title, exercise builder (add/remove exercises, set type/points/tags/correct-answers), randomization seed toggle
- [x] LaTeX preview: generate LaTeX → compile → render PDF preview; display LAN warning if using server fallback
- [x] Scan ingestion (`/exam/[id]/scan`): file picker (multi-file or directory) → hardware-adaptive pipeline with PipelineMonitor → progress bar + heap indicator → QR match results table (matched / unmatched / fallback-needed)
- [x] Manual fallback entry: if QR unreadable, show "Enter fallback code" input for the orphaned submission
- [x] Grading view (`/exam/[id]/grade`): paginated student list → per-student annotation canvas overlay → score fields (pre-filled by OMR where applicable) → save → encrypt → IDB write
- [x] Statistics view (`/exam/[id]/stats`): histogram, std dev, mean; competency heatmap (k≥5 gate with suppression message); export CSV button → confirmation modal ("I confirm I am authorized to export this data") + audit log entry
- [x] `analytics/csvExport.ts`: Native CSV serialization — iterate decrypted student records, format as RFC 4180 CSV with BOM for Excel compatibility, trigger download via `Blob` + `URL.createObjectURL`. No external library.
- [x] Settings page: session timeout config; breach-guidance notice; "Clear all session data" button; GDPR info (controller role, DPA requirement, Art. 17 erasure link)
- [x] Retention warning modal: blocking, shown on project load if past `expires_at`
- [x] Hybrid Mode sync: on grading complete, push score-only updates to server (`PATCH /submissions/{id}/score`) — credentials included automatically via httpOnly cookie; on 401, attempt silent refresh; on refresh failure, redirect to login

### End-to-End Validation
- [x] **Local Mode flow**: New project → set password → create exam → compile → print QR → scan mock exams → grade → annotate → export `.bgproj` → clear IDB → re-import with password → verify all data restored + pseudonym linkage intact
- [x] **Hybrid Mode flow**: Admin creates invite → teacher registers with invite token → login (cookie set) → create exam on server → upload encrypted student identities → upload encrypted scans → grade → download ciphertext → decrypt client-side → export local backup
- [x] **GDPR flows**:
  - Erase student → export → import → student absent ✓
  - Load expired project → modal fires ✓
  - CSV export without confirmation → blocked ✓
  - k<5 class stats → suppressed ✓
  - Session idle 30 min → key wiped → lock screen ✓
- [x] **Stress test**: 30 students × 10 pages × 300 DPI on constrained profile; heap must stay < 512 MB; dynamic downgrade triggers correctly if threshold hit; no OOM crash
- [x] **Security**:
  - Confirm CSP blocks inline script injection (devtools CSP violation test)
  - Confirm SRI mismatch on any WASM blob fails hard (tamper one byte, verify load aborted)
  - Confirm access token is NOT accessible from `document.cookie` or any JS variable (httpOnly)
  - Pentest API: IDOR attempt (teacher A accessing teacher B's exam) → 401 ✓
  - Pentest compile endpoint: rate limit triggers at 11th request → 429 ✓
  - Pentest compile endpoint: 3 MB body → 413 ✓
  - Pentest registration: no invite token → 401 ✓; expired invite → 401 ✓
  - Verify temp LaTeX dir absent after compilation in all code paths (success, timeout, exception)
  - Verify `--untrusted` in Tectonic subprocess args
  - Verify CORS: request from unlisted origin → blocked
  - Verify: export same project twice → both files have different salt + nonce + ciphertext bytes
- [x] **Documentation**: `docs/DPA_template.md`, `docs/breach_response_checklist.md`, `docs/THIRD_PARTY_LICENSES.md` with all WASM hashes

---

## 12. Cross-Cutting Concerns

### Error Handling
- All worker errors propagate via `{ type: 'ERROR', message }` response; pool re-queues failed tasks up to 2 retries then surfaces to UI.
- Backend: global FastAPI exception handler catches unexpected exceptions, logs (without request bodies or LaTeX content), returns `500` with generic message. The `LaTeXRequest.__repr__` redaction ensures stack traces never contain LaTeX source.

### Logging (Backend)
- Log level `INFO` in prod: request method, path, status code, duration — no request bodies, no query params containing IDs.
- LaTeX source payload: **never logged at any level, in any environment.** There is no env-var toggle for this. The `LaTeXRequest` Pydantic model overrides `__repr__` to redact the body, preventing accidental exposure through framework debug logs, exception handlers, or APM tools.
- Audit-trail actions written to `AuditLog` table are separate from application logs.

### Testing Strategy
| Layer | Tool | Coverage target |
|---|---|---|
| Backend unit | pytest + pytest-asyncio | 80% line coverage |
| Backend integration | pytest + httpx TestClient + PostgreSQL (Docker) | All endpoints |
| Frontend unit | Vitest | All crypto, archive, GDPR modules |
| Frontend e2e | Playwright | All GDPR flows + Local + Hybrid happy paths |
| Performance | Playwright + custom heap probe | Assembly-line stress test + dynamic downgrade |

### CI Pipeline (GitHub Actions)
```
1. backend: ruff lint → mypy → pytest (unit + integration)
2. frontend: eslint → tsc --noEmit → vitest → playwright
3. security: pip-audit (backend) + npm audit (frontend) → fail on high CVEs
4. sri-check: verify sri-manifest.json WASM hashes match vendored blobs
5. sri-check: verify sri-manifest.json JS hashes match bundled outputs
```

### Semantic Versioning
`.bgproj` format version is independent of app version. Format version bumps require a migration path in `unpacker.ts`. Format version is checked on import; unknown future versions show "This file requires a newer version of BlindGrade."
