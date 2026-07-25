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
| Auth | **python-jose** (JWT) + **fastapi-users** | JWT access (1h) + refresh (7d) |
| Rate limiting | **slowapi** (Redis-backed in prod, in-memory in dev) | Compilation endpoint protection |
| LaTeX compiler | **Tectonic** (system binary) | Self-contained, fast |
| Scheduled jobs | **APScheduler** (AsyncIOScheduler) | Retention soft-delete job |
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
| Archive packing | **fflate** | Streaming DEFLATE in workers; replaces JSZip |
| Export (grids) | **xlsx** (SheetJS) | XLSX export for administration software |
| State management | **Svelte stores** (built-in) | No external store needed at this scale |
| Build | **Vite** | Fast HMR, supports WASM |
| Testing | **Vitest** (unit) + **Playwright** (e2e) | |

### WASM SRI Pins (to be populated at first install, frozen in `sri-manifest.json`)
```json
{
  "argon2-browser@1.18.0": "sha256-...",
  "opencv.js@4.10.0": "sha256-...",
  "zxing-wasm@1.2.3": "sha256-...",
  "fflate@0.8.2": "sha256-..."
}
```
The build step verifies all WASM hashes and fails if any mismatch.

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
│   │   │   ├── exam.py
│   │   │   ├── exercise.py
│   │   │   ├── student_identity.py
│   │   │   ├── scan_submission.py
│   │   │   └── audit_log.py
│   │   ├── schemas/               # Pydantic request/response models
│   │   ├── routers/
│   │   │   ├── auth.py            # /auth/*
│   │   │   ├── exams.py           # /exams/*
│   │   │   ├── students.py        # /students/*
│   │   │   ├── submissions.py     # /submissions/*
│   │   │   ├── compile.py         # /compile (stateless)
│   │   │   └── admin.py           # /admin/* (Admin role only)
│   │   ├── services/
│   │   │   ├── crypto.py          # Server-side Argon2id, HMAC helpers
│   │   │   ├── latex.py           # Async Tectonic wrapper
│   │   │   ├── retention.py       # APScheduler soft-delete job
│   │   │   └── audit.py           # Audit log write helper
│   │   └── middleware/
│   │       ├── csp.py             # CSP header injection
│   │       └── rate_limit.py      # slowapi setup
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
│   │   │   │   ├── hygiene.ts         # clear-on-close, session timeout
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
│   │   │   │   └── detect.ts          # CPU cores, memory estimate, SIMD probe
│   │   │   ├── latex/
│   │   │   │   ├── compiler.ts        # WASM Tectonic (preferred) or server fallback
│   │   │   │   └── generator.ts       # Template → LaTeX string builder
│   │   │   ├── api/
│   │   │   │   └── client.ts          # Typed fetch wrapper + JWT management
│   │   │   ├── gdpr/
│   │   │   │   ├── erasure.ts         # Erase student record from IDB + server
│   │   │   │   ├── retention.ts       # expires_at check on project load
│   │   │   │   └── exportAudit.ts     # Log CSV/XLSX export actions
│   │   │   └── analytics/
│   │   │       ├── stats.ts           # Histogram, std dev, mean
│   │   │       └── kanonymity.ts      # k≥5 check before display
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
│   │   │   ├── session.ts             # { masterKey, sessionKey, mode }
│   │   │   └── project.ts             # { exam, exercises, isDirty }
│   │   └── app.html
│   ├── static/
│   │   ├── wasm/                      # Vendored WASM blobs
│   │   └── sri-manifest.json
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

A `.bgproj` file is a **DEFLATE-compressed tar-like bundle** encrypted with AES-256-GCM. The outer structure:

```
[4 bytes]  Magic: 0x42 0x47 0x50 0x4A  ("BGPJ")
[1 byte]   Format version: 0x01
[16 bytes] Argon2id salt (for key re-derivation)
[12 bytes] AES-GCM nonce (for outer envelope)
[8 bytes]  Ciphertext length (uint64 LE)
[N bytes]  AES-GCM ciphertext of the inner bundle
[16 bytes] AES-GCM authentication tag
```

The **inner bundle** (plaintext after decryption) is a sequential stream of framed records:

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
  "mode": "local" | "hybrid",
  "exam_count": 2,
  "student_count": 58,
  "checksum": "sha256 of all subsequent records"
}
```

**STUDENT record** payload: `{ "pseudonym_id": "uuid-v4", "fallback_code": "A-X7K2M9", "pii_ciphertext": "<base64>", "iv": "<base64>" }`

**SUBMISSION record** payload: `{ "id": "...", "exam_id": "...", "pseudonym_id": "...", "total_score": 42.5, "scan_iv": "<base64>", "scan_blob": "<base64 binary>" }`

> The scan blobs are individually encrypted with the session key *before* being written into the inner bundle, providing defence-in-depth if the outer envelope is somehow decrypted.

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
    teacher_id: UUID (FK → Teacher)
    action: Enum["LOGIN","EXPORT","DELETE","VIEW","EXTEND_RETENTION"]
    target_hash: str | None     # SHA-256 of affected exam_id or pseudonym_hmac
    ip_hash: str | None         # SHA-256 of request IP
    created_at: datetime
    # AuditLog rows are NEVER soft-deleted
```

**Migrations:** One Alembic migration per schema change. Migration zero creates all tables plus a `CREATE UNIQUE INDEX` on `StudentIdentity(pseudonym_hmac, exam_id)`.

---

## 5. API Contract

Base URL: `/api/v1`

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Create teacher account |
| POST | `/auth/login` | None | Returns `{ access_token, refresh_token }` |
| POST | `/auth/refresh` | Refresh JWT | New access token |
| POST | `/auth/logout` | Access JWT | Revoke refresh token |

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

| Method | Path | Auth | Rate limit | Description |
|---|---|---|---|---|
| POST | `/compile/latex` | Teacher | 10 req/min | Body: `{ latex: string }`. Returns `application/pdf`. Temp dir created + destroyed. LaTeX source never logged. |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/stats` | Admin | Aggregate anonymized statistics (k≥5 enforced server-side) |
| GET | `/admin/audit` | Admin | Paginated audit log |

### Response conventions
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
  accessToken: string | null;    // Hybrid Mode only
}
```

### IndexedDB Schema (Dexie)
```typescript
class BlindGradeDB extends Dexie {
  exams!: Table<ExamRecord>;           // plaintext metadata
  exercises!: Table<ExerciseRecord>;   // plaintext
  students!: Table<StudentRecord>;     // { pseudonym_id, fallback_code, pii_ct, iv } — ct = ciphertext
  submissions!: Table<SubmissionRecord>; // { id, exam_id, pseudonym_id, total_score, scan_ct, scan_iv, ann_ct, ann_iv }
  auditLog!: Table<AuditEntry>;        // local audit entries merged into .bgproj
}
// All *_ct fields are Uint8Array (encrypted before IDB write, decrypted at point of use only)
```

### Hardware Detection (`detect.ts`)
```typescript
interface HardwareProfile {
  logicalCores: number;        // navigator.hardwareConcurrency
  estimatedRAMGB: number;      // navigator.deviceMemory ?? 2
  simdSupported: boolean;      // WebAssembly.validate(simd_probe_bytes)
  fileSystemAccessAPI: boolean; // 'showSaveFilePicker' in window
}
// Determines: workerPoolSize, blobBufferCount, indexedDBBatchSize
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

**Goal:** Key derivation, session lifecycle, server auth, IndexedDB hygiene, CSP. No UI beyond unlock screen.

### Backend tasks
- [ ] Scaffold FastAPI app (`app/main.py`, `config.py`, `database.py`)
- [ ] Implement `Teacher` model + Alembic migration zero (all tables)
- [ ] `POST /auth/register` + `POST /auth/login` with Argon2id server-side hashing
- [ ] JWT middleware: access token (1h), refresh token (7d), refresh rotation
- [ ] `POST /auth/logout` — revoke refresh token (store revocation in DB or Redis)
- [ ] Ownership check dependency: `get_current_teacher_and_verify_ownership()`
- [ ] `AuditLog` model + `audit.write()` helper; wire LOGIN action
- [ ] CSP middleware (`csp.py`): set `script-src 'self'`, `connect-src`, `worker-src`
- [ ] Dockerfile + docker-compose (postgres, backend, volumes)

### Frontend tasks
- [ ] SvelteKit project init with TypeScript, Vite, static adapter
- [ ] `sri-manifest.json` + build-time SRI verification script
- [ ] `crypto/keyDerivation.ts`: `deriveKey(password, salt) → CryptoKey` using argon2-browser WASM
- [ ] `crypto/sessionKey.ts`: `deriveSessionKey(masterKey, nonce) → CryptoKey` via HKDF (Web Crypto)
- [ ] `crypto/aesGcm.ts`: `encrypt(key, plaintext) → { ct, iv }` and `decrypt(key, ct, iv) → plaintext`
- [ ] `crypto/hmac.ts`: `hmacPseudonymId(rawId, examSecret) → string`
- [ ] `stores/session.ts`: session store + session timeout (30-min inactivity → wipe masterKey + sessionKey)
- [ ] `db/schema.ts` + `db/db.ts`: Dexie instance with all stores
- [ ] `db/hygiene.ts`: register `beforeunload` + `visibilitychange` → wipe IDB; prompt if `isDirty`
- [ ] Unlock page (`/unlock`): password input → `deriveKey` → `deriveSessionKey` → populate session store
- [ ] `api/client.ts`: typed fetch with JWT `Authorization` header, auto-refresh on 401

### Verification
- Unit test `keyDerivation.ts`: same password + salt → same key (deterministic).
- Unit test `aesGcm.ts`: round-trip encrypt/decrypt; tampered ciphertext throws.
- Unit test `hmac.ts`: different exam secrets produce different outputs.
- Integration test: register teacher, login, call protected endpoint, logout, verify 401.
- Manual: close tab mid-session on a shared browser profile; verify IDB is empty on reopen.

---

## Phase 2 — Local Storage & Single-File Engine

**Goal:** Full `.bgproj` round-trip (export/import), erasure workflow, retention warnings.

### Frontend tasks
- [ ] `db/migrations.ts`: implement Dexie version upgrade hooks for future schema changes
- [ ] Write all IDB entries with encrypted blobs (`aesGcm.encrypt` before every IDB put)
- [ ] `archive/format.ts`: TypeScript types for all record types + magic header constants
- [ ] `archive/packer.ts`:
  - Open file via `showSaveFilePicker()` (File System Access API)
  - Write magic header + manifest first
  - Stream each Dexie table record: fetch → serialize → compress chunk via `packWorker` → write to file stream
  - Fallback: buffer in memory if File System Access API unavailable; emit segmented blobs
  - Emit progress events: `{ stage, current, total, heapUsedMB }`
- [ ] `archive/unpacker.ts`:
  - Read file into `ReadableStream`
  - Parse header, verify magic + format version
  - Derive key from header salt + user password
  - Decrypt outer envelope
  - Iterate records: decompress → parse → write to IDB (one at a time to bound RAM)
  - Emit progress events
- [ ] `workers/packWorker.ts`: fflate `deflate`/`inflate` with DEFLATE level 6
- [ ] `gdpr/retention.ts`: on `.bgproj` load, compare `manifest.expires_at` to `Date.now()`; if expired, show blocking modal: "This project has exceeded its retention period. Delete or explicitly extend?"
- [ ] `gdpr/erasure.ts`: `eraseStudent(pseudonymId)` → delete from IDB `students` + `submissions` stores → append `AUDITLOG` entry → set `isDirty = true`
- [ ] Erasure UI: settings → "Manage Students" → per-student delete button + confirmation dialog
- [ ] Clear-on-export: after successful pack, prompt "Clear local session data?" (default: Yes)

### Verification
- Integration test: create 30 mock students with 5 MB scan blobs each → export → import → verify all records intact.
- Test on a simulated 2 GB RAM environment (Chrome DevTools memory throttle).
- Test erasure: erase student → export → import → verify student absent, audit log present.
- Test retention: load a project with `expires_at` in the past → verify blocking modal fires.
- Test fallback: disable `showSaveFilePicker` via flag → verify segmented output.

---

## Phase 3 — FastAPI Backend & Asynchronous Compiler

**Goal:** All API endpoints live, async Tectonic wrapper, retention job, Hybrid Mode upload/download.

### Backend tasks
- [ ] `routers/exams.py`: CRUD with ownership dependency; soft-delete sets `deleted_at`
- [ ] `routers/students.py`:
  - `POST /exams/{id}/students`: store `pseudonym_hmac` + encrypted blobs
  - `DELETE /exams/{id}/students/{hmac}`: hard delete student + cascade submissions; write AUDIT DELETE
- [ ] `routers/submissions.py`: upload/download ciphertext; `PATCH score` endpoint
- [ ] `services/latex.py`:
  - Async wrapper around `asyncio.create_subprocess_exec("tectonic", ...)`
  - Writes LaTeX to `tmp/{uuid}/main.tex`
  - 30-second hard timeout via `asyncio.wait_for`
  - `shutil.rmtree(tmpdir)` in `finally` block (never leaks temp files)
  - No logging of the LaTeX payload (`logger.debug` calls omit body)
- [ ] `routers/compile.py`: `POST /compile/latex` → call `latex_service.compile()` → return PDF bytes. Rate limit: `@limiter.limit("10/minute")`
- [ ] `services/retention.py`: APScheduler job runs daily at 02:00; soft-deletes `Exam` rows where `retention_until < today` and `deleted_at IS NULL`; writes AUDIT row per deletion
- [ ] `routers/admin.py`: aggregate stats endpoint; enforce k≥5 server-side before returning group stats
- [ ] `middleware/rate_limit.py`: slowapi setup with Redis backend for prod; in-memory for dev/test
- [ ] Alembic migration: add `deleted_at` to `Exam` + `ScanSubmission`; create partial index `WHERE deleted_at IS NULL`
- [ ] Environment config: `LATEX_PAYLOAD_LOGGING=false` env var gates any payload logging
- [ ] Docker Compose: add Redis service for rate limiting

### Verification
- Unit test `latex.py`: valid LaTeX → PDF bytes returned; timeout exceeded → `asyncio.TimeoutError` raised; temp dir absent after return in all branches.
- Unit test ownership: teacher A cannot access teacher B's exam (expect 401).
- Unit test erasure cascade: delete student → verify submission rows gone from DB.
- Integration test retention job: insert exam with `retention_until = yesterday` → run job → verify `deleted_at` set and audit row written.
- Load test compile endpoint: exceed rate limit → verify 429 response.

---

## Phase 4 — Web Worker Pool, OMR & Hardware Routing

**Goal:** QR decode, OMR pipeline, hardware-adaptive worker pool, fiducial marker support in LaTeX templates.

### Frontend tasks
- [ ] `hardware/detect.ts`: probe `navigator.hardwareConcurrency`, `navigator.deviceMemory`, WASM SIMD
- [ ] `workers/pool.ts`:
  - `WorkerPool` class: `size = min(hardwareCores, 8)` in modern mode; `size = 1` in constrained mode
  - Generic `dispatch(request): Promise<response>` with per-type worker routing
  - Back-pressure queue: if all workers busy, queue tasks instead of spawning unboundedly
- [ ] `workers/qrWorker.ts`: ZXing-wasm `readBarcodesFromImageData()`; returns `{ pseudonymId, fallbackCode, version }`
- [ ] `workers/omrWorker.ts`:
  - Step 1: detect fiducial markers (ArUco or custom corner markers) → compute homography
  - Step 2: warp-perspective the page to a normalised coordinate system
  - Step 3: for each MC bounding box in `exerciseConfig`: sample pixel density → threshold → filled/empty
  - Step 4: compare to correct answer key for the detected `version`; compute score with penalty
- [ ] `workers/cryptoWorker.ts`: offload `aesGcm.encrypt/decrypt` to worker for large blobs to avoid blocking UI thread
- [ ] `latex/generator.ts`:
  - Build LaTeX string from `ExamConfig`
  - Inject ArUco fiducial markers at fixed corner positions (uses `aruco` LaTeX package or custom TikZ)
  - Embed QR code (pseudonym_id + version) via `qrcode` npm package → data URL → `\includegraphics`
  - Embed human-readable fallback code as large `\texttt{VERSION-XXXXXXXX}` on cover page
  - Seed-based MC option shuffling (`version` letter → deterministic permutation of answer options)
- [ ] `latex/compiler.ts`:
  - Try WASM Tectonic build first; detect availability
  - Fall back to `POST /compile/latex` with LAN warning modal if WASM unavailable
- [ ] Assembly-line scan pipeline (constrained mode):
  - `for page of scanPages`: renderPage → dispatch QR → dispatch OMR → encrypt blob → IDB put → release page canvas → trigger GC hint (`page = null`)
- [ ] Parallel scan pipeline (modern mode):
  - Batch pages into groups of `workerPoolSize`; run groups concurrently

### Verification
- Unit test `detect.ts`: mocked environments return correct profile (constrained vs modern).
- Unit test `pool.ts`: all workers busy → new task queued, not dropped; worker freed → queued task dispatched.
- Unit test `generator.ts`: generated LaTeX string contains fiducial marker commands and QR `\includegraphics`.
- Integration test OMR: generate exam with known MC answers, render page to canvas, feed to `omrWorker`, verify scores match expected.
- Stress test: 30 pages at 300 DPI → full pipeline → measure peak heap in constrained profile (must stay under 512 MB).

---

## Phase 5 — UI Integration & End-to-End Validation

**Goal:** Full SvelteKit UI wired to all services; both modes verified end-to-end; GDPR flows tested; security audit.

### Frontend UI tasks
- [ ] Dashboard (`/`): project list (from IDB or Hybrid Mode server); "Open .bgproj", "New Local Project", "Connect to Server"
- [ ] Mode selector: shown on first launch; mode stored in `SessionStore`
- [ ] Exam creation (`/exam/new`): title, exercise builder (add/remove exercises, set type/points/tags/correct-answers), randomization seed toggle
- [ ] LaTeX preview: generate LaTeX → compile → render PDF preview; display LAN warning if using server fallback
- [ ] Scan ingestion (`/exam/[id]/scan`): file picker (multi-file or directory) → hardware-adaptive pipeline → progress bar + heap indicator → QR match results table (matched / unmatched / fallback-needed)
- [ ] Manual fallback entry: if QR unreadable, show "Enter fallback code" input for the orphaned submission
- [ ] Grading view (`/exam/[id]/grade`): paginated student list → per-student annotation canvas overlay → score fields (pre-filled by OMR where applicable) → save → encrypt → IDB write
- [ ] Statistics view (`/exam/[id]/stats`): histogram, std dev, mean; competency heatmap (k≥5 gate with suppression message); export CSV/XLSX button → confirmation modal + audit log entry
- [ ] Settings page: session timeout config; breach-guidance notice; "Clear all session data" button; GDPR info (controller role, DPA requirement, Art. 17 erasure link)
- [ ] Retention warning modal: blocking, shown on project load if past `expires_at`
- [ ] Hybrid Mode sync: on grading complete, push score-only updates to server (`PATCH /submissions/{id}/score`) with 401-redirect to login if session expired

### End-to-End Validation
- [ ] **Local Mode flow**: New project → create exam → compile → print QR → scan mock exams → grade → annotate → export `.bgproj` → clear IDB → re-import → verify all data restored
- [ ] **Hybrid Mode flow**: Register → login → create exam on server → upload encrypted student identities → upload encrypted scans → grade → download ciphertext → decrypt client-side → export local backup
- [ ] **GDPR flows**:
  - Erase student → export → import → student absent ✓
  - Load expired project → modal fires ✓
  - CSV export without confirmation → blocked ✓
  - k<5 class stats → suppressed ✓
  - Session idle 30 min → key wiped → lock screen ✓
- [ ] **Stress test**: 30 students × 10 pages × 300 DPI on constrained profile; heap must stay < 512 MB, no OOM crash
- [ ] **Security**:
  - Confirm CSP blocks inline script injection (devtools CSP violation test)
  - Confirm SRI mismatch on any WASM blob fails hard
  - Pentest API: IDOR attempt (teacher A accessing teacher B's exam) → 401 ✓
  - Pentest compile endpoint: rate limit triggers at 11th request → 429 ✓
  - Verify temp LaTeX dir absent after compilation in all code paths (success, timeout, exception)
- [ ] **Documentation**: `docs/DPA_template.md`, `docs/breach_response_checklist.md`, `docs/THIRD_PARTY_LICENSES.md` with all WASM hashes

---

## 12. Cross-Cutting Concerns

### Error Handling
- All worker errors propagate via `{ type: 'ERROR', message }` response; pool re-queues failed tasks up to 2 retries then surfaces to UI.
- Backend: global FastAPI exception handler catches unexpected exceptions, logs (without request bodies), returns `500` with generic message.

### Logging (Backend)
- Log level `INFO` in prod: request method, path, status code, duration — no request bodies, no query params containing IDs.
- LaTeX source payload: never logged at any level.
- Audit-trail actions written to `AuditLog` table are separate from application logs.

### Testing Strategy
| Layer | Tool | Coverage target |
|---|---|---|
| Backend unit | pytest + pytest-asyncio | 80% line coverage |
| Backend integration | pytest + httpx TestClient + PostgreSQL (Docker) | All endpoints |
| Frontend unit | Vitest | All crypto, archive, GDPR modules |
| Frontend e2e | Playwright | All 3 GDPR flows + Local + Hybrid happy paths |
| Performance | Playwright + custom heap probe | Assembly-line stress test |

### CI Pipeline (GitHub Actions)
```
1. backend: ruff lint → mypy → pytest (unit + integration)
2. frontend: eslint → tsc --noEmit → vitest → playwright
3. security: pip-audit (backend) + npm audit (frontend) → fail on high CVEs
4. sri-check: verify sri-manifest.json matches vendored WASM blobs
```

### Semantic Versioning
`.bgproj` format version is independent of app version. Format version bumps require a migration path in `unpacker.ts`. Format version is checked on import; unknown future versions show "This file requires a newer version of BlindGrade."
