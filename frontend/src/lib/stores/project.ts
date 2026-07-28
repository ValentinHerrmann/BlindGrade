/**
 * Project store — current exam, exercises, dirty state.
 */

import { writable } from 'svelte/store';
import type { ExamRecord, ExerciseRecord } from '$lib/db/schema';

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
