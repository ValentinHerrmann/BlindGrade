# BlindGrade Data Flow, Encryption-at-Rest, & Security Architecture

This document describes the privacy-first data storage architecture, client-side encryption lifecycle, session hygiene, and DevTools zero-exposure security model implemented in **BlindGrade**.

---

## 1. Overview & Security Invariants

BlindGrade uses a zero-knowledge, client-side encryption-at-rest model designed to prevent unauthorized access to sensitive exam data, student PII, scan images, and grading scores—even when inspecting browser storage via Developer Tools.

### Core Invariants
1. **No Unauthenticated DevTools Access**: When a user is locked or logged out, browser DevTools inspection reveals **zero unencrypted text** (no LaTeX preamble/body, exam metadata, answer keys, fallback codes, or raw scores). Storage is either completely purged (`server-synced` mode) or stored as opaque AES-256-GCM binary ciphertexts (`local-only` mode).
2. **Non-Extractable In-Memory Keys**: Crypto keys (`masterKey`, `sessionKey`) exist solely in volatile JavaScript memory as non-extractable Web Crypto `CryptoKey` handles. They are never written to LocalStorage, SessionStorage, or IndexedDB.
3. **Data Loss Prevention**: Edits and grading annotations are protected against tab closing/reloading (`beforeunload`) and SvelteKit client-side SPA navigation (`beforeNavigate` via `sessionStore.isDirty`).

---

## 2. Key Derivation & Encryption Architecture

```mermaid
flowchart TD
    Password[User Password] --> Argon2id[Argon2id WASM Key Derivation]
    Salt[Random 16-byte Salt] --> Argon2id
    Argon2id --> MasterKey[Master CryptoKey - Non-Extractable HKDF]
    MasterKey --> HKDF[HKDF-SHA-256 Key Derivation]
    Nonce[Random 12-byte Session Nonce] --> HKDF
    HKDF --> SessionKey[Session CryptoKey - Non-Extractable AES-256-GCM]

    SessionKey --> AESGCM[AES-256-GCM Encrypt / Decrypt]
    FreshIV[Fresh 12-byte Random IV] --> AESGCM
    RecordPayload[Record Payload / Text / LaTeX / PII] --> AESGCM
    AESGCM --> CiphertextPayload[Encrypted Uint8Array Blob in IndexedDB]
```

### Cryptographic Algorithms
* **Key Derivation (Master Key)**: Argon2id (`time=3, memory=64MB, parallelism=4, hashLen=32`).
* **Session Key Derivation**: HKDF-SHA-256 combining `masterKey` and a fresh 12-byte `sessionNonce`.
* **Symmetric Encryption**: AES-256-GCM with fresh 12-byte IV generated per operation via `crypto.getRandomValues`.

---

## 3. Data Storage Topology & Encryption-at-Rest

| Entity Table | Plaintext Index Fields | Encrypted Payload (`payloadCt` & `payloadIv`) | DevTools Exposure when Locked/Logged Out |
| :--- | :--- | :--- | :--- |
| `exams` | `id, teacherId, retentionUntil` | Title, LaTeX preamble, LaTeX template, info text, testart, klasse, datum, nr, fach, teacher name | Opaque Binary Ciphertext / Purged |
| `exercises` | `id, examId, topicTag, maxPoints` | Title, exercise name, LaTeX body, answer choices, correct answers | Opaque Binary Ciphertext / Purged |
| `examExercises` | `[examId+exerciseId], orderIndex` | N/A (UUID links only) | Standard IDB table |
| `students` | `pseudonymId, examId` | Fallback booklet code (`fallbackCode`), student PII (`piiCt`) | Opaque Binary Ciphertext / Purged |
| `submissions` | `id, examId, pseudonymHash` | Total score (`totalScore`), scan image blob (`scanCt`), annotations vector layer (`annotationCt`) | Opaque Binary Ciphertext / Purged |
| `exerciseScores` | `id, submissionId, exerciseId` | Score value (`score`), selected options | Opaque Binary Ciphertext / Purged |
| `auditLog` | `id, action, timestamp` | Action note details | Opaque Binary Ciphertext / Purged |

---

## 4. DevTools Security & Session Hygiene Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Page as SvelteKit App
    participant Memory as JS RAM (sessionStore)
    participant IDB as IndexedDB (BlindGrade)
    participant Server as Backend API

    User->>Page: Login (Email & Password)
    Page->>Server: POST /auth/login (httpOnly cookie set)
    Page->>Memory: Derive Master Key & Session Key in RAM
    Page->>IDB: Read & Decrypt Encrypted Payloads (AES-256-GCM)

    Note over Page,IDB: Active Session (Data Unlocked in Memory)

    User->>Page: Lock Session / Inactivity Timeout (30 min)
    Page->>Memory: Wipe Crypto Keys & Nonce from RAM
    alt Storage Policy == 'server-synced'
        Page->>IDB: Wipe IndexedDB (wipeDatabase())
        Note over IDB: IndexedDB completely empty in DevTools
    else Storage Policy == 'local-only'
        Note over IDB: IndexedDB contains only encrypted Uint8Array blobs
    end

    Note over User,IDB: Inspection via DevTools (F12 -> Application -> Storage -> IndexedDB)
```

---

## 5. Data Migration & Sync Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Store as Local Storage Policy
    participant IDB as Local IndexedDB
    participant Server as Backend API

    rect rgb(30, 41, 59)
    note right of User: Local-to-Server Sync
    User->>Store: Switch to 'server-synced'
    Store->>IDB: Read & Decrypt local records
    Store->>Server: POST /exams & /exercises
    Store->>Server: POST /exams/{id}/students (Client-encrypted PII)
    Store->>Server: POST /exams/{id}/submissions (Encrypted scans)
    end

    rect rgb(30, 41, 59)
    note right of User: Server-to-Local Purge
    User->>Store: Switch to 'local-only'
    Store->>User: Download encrypted .bgproj backup archive
    Store->>Server: POST /user/purge-server-student-data
    Server-->>Store: Soft-delete student data (7-day temporary retention)
    end
```

---

## 6. Data Loss Prevention Guards

### Internal Route Navigation Interceptor
SvelteKit `beforeNavigate` in `+layout.svelte` checks `sessionStore.isDirty`:
- If `isDirty` is true when clicking navigation links, the user is prompted to confirm before leaving.
- Prevents accidental loss of unsaved exercise edits or exam configurations.

### Canvas Grading Annotation Guard
In `exam/[id]/grade/+page.svelte`:
- Drawn pen strokes (`currentStrokes`) are tracked in component state.
- Navigating between student booklets (`prevStudent()` / `nextStudent()`) prompts the user if unsaved canvas annotations exist.
- Saving updates `db.submissions` with encrypted `annotationCt` and resets dirty state.
