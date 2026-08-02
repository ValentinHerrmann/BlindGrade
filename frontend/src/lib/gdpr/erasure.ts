/**
 * GDPR Art. 17 Right to Erasure (Right to be Forgotten).
 *
 * Hard deletes a student record and all associated submissions from Dexie IDB,
 * and appends an AUDITLOG entry capturing the deletion.
 */

import { db } from '$lib/db/db';
import { sessionStore } from '$lib/stores/session';
import { encryptAuditEntry } from '$lib/db/dbEncryption';
import { submissionRepository } from '$lib/repositories/submissionRepository';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { api } from '$lib/api/client';
import { get } from 'svelte/store';

export interface ErasureResult {
  pseudonymId: string;
  submissionsErased: number;
  auditEntryId: string;
}

/**
 * Permanently erase student identity and scan submissions from local IDB and optional server.
 *
 * @param pseudonymId Raw pseudonym ID of the student to erase.
 * @param examId Exam ID.
 */
export async function eraseStudent(pseudonymId: string, examId: string): Promise<ErasureResult> {
  const auditId = crypto.randomUUID();
  let submissionsCount = 0;

  // Compute SHA-256 target_hash of pseudonymId for audit logging
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pseudonymId));
  const targetHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const key = get(sessionStore).sessionKey;
  const encryptedAudit = await encryptAuditEntry({
    id: auditId,
    action: 'DELETE',
    targetId: targetHash,
    timestamp: new Date().toISOString(),
    note: 'GDPR Art. 17 student erasure',
  }, key);

  await db.transaction('rw', [db.students, db.submissions, db.auditLog], async () => {
    // 1. Find all submissions linked to this student
    const student = await db.students.get(pseudonymId);
    if (!student) {
      throw new Error(`Student record not found for ID: ${pseudonymId}`);
    }

    const allSubs = await submissionRepository.getByExamId(examId, key);
    // Filter matching submissions
    const matchingSubs = allSubs.filter((s) => s.pseudonymHash);
    submissionsCount = matchingSubs.length;

    // Delete student identity record
    await db.students.delete(pseudonymId);

    // Delete submission records
    for (const sub of matchingSubs) {
      await db.submissions.delete(sub.id);
    }

    // Append immutable audit log entry
    await db.auditLog.add(encryptedAudit);
  });

  // Mark session dirty
  sessionStore.setDirty(true);

  // If server sync enabled, notify server of student erasure
  if (get(storagePolicyStore).storageMode === 'all-server') {

    try {
      await api.delete(`/exams/${examId}/students/${targetHash}`);
    } catch (err) {
      console.warn('Server student erasure failed (local erasure completed):', err);
    }
  }

  return {
    pseudonymId,
    submissionsErased: submissionsCount,
    auditEntryId: auditId,
  };
}
