/**
 * Storage policy migration & purge services.
 * Handles Local -> Server data sync and Server -> Local backup & purge.
 */

import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { packProject } from '$lib/archive/packer';
import { sessionStore } from '$lib/stores/session';
import {
  loadExamsEncrypted,
  loadExercisesEncrypted,
  loadStudentsEncrypted,
  loadSubmissionsEncrypted,
} from '$lib/db/dbEncryption';
import { get } from 'svelte/store';

export interface UnsyncedCounts {
  unsyncedExams: number;
  unsyncedExercises: number;
  unsyncedStudents: number;
  unsyncedSubmissions: number;
  total: number;
}

export async function checkUnsyncedLocalCount(): Promise<UnsyncedCounts> {
  const unsyncedExams = await db.exams.count();
  const unsyncedExercises = await db.exercises.count();
  const unsyncedStudents = await db.students.count();
  const unsyncedSubmissions = await db.submissions.count();
  const total = unsyncedExams + unsyncedExercises + unsyncedStudents + unsyncedSubmissions;

  return {
    unsyncedExams,
    unsyncedExercises,
    unsyncedStudents,
    unsyncedSubmissions,
    total,
  };
}

export async function syncLocalDataToServer(
  progressCallback?: (step: string, current: number, total: number) => void
): Promise<void> {
  const key = get(sessionStore).sessionKey;
  const exams = await loadExamsEncrypted(key);
  const exercises = await loadExercisesEncrypted(key);
  const students = await loadStudentsEncrypted(key);
  const submissions = await loadSubmissionsEncrypted(key);

  const total = exams.length + exercises.length + students.length + submissions.length;
  let current = 0;

  // 1. Sync Exams
  for (const exam of exams) {
    current++;
    progressCallback?.('Syncing exams', current, total);
    try {
      await api.post('/exams', {
        id: exam.id,
        title: exam.title || 'Unbenannte Prüfung',
        testart: exam.testart,
        klasse: exam.klasse,
        datum: exam.datum,
        nr: exam.nr,
        fach: exam.fach,
        lehrernachname: exam.lehrernachname,
        info_text: exam.infoText,
        latex_template: exam.latexTemplate,
        retention_until: exam.retentionUntil || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      });
    } catch {
      // Exam may already exist on server
    }
  }

  // 2. Sync Exercises
  for (const ex of exercises) {
    current++;
    progressCallback?.('Syncing exercises', current, total);
    try {
      await api.post('/exercises', {
        id: ex.id,
        name: ex.title || ex.name || 'Exercise',
        latex_body: ex.latexBody || '',
        max_points: ex.maxPoints,
        topic_tag: ex.topicTag,
        question_type: ex.questionType || 'free_text',
        options: ex.options,
        correct_answers: ex.correctAnswers,
        penalty: ex.penalty || 0,
      });
    } catch {
      // Exercise may already exist on server
    }
  }

  // 3. Sync Students
  for (const st of students) {
    current++;
    progressCallback?.('Syncing student identities', current, total);
    try {
      const piiBytes = st.piiCt || new Uint8Array([0]);
      const ivBytes = st.piiIv || new Uint8Array(12);
      const saltBytes = new Uint8Array(16);

      const emptyCtB64 = btoa(String.fromCharCode(...piiBytes));
      const emptyIvB64 = btoa(String.fromCharCode(...ivBytes));
      const emptySaltB64 = btoa(String.fromCharCode(...saltBytes));

      await api.post(`/exams/${st.examId}/students`, {
        pseudonym_hmac: st.pseudonymId,
        pii_ciphertext_b64: emptyCtB64,
        iv_b64: emptyIvB64,
        encryption_salt_b64: emptySaltB64,
      });
    } catch {
      // Student identity may already exist on server
    }
  }

  // 4. Sync Submissions
  for (const sub of submissions) {
    current++;
    progressCallback?.('Syncing submissions', current, total);
    try {
      const scanCtB64 = sub.scanCt ? btoa(String.fromCharCode(...sub.scanCt)) : undefined;
      const scanIvB64 = sub.scanIv ? btoa(String.fromCharCode(...sub.scanIv)) : undefined;
      const annCtB64 = sub.annotationCt ? btoa(String.fromCharCode(...sub.annotationCt)) : undefined;
      const annIvB64 = sub.annotationIv ? btoa(String.fromCharCode(...sub.annotationIv)) : undefined;

      await api.post(`/exams/${sub.examId}/submissions`, {
        id: sub.id,
        pseudonym_hmac: sub.pseudonymHash,
        total_score: sub.totalScore || 0,
        scan_ciphertext_b64: scanCtB64,
        scan_iv_b64: scanIvB64,
        annotation_ciphertext_b64: annCtB64,
        annotation_iv_b64: annIvB64,
      });
    } catch {
      // Submission may already exist on server
    }
  }
}

export async function downloadBackupAndPurgeServer(password: string): Promise<{
  purgedStudents: number;
  purgedSubmissions: number;
  retentionUntil: string;
}> {
  // 1. Pack project into encrypted .bgproj ArrayBuffer
  const bytes = await packProject(password);

  // 2. Trigger browser download
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blindgrade-backup-${new Date().toISOString().slice(0, 10)}.bgproj`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // 3. Call server purge endpoint
  const resp = await api.post<{
    status: string;
    purged_student_identities: number;
    purged_submissions: number;
    retention_until: string;
  }>('/user/purge-server-student-data');

  return {
    purgedStudents: resp.purged_student_identities,
    purgedSubmissions: resp.purged_submissions,
    retentionUntil: resp.retention_until,
  };
}

export async function restoreServerData(): Promise<{
  restoredStudents: number;
  restoredSubmissions: number;
}> {
  const resp = await api.post<{
    status: string;
    restored_student_identities: number;
    restored_submissions: number;
  }>('/user/restore-server-data');

  return {
    restoredStudents: resp.restored_student_identities,
    restoredSubmissions: resp.restored_submissions,
  };
}
