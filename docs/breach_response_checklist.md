# GDPR Incident & Data Breach Response Checklist

> **Regulatory Requirement:** GDPR Article 33 requires notification to the supervisory authority within **72 hours** of becoming aware of a personal data breach, unless the breach is unlikely to result in a risk to the rights and freedoms of natural persons.

---

## Phase 1: Immediate Containment (Hours 0 – 4)

- [ ] **1. Revoke Refresh Tokens & Sessions:** Execute database command to invalidate active sessions for compromised accounts:
  ```sql
  UPDATE refresh_tokens SET revoked = true WHERE teacher_id = '<COMPROMISED_TEACHER_ID>';
  ```
- [ ] **2. Rotate Application Secrets:** Immediately update `SECRET_KEY` in environment configuration and restart backend workers.
- [ ] **3. Inspect Immutable Audit Logs:** Query `audit_logs` table for suspicious `EXPORT` or `DELETE` activities:
  ```sql
  SELECT * FROM audit_logs WHERE created_at >= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC;
  ```
- [ ] **4. Isolate Infrastructure:** If server compromise is suspected, isolate the application container network while preserving database logs.

---

## Phase 2: Impact Assessment (Hours 4 – 24)

- [ ] **5. Determine Exposure Scope:**
  - Verify whether encrypted PII blobs (`pii_ciphertext`) were accessed.
  - *Risk Mitigation Assessment:* Because PII is encrypted client-side with AES-256-GCM using keys derived via Argon2id from the teacher's master password, exfiltrated database dumps without the master password remain cryptographically protected.
- [ ] **6. Determine Data Subject Impact:** Identify affected exams and number of enrolled students.

---

## Phase 3: Regulatory Notification (Hours 24 – 72)

- [ ] **7. Notify Lead Supervisory Authority (Art. 33):** If unencrypted PII or master key compromise occurred, file formal notification containing:
  - Description of the nature of the breach.
  - Name and contact details of Data Protection Officer (DPO).
  - Likely consequences of the breach.
  - Measures taken or proposed to address the breach.
- [ ] **8. Data Subject Notification (Art. 34):** If high risk to individuals is established, notify affected students/teachers without undue delay.

---

## Phase 4: Post-Mortem & Remediation

- [ ] **9. Root Cause Analysis:** Document entry vector (e.g. credential theft, CORS misconfiguration, dependency vulnerability).
- [ ] **10. Re-verify SRI & Dependency Integrity:** Run `npm run sri:verify` and `pip-audit`.
