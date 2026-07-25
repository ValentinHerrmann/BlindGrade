# System Architecture & Implementation Specification: BlindGrade

## 1. Executive Summary & Vision
**BlindGrade** is a cross-platform, privacy-first, client-side-encrypted exam management and grading system designed for educational environments. Teachers generate exams, manage grades, and process physical scans without exposing student Personally Identifiable Information (PII) to any backend server.

The system operates in two distinct modes: **Hybrid Client-Encrypted Mode** (server used for blind storage of ciphertext only) and **Strict Local Mode** (server acts purely as a stateless computation engine; all data lives on the teacher's machine). The architecture adapts to hardware capabilities to run safely on legacy school hardware while exploiting parallel processing on modern workstations.

> **Terminology note:** This document uses *client-side encryption* and *end-to-end encrypted storage* rather than the informal "zero-knowledge" label to accurately describe the threat model and avoid misleading institutional reviewers or auditors. The server never holds plaintext PII, but this is an encryption architecture, not a cryptographic zero-knowledge proof system.

---

## 2. GDPR Compliance Framework

GDPR compliance must be designed in from the start, not retrofitted. This section defines the legal and organizational requirements that constrain the technical architecture.

### 2.1 Roles & Legal Basis
* **Data Controller:** The individual teacher (or the school institution, depending on jurisdictional interpretation) is the data controller under GDPR Art. 4(7).
* **Data Processor:** Any third-party hosting the backend server must sign a Data Processing Agreement (DPA) as required by GDPR Art. 28 before any data is processed. The software documentation must include a DPA template.
* **Legal Basis:** Processing of student exam grades falls under Art. 6(1)(c) (legal obligation — schools are legally required to assess and record student performance) and potentially Art. 6(1)(e) (public task). The onboarding flow must present and record the applicable legal basis per institution.

### 2.2 Right to Erasure (Art. 17)
* The `.bgproj` archive format (§3.2) must include an **erasure workflow**: a dedicated UI action that locates a student's `Pseudonym_ID`, removes their `StudentIdentity` record and all associated `ScanSubmission` blobs, and re-exports a new archive.
* In Hybrid Mode, the server must expose a `DELETE /student/{pseudonym_id}` endpoint that removes the encrypted identity blob and all associated encrypted submissions. Cascading deletes must be enforced at the database level.
* Documentation must inform teachers that erasure of student data from exported `.bgproj` files on local storage (e.g., backups, USB drives) is the teacher's responsibility as data controller.

### 2.3 Data Retention Policy
* The `.bgproj` archive format must include a machine-readable `expires_at` metadata field (ISO 8601 date). The application must warn the teacher when loading a project past its expiry date and prompt for deletion or explicit extension.
* Default retention suggestion: end of the academic year + 1 year (aligned with typical school record-keeping obligations). Institutions may override via configuration.
* The server-side schema (Hybrid Mode) must include a `retention_until` field on the `Exam` table. A scheduled job must soft-delete expired exam data and log the deletion for audit purposes.

### 2.4 Breach Notification Path (Art. 33)
* The `.bgproj` file **must** be encrypted (AES-256-GCM, password-derived key) at all times. Unencrypted export is not supported. This transforms a lost laptop from a reportable breach into a low-risk incident, provided key strength is adequate.
* The application must display a breach-guidance notice in the settings/help section, informing teachers that loss of an unrecovered encrypted archive must still be assessed against Art. 33 and reported to the institutional Data Protection Officer (DPO) within 72 hours if re-identification risk cannot be ruled out.
* Documentation must include a breach response checklist for teachers and institutions.

### 2.5 Re-identification & Minimum Group Size (k-Anonymity)
* Competency heatmaps (§8.4) and statistical dashboards (§8.5) must enforce a **minimum group size of k=5** before displaying aggregated results. If a group (e.g., a class, a competency tag segment) contains fewer than 5 students, the result is suppressed and replaced with a "Insufficient data for anonymized display" message.
* In Hybrid Mode, per-student competency vectors must never be transmitted to the server; only the aggregated class-level totals (after k-anonymity check) are synced.

### 2.6 Third-Party Export Legal Basis (CSV/XLSX to Administration Software)
* The CSV/XLSX export to school administration software (e.g., Notenmanager) decrypts PII client-side and writes it to a file. This action must:
  1. Require explicit confirmation from the teacher ("I confirm I am authorized to export this data to [system name]").
  2. Display a warning that the exported file is plaintext and must be handled according to the school's data protection policy.
  3. Never be transmitted automatically; the export file is created locally only.
* The export action must be logged in the `.bgproj` audit trail (timestamp, export type, pseudonym IDs included) to support accountability under Art. 5(2).

---

## 3. Core Security & Storage Models

### 3.1 Key Management Architecture (CRITICAL)
All encryption in BlindGrade derives from a teacher-controlled password. The key **never leaves the client** and is **never transmitted to the server**.

* **Key Derivation:** `Argon2id` (WASM implementation client-side) with parameters `m=65536, t=3, p=4` applied to the teacher's password + a random 16-byte salt stored in the project header. This produces a 256-bit master key.
* **Key Wrapping:** For Hybrid Mode multi-device access (e.g., teacher uses two machines), the master key may be wrapped with a second password-derived key and stored as an encrypted blob in the server DB — the server stores wrapped key material it cannot use.
* **Session Key:** A per-session AES-256-GCM key is derived from the master key + a session nonce to limit blast radius of nonce reuse.
* **No key escrow:** There is no key recovery mechanism. Teachers must maintain their own secure backup of the password (e.g., printed recovery code). This is a deliberate trade-off documented in the user guide.

### 3.2 Hybrid Client-Encrypted Mode (Networked)
* **Plaintext Domain (Server Accessible):** Exam configurations (topics, max points, LaTeX templates, blank PDF outputs), and anonymized aggregate grades for statistical analysis.
* **Encrypted Domain (Client-Side Only):** Student PII and the raw images/PDFs of handwritten exam submissions. Encrypted in the browser via AES-256-GCM with the session key before any network transmission.
* **Server never receives:** plaintext PII, unencrypted scan images, or the encryption key material.

### 3.3 Strict Local Mode (Air-Gapped / Serverless Storage)
* **Zero Server Storage:** No student data, encrypted blobs, or exam metadata is saved to the backend database.
* **Stateless Backend (Scoped Use):** The FastAPI server is used only as a stateless LaTeX compilation engine. See §3.5 for the privacy implications and constraints of this.
* **Single-File Portability:** Project state is maintained in the browser's IndexedDB during the session and exported to a compressed, **always-encrypted** `.bgproj` archive on the teacher's hard drive. See §3.4 for IndexedDB hygiene requirements.
* **Session Restoration:** Teachers load the `.bgproj` file via the HTML5 File API, supply their password, and the application re-derives the key and streams data back into IndexedDB.

### 3.4 IndexedDB Hygiene (Shared Machine Risk)
IndexedDB data persists in the browser's profile after the tab is closed. On a shared or institutional computer, a subsequent user of the same browser profile could access uncleared project data.

* **Mandatory Clear-on-Close:** The application must register a `beforeunload` / `visibilitychange` handler that wipes all BlindGrade IndexedDB stores when the session ends. Teachers must be prompted to export first if unsaved changes exist.
* **Encrypt at Rest in IndexedDB:** All blobs written to IndexedDB (scan images, PII records) must be stored encrypted using the session key, not in plaintext. Decryption occurs only in-memory at the point of use.
* **Clear-on-Export:** After a successful `.bgproj` export, the application must offer (and default to) immediately clearing IndexedDB. A persistent session indicator must show the teacher whether active uncleared data exists.
* **Session Timeout:** The application must implement a configurable inactivity timeout (default: 30 minutes) that wipes in-memory key material and locks the session, requiring password re-entry to continue.

### 3.5 LaTeX Compilation & Local Mode Privacy
Sending the LaTeX source to the backend for compilation transmits exam content (structure, topics, exercise text) over the network. In Strict Local Mode this contradicts complete air-gapping.

* **Preferred path:** Compile LaTeX entirely in-browser using a WASM-compiled LaTeX engine (e.g., `texlive.js` or a custom WASM build of Tectonic). This is the only true air-gapped approach and must be the target for v1.
* **Fallback path (if WASM compilation is not feasible for v1):** The backend compilation endpoint may be used in Local Mode, but with the following constraints:
  - The server must be deployed on the **local network only** (localhost or school LAN), not a public internet endpoint.
  - The connection must be TLS-encrypted even on LAN.
  - The server must not log the LaTeX payload beyond ephemeral request processing.
  - The UI must display a clear warning: "Your exam content is being sent to [server address] for compilation. Ensure this server is trusted and on a local network."
* **No compilation of PII-containing content:** LaTeX templates must contain only structural exam content (exercise placeholders, point values, layout). Student names or pseudonym IDs must never appear in the LaTeX source sent to the server.

### 3.6 Pseudonymization & Cryptography Architecture
1. **Pseudonym_ID Generation:** The client generates cryptographically secure UUIDs (v4) for each student. Pseudonym IDs are never derived from or correlated to student PII.
2. **Server-Side Pseudonym Handling (Hybrid Mode):** Pseudonym IDs stored server-side are **salted and hashed** (HMAC-SHA256 with a per-exam secret held only client-side) before transmission. The server stores `HMAC(pseudonym_id, exam_secret)` as the record key. The server cannot reverse this to correlate submissions across exams or to the original pseudonym.
3. **Client-Side Encryption:** PII and raw exam scans are encrypted with the session key before any network transmission (Hybrid Mode) or before writing to IndexedDB (Local Mode).
4. **QR Code Binding:** Generated blank exams feature a pre-printed QR code encoding the `Pseudonym_ID`. A secondary human-readable pseudonym code (6–8 alphanumeric characters) is also printed on the cover page. If the QR code is damaged or unreadable, the teacher can manually enter the fallback code to link the submission. The QR code also encodes the exam version/seed (§8.3) to enable correct OMR key selection.

---

## 4. Authentication & Authorization

The plan previously had no auth model. This section defines it.

### 4.1 Teacher Authentication (Hybrid Mode)
* Teachers authenticate to the backend via password-based auth with JWT bearer tokens (short-lived: 1 hour, refresh: 7 days).
* Passwords are hashed with Argon2id server-side. The server never stores plaintext passwords.
* Each teacher account is isolated: a teacher can only read/write exams and submissions associated with their own account.
* Multi-teacher collaboration on a single exam is explicitly out of scope for v1 to avoid key-sharing complexity.

### 4.2 Authorization Model
* **Role: Teacher** — Full CRUD on their own exams and submissions. Cannot access other teachers' data.
* **Role: Admin** — Can view aggregate anonymized statistics across the institution. Cannot decrypt any encrypted blobs (no key access). Admin role exists for institutional compliance reporting only.
* All API endpoints must enforce ownership checks: `exam.teacher_id == requesting_teacher_id` before any data access.

### 4.3 Rate Limiting & Abuse Prevention
* The LaTeX compilation endpoint must be rate-limited (e.g., 10 requests/minute per authenticated user) to prevent server resource abuse.
* Unauthenticated access to any non-public endpoint returns HTTP 401. The API must not expose whether a resource exists to unauthenticated callers (return 401, not 404).

---

## 5. Database Schema Design (Conceptual)

The schema acts as the ORM definition for the backend (Hybrid Mode) and maps directly to the IndexedDB structure on the frontend (both modes).

**Table: Teacher**
* Fields: ID, Email, Argon2id Password Hash, Created At, Role.

**Table: Exam (Plaintext)**
* Fields: ID, Teacher ID (FK), Title, LaTeX Template, Creation Date, Compilation Status, Retention Until.

**Table: Exercise (Plaintext)**
* Fields: ID, Exam ID (FK), Max Points, Topic Tag, Correct MC Answers (for auto-scoring).

**Table: StudentIdentity (Encrypted)**
* Fields: Pseudonym ID (HMAC — server never sees raw pseudonym), Exam ID (FK), Encrypted PII Blob (AES-GCM ciphertext), IV, Encryption Salt.
* Note: Pseudonym ID here is `HMAC(raw_pseudonym_id, per_exam_secret)`. The per-exam secret is held client-side only and never stored on the server.

**Table: ScanSubmission (Encrypted)**
* Fields: ID, Exam ID (FK), Hashed Pseudonym ID (FK → StudentIdentity), Total Score (plaintext — needed for server-side statistics), Encrypted Scan Blob (AES-GCM ciphertext or server disk path pointer in Hybrid Mode), IV, Annotation Vector (Encrypted JSON blob), Created At.

**Table: AuditLog**
* Fields: ID, Teacher ID (FK), Action (enum: EXPORT, DELETE, VIEW, LOGIN), Target (Exam ID or Pseudonym ID — hashed), Timestamp, IP Address Hash.
* Audit logs support Art. 5(2) accountability requirements.

---

## 6. Frontend Architecture & Hardware Capability Routing

### 6.1 System Adaptive Matrix
* **Memory-Constrained Devices (e.g., older tablets, limited RAM):**
  * Strict "Assembly Line" memory model: render one PDF page, scan QR, slice, encrypt, destroy canvas, force garbage collection.
  * Throttle IndexedDB writes sequentially.
* **Modern Workstations (e.g., multi-core CPUs, NVMe SSDs):**
  * Expansive Web Worker pool based on logical CPU core count.
  * Multi-page parallel memory buffering.
  * Enable WASM SIMD acceleration for the QR parsing engine and utilize unthrottled batch writes.

### 6.2 Local Export/Import Engine (Large Project Handling)
High-resolution scans of a full class (e.g., 30 students × 10 pages at 300 DPI) may total 1–3 GB. Single-pass in-memory compression of this volume will cause Out-Of-Memory errors on constrained devices.

* **Chunked Export:** The packer must not load all blobs into memory at once. Instead it must:
  1. Write the archive header and metadata first.
  2. Stream scan blobs one-at-a-time from IndexedDB into the compressor, flushing each chunk to disk via the File System Access API (or streaming download) before loading the next.
  3. If the File System Access API is unavailable (Firefox), fall back to segmented archives (`.bgproj.001`, `.bgproj.002`, etc.) with a manifest file.
* **Chunked Import:** The unpacker streams the archive, writing each blob back into IndexedDB before loading the next. Maximum in-memory footprint is bounded to ~1 blob + overhead at any time.
* **Progress Reporting:** All export/import operations must expose a progress percentage to the UI. Memory-constrained mode must display current heap usage.

### 6.3 Supply-Chain Security (WASM & Third-Party Libraries)
* All third-party WASM modules (OpenCV.js, JSZip, LaTeX engine, Argon2id) must be **pinned to specific versions** with published SHA-256 hashes verified at load time via Subresource Integrity (SRI).
* A strict **Content Security Policy (CSP)** must be deployed:
  - `script-src 'self'` — no inline scripts, no eval.
  - `connect-src 'self' [backend-origin]` — no unexpected outbound connections.
  - `worker-src 'self'` — Web Workers from same origin only.
* WASM modules must be audited at each version bump. A `THIRD_PARTY_LICENSES.md` must enumerate all included libraries, their versions, and their hashes.

---

## 7. Backend Architecture (FastAPI & Tectonic)

### 7.1 Route Separation & Mode Handling
* **Plaintext Routes (authenticated):** Endpoints for exam CRUD operations. All require JWT auth and ownership checks.
* **Encrypted Storage Routes (authenticated):** Endpoints for encrypted blind storage of `StudentIdentity` and `ScanSubmission` ciphertexts. Server cannot decrypt these.
* **Stateless Computation Routes (authenticated, rate-limited):** Endpoints that accept a LaTeX string, compile it via Tectonic, and return the PDF binary in the HTTP response without database interaction. Used by both modes (subject to the Local Mode privacy constraints defined in §3.5).

### 7.2 Asynchronous Compilation Engine
* LaTeX compilation via Tectonic is handled as an async background subprocess to prevent blocking the HTTP event loop.
* The backend writes the LaTeX source to a **temporary directory with a random UUID name**, executes Tectonic, captures the output binary, and immediately removes the entire temp directory (including the source file) before returning the response.
* The LaTeX source payload is **not logged** at any log level in production.
* Maximum compilation time is bounded (e.g., 30 seconds) with a hard timeout to prevent resource exhaustion.

---

## 8. Advanced Grading Features & Extensibility

### 8.1 Automated Multiple Choice & Optical Mark Recognition (OMR)
* **Client-Side OMR Engine:** To maintain the strict client-side encryption privacy model, evaluation of multiple-choice (MC), single-choice, and true/false questions occurs entirely in the browser. A WASM computer vision module (e.g., OpenCV.js) handles Optical Mark Recognition.
* **Fiducial Markers:** Generated LaTeX templates must include alignment markers in the corners of each page. The frontend uses these to deskew and normalize scan perspective before reading MC bounding boxes.
* **Auto-Scoring Pipeline:** The plaintext exam configuration stores correct MC answers and point weights. The OMR engine maps detected checkboxes, calculates scores, and populates grades for those exercises, leaving only free-text answers for manual review.

### 8.2 Digital Annotation & Feedback System
* **Non-Destructive Overlays:** Teachers mark up digital exams (checkmarks, crosses, text comments, freehand drawing) via the HTML5 Canvas API.
* **Vector Storage:** Annotations are stored as a lightweight, encrypted JSON vector layer tied to the `ScanSubmission` — not burned into the scan image. This preserves the original and keeps file sizes small.
* **Export Rendering:** When finalized, the frontend merges the raw scan blob and the vector annotation layer to generate a flattened PDF for the student or school archive.

### 8.3 Exam Randomization & Versioning
* **Seed-Based Shuffling:** The LaTeX generation engine supports permutation of question order and multiple-choice options to prevent cheating.
* **QR Version Mapping:** The randomization seed (Version A, B, C, etc.) is encoded into the student's QR code alongside the `Pseudonym_ID`. When the frontend scans the paper, it reads the seed and aligns the OMR engine to the correct grading key for that permutation.
* **Fallback code:** The human-readable fallback code (§3.6) must also encode the version, e.g. `A-X7K2M9`, where the prefix letter is the version.

### 8.4 Granular Rubrics & Grading Policies
* **Fractional & Penalty Scoring:** The data schema supports floating-point point values (e.g., 0.5 points) and customizable penalty logic (e.g., −0.5 points for incorrect MC answers).
* **Competency Tagging (Didactic Analytics):** Individual exercises are tagged with curriculum competencies (e.g., "Syntax," "Algorithmic Logic"). The client-side analytics engine aggregates these tags to generate heatmaps, showing which concepts a class has mastered and which need review. Minimum group size k=5 is enforced before display (§2.5).

### 8.5 Grade Export & Administration Sync
* **System Integration:** Once grading is complete and identities are locally decrypted, the frontend provides a CSV/XLSX export formatted for school administration software (e.g., Notenmanager), subject to the authorization requirements in §2.6.
* **Statistical Dashboards:** Automated generation of class histograms, standard deviations, and average scores. In Hybrid Mode, only plaintext point totals (no PII, no pseudonym IDs) are synchronized with the server for longitudinal tracking. k-anonymity thresholds are enforced on all displayed aggregates.

---

## 9. Implementation Roadmap

### Phase 1: Core Security, Cryptography & Auth
* Implement the Argon2id key derivation service (WASM) and session key management lifecycle.
* Build the client-side AES-256-GCM encryption/decryption wrapper using native Web Crypto APIs.
* Implement JWT-based teacher authentication on the backend, with Argon2id password hashing.
* Implement IndexedDB hygiene: encrypt-at-rest, clear-on-close, session timeout.
* Set up CSP headers and SRI verification for all third-party WASM modules.

### Phase 2: Local Storage & Single-File Engine
* Implement the Dexie.js (IndexedDB) persistence layer with encrypted blob storage.
* Build the chunked streaming File API export/import pipeline (`.bgproj` format).
* Embed metadata in `.bgproj`: `expires_at`, `audit_log`, `encryption_salt`, `version`.
* Implement the erasure workflow: UI action to remove a student record and re-export.
* Implement the mandatory clear-on-close IndexedDB wipe.

### Phase 3: FastAPI Backend & Asynchronous Compiler
* Scaffold the FastAPI application with ownership-enforced routes and rate limiting.
* Implement the async Tectonic compilation wrapper (temp dir, hard timeout, no logging of source).
* Build encrypted storage endpoints for `StudentIdentity` and `ScanSubmission` ciphertexts.
* Implement the `AuditLog` table and the `DELETE /student/{pseudonym_id}` erasure endpoint.
* Add the `retention_until` field and scheduled soft-delete job.

### Phase 4: Web Worker Pool, OMR & Hardware Routing
* Set up the Web Worker pool for QR extraction and assembly-line memory lifecycle.
* Build hardware detection heuristics (CPU cores, RAM, WASM SIMD availability).
* Integrate the OpenCV.js WASM OMR engine with fiducial marker deskewing.
* Implement the chunked export/import engine with constrained-memory fallback paths.

### Phase 5: UI Integration & End-to-End Validation
* Connect the frontend framework to the hardware routing logic and storage modes.
* Verify both complete flows: Hybrid Mode (networked encryption/decryption) and Local Mode (exporting/importing the single file).
* Verify GDPR flows: erasure, retention warning, export audit log, k-anonymity suppression.
* Conduct stress tests with multi-page, high-resolution document batches (target: 30 students × 10 pages) across memory-constrained and modern hardware profiles.
* Penetration test the API authentication and authorization layer.
