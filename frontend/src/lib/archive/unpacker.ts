/**
 * .bgproj Archive Unpacker.
 *
 * Atomically decrypts, authenticates, decompresses, and imports a .bgproj archive file.
 *
 * ATOMIC DECRYPTION & CHECKSUM INVARIANT:
 * The entire outer AES-GCM envelope is decrypted & authenticated BEFORE any inner record is parsed.
 * Inner records are verified against records_checksum before writing to IDB.
 */

import {
  MAGIC_BYTES,
  FORMAT_VERSION,
  RecordType,
  type ArchiveManifest,
  type ProgressEventData,
} from './format';
import { deriveKey } from '$lib/crypto/keyDerivation';
import { deriveSessionKey } from '$lib/crypto/sessionKey';
import { db } from '$lib/db/db';
import { sessionStore } from '$lib/stores/session';
import {
  encryptExam,
  encryptExercise,
  encryptStudent,
  encryptSubmission,
  encryptScore,
  encryptAuditEntry,
} from '$lib/db/dbEncryption';
import { get } from 'svelte/store';
import { inflateSync } from 'fflate';
import type { ExamRecord, ExerciseRecord, ExerciseScoreRecord, StudentRecord, SubmissionRecord, AuditEntry } from '$lib/db/schema';

export interface UnpackResult {
  manifest: ArchiveManifest;
  examCount: number;
  studentCount: number;
  submissionCount: number;
}

/**
 * Unpack and import a .bgproj archive into Dexie IDB.
 *
 * @param fileBytes Raw bytes of the .bgproj file.
 * @param password Teacher's password to re-derive key from header salt.
 * @param onProgress Progress event callback.
 */
export async function unpackProject(
  fileBytes: Uint8Array,
  password: string,
  onProgress?: (e: ProgressEventData) => void
): Promise<UnpackResult> {
  onProgress?.({ stage: 'unpacking', current: 0, total: 100 });

  // 1. Verify Magic Header
  if (
    fileBytes[0] !== MAGIC_BYTES[0] ||
    fileBytes[1] !== MAGIC_BYTES[1] ||
    fileBytes[2] !== MAGIC_BYTES[2] ||
    fileBytes[3] !== MAGIC_BYTES[3]
  ) {
    throw new Error('Invalid file format: Magic bytes mismatch (not a .bgproj file).');
  }

  // 2. Verify Version
  const version = fileBytes[4];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${version}. Required: ${FORMAT_VERSION}`);
  }

  // 3. Extract Salt & Nonce & Ciphertext Length
  const salt = new Uint8Array(fileBytes.subarray(5, 21));
  const nonce = new Uint8Array(fileBytes.subarray(21, 33));

  const view = new DataView(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  const ctLenLow = view.getUint32(33, true);
  const ctLenHigh = view.getUint32(37, true);
  const ctLen = ctLenLow + ctLenHigh * 0x100000000;

  const ciphertext = new Uint8Array(fileBytes.subarray(41, 41 + ctLen));
  if (ciphertext.length !== ctLen) {
    throw new Error('Corrupted archive: Ciphertext length mismatch.');
  }

  onProgress?.({ stage: 'salt', current: 20, total: 100 });

  // 4. Derive key from header salt + password
  const masterKey = await deriveKey(password, salt);

  onProgress?.({ stage: 'encrypt', current: 40, total: 100 });

  // 5. ATOMIC OUTER DECRYPTION: Decrypt and authenticate entire envelope
  let decompressedInner: Uint8Array;
  try {
    const gcmKey = await deriveSessionKey(masterKey, nonce);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer },
      gcmKey,
      ciphertext.buffer as ArrayBuffer
    );
    onProgress?.({ stage: 'compress', current: 60, total: 100 });

    // 6. Decompress inner bundle
    decompressedInner = inflateSync(new Uint8Array(decryptedBuffer));
  } catch (err) {
    throw new Error('Decryption failed: Invalid password or tampered/corrupted archive.');
  }

  onProgress?.({ stage: 'verifying', current: 80, total: 100 });

  // 7. Parse framed inner records
  let offset = 0;
  const dataView = new DataView(
    decompressedInner.buffer,
    decompressedInner.byteOffset,
    decompressedInner.byteLength
  );

  let manifest: ArchiveManifest | null = null;
  const exams: ExamRecord[] = [];
  const exercises: ExerciseRecord[] = [];
  const examExercises: Array<{ examId: string; exerciseId: string; orderIndex: number }> = [];
  const exerciseScores: ExerciseScoreRecord[] = [];
  const students: StudentRecord[] = [];
  const submissions: SubmissionRecord[] = [];
  const auditLogs: AuditEntry[] = [];

  const rawDataRecordChunks: Uint8Array[] = [];

  while (offset < decompressedInner.length) {
    if (offset + 12 > decompressedInner.length) break;

    const type = dataView.getUint32(offset, true) as RecordType;
    const lenLow = dataView.getUint32(offset + 4, true);
    const lenHigh = dataView.getUint32(offset + 8, true);
    const payloadLen = lenLow + lenHigh * 0x100000000;

    const recordStart = offset;
    const payloadStart = offset + 12;
    const recordEnd = payloadStart + payloadLen;

    if (recordEnd > decompressedInner.length) {
      throw new Error('Corrupted record frame: exceeds inner bundle size.');
    }

    const payloadBytes = decompressedInner.subarray(payloadStart, recordEnd);
    const payloadStr = new TextDecoder().decode(payloadBytes);

    if (type === RecordType.MANIFEST) {
      manifest = JSON.parse(payloadStr) as ArchiveManifest;
    } else {
      // Save entire framed record bytes for running checksum calculation
      rawDataRecordChunks.push(decompressedInner.subarray(recordStart, recordEnd));

      if (type === RecordType.EXAM) {
        exams.push(JSON.parse(payloadStr));
      } else if (type === RecordType.EXERCISE) {
        exercises.push(JSON.parse(payloadStr));
      } else if (type === RecordType.EXAMEXERCISE) {
        examExercises.push(JSON.parse(payloadStr));
      } else if (type === RecordType.EXERCISESCORE) {
        exerciseScores.push(JSON.parse(payloadStr));
      } else if (type === RecordType.STUDENT) {
        const raw = JSON.parse(payloadStr);
        students.push({
          pseudonymId: raw.pseudonym_id,
          examId: raw.exam_id || raw.examId,
          fallbackCode: raw.fallback_code,
          piiCt: new Uint8Array(raw.pii_ciphertext),
          piiIv: new Uint8Array(raw.iv),
        });
      } else if (type === RecordType.SUBMISSION) {
        const raw = JSON.parse(payloadStr);
        submissions.push({
          id: raw.id,
          examId: raw.exam_id || raw.examId,
          pseudonymHash: raw.pseudonym_hash,
          totalScore: raw.total_score,
          scanCt: raw.scan_blob ? new Uint8Array(raw.scan_blob) : undefined,
          scanIv: raw.scan_iv ? new Uint8Array(raw.scan_iv) : undefined,
          annotationCt: raw.annotation_blob ? new Uint8Array(raw.annotation_blob) : undefined,
          annotationIv: raw.annotation_iv ? new Uint8Array(raw.annotation_iv) : undefined,
          createdAt: raw.created_at,
        });
      } else if (type === RecordType.AUDITLOG) {
        auditLogs.push(JSON.parse(payloadStr));
      }
    }

    offset = recordEnd;
  }

  if (!manifest) {
    throw new Error('Archive corrupted: missing MANIFEST record.');
  }

  // 8. Verify records_checksum over all non-manifest record bytes concatenated
  const totalRecordBytes = rawDataRecordChunks.reduce((acc, c) => acc + c.length, 0);
  const concatenatedDataRecords = new Uint8Array(totalRecordBytes);
  let concatOffset = 0;
  for (const chunk of rawDataRecordChunks) {
    concatenatedDataRecords.set(chunk, concatOffset);
    concatOffset += chunk.length;
  }

  const checksumDigest = await crypto.subtle.digest('SHA-256', concatenatedDataRecords);
  const computedChecksum = Array.from(new Uint8Array(checksumDigest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedChecksum !== manifest.records_checksum) {
    throw new Error(
      `Checksum mismatch! Archive may have been tampered. Expected ${manifest.records_checksum}, got ${computedChecksum}`
    );
  }

  // 9. Import verified records into Dexie IDB
  const key = get(sessionStore).sessionKey;
  const encExams = await Promise.all(exams.map((e) => encryptExam(e, key)));
  const encExercises = await Promise.all(exercises.map((e) => encryptExercise(e, key)));
  const encStudents = await Promise.all(students.map((st) => encryptStudent(st, key)));
  const encSubmissions = await Promise.all(submissions.map((sub) => encryptSubmission(sub, key)));
  const encScores = await Promise.all(exerciseScores.map((es) => encryptScore(es, key)));
  const encAuditLogs = await Promise.all(auditLogs.map((log) => encryptAuditEntry(log, key)));

  await db.transaction('rw', [db.exams, db.exercises, db.examExercises, db.students, db.submissions, db.exerciseScores, db.auditLog], async () => {
    if (encExams.length > 0) await db.exams.bulkPut(encExams);
    if (encExercises.length > 0) await db.exercises.bulkPut(encExercises);
    if (examExercises.length > 0) await db.examExercises.bulkPut(examExercises);
    if (encStudents.length > 0) await db.students.bulkPut(encStudents);
    if (encSubmissions.length > 0) await db.submissions.bulkPut(encSubmissions);
    if (encScores.length > 0) await db.exerciseScores.bulkPut(encScores);
    if (encAuditLogs.length > 0) await db.auditLog.bulkPut(encAuditLogs);
  });

  onProgress?.({ stage: 'complete', current: 100, total: 100 });

  return {
    manifest,
    examCount: exams.length,
    studentCount: students.length,
    submissionCount: submissions.length,
  };
}
