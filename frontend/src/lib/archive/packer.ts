/**
 * .bgproj Archive Packer.
 *
 * Encrypts and bundles all Dexie IDB stores into an authenticated, encrypted .bgproj file.
 *
 * CRITICAL NONCE FRESHNESS INVARIANT:
 * Generates a fresh random 16-byte Argon2id salt AND a fresh random 12-byte GCM nonce
 * at the start of EVERY export.
 */

import {
  MAGIC_BYTES,
  FORMAT_VERSION,
  RecordType,
  type ArchiveManifest,
  type ProgressEventData,
} from './format';
import { deriveKey, generateSalt } from '$lib/crypto/keyDerivation';
import { deriveArchiveSecret, deriveSessionKey } from '$lib/crypto/sessionKey';
import { hmacSha256Hex, importHmacKey } from '$lib/crypto/hmac';
import { db } from '$lib/db/db';
import { sessionStore } from '$lib/stores/session';
import {
  loadExamsEncrypted,
  loadExercisesEncrypted,
  loadStudentsEncrypted,
  loadSubmissionsEncrypted,
  decryptAuditEntry,
  decryptScore,
} from '$lib/db/dbEncryption';
import { get } from 'svelte/store';
import { deflateSync } from 'fflate';

/**
 * Frame a record payload into byte representation:
 * [4 bytes RecordType (uint32 LE)] [8 bytes PayloadLength (uint64 LE)] [N bytes Payload]
 */
export function frameRecord(type: RecordType, payload: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + 8 + payload.length);
  const view = new DataView(framed.buffer);

  // Record type
  view.setUint32(0, type, true);

  // Length (uint64 LE)
  const len = payload.length;
  view.setUint32(4, len & 0xffffffff, true);
  view.setUint32(8, Math.floor(len / 0x100000000), true);

  framed.set(payload, 12);
  return framed;
}

/**
 * Pack all current Dexie IDB data into an encrypted .bgproj ArrayBuffer.
 *
 * @param password Password used to derive the Argon2id key.
 * @param onProgress Progress event callback.
 */
export async function packProject(
  password: string,
  onProgress?: (e: ProgressEventData) => void
): Promise<Uint8Array> {
  onProgress?.({ stage: 'salt', current: 0, total: 100 });

  // 1. NONCE & SALT FRESHNESS: Generate fresh salt and nonce for every single export
  const salt = generateSalt();
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  // 2. Derive fresh master key & archive secret
  const masterKey = await deriveKey(password, salt);
  const archiveSecretBuffer = await deriveArchiveSecret(masterKey);
  const archiveHmacKey = await importHmacKey(new Uint8Array(archiveSecretBuffer));

  // 3. Collect records from IDB
  const key = get(sessionStore).sessionKey;
  const exams = await loadExamsEncrypted(key);
  const exercises = await loadExercisesEncrypted(key);
  const students = await loadStudentsEncrypted(key);
  const submissions = await loadSubmissionsEncrypted(key);
  const rawScores = await db.exerciseScores.toArray();
  const exerciseScores = await Promise.all(rawScores.map(s => decryptScore(s, key)));
  const rawAuditLogs = await db.auditLog.toArray();
  const auditLogs = await Promise.all(rawAuditLogs.map(l => decryptAuditEntry(l, key)));
  const examExercises = await db.examExercises.toArray();

  const recordChunks: Uint8Array[] = [];

  // Frame EXAM records
  for (const exam of exams) {
    const payload = new TextEncoder().encode(JSON.stringify(exam));
    recordChunks.push(frameRecord(RecordType.EXAM, payload));
  }

  // Frame EXERCISE records
  for (const ex of exercises) {
    const payload = new TextEncoder().encode(JSON.stringify(ex));
    recordChunks.push(frameRecord(RecordType.EXERCISE, payload));
  }

  // Frame EXAMEXERCISE records
  for (const ee of examExercises) {
    const payload = new TextEncoder().encode(JSON.stringify(ee));
    recordChunks.push(frameRecord(RecordType.EXAMEXERCISE, payload));
  }

  // Frame EXERCISESCORE records
  for (const es of exerciseScores) {
    const payload = new TextEncoder().encode(JSON.stringify(es));
    recordChunks.push(frameRecord(RecordType.EXERCISESCORE, payload));
  }

  // Frame STUDENT records
  for (const st of students) {
    const payload = new TextEncoder().encode(
      JSON.stringify({
        pseudonym_id: st.pseudonymId,
        exam_id: st.examId,
        fallback_code: st.fallbackCode,
        pii_ciphertext: Array.from(st.piiCt),
        iv: Array.from(st.piiIv),
      })
    );
    recordChunks.push(frameRecord(RecordType.STUDENT, payload));
  }

  // Frame SUBMISSION records (hashes raw pseudonym_id using archive secret)
  for (const sub of submissions) {
    let pseudonymHash = sub.pseudonymHash;
    // If we have local student matching, re-verify hash
    const matchingStudent = students.find((s) => s.examId === sub.examId);
    if (matchingStudent) {
      pseudonymHash = await hmacSha256Hex(matchingStudent.pseudonymId, archiveHmacKey);
    }

    const payload = new TextEncoder().encode(
      JSON.stringify({
        id: sub.id,
        exam_id: sub.examId,
        pseudonym_hash: pseudonymHash,
        total_score: sub.totalScore,
        scan_blob: sub.scanCt ? Array.from(sub.scanCt) : null,
        scan_iv: sub.scanIv ? Array.from(sub.scanIv) : null,
        annotation_blob: sub.annotationCt ? Array.from(sub.annotationCt) : null,
        annotation_iv: sub.annotationIv ? Array.from(sub.annotationIv) : null,
        created_at: sub.createdAt,
      })
    );
    recordChunks.push(frameRecord(RecordType.SUBMISSION, payload));
  }

  // Frame AUDITLOG records
  for (const log of auditLogs) {
    const payload = new TextEncoder().encode(JSON.stringify(log));
    recordChunks.push(frameRecord(RecordType.AUDITLOG, payload));
  }

  // 4. Compute running SHA-256 over all framed data records
  const totalRecordBytes = recordChunks.reduce((acc, c) => acc + c.length, 0);
  const concatenatedRecords = new Uint8Array(totalRecordBytes);
  let offset = 0;
  for (const chunk of recordChunks) {
    concatenatedRecords.set(chunk, offset);
    offset += chunk.length;
  }

  const checksumDigest = await crypto.subtle.digest('SHA-256', concatenatedRecords);
  const recordsChecksum = Array.from(new Uint8Array(checksumDigest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // 5. Create MANIFEST record (always first)
  const manifestData: ArchiveManifest = {
    version: '1.0',
    created_at: new Date().toISOString(),
    expires_at: exams[0]?.retentionUntil || new Date(Date.now() + 365 * 86400000).toISOString(),
    mode: 'local',
    exam_count: exams.length,
    student_count: students.length,
    records_checksum: recordsChecksum,
  };

  const manifestPayload = new TextEncoder().encode(JSON.stringify(manifestData));
  const manifestRecord = frameRecord(RecordType.MANIFEST, manifestPayload);

  // Combine MANIFEST + data records
  const innerBundlePlaintext = new Uint8Array(manifestRecord.length + concatenatedRecords.length);
  innerBundlePlaintext.set(manifestRecord, 0);
  innerBundlePlaintext.set(concatenatedRecords, manifestRecord.length);

  onProgress?.({ stage: 'compress', current: 50, total: 100 });

  // 6. Compress inner bundle using DEFLATE level 6
  const compressedInnerBundle = deflateSync(innerBundlePlaintext, { level: 6 });

  onProgress?.({ stage: 'encrypt', current: 75, total: 100 });

  // 7. Encrypt entire compressed inner bundle with AES-256-GCM
  const gcmKey = await deriveSessionKey(masterKey, nonce);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
    gcmKey,
    compressedInnerBundle.buffer as ArrayBuffer
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);

  // 8. Assemble final outer file structure:
  // [4b magic] [1b ver] [16b salt] [12b nonce] [8b ct_len] [N bytes ct]
  const finalFile = new Uint8Array(4 + 1 + 16 + 12 + 8 + ciphertext.length);
  finalFile.set(MAGIC_BYTES, 0);
  finalFile[4] = FORMAT_VERSION;
  finalFile.set(salt, 5);
  finalFile.set(nonce, 21);

  const view = new DataView(finalFile.buffer);
  const ctLen = ciphertext.length;
  view.setUint32(33, ctLen & 0xffffffff, true);
  view.setUint32(37, Math.floor(ctLen / 0x100000000), true);

  finalFile.set(ciphertext, 41);

  onProgress?.({ stage: 'complete', current: 100, total: 100 });

  return finalFile;
}
