import { get } from "svelte/store";
import { writable } from "svelte/store";
import { db } from "$lib/db/db";
import type { ExamRecord, ExerciseRecord, SubmissionRecord } from "$lib/db/schema";
import {
  loadExamEncrypted,
  saveExamEncrypted,
  loadExamExercisesEncrypted,
  loadExercisesEncrypted,
  encryptExercise,
} from "$lib/db/dbEncryption";
import { api } from "$lib/api/client";
import { submissionRepository } from "$lib/repositories/submissionRepository";
import { sessionStore, isAuthenticated } from "$lib/stores/session";
import { storagePolicyStore } from "$lib/stores/storagePolicy";

export interface ExamPageState {
  exam: ExamRecord | null;
  exercises: ExerciseRecord[];
  submissions: SubmissionRecord[];
  isLocalFallback: boolean;
  errorMsg: string;
}

/**
 * Loads exam data (exam record, exercises, submissions) for a given exam ID.
 * Tries server first (if authenticated and not all-local), falls back to IndexedDB.
 */
export async function loadExamData(id: string): Promise<ExamPageState> {
  const state: ExamPageState = {
    exam: null,
    exercises: [],
    submissions: [],
    isLocalFallback: false,
    errorMsg: "",
  };
  const key = get(sessionStore).sessionKey;

  try {
    const authed = get(isAuthenticated);
    const mode = get(storagePolicyStore).storageMode;

    if (authed && mode !== "all-local") {
      try {
        const remoteExam = (await api.get(`/exams/${id}`)) as any;
        state.exam = {
          id: remoteExam.id,
          teacherId: remoteExam.teacher_id,
          title: remoteExam.title,
          testart: remoteExam.testart,
          klasse: remoteExam.klasse,
          datum: remoteExam.datum,
          nr: remoteExam.nr,
          fach: remoteExam.fach,
          lehrernachname: remoteExam.lehrernachname,
          infoText: remoteExam.info_text,
          retentionUntil: remoteExam.retention_until,
          compilationStatus: remoteExam.compilation_status,
          createdAt: remoteExam.created_at,
        };
        state.exercises = remoteExam.exercises.map((e: any) => ({
          id: e.id,
          name: e.name,
          topicTag: e.topic_tag,
          latexBody: e.latex_body,
          maxPoints: e.max_points,
          version: e.version || 1,
          orderIndex: e.order_index,
          questionType: e.question_type || "free_text",
          penalty: e.penalty || 0,
        }));

        if (state.exercises.length > 0) {
          const encExs = await Promise.all(state.exercises.map((ex: ExerciseRecord) => encryptExercise(ex, key)));
          await db.exercises.bulkPut(encExs);
          const junctions = state.exercises.map((ex: any, idx: number) => ({
            examId: id,
            exerciseId: ex.id,
            orderIndex: ex.orderIndex || (idx + 1),
          }));
          await db.examExercises.bulkPut(junctions);
        } else {
          const localExs = await loadExamExercisesEncrypted(id, key);
          if (localExs.length > 0) {
            state.exercises = localExs;
          }
        }
        state.isLocalFallback = false;
      } catch {
        // Fall back to IndexedDB
        state.exam = (await loadExamEncrypted(id, key)) || null;
        if (state.exam) {
          state.isLocalFallback = true;
          state.exercises = await loadExamExercisesEncrypted(id, key);
        } else {
          state.errorMsg = "Exam not found or has been deleted from server.";
        }
      }
    } else {
      state.exam = (await loadExamEncrypted(id, key)) || null;
      state.exercises = await loadExamExercisesEncrypted(id, key);
    }

    state.submissions = await submissionRepository.getByExamId(id, key);
  } catch (err) {
    console.error("Failed to load exam from DB:", err);
    state.errorMsg = err instanceof Error ? err.message : "Failed to load exam";
  }

  return state;
}