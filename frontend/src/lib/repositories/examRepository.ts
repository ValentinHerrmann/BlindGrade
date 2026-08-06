import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { encryptExam, decryptExam } from '$lib/db/dbEncryption';
import { enqueueRequest } from '$lib/services/offlineQueue';
import type { ExamRecord } from '$lib/db/schema';

function mapApiToExamRecord(raw: any): ExamRecord {
  return {
    id: raw.id,
    teacherId: raw.teacher_id || raw.teacherId || '',
    title: raw.title,
    testart: raw.testart,
    klasse: raw.klasse,
    datum: raw.datum,
    nr: raw.nr,
    fach: raw.fach,
    lehrernachname: raw.lehrernachname,
    infoText: raw.info_text || raw.infoText,
    latexPreamble: raw.latex_preamble || raw.latexPreamble,
    latexTemplate: raw.latex_template || raw.latexTemplate,
    numVersions: raw.num_versions || raw.numVersions || 1,
    retentionUntil: raw.retention_until || raw.retentionUntil || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    compilationStatus: raw.compilation_status || raw.compilationStatus || 'pending',
    createdAt: raw.created_at || raw.createdAt || new Date().toISOString(),
  };
}

function mapExamRecordToApi(exam: ExamRecord): any {
  return {
    id: exam.id,
    title: exam.title || 'Unbenannte Prüfung',
    testart: exam.testart,
    klasse: exam.klasse,
    datum: exam.datum,
    nr: exam.nr,
    fach: exam.fach,
    lehrernachname: exam.lehrernachname,
    info_text: exam.infoText,
    latex_preamble: exam.latexPreamble,
    latex_template: exam.latexTemplate,
    retention_until: exam.retentionUntil,
  };
}

export const examRepository = {
  async getAll(key: CryptoKey | null): Promise<ExamRecord[]> {
    const policy = get(storagePolicyStore);
    if (!db.exams) return [];
    if (policy.storageMode === 'all-local') {
      const raw = await db.exams.toArray();
      return Promise.all(raw.map((e) => decryptExam(e, key)));
    } else {
      try {
        const rawList = await api.get<any[]>('/exams');
        return rawList.map(mapApiToExamRecord);
      } catch (err: any) {
        if (policy.storageMode === 'hybrid') {
          const raw = await db.exams.toArray();
          return Promise.all(raw.map((e) => decryptExam(e, key)));
        }
        return [];
      }
    }
  },

  async getById(id: string, key: CryptoKey | null): Promise<ExamRecord | undefined> {
    const policy = get(storagePolicyStore);
    if (!db.exams) return undefined;
    if (policy.storageMode === 'all-local') {
      const raw = await db.exams.get(id);
      if (!raw) return undefined;
      return decryptExam(raw, key);
    } else {
      try {
        const raw = await api.get<any>(`/exams/${id}`);
        return mapApiToExamRecord(raw);
      } catch (err: any) {
        const raw = await db.exams.get(id);
        if (raw) return decryptExam(raw, key);
        return undefined;
      }
    }
  },

  async save(exam: ExamRecord, key: CryptoKey | null): Promise<void> {
    const policy = get(storagePolicyStore);
    if (!db.exams) return;
    if (policy.storageMode === 'all-local') {
      const encrypted = await encryptExam(exam, key);
      await db.exams.put(encrypted);
    } else {
      const payload = mapExamRecordToApi(exam);
      try {
        await api.post('/exams', payload);
      } catch (err: any) {
        enqueueRequest('/exams', 'POST', payload);
      }
    }
  },

  async delete(id: string): Promise<void> {
    if (!db.exams) return;

    // Collect submission IDs first to clean up exercise scores
    const submissionIds = (await db.submissions.where('examId').equals(id).toArray()).map((s) => s.id);

    // Delete exercise scores for all submissions in this exam to prevent orphaned data
    for (const subId of submissionIds) {
      await db.exerciseScores.where('submissionId').equals(subId).delete();
    }

    await db.exams.delete(id);
    await db.exercises.where('examId').equals(id).delete();
    await db.examExercises.where('examId').equals(id).delete();
    await db.submissions.where('examId').equals(id).delete();
    await db.students.where('examId').equals(id).delete();

    const policy = get(storagePolicyStore);
    if (policy.storageMode !== 'all-local') {
      try {
        await api.delete(`/exams/${id}`);
      } catch (err: any) {
        enqueueRequest(`/exams/${id}`, 'DELETE');
      }
    }
  },
};

