import { writable } from 'svelte/store';
import type { ExamRecord, ExerciseRecord } from '$lib/db/schema';
import { examRepository } from '$lib/repositories/examRepository';
import { exerciseRepository } from '$lib/repositories/exerciseRepository';

export interface ProjectState {
  exam: ExamRecord | null;
  exercises: ExerciseRecord[];
  isDirty: boolean;
}

const INITIAL: ProjectState = {
  exam: null,
  exercises: [],
  isDirty: false,
};

function createProjectStore() {
  const { subscribe, set, update } = writable<ProjectState>(INITIAL);

  return {
    subscribe,

    async init(examId: string, sessionKey: CryptoKey | null) {
      const exam = await examRepository.getById(examId, sessionKey);
      const exercises = exam ? await exerciseRepository.getByExamId(examId, sessionKey) : [];
      set({ exam: exam || null, exercises, isDirty: false });
    },

    load(exam: ExamRecord, exercises: ExerciseRecord[]) {
      set({ exam, exercises, isDirty: false });
    },

    setDirty(dirty: boolean) {
      update((s) => ({ ...s, isDirty: dirty }));
    },

    clear() {
      set(INITIAL);
    },
  };
}

export const projectStore = createProjectStore();

