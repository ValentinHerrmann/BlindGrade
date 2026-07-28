/**
 * Dexie IndexedDB instance — all BlindGrade local stores.
 *
 * Tables:
 *   exams        — plaintext metadata (no PII)
 *   exercises    — plaintext exercise library
 *   examExercises — junction table linking exams to exercises
 *   students     — { pseudonymId, fallbackCode, piiCt, piiIv } — PII encrypted
 *   submissions  — scan + annotation ciphertexts only
 *   auditLog     — local audit trail, merged into .bgproj on export
 */

import { browser } from '$app/environment';
import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry,
  ExamExerciseRecord,
  ExamRecord,
  ExerciseRecord,
  ExerciseScoreRecord,
  StudentRecord,
  SubmissionRecord,
} from './schema';

export class BlindGradeDB extends Dexie {
  exams!: Table<ExamRecord>;
  exercises!: Table<ExerciseRecord>;
  examExercises!: Table<ExamExerciseRecord>;
  students!: Table<StudentRecord>;
  submissions!: Table<SubmissionRecord>;
  exerciseScores!: Table<ExerciseScoreRecord>;
  auditLog!: Table<AuditEntry>;

  constructor() {
    super('BlindGrade');

    this.version(1).stores({
      exams: 'id, teacherId, retentionUntil',
      exercises: 'id, examId, orderIndex',
      students: 'pseudonymId, examId, fallbackCode',
      submissions: 'id, examId, pseudonymHash',
      auditLog: 'id, action, timestamp',
    });

    this.version(2).stores({
      exams: 'id, teacherId, retentionUntil',
      exercises: 'id, examId, orderIndex',
      students: 'pseudonymId, examId, fallbackCode',
      submissions: 'id, examId, pseudonymHash',
      exerciseScores: 'id, submissionId, exerciseId',
      auditLog: 'id, action, timestamp',
    });

    this.version(3).stores({
      exams: 'id, teacherId, retentionUntil',
      exercises: 'id, examId, topicTag, name',
      examExercises: '[examId+exerciseId], examId, exerciseId, orderIndex',
      students: 'pseudonymId, examId, fallbackCode',
      submissions: 'id, examId, pseudonymHash',
      exerciseScores: 'id, submissionId, exerciseId',
      auditLog: 'id, action, timestamp',
    });

    this.version(4).stores({
      exams: 'id, teacherId, retentionUntil',
      exercises: 'id, examId, topicTag, name, exerciseGroupId, variantKey, isCurrent',
      examExercises: '[examId+exerciseId], examId, exerciseId, orderIndex',
      students: 'pseudonymId, examId, fallbackCode',
      submissions: 'id, examId, pseudonymHash',
      exerciseScores: 'id, submissionId, exerciseId',
      auditLog: 'id, action, timestamp',
    });

    this.version(5).stores({
      exams: 'id, teacherId, retentionUntil',
      exercises: 'id, examId, topicTag, grade, subject, name, exerciseGroupId, variantKey, isCurrent',
      examExercises: '[examId+exerciseId], examId, exerciseId, orderIndex',
      students: 'pseudonymId, examId, fallbackCode',
      submissions: 'id, examId, pseudonymHash',
      exerciseScores: 'id, submissionId, exerciseId',
      auditLog: 'id, action, timestamp',
    });
  }
}

/** Singleton DB instance — import this everywhere. */
export const db = browser ? new BlindGradeDB() : ({} as BlindGradeDB);

/**
 * Checks for and migrates legacy 'Blindgrade' IndexedDB records if present.
 */
export async function migrateLegacyDatabase(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const exists = await Dexie.exists('Blindgrade');
    if (!exists) return;
    const oldDb = new Dexie('Blindgrade');
    oldDb.version(5).stores({
      exams: 'id, teacherId, retentionUntil',
      exercises: 'id, examId, topicTag, grade, subject, name, exerciseGroupId, variantKey, isCurrent',
      examExercises: '[examId+exerciseId], examId, exerciseId, orderIndex',
      students: 'pseudonymId, examId, fallbackCode',
      submissions: 'id, examId, pseudonymHash',
      exerciseScores: 'id, submissionId, exerciseId',
      auditLog: 'id, action, timestamp',
    });
    await oldDb.open();
    for (const table of oldDb.tables) {
      const records = await table.toArray();
      if (records.length > 0 && db.table(table.name)) {
        await db.table(table.name).bulkPut(records);
      }
    }
    await oldDb.delete();
  } catch {
    // Ignore migration failures if legacy DB is unavailable or inaccessible
  }
}

/**
 * Clears all Dexie IndexedDB tables.
 */
export async function clearAllTables(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !db.isOpen()) return;
  try {
    await Promise.all([
      db.exams.clear(),
      db.exercises.clear(),
      db.examExercises.clear(),
      db.students.clear(),
      db.submissions.clear(),
      db.exerciseScores.clear(),
      db.auditLog.clear(),
    ]);
  } catch {
    // Ignore clear errors on un-opened DB
  }
}
