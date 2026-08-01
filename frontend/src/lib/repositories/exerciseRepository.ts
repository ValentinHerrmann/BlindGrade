import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { db } from '$lib/db/db';
import { storagePolicyStore } from '$lib/stores/storagePolicy';
import { encryptExercise, decryptExercise } from '$lib/db/dbEncryption';
import { enqueueRequest } from '$lib/services/offlineQueue';
import type { ExerciseRecord } from '$lib/db/schema';

function mapApiToExerciseRecord(raw: any): ExerciseRecord {
  return {
    id: raw.id,
    teacherId: raw.teacher_id || raw.teacherId,
    examId: raw.exam_id || raw.examId,
    orderIndex: raw.order_index ?? raw.orderIndex ?? 0,
    title: raw.name || raw.title || 'Exercise',
    name: raw.name || raw.title,
    latexBody: raw.latex_body || raw.latexBody || '',
    maxPoints: raw.max_points ?? raw.maxPoints ?? 0,
    topicTag: raw.topic_tag || raw.topicTag,
    grade: raw.grade,
    subject: raw.subject,
    version: raw.version || 1,
    exerciseGroupId: raw.exercise_group_id || raw.exerciseGroupId,
    variantKey: raw.variant_key || raw.variantKey,
    isCurrent: raw.is_current ?? raw.isCurrent ?? true,
    createdAt: raw.created_at || raw.createdAt,
    updatedAt: raw.updated_at || raw.updatedAt,
    questionType: raw.question_type || raw.questionType || 'free_text',
    options: raw.options || [],
    correctAnswers: raw.correct_answers || raw.correctAnswers || [],
    penalty: raw.penalty || 0,
  };
}

function mapExerciseRecordToApi(ex: ExerciseRecord): any {
  return {
    id: ex.id,
    name: ex.title || ex.name || 'Exercise',
    latex_body: ex.latexBody || '',
    max_points: ex.maxPoints,
    topic_tag: ex.topicTag,
    question_type: ex.questionType || 'free_text',
    options: ex.options,
    correct_answers: ex.correctAnswers,
    penalty: ex.penalty || 0,
  };
}

export const exerciseRepository = {
  async getAll(key: CryptoKey | null): Promise<ExerciseRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local') {
      const raw = await db.exercises.toArray();
      return Promise.all(raw.map((ex) => decryptExercise(ex, key)));
    } else {
      try {
        const rawList = await api.get<any[]>('/exercises');
        return rawList.map(mapApiToExerciseRecord);
      } catch (err: any) {
        return [];
      }
    }
  },

  async getByExamId(examId: string, key: CryptoKey | null): Promise<ExerciseRecord[]> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local') {
      const links = await db.examExercises.where('examId').equals(examId).sortBy('orderIndex');
      if (links.length > 0) {
        const exercises: ExerciseRecord[] = [];
        for (const link of links) {
          const rawEx = await db.exercises.get(link.exerciseId);
          if (rawEx) {
            const ex = await decryptExercise(rawEx, key);
            exercises.push({ ...ex, orderIndex: link.orderIndex });
          }
        }
        return exercises;
      }
      const raw = await db.exercises.where('examId').equals(examId).toArray();
      return Promise.all(raw.map((ex) => decryptExercise(ex, key)));
    } else {
      try {
        const rawList = await api.get<any[]>(`/exams/${examId}/exercises`);
        return rawList.map(mapApiToExerciseRecord);
      } catch (err: any) {
        const raw = await db.exercises.where('examId').equals(examId).toArray();
        return Promise.all(raw.map((ex) => decryptExercise(ex, key)));
      }
    }
  },

  async save(ex: ExerciseRecord, key: CryptoKey | null): Promise<void> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local') {
      const encrypted = await encryptExercise(ex, key);
      await db.exercises.put(encrypted);
      if (ex.examId) {
        await db.examExercises.put({
          examId: ex.examId,
          exerciseId: ex.id,
          orderIndex: ex.orderIndex || 0,
        });
      }
    } else {
      const payload = mapExerciseRecordToApi(ex);
      try {
        await api.post('/exercises', payload);
      } catch (err: any) {
        enqueueRequest('/exercises', 'POST', payload);
      }
    }
  },

  async delete(id: string): Promise<void> {
    const policy = get(storagePolicyStore);
    if (policy.storageMode === 'all-local') {
      await db.exercises.delete(id);
      await db.examExercises.where('exerciseId').equals(id).delete();
    } else {
      try {
        await api.delete(`/exercises/${id}`);
      } catch (err: any) {
        enqueueRequest(`/exercises/${id}`, 'DELETE');
      }
    }
  },
};
