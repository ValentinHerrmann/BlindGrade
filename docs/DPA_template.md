# Data Processing Agreement (DPA) Template — Examance

This Data Processing Agreement ("DPA") supplements the main terms of service between the **Data Controller** (Educational Institution / School / University) and the **Data Processor** (Examance Hybrid Service Provider) pursuant to Article 28 of the General Data Protection Regulation (GDPR).

---

## 1. Scope and Object of Processing

1.1 **Subject Matter:** Processing of student examination scans, pseudonymized identity records, and grading scores for examination evaluation and grade administration.
1.2 **Duration:** For the duration of the educational institution's active subscription, plus applicable statutory document retention periods.
1.3 **Nature & Purpose:**
- Local zero-knowledge encryption of student personal data (PII).
- Server-side storage of encrypted blobs (AES-256-GCM).
- Anonymized group statistical analytics (subject to k ≥ 5 threshold enforcement).

---

## 2. Technical and Organizational Measures (TOMs)

Pursuant to GDPR Article 32, the Processor implements the following security guarantees:

1. **Zero-Knowledge Architecture:** Student names and identity numbers are encrypted client-side in the browser using AES-256-GCM before transmission. The server never receives raw student identity data.
2. **Deterministic Pseudonym Hashing:** Student submission records use HMAC-SHA-256 keyed with a client-derived exam secret (`pseudonym_hmac`).
3. **Strict Authentication:** Authentication tokens are issued exclusively via `httpOnly`, `Secure`, `SameSite=Strict` cookies.
4. **Tectonic Subprocess Isolation:** LaTeX compilation uses the system binary invoked with the `--untrusted` flag to block shell escape (`\write18`) and arbitrary filesystem access.
5. **k-Anonymity Controls:** Aggregated statistical analysis endpoints enforce a minimum $k \ge 5$ class size threshold before outputting mean or standard deviation metrics.

---

## 3. Data Subject Rights & Erasure

3.1 **Right to Erasure (Art. 17):** The Controller may execute an immediate, cascading hard-deletion of student identities and linked submission records via the API (`DELETE /api/v1/exams/{id}/students/{pseudonym_hmac}`) or the local settings management view.
3.2 **Audit Trail:** Every deletion generates an immutable audit record in the `audit_logs` table capturing the Controller's email and a SHA-256 hash of the target record.

---

## 4. Sub-Processors

4.1 The Processor shall not engage sub-processors without prior written authorization from the Controller.
4.2 Current approved sub-processors:
- PostgreSQL 16 Hosting Provider (Database at rest)
- Redis 7 Hosting Provider (Rate limiting cache)
