/**
 * IndexedDB Record Encryption & Decryption Helpers.
 *
 * Ensures that all records written to Dexie IndexedDB have their sensitive payload
 * (including LaTeX templates, exercise text, answer keys, scores, and fallback codes)
 * encrypted with AES-256-GCM using the active in-memory sessionKey.
 *
 * When the session is locked or logged out (sessionKey is null), DevTools inspection
 * of IndexedDB reveals ONLY encrypted binary blobs (Uint8Array ciphertexts).
 */

import { encrypt, decrypt } from '$lib/crypto/aesGcm';
import type {
  ExamRecord,
  ExerciseRecord,
  ExerciseScoreRecord,
  StudentRecord,
  SubmissionRecord,
  AuditEntry,
} from './schema';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encrypt raw bytes with key. */
async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<{ ct: Uint8Array; iv: Uint8Array }> {
  const res = await encrypt(key, bytes);
  return { ct: res.ciphertext, iv: res.iv };
}

/** Decrypt raw bytes with key. */
async function decryptBytes(key: CryptoKey, ct: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  return await decrypt(key, ct, iv);
}

// ---------------------------------------------------------------------------
// ExamRecord
// ---------------------------------------------------------------------------

interface ExamPayload {
  title?: string;
  testart?: string;
  klasse?: string;
  datum?: string;
  nr?: string;
  fach?: string;
  lehrernachname?: string;
  infoText?: string;
  latexPreamble?: string;
  latexTemplate?: string;
  numVersions?: number;
}

export async function encryptExam(exam: ExamRecord, key: CryptoKey | null): Promise<ExamRecord> {
  const payload: ExamPayload = {
    title: exam.title,
    testart: exam.testart,
    klasse: exam.klasse,
    datum: exam.datum,
    nr: exam.nr,
    fach: exam.fach,
    lehrernachname: exam.lehrernachname,
    infoText: exam.infoText,
    latexPreamble: exam.latexPreamble,
    latexTemplate: exam.latexTemplate,
    numVersions: exam.numVersions,
  };

  let payloadCt = exam.payloadCt;
  let payloadIv = exam.payloadIv;

  if (key) {
    const jsonStr = JSON.stringify(payload);
    const { ct, iv } = await encryptBytes(key, encoder.encode(jsonStr));
    payloadCt = ct;
    payloadIv = iv;
  }

  return {
    id: exam.id,
    teacherId: exam.teacherId,
    retentionUntil: exam.retentionUntil,
    compilationStatus: exam.compilationStatus,
    createdAt: exam.createdAt,
    isDirty: exam.isDirty,
    payloadCt,
    payloadIv,
  };
}

export async function decryptExam(exam: ExamRecord, key: CryptoKey | null): Promise<ExamRecord> {
  const baseRecord: ExamRecord = {
    id: exam.id,
    teacherId: exam.teacherId,
    retentionUntil: exam.retentionUntil,
    compilationStatus: exam.compilationStatus,
    createdAt: exam.createdAt,
    isDirty: exam.isDirty,
    payloadCt: exam.payloadCt,
    payloadIv: exam.payloadIv,
  };

  if (!key || !exam.payloadCt || !exam.payloadIv) {
    return baseRecord;
  }

  try {
    const bytes = await decryptBytes(key, exam.payloadCt, exam.payloadIv);
    const payload: ExamPayload = JSON.parse(decoder.decode(bytes));
    return {
      ...baseRecord,
      ...payload,
    };
  } catch (err) {
    console.error('Failed to decrypt exam record:', err);
    return baseRecord;
  }
}

// ---------------------------------------------------------------------------
// ExerciseRecord
// ---------------------------------------------------------------------------

interface ExercisePayload {
  title?: string;
  name?: string;
  latexBody?: string;
  options?: string[];
  correctAnswers?: number[];
}

export async function encryptExercise(exercise: ExerciseRecord, key: CryptoKey | null): Promise<ExerciseRecord> {
  const payload: ExercisePayload = {
    title: exercise.title,
    name: exercise.name,
    latexBody: exercise.latexBody,
    options: exercise.options,
    correctAnswers: exercise.correctAnswers,
  };

  let payloadCt = exercise.payloadCt;
  let payloadIv = exercise.payloadIv;

  if (key) {
    const jsonStr = JSON.stringify(payload);
    const { ct, iv } = await encryptBytes(key, encoder.encode(jsonStr));
    payloadCt = ct;
    payloadIv = iv;
  }

  return {
    id: exercise.id,
    teacherId: exercise.teacherId,
    examId: exercise.examId,
    orderIndex: exercise.orderIndex,
    maxPoints: exercise.maxPoints,
    topicTag: exercise.topicTag,
    grade: exercise.grade,
    subject: exercise.subject,
    version: exercise.version,
    exerciseGroupId: exercise.exerciseGroupId,
    variantKey: exercise.variantKey,
    isCurrent: exercise.isCurrent,
    createdAt: exercise.createdAt,
    updatedAt: exercise.updatedAt,
    questionType: exercise.questionType,
    penalty: exercise.penalty,
    payloadCt,
    payloadIv,
  };
}

export async function decryptExercise(exercise: ExerciseRecord, key: CryptoKey | null): Promise<ExerciseRecord> {
  const baseRecord: ExerciseRecord = {
    id: exercise.id,
    teacherId: exercise.teacherId,
    examId: exercise.examId,
    orderIndex: exercise.orderIndex,
    maxPoints: exercise.maxPoints,
    topicTag: exercise.topicTag,
    grade: exercise.grade,
    subject: exercise.subject,
    version: exercise.version,
    exerciseGroupId: exercise.exerciseGroupId,
    variantKey: exercise.variantKey,
    isCurrent: exercise.isCurrent,
    createdAt: exercise.createdAt,
    updatedAt: exercise.updatedAt,
    questionType: exercise.questionType,
    penalty: exercise.penalty,
    payloadCt: exercise.payloadCt,
    payloadIv: exercise.payloadIv,
  };

  if (!key || !exercise.payloadCt || !exercise.payloadIv) {
    return baseRecord;
  }

  try {
    const bytes = await decryptBytes(key, exercise.payloadCt, exercise.payloadIv);
    const payload: ExercisePayload = JSON.parse(decoder.decode(bytes));
    return {
      ...baseRecord,
      ...payload,
    };
  } catch (err) {
    console.error('Failed to decrypt exercise record:', err);
    return baseRecord;
  }
}

// ---------------------------------------------------------------------------
// ExerciseScoreRecord
// ---------------------------------------------------------------------------

interface ScorePayload {
  score?: number;
  selectedOptions?: number[];
}

export async function encryptScore(scoreRec: ExerciseScoreRecord, key: CryptoKey | null): Promise<ExerciseScoreRecord> {
  const payload: ScorePayload = {
    score: scoreRec.score,
    selectedOptions: scoreRec.selectedOptions,
  };

  let payloadCt = scoreRec.payloadCt;
  let payloadIv = scoreRec.payloadIv;

  if (key) {
    const jsonStr = JSON.stringify(payload);
    const { ct, iv } = await encryptBytes(key, encoder.encode(jsonStr));
    payloadCt = ct;
    payloadIv = iv;
  }

  return {
    id: scoreRec.id,
    submissionId: scoreRec.submissionId,
    exerciseId: scoreRec.exerciseId,
    payloadCt,
    payloadIv,
  };
}

export async function decryptScore(scoreRec: ExerciseScoreRecord, key: CryptoKey | null): Promise<ExerciseScoreRecord> {
  const baseRecord: ExerciseScoreRecord = {
    id: scoreRec.id,
    submissionId: scoreRec.submissionId,
    exerciseId: scoreRec.exerciseId,
    payloadCt: scoreRec.payloadCt,
    payloadIv: scoreRec.payloadIv,
  };

  if (!key || !scoreRec.payloadCt || !scoreRec.payloadIv) {
    return baseRecord;
  }

  try {
    const bytes = await decryptBytes(key, scoreRec.payloadCt, scoreRec.payloadIv);
    const payload: ScorePayload = JSON.parse(decoder.decode(bytes));
    return {
      ...baseRecord,
      ...payload,
    };
  } catch (err) {
    console.error('Failed to decrypt score record:', err);
    return baseRecord;
  }
}

// ---------------------------------------------------------------------------
// StudentRecord
// ---------------------------------------------------------------------------

interface StudentPayload {
  fallbackCode?: string;
}

export async function encryptStudent(student: StudentRecord, key: CryptoKey | null): Promise<StudentRecord> {
  const payload: StudentPayload = {
    fallbackCode: student.fallbackCode,
  };

  let payloadCt = student.payloadCt;
  let payloadIv = student.payloadIv;

  if (key) {
    const jsonStr = JSON.stringify(payload);
    const { ct, iv } = await encryptBytes(key, encoder.encode(jsonStr));
    payloadCt = ct;
    payloadIv = iv;
  }

  return {
    pseudonymId: student.pseudonymId,
    examId: student.examId,
    piiCt: student.piiCt,
    piiIv: student.piiIv,
    payloadCt,
    payloadIv,
  };
}

export async function decryptStudent(student: StudentRecord, key: CryptoKey | null): Promise<StudentRecord> {
  const baseRecord: StudentRecord = {
    pseudonymId: student.pseudonymId,
    examId: student.examId,
    piiCt: student.piiCt,
    piiIv: student.piiIv,
    payloadCt: student.payloadCt,
    payloadIv: student.payloadIv,
  };

  if (!key || !student.payloadCt || !student.payloadIv) {
    return baseRecord;
  }

  try {
    const bytes = await decryptBytes(key, student.payloadCt, student.payloadIv);
    const payload: StudentPayload = JSON.parse(decoder.decode(bytes));
    return {
      ...baseRecord,
      ...payload,
    };
  } catch (err) {
    console.error('Failed to decrypt student record payload:', err);
    return baseRecord;
  }
}

// ---------------------------------------------------------------------------
// SubmissionRecord
// ---------------------------------------------------------------------------

interface SubmissionPayload {
  totalScore?: number;
}

export async function encryptSubmission(submission: SubmissionRecord, key: CryptoKey | null): Promise<SubmissionRecord> {
  const payload: SubmissionPayload = {
    totalScore: submission.totalScore,
  };

  let payloadCt = submission.payloadCt;
  let payloadIv = submission.payloadIv;

  if (key) {
    const jsonStr = JSON.stringify(payload);
    const { ct, iv } = await encryptBytes(key, encoder.encode(jsonStr));
    payloadCt = ct;
    payloadIv = iv;
  }

  return {
    id: submission.id,
    examId: submission.examId,
    pseudonymHash: submission.pseudonymHash,
    scanCt: submission.scanCt,
    scanIv: submission.scanIv,
    annotationCt: submission.annotationCt,
    annotationIv: submission.annotationIv,
    createdAt: submission.createdAt,
    payloadCt,
    payloadIv,
  };
}

export async function decryptSubmission(submission: SubmissionRecord, key: CryptoKey | null): Promise<SubmissionRecord> {
  const baseRecord: SubmissionRecord = {
    id: submission.id,
    examId: submission.examId,
    pseudonymHash: submission.pseudonymHash,
    scanCt: submission.scanCt,
    scanIv: submission.scanIv,
    annotationCt: submission.annotationCt,
    annotationIv: submission.annotationIv,
    createdAt: submission.createdAt,
    payloadCt: submission.payloadCt,
    payloadIv: submission.payloadIv,
  };

  if (!key || !submission.payloadCt || !submission.payloadIv) {
    return baseRecord;
  }

  try {
    const bytes = await decryptBytes(key, submission.payloadCt, submission.payloadIv);
    const payload: SubmissionPayload = JSON.parse(decoder.decode(bytes));
    return {
      ...baseRecord,
      ...payload,
    };
  } catch (err) {
    console.error('Failed to decrypt submission payload:', err);
    return baseRecord;
  }
}

// ---------------------------------------------------------------------------
// AuditEntry
// ---------------------------------------------------------------------------

interface AuditPayload {
  note?: string;
}

export async function encryptAuditEntry(entry: AuditEntry, key: CryptoKey | null): Promise<AuditEntry> {
  const payload: AuditPayload = {
    note: entry.note,
  };

  let payloadCt = entry.payloadCt;
  let payloadIv = entry.payloadIv;

  if (key) {
    const jsonStr = JSON.stringify(payload);
    const { ct, iv } = await encryptBytes(key, encoder.encode(jsonStr));
    payloadCt = ct;
    payloadIv = iv;
  }

  return {
    id: entry.id,
    action: entry.action,
    targetId: entry.targetId,
    timestamp: entry.timestamp,
    payloadCt,
    payloadIv,
  };
}

export async function decryptAuditEntry(entry: AuditEntry, key: CryptoKey | null): Promise<AuditEntry> {
  const baseRecord: AuditEntry = {
    id: entry.id,
    action: entry.action,
    targetId: entry.targetId,
    timestamp: entry.timestamp,
    payloadCt: entry.payloadCt,
    payloadIv: entry.payloadIv,
  };

  if (!key || !entry.payloadCt || !entry.payloadIv) {
    return baseRecord;
  }

  try {
    const bytes = await decryptBytes(key, entry.payloadCt, entry.payloadIv);
    const payload: AuditPayload = JSON.parse(decoder.decode(bytes));
    return {
      ...baseRecord,
      ...payload,
    };
  } catch (err) {
    console.error('Failed to decrypt audit entry payload:', err);
    return baseRecord;
  }
}

// ---------------------------------------------------------------------------
// Dexie High-Level Encrypted CRUD Operations
// ---------------------------------------------------------------------------

import { db } from './db';

export async function loadExamsEncrypted(key: CryptoKey | null): Promise<ExamRecord[]> {
  const rawExams = await db.exams.toArray();
  return Promise.all(rawExams.map((e) => decryptExam(e, key)));
}

export async function loadExamEncrypted(id: string, key: CryptoKey | null): Promise<ExamRecord | undefined> {
  const raw = await db.exams.get(id);
  if (!raw) return undefined;
  return decryptExam(raw, key);
}

export async function saveExamEncrypted(exam: ExamRecord, key: CryptoKey | null): Promise<string> {
  const encrypted = await encryptExam(exam, key);
  return db.exams.put(encrypted);
}

export async function loadExercisesEncrypted(key: CryptoKey | null): Promise<ExerciseRecord[]> {
  const rawExercises = await db.exercises.toArray();
  return Promise.all(rawExercises.map((ex) => decryptExercise(ex, key)));
}

export async function loadExamExercisesEncrypted(examId: string, key: CryptoKey | null): Promise<ExerciseRecord[]> {
  const rawExercises = await db.exercises.where('examId').equals(examId).toArray();
  return Promise.all(rawExercises.map((ex) => decryptExercise(ex, key)));
}

export async function saveExerciseEncrypted(exercise: ExerciseRecord, key: CryptoKey | null): Promise<string> {
  const encrypted = await encryptExercise(exercise, key);
  return db.exercises.put(encrypted);
}

export async function loadStudentsEncrypted(key: CryptoKey | null): Promise<StudentRecord[]> {
  const rawStudents = await db.students.toArray();
  return Promise.all(rawStudents.map((st) => decryptStudent(st, key)));
}

export async function saveStudentEncrypted(student: StudentRecord, key: CryptoKey | null): Promise<string> {
  const encrypted = await encryptStudent(student, key);
  return db.students.put(encrypted);
}

export async function loadSubmissionsEncrypted(key: CryptoKey | null): Promise<SubmissionRecord[]> {
  const rawSubmissions = await db.submissions.toArray();
  return Promise.all(rawSubmissions.map((sub) => decryptSubmission(sub, key)));
}

export async function saveSubmissionEncrypted(submission: SubmissionRecord, key: CryptoKey | null): Promise<string> {
  const encrypted = await encryptSubmission(submission, key);
  return db.submissions.put(encrypted);
}

export async function loadScoresEncrypted(submissionId: string, key: CryptoKey | null): Promise<ExerciseScoreRecord[]> {
  const rawScores = await db.exerciseScores.where('submissionId').equals(submissionId).toArray();
  return Promise.all(rawScores.map((sc) => decryptScore(sc, key)));
}

export async function saveScoreEncrypted(scoreRec: ExerciseScoreRecord, key: CryptoKey | null): Promise<string> {
  const encrypted = await encryptScore(scoreRec, key);
  return db.exerciseScores.put(encrypted);
}


