/**
 * Audit log helper for CSV and PDF grade exports.
 */

import { db } from '$lib/db/db';
import { encryptAuditEntry } from '$lib/db/dbEncryption';

/**
 * Log a CSV or data export action to the audit log.
 *
 * @param examId Exam ID being exported.
 * @param exportFormat Format string (e.g. 'CSV', '.bgproj', 'PDF')
 * @param key Encryption key from active session.
 */
export async function logExportAction(examId: string, exportFormat: string, key: CryptoKey | null): Promise<string> {
  const auditId = crypto.randomUUID();

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(examId));
  const targetHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const plainEntry = {
    id: auditId,
    action: 'EXPORT' as const,
    targetId: targetHash,
    timestamp: new Date().toISOString(),
    note: `Grade export in format: ${exportFormat}`,
  };

  const encrypted = await encryptAuditEntry(plainEntry, key);
  await db.auditLog.add(encrypted);

  return auditId;
}
