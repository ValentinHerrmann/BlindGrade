<script lang="ts">
  import { onMount } from "svelte";
  import { db } from "$lib/db/db";
  import { sessionStore, isAuthenticated } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import type { ExerciseRecord } from "$lib/db/schema";
  import { loadExercisesEncrypted, saveExerciseEncrypted, encryptExercise } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { parseExerciseScore } from "$lib/latex/scoreParser";
  import { get } from "svelte/store";

  import LatexEditor from "$lib/components/LatexEditor.svelte";
  import LatexViewer from "$lib/components/LatexViewer.svelte";
  import { highlightLatexToHtml } from "$lib/latex/highlighter";
  import ExerciseEditorModal from "$lib/components/ExerciseEditorModal.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import { diffLines, diffWords } from "diff";

  let exercises: ExerciseRecord[] = [];
  let selectedTopic: string = "ALL";
  let selectedGrade: string = "ALL";
  let selectedSubject: string = "ALL";
  let searchQuery: string = "";
  let isLoading = false;
  let errorMsg = "";
  let isLocalFallback = false;
  let isSyncingExercises = false;

  // Shared Editor modal state
  let isEditorOpen = false;
  let editingExercise: ExerciseRecord | null = null;
  let isCreatingVersion = false;
  let versionBaseEx: ExerciseRecord | null = null;

  // Delete modal state
  let isDeleteModalOpen = false;
  let deletingExercise: ExerciseRecord | null = null;
  let deleteUsageInfo: { examCount: number; exams: { id: string; title: string; datum: string | null }[] } | null = null;
  let isDeleteLoading = false;

  // Diff modal state
  let isDiffModalOpen = false;
  let diffLeftId: string = "";
  let diffRightId: string = "";
  let diffGroupExercises: ExerciseRecord[] = [];
  let diffLeftLatex: string = "";
  let diffRightLatex: string = "";
  let diffLeftMode: "diff" | "edit" = "diff";
  let diffRightMode: "diff" | "edit" = "diff";
  let isSavingDiffLeft = false;
  let isSavingDiffRight = false;
  let showDiffConfirmClose = false;

  let lastLoadedLeftId = "";
  let lastLoadedRightId = "";

  // Expanded groups tracking — use object for Svelte reactivity
  let expandedGroups: { [groupId: string]: boolean } = {};

  interface DiffToken {
    text: string;
    type: "added" | "removed" | "unchanged";
  }

  interface DiffLine {
    lineNumber?: number;
    text?: string;
    type: "added" | "removed" | "unchanged" | "empty" | "modified";
    tokens?: DiffToken[];
  }

  /* ── Exercise Grouping ── */

  interface VariantMember {
    ex: ExerciseRecord;
    variantLabel: string;
    version: number;
    isCurrent: boolean;
  }

  interface ExerciseGroup {
    groupId: string;
    name: string;
    topicTag: string;
    maxPoints: number;
    minPoints: number;
    variants: Map<string, VariantMember[]>;
    allMembers: VariantMember[];
  }

  function groupExercises(exs: ExerciseRecord[]): ExerciseGroup[] {
    const buckets = new Map<string, ExerciseRecord[]>();

    for (const ex of exs) {
      const key = ex.exerciseGroupId || (`name:${ex.name || "Untitled"}`);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(ex);
    }

    const groups: ExerciseGroup[] = [];

    for (const [groupId, members] of buckets) {
      const currentMembers = members.filter((m) => m.isCurrent !== false);
      if (currentMembers.length === 0) continue;

      const name = currentMembers[0]?.name || "Untitled";
      const topicTag = currentMembers[0]?.topicTag || "_General";

      const variants = new Map<string, VariantMember[]>();
      for (const ex of currentMembers) {
        const vKey = ex.variantKey || "_General";
        if (!variants.has(vKey)) variants.set(vKey, []);
        variants.get(vKey)!.push({
          ex,
          variantLabel: vKey,
          version: ex.version || 1,
          isCurrent: ex.isCurrent !== false,
        });
      }

      const sortedVariants = new Map<string, VariantMember[]>();
      const keys = [...variants.keys()].sort((a, b) => {
        if (a === "_General") return -1;
        if (b === "_General") return 1;
        return a.localeCompare(b);
      });
      for (const k of keys) sortedVariants.set(k, variants.get(k)!);

      for (const [, vMembers] of sortedVariants) {
        vMembers.sort((a, b) => b.version - a.version);
      }

      const allMembers: VariantMember[] = [];
      for (const [, vMembers] of sortedVariants) {
        allMembers.push(...vMembers);
      }

      const scores = allMembers.map((m) => parseExerciseScore(m.ex.latexBody || "") || m.ex.maxPoints || 0);
      const maxPoints = scores.length > 0 ? Math.max(...scores) : 0;
      const minPoints = scores.length > 0 ? Math.min(...scores) : 0;

      groups.push({ groupId, name, topicTag, maxPoints, minPoints, variants: sortedVariants, allMembers });
    }

    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  function toggleGroup(groupId: string) {
    expandedGroups = { ...expandedGroups, [groupId]: !expandedGroups[groupId] };
  }

  function isGroupExpanded(groupId: string): boolean {
    return !!expandedGroups[groupId];
  }

  function getGroupRepresentative(group: ExerciseGroup): ExerciseRecord {
    return group.allMembers[0]?.ex || { id: "", name: group.name } as ExerciseRecord;
  }

  function buildWordTokens(
    leftStr: string,
    rightStr: string,
  ): { leftTokens: DiffToken[]; rightTokens: DiffToken[] } {
    const wordDiff = diffWords(leftStr, rightStr);
    const leftTokens: DiffToken[] = [];
    const rightTokens: DiffToken[] = [];

    for (const part of wordDiff) {
      if (part.removed) {
        leftTokens.push({ text: part.value, type: "removed" });
      } else if (part.added) {
        rightTokens.push({ text: part.value, type: "added" });
      } else {
        leftTokens.push({ text: part.value, type: "unchanged" });
        rightTokens.push({ text: part.value, type: "unchanged" });
      }
    }

    return { leftTokens, rightTokens };
  }

  function stringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    const s1 = str1.trim();
    const s2 = str2.trim();
    if (s1 === s2) return 0.98;

    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    if (maxLen === 0) return 1.0;

    const matrix: number[] = new Array(len2 + 1);
    for (let j = 0; j <= len2; j++) matrix[j] = j;

    for (let i = 1; i <= len1; i++) {
      let prev = i;
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        const current = Math.min(
          matrix[j] + 1,
          prev + 1,
          matrix[j - 1] + cost,
        );
        matrix[j - 1] = prev;
        prev = current;
      }
      matrix[len2] = prev;
    }

    return 1.0 - matrix[len2] / maxLen;
  }

  function computeSideBySideDiff(
    leftText: string,
    rightText: string,
  ): { leftLines: DiffLine[]; rightLines: DiffLine[] } {
    const a = (leftText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n$/, "")
      .split("\n");
    const b = (rightText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n$/, "")
      .split("\n");

    if (a.length === 1 && a[0] === "") a.pop();
    if (b.length === 1 && b[0] === "") b.pop();

    const N = a.length;
    const M = b.length;

    if (N === 0 && M === 0) {
      return { leftLines: [], rightLines: [] };
    }

    if (N === 0) {
      const rightLines = b.map((line, idx) => ({
        lineNumber: idx + 1,
        text: line,
        type: "added" as const,
        tokens: [{ text: line, type: "added" as const }],
      }));
      const leftLines = b.map(() => ({ text: "", type: "empty" as const }));
      return { leftLines, rightLines };
    }

    if (M === 0) {
      const leftLines = a.map((line, idx) => ({
        lineNumber: idx + 1,
        text: line,
        type: "removed" as const,
        tokens: [{ text: line, type: "removed" as const }],
      }));
      const rightLines = a.map(() => ({ text: "", type: "empty" as const }));
      return { leftLines, rightLines };
    }

    const simMatrix: number[][] = Array.from({ length: N }, () =>
      new Array(M).fill(0),
    );
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        simMatrix[i][j] = stringSimilarity(a[i], b[j]);
      }
    }

    const GAP_PENALTY = -0.4;
    const dp: number[][] = Array.from({ length: N + 1 }, () =>
      new Array(M + 1).fill(0),
    );

    for (let i = 0; i <= N; i++) dp[i][0] = i * GAP_PENALTY;
    for (let j = 0; j <= M; j++) dp[0][j] = j * GAP_PENALTY;

    for (let i = 1; i <= N; i++) {
      for (let j = 1; j <= M; j++) {
        const sim = simMatrix[i - 1][j - 1];
        let matchScore: number;
        if (sim === 1.0) {
          matchScore = 2.0;
        } else if (sim >= 0.35) {
          matchScore = 2.0 * sim;
        } else {
          matchScore = -0.8;
        }

        const scoreDiag = dp[i - 1][j - 1] + matchScore;
        const scoreUp = dp[i - 1][j] + GAP_PENALTY;
        const scoreLeft = dp[i][j - 1] + GAP_PENALTY;

        dp[i][j] = Math.max(scoreDiag, scoreUp, scoreLeft);
      }
    }

    const ops: Array<{
      op: "MATCH" | "MODIFY" | "DELETE" | "INSERT";
      i: number;
      j: number;
    }> = [];
    let i = N;
    let j = M;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const sim = simMatrix[i - 1][j - 1];
        let matchScore: number;
        if (sim === 1.0) {
          matchScore = 2.0;
        } else if (sim >= 0.35) {
          matchScore = 2.0 * sim;
        } else {
          matchScore = -0.8;
        }

        if (dp[i][j] === dp[i - 1][j - 1] + matchScore) {
          const opType =
            sim === 1.0 ? "MATCH" : sim >= 0.35 ? "MODIFY" : "DELETE";
          if (opType !== "DELETE") {
            ops.push({ op: opType, i: i - 1, j: j - 1 });
            i--;
            j--;
            continue;
          }
        }
      }

      if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP_PENALTY) {
        ops.push({ op: "DELETE", i: i - 1, j: -1 });
        i--;
      } else if (j > 0 && dp[i][j] === dp[i][j - 1] + GAP_PENALTY) {
        ops.push({ op: "INSERT", i: -1, j: j - 1 });
        j--;
      } else {
        if (i > 0) {
          ops.push({ op: "DELETE", i: i - 1, j: -1 });
          i--;
        } else {
          ops.push({ op: "INSERT", i: -1, j: j - 1 });
          j--;
        }
      }
    }

    ops.reverse();

    const leftLines: DiffLine[] = [];
    const rightLines: DiffLine[] = [];
    let leftLineNum = 1;
    let rightLineNum = 1;

    for (const op of ops) {
      if (op.op === "MATCH") {
        leftLines.push({
          lineNumber: leftLineNum++,
          text: a[op.i],
          type: "unchanged",
          tokens: [{ text: a[op.i], type: "unchanged" }],
        });
        rightLines.push({
          lineNumber: rightLineNum++,
          text: b[op.j],
          type: "unchanged",
          tokens: [{ text: b[op.j], type: "unchanged" }],
        });
      } else if (op.op === "MODIFY") {
        const { leftTokens, rightTokens } = buildWordTokens(a[op.i], b[op.j]);
        leftLines.push({
          lineNumber: leftLineNum++,
          text: a[op.i],
          type: "modified",
          tokens: leftTokens,
        });
        rightLines.push({
          lineNumber: rightLineNum++,
          text: b[op.j],
          type: "modified",
          tokens: rightTokens,
        });
      } else if (op.op === "DELETE") {
        leftLines.push({
          lineNumber: leftLineNum++,
          text: a[op.i],
          type: "removed",
          tokens: [{ text: a[op.i], type: "removed" }],
        });
        rightLines.push({ text: "", type: "empty" });
      } else if (op.op === "INSERT") {
        leftLines.push({ text: "", type: "empty" });
        rightLines.push({
          lineNumber: rightLineNum++,
          text: b[op.j],
          type: "added",
          tokens: [{ text: b[op.j], type: "added" }],
        });
      }
    }

    return { leftLines, rightLines };
  }

  $: activeDiffGroupExercises = diffGroupExercises.map(
    (e) => exercises.find((x) => x.id === e.id) || e
  );

  function getDiffSelectLabel(ex: ExerciseRecord): string {
    const name = ex.name || "Untitled";
    const v = ex.version || 1;
    const variantStr = ex.variantKey ? `, Variant: ${ex.variantKey}` : "";
    return `${name} (v${v}${variantStr})`;
  }

  // Lazy: only look up exercises when the diff modal is open
  $: diffLeftEx = isDiffModalOpen
    ? (exercises.find((e) => e.id === diffLeftId) || activeDiffGroupExercises.find((e) => e.id === diffLeftId))
    : null;
  $: diffRightEx = isDiffModalOpen
    ? (exercises.find((e) => e.id === diffRightId) || activeDiffGroupExercises.find((e) => e.id === diffRightId))
    : null;

  $: if (diffLeftEx && isDiffModalOpen) {
    if (diffLeftId !== lastLoadedLeftId) {
      diffLeftLatex = diffLeftEx.latexBody || "";
      lastLoadedLeftId = diffLeftId;
    }
  }

  $: if (diffRightEx && isDiffModalOpen) {
    if (diffRightId !== lastLoadedRightId) {
      diffRightLatex = diffRightEx.latexBody || "";
      lastLoadedRightId = diffRightId;
    }
  }

  $: isDiffLeftDirty = diffLeftEx ? diffLeftLatex !== (diffLeftEx.latexBody || "") : false;
  $: isDiffRightDirty = diffRightEx ? diffRightLatex !== (diffRightEx.latexBody || "") : false;

  // Lazy: compute diff dynamically from editable buffers when modal is open
  $: sideBySideDiff = isDiffModalOpen
    ? computeSideBySideDiff(diffLeftLatex, diffRightLatex)
    : { leftLines: [], rightLines: [] };

  // Preview state
  let isPreviewLoading = false;
  let previewPdfUrl: string | null = null;

  $: availableTopics = Array.from(
    new Set(
      exercises.map((e) => e.topicTag).filter((t): t is string => Boolean(t)),
    ),
  ).sort();

  $: availableGrades = Array.from(
    new Set(
      exercises.map((e) => e.grade).filter((g): g is string => Boolean(g)),
    ),
  ).sort();

  $: availableSubjects = Array.from(
    new Set(
      exercises.map((e) => e.subject).filter((s): s is string => Boolean(s)),
    ),
  ).sort();

  $: filteredExercises = exercises.filter((ex) => {
    const matchesTopic =
      selectedTopic === "ALL" || ex.topicTag === selectedTopic;
    const matchesGrade =
      selectedGrade === "ALL" || ex.grade === selectedGrade;
    const matchesSubject =
      selectedSubject === "ALL" || ex.subject === selectedSubject;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (ex.name && ex.name.toLowerCase().includes(q)) ||
      (ex.topicTag && ex.topicTag.toLowerCase().includes(q)) ||
      (ex.grade && ex.grade.toLowerCase().includes(q)) ||
      (ex.subject && ex.subject.toLowerCase().includes(q)) ||
      (ex.latexBody && ex.latexBody.toLowerCase().includes(q));
    return matchesTopic && matchesGrade && matchesSubject && matchesSearch;
  });

  // Grouped view: filter then group
  $: filteredGroups = groupExercises(filteredExercises);

  onMount(() => {
    loadExercises();
  });

  async function loadExercises() {
    isLoading = true;
    errorMsg = "";
    const key = get(sessionStore).sessionKey;
    try {
      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
        try {
          const remoteExs = (await api.get("/exercises")) as any[];
          exercises = remoteExs.map((e: any) => ({
            id: e.id,
            teacherId: e.teacher_id,
            name: e.name,
            topicTag: e.topic_tag,
            grade: e.grade || undefined,
            subject: e.subject || undefined,
            latexBody: e.latex_body,
            maxPoints: e.max_points,
            version: e.version || 1,
            questionType: e.question_type || "free_text",
            penalty: e.penalty || 0,
            exerciseGroupId: e.exercise_group_id || undefined,
            variantKey: e.variant_key || undefined,
            isCurrent: e.is_current,
          }));
          const encryptedExs = await Promise.all(exercises.map(ex => encryptExercise(ex, key)));
          await db.exercises.bulkPut(encryptedExs);
          isLocalFallback = false;
        } catch (apiErr) {
          console.warn(
            "Failed to fetch remote exercises, falling back to IDB:",
            apiErr,
          );
          exercises = await loadExercisesEncrypted(key);
          isLocalFallback = true;
        }
      } else {
        isLocalFallback = false;
        exercises = await loadExercisesEncrypted(key);
      }
    } catch (err: any) {
      errorMsg = err.message || "Failed to load exercise library.";
    } finally {
      isLoading = false;
    }
  }



  function openCreateModal() {
    editingExercise = null;
    isCreatingVersion = false;
    versionBaseEx = null;
    isEditorOpen = true;
  }

  function openEditModal(ex: ExerciseRecord) {
    editingExercise = ex;
    isCreatingVersion = false;
    versionBaseEx = null;
    isEditorOpen = true;
  }

  function openNewVersionModal(ex: ExerciseRecord) {
    editingExercise = null;
    isCreatingVersion = true;
    versionBaseEx = ex;
    isEditorOpen = true;
  }

  function handleExerciseSaved() {
    loadExercises();
  }

  // Variant modal state
  let isVariantModalOpen = false;
  let variantBaseEx: ExerciseRecord | null = null;
  let variantKey = "Moebel";
  let variantName = "";
  let variantTopicTag = "_Vererbung";
  let variantLatexBody = "";

  let initialVariantName = "";
  let initialVariantKey = "";
  let initialVariantTopicTag = "";
  let initialVariantLatexBody = "";
  let showVariantConfirmClose = false;

  $: isVariantDirty =
    variantName !== initialVariantName ||
    variantKey !== initialVariantKey ||
    variantTopicTag !== initialVariantTopicTag ||
    variantLatexBody !== initialVariantLatexBody;

  async function openDeleteModal(ex: ExerciseRecord) {
    deletingExercise = ex;
    deleteUsageInfo = null;
    isDeleteLoading = true;
    isDeleteModalOpen = true;

    if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
      try {
        const usage = (await api.get(`/exercises/${ex.id}/usage`)) as any;
        deleteUsageInfo = {
          examCount: usage.exam_count,
          exams: usage.exams,
        };
      } catch (err) {
        console.warn("Failed to check exercise usage:", err);
        deleteUsageInfo = { examCount: 0, exams: [] };
      }
    } else {
      deleteUsageInfo = { examCount: 0, exams: [] };
    }
    isDeleteLoading = false;
  }

  async function handleConfirmDelete() {
    if (!deletingExercise) return;
    try {
      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
        await api.delete(`/exercises/${deletingExercise.id}`);
      }
      await db.exercises.delete(deletingExercise.id);
      await loadExercises();
      isDeleteModalOpen = false;
      deletingExercise = null;
    } catch (err: any) {
      alert(`Failed to delete exercise: ${err.message}`);
    }
  }

  async function openDiffModal(ex: ExerciseRecord) {
    let groupExs: ExerciseRecord[] = [];
    const key = get(sessionStore).sessionKey;

    if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
      try {
        if (ex.exerciseGroupId) {
          const remoteExs = (await api.get(`/exercises?group_id=${ex.exerciseGroupId}&current_only=false`)) as any[];
          groupExs = remoteExs.map((e: any) => ({
            id: e.id,
            teacherId: e.teacher_id,
            name: e.name,
            topicTag: e.topic_tag,
            grade: e.grade || undefined,
            subject: e.subject || undefined,
            latexBody: e.latex_body,
            maxPoints: e.max_points,
            version: e.version || 1,
            questionType: e.question_type || "free_text",
            penalty: e.penalty || 0,
            exerciseGroupId: e.exercise_group_id || undefined,
            variantKey: e.variant_key || undefined,
            isCurrent: e.is_current,
          }));
        }
      } catch (err) {
        console.warn("Failed to fetch group exercises for diff:", err);
      }
    }

    if (groupExs.length === 0) {
      try {
        const allLocal = await loadExercisesEncrypted(key);
        if (ex.exerciseGroupId) {
          groupExs = allLocal.filter((e) => e.exerciseGroupId === ex.exerciseGroupId);
        }
        if (groupExs.length === 0) {
          groupExs = allLocal.filter((e) => (e.name && ex.name && e.name === ex.name) || e.id === ex.id);
        }
      } catch (err) {
        console.warn("Failed to load local exercises for diff:", err);
      }
    }

    if (groupExs.length === 0) {
      groupExs = [ex];
    }

    groupExs.sort((a, b) => {
      const vA = a.variantKey || "";
      const vB = b.variantKey || "";
      if (vA !== vB) return vA.localeCompare(vB);
      return (a.version || 1) - (b.version || 1);
    });

    diffGroupExercises = groupExs;
    diffLeftId = ex.id;
    const other = diffGroupExercises.find((e) => e.id !== ex.id) || diffGroupExercises[0];
    diffRightId = other.id;
    diffLeftLatex = ex.latexBody || "";
    diffRightLatex = (diffGroupExercises.find((e) => e.id === diffRightId) || ex).latexBody || "";
    lastLoadedLeftId = diffLeftId;
    lastLoadedRightId = diffRightId;
    diffLeftMode = "diff";
    diffRightMode = "diff";
    showDiffConfirmClose = false;
    isDiffModalOpen = true;
  }

  async function handleSaveDiffLeft() {
    if (!diffLeftEx) return;
    isSavingDiffLeft = true;
    try {
      const updatedMaxPoints = parseExerciseScore(diffLeftLatex);
      const key = get(sessionStore).sessionKey;

      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
        await api.patch(`/exercises/${diffLeftEx.id}`, {
          latex_body: diffLeftLatex,
          max_points: updatedMaxPoints,
        });
      }

      const updatedRecord: ExerciseRecord = {
        ...diffLeftEx,
        latexBody: diffLeftLatex,
        maxPoints: updatedMaxPoints,
        updatedAt: new Date().toISOString(),
      };

      const encrypted = await encryptExercise(updatedRecord, key);
      await db.exercises.put(encrypted);
      await loadExercises();
    } catch (err: any) {
      alert(`Failed to save left exercise: ${err.message}`);
    } finally {
      isSavingDiffLeft = false;
    }
  }

  async function handleSaveDiffRight() {
    if (!diffRightEx) return;
    isSavingDiffRight = true;
    try {
      const updatedMaxPoints = parseExerciseScore(diffRightLatex);
      const key = get(sessionStore).sessionKey;

      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
        await api.patch(`/exercises/${diffRightEx.id}`, {
          latex_body: diffRightLatex,
          max_points: updatedMaxPoints,
        });
      }

      const updatedRecord: ExerciseRecord = {
        ...diffRightEx,
        latexBody: diffRightLatex,
        maxPoints: updatedMaxPoints,
        updatedAt: new Date().toISOString(),
      };

      const encrypted = await encryptExercise(updatedRecord, key);
      await db.exercises.put(encrypted);
      await loadExercises();
    } catch (err: any) {
      alert(`Failed to save right exercise: ${err.message}`);
    } finally {
      isSavingDiffRight = false;
    }
  }

  function requestCloseDiffModal() {
    if (isDiffLeftDirty || isDiffRightDirty) {
      showDiffConfirmClose = true;
    } else {
      forceCloseDiffModal();
    }
  }

  function forceCloseDiffModal() {
    showDiffConfirmClose = false;
    isDiffModalOpen = false;
  }

  function openVariantModal(ex: ExerciseRecord) {
    variantBaseEx = ex;
    variantName = `${ex.name || "Exercise"} (Variant)`;
    variantKey = "Moebel";
    variantTopicTag = ex.topicTag || "_General";
    variantLatexBody = ex.latexBody || "";

    initialVariantName = variantName;
    initialVariantKey = variantKey;
    initialVariantTopicTag = variantTopicTag;
    initialVariantLatexBody = variantLatexBody;
    showVariantConfirmClose = false;
    isVariantModalOpen = true;
  }

  function requestCloseVariantModal() {
    if (isVariantDirty) {
      showVariantConfirmClose = true;
    } else {
      forceCloseVariantModal();
    }
  }

  function forceCloseVariantModal() {
    showVariantConfirmClose = false;
    isVariantModalOpen = false;
  }

  async function handleSaveVariant() {
    if (!variantBaseEx) return;
    if (!variantKey.trim()) {
      alert("Variant key (e.g. Moebel, Fahrzeug, Wildtier) is required.");
      return;
    }

    try {
      if ($storagePolicyStore.storageMode !== "all-local") {
        await api.post(`/exercises/${variantBaseEx.id}/new-variant`, {
          name: variantName,
          topic_tag: variantTopicTag,
          latex_body: variantLatexBody,
          variant_key: variantKey,
        });
      } else {
        const groupId = variantBaseEx.exerciseGroupId || crypto.randomUUID();
        if (!variantBaseEx.exerciseGroupId) {
          variantBaseEx.exerciseGroupId = groupId;
          await db.exercises.put(variantBaseEx);
        }
        const variantRecord: ExerciseRecord = {
          id: crypto.randomUUID(),
          teacherId: $sessionStore.email || "local-teacher",
          name: variantName,
          topicTag: variantTopicTag,
          latexBody: variantLatexBody,
          maxPoints: parseExerciseScore(variantLatexBody),
          version: 1,
          exerciseGroupId: groupId,
          variantKey: variantKey,
          isCurrent: true,
          questionType: "free_text",
          penalty: 0,
          updatedAt: new Date().toISOString(),
        };
        await db.exercises.put(variantRecord);
      }

      forceCloseVariantModal();
      await loadExercises();
      alert(`New variant "${variantKey}" created.`);
    } catch (err: any) {
      alert(`Failed to create variant: ${err.message}`);
    }
  }
</script>

<div class="exercise-library-page">


  <div class="page-header">
    <div>
      <h2>Exercise Library (Aufgabenkatalog)</h2>
      <p class="subtitle">
        Reusable LaTeX exercise collection live-linked across your exams.
      </p>
    </div>
    <button class="create-btn" on:click={openCreateModal}
      >+ Create New Exercise</button
    >
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  <div class="filter-bar">
    <div class="search-box">
      <input
        type="text"
        placeholder="Search exercises by name, topic, grade, subject, or LaTeX content..."
        bind:value={searchQuery}
      />
    </div>

    <div class="filter-selects">
      {#if availableGrades.length > 0}
        <div class="select-group">
          <label for="grade-select">Grade:</label>
          <select id="grade-select" bind:value={selectedGrade}>
            <option value="ALL">All Grades</option>
            {#each availableGrades as g}
              <option value={g}>Grade {g}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if availableSubjects.length > 0}
        <div class="select-group">
          <label for="subject-select">Subject:</label>
          <select id="subject-select" bind:value={selectedSubject}>
            <option value="ALL">All Subjects</option>
            {#each availableSubjects as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </div>
      {/if}
    </div>

    <div class="topic-pills">
      <button
        class="pill"
        class:active={selectedTopic === "ALL"}
        on:click={() => (selectedTopic = "ALL")}
      >
        All Topics ({filteredGroups.length})
      </button>
      {#each availableTopics as topic}
        {@const groupCount = filteredGroups.filter((g) => g.topicTag === topic).length}
        <button
          class="pill"
          class:active={selectedTopic === topic}
          on:click={() => (selectedTopic = topic)}
        >
          {topic} ({groupCount})
        </button>
      {/each}
    </div>
  </div>

  {#if isLoading}
    <div class="loading is-loading">Loading exercise library...</div>
  {:else if filteredGroups.length === 0}
    <div class="empty-state">
      <p>No exercises found matching your criteria.</p>
      <button class="create-btn" on:click={openCreateModal}
        >Create First Exercise</button
      >
    </div>
  {:else}
    <div class="exercise-group-list">
      {#each filteredGroups as group}
        {@const rep = getGroupRepresentative(group)}
        {@const variantCount = group.variants.size}
        {@const isExpanded = !!expandedGroups[group.groupId]}
        <div class="exercise-group-card">
          <!-- ── Group Header (always visible) ── -->
          <div
            class="group-header"
            role="button"
            tabindex="0"
            aria-expanded={isExpanded}
            on:click={() => toggleGroup(group.groupId)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(group.groupId); } }}
          >
            <div class="group-title-row">
              <h3>{group.name || "Untitled"}</h3>
              <div class="group-meta">
                {#if group.topicTag}
                  <span class="topic-badge">{group.topicTag}</span>
                {/if}
                {#if rep?.grade}
                  <span class="meta-badge grade-badge">Klasse {rep.grade}</span>
                {/if}
                {#if rep?.subject}
                  <span class="meta-badge subject-badge">{rep.subject}</span>
                {/if}
                <span class="score-badge">
                  {group.variants.size > 1 && group.minPoints !== group.maxPoints
                    ? `${group.minPoints}-${group.maxPoints} Pkt`
                    : `${group.maxPoints} Pkt`}
                </span>
                <span class="variant-count-badge">{variantCount} variant{variantCount !== 1 ? 's' : ''}</span>
              </div>
            </div>

            <!-- Variant pills row (collapsed preview) -->
            {#if !isExpanded}
              <div class="variant-pills-row">
                {#each group.variants.keys() as vKey}
                  {@const vMembers = group.variants.get(vKey) || []}
                  {@const latestVer = vMembers[0]?.version || 1}
                  <span class="variant-pill{vKey !== '_General' ? ' has-variant' : ''}">
                    {vKey} <strong>v{latestVer}</strong>
                  </span>
                {/each}
              </div>
            {/if}

            <button class="expand-toggle" class:expanded={isExpanded}>
              {isExpanded ? '▲' : '▼'}
            </button>
          </div>

          <!-- ── Expanded Body ── -->
          {#if isExpanded}
            <div class="group-body">
              {#each group.variants as [vKey, vMembers]}
                <div class="variant-section">
                  <div class="variant-header">
                    <span class="variant-label{vKey !== '_General' ? ' has-variant' : ''}">
                      {vKey}
                    </span>
                    <span class="variant-version">v{vMembers[0]?.version || 1}{vMembers[0]?.isCurrent ? ' ← current' : ''}</span>
                  </div>

                  {#each vMembers as member}
                    <div class="variant-member">
                      <div class="member-info">
                        <span class="member-version-badge">v{member.version}</span>
                        {#if member.isCurrent}
                          <span class="current-tag">current</span>
                        {/if}
                      </div>

                      <div class="snippet-preview">
                        <LatexViewer code={(member.ex.latexBody || "").slice(0, 150) + "..."} snippet={true} />
                      </div>

                      <div class="member-actions">
                        <button
                          class="action-btn edit-btn"
                          title="Edit exercise"
                          on:click={() => openEditModal(member.ex)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                          <span>Edit</span>
                        </button>
                        <button
                          class="action-btn version-btn"
                          title="Create new version"
                          on:click={() => openNewVersionModal(member.ex)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <line x1="12" y1="18" x2="12" y2="12"></line>
                            <line x1="9" y1="15" x2="15" y2="15"></line>
                          </svg>
                          <span>+Ver</span>
                        </button>
                        <button
                          class="action-btn diff-btn"
                          title="Compare LaTeX diff"
                          on:click={() => openDiffModal(member.ex)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M16 3h5v5"></path>
                            <path d="M8 21H3v-5"></path>
                            <path d="M21 3L14 10"></path>
                            <path d="M3 21l7-7"></path>
                          </svg>
                          <span>Diff</span>
                        </button>
                        <button
                          class="action-btn delete-btn"
                          title="Delete exercise"
                          on:click={() => openDeleteModal(member.ex)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/each}

              <!-- Group-level actions -->
              <div class="group-actions">
                <button
                  class="group-action-btn variant-btn"
                  title="Create parallel variant"
                  on:click={() => openVariantModal(rep)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                    <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                    <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                    <path d="M6 10v7a2 2 0 0 0 2 2h6"></path>
                  </svg>
                  <span>+ Variant</span>
                </button>
                <button
                  class="group-action-btn version-btn"
                  title="Create new version of first variant"
                  on:click={() => openNewVersionModal(rep)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <line x1="12" y1="18" x2="12" y2="12"></line>
                    <line x1="9" y1="15" x2="15" y2="15"></line>
                  </svg>
                  <span>+ Version</span>
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if isVariantModalOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={requestCloseVariantModal}
    on:keydown|self={(e) => e.key === "Escape" && requestCloseVariantModal()}
  >
    <div class="modal-content">
      <div class="modal-header">
        <h3>Create Parallel Exercise Variant</h3>
        <button class="close-btn" on:click={requestCloseVariantModal}
          >✕</button
        >
      </div>

      <div class="modal-body">
        <p class="desc-text">
          Variants share the same exercise type structure but use a different
          theme (e.g. Möbel, Fahrzeug, Wildtier). This allows generating
          parallel exam groups while maintaining statistical comparability.
        </p>

        <div class="form-grid">
          <div class="form-group">
            <label for="variantName">Variant Name</label>
            <input
              id="variantName"
              type="text"
              bind:value={variantName}
              required
            />
          </div>

          <div class="form-group">
            <label for="variantKey">Variant Theme / Key</label>
            <input
              id="variantKey"
              type="text"
              bind:value={variantKey}
              placeholder="e.g. Moebel, Fahrzeug, Wildtier"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <label for="variantTopic">Topic Tag</label>
          <input
            id="variantTopic"
            type="text"
            bind:value={variantTopicTag}
            required
          />
        </div>

        <div class="form-group">
          <label for="variantBody"
            >LaTeX Body (\\begin&#123;Aufgabe&#125;...)</label
          >
          <LatexEditor bind:value={variantLatexBody} rows={8} />
        </div>
      </div>

      <div class="modal-footer">
        <button class="cancel-btn" on:click={requestCloseVariantModal}
          >Cancel</button
        >
        <button class="save-btn" on:click={handleSaveVariant}
          >Save Variant</button
        >
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog
  isOpen={showVariantConfirmClose}
  title="Discard Variant Changes?"
  message="You have unsaved changes in this variant form. Discarding will lose your changes."
  confirmText="Discard Changes"
  cancelText="Keep Editing"
  on:confirm={forceCloseVariantModal}
  on:cancel={() => (showVariantConfirmClose = false)}
/>

<ExerciseEditorModal
  isOpen={isEditorOpen}
  editingExercise={editingExercise}
  isCreatingVersion={isCreatingVersion}
  versionBaseEx={versionBaseEx}
  on:close={() => (isEditorOpen = false)}
  on:save={handleExerciseSaved}
/>

{#if isDeleteModalOpen && deletingExercise}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={() => (isDeleteModalOpen = false)}
    on:keydown|self={(e) => e.key === "Escape" && (isDeleteModalOpen = false)}
  >
    <div class="modal-content small-modal">
      <div class="modal-header">
        <h3>Delete Exercise: {deletingExercise.name || "Untitled"}</h3>
        <button class="close-btn" on:click={() => (isDeleteModalOpen = false)}>✕</button>
      </div>

      <div class="modal-body">
        {#if isDeleteLoading}
          <p>Checking exercise usage in exams...</p>
        {:else if deleteUsageInfo && deleteUsageInfo.examCount > 0}
          <div class="warning-box">
            <h4>⚠️ Warning: Exercise in Use</h4>
            <p>
              This exercise is currently referenced in <strong>{deleteUsageInfo.examCount}</strong> exam(s):
            </p>
            <ul class="exam-list">
              {#each deleteUsageInfo.exams as exam}
                <li>
                  <strong>{exam.title}</strong>
                  {#if exam.datum}<span class="exam-date">({exam.datum})</span>{/if}
                </li>
              {/each}
            </ul>
            <p class="warning-note">
              Deleting it will permanently remove it from the library and unlink it from these exams.
            </p>
          </div>
        {:else}
          <p>Are you sure you want to delete this exercise from your library?</p>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="cancel-btn" on:click={() => (isDeleteModalOpen = false)}>Cancel</button>
        <button class="delete-confirm-btn" on:click={handleConfirmDelete} disabled={isDeleteLoading}>
          Delete Anyway
        </button>
      </div>
    </div>
  </div>
{/if}

{#if isDiffModalOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={requestCloseDiffModal}
    on:keydown|self={(e) => e.key === "Escape" && requestCloseDiffModal()}
  >
    <div class="modal-content large-modal">
      <div class="modal-header">
        <h3>Exercise LaTeX Code Diff Comparison</h3>
        <button class="close-btn" on:click={requestCloseDiffModal}>✕</button>
      </div>

      <div class="modal-body">
        <div class="diff-selectors">
          <div class="diff-select-group">
            <label for="diffLeftSelect">Base / Left Version:</label>
            <select id="diffLeftSelect" bind:value={diffLeftId}>
              {#each activeDiffGroupExercises as ex}
                <option value={ex.id}>
                  {getDiffSelectLabel(ex)}
                </option>
              {/each}
            </select>
          </div>

          <div class="diff-select-group">
            <label for="diffRightSelect">Compared / Right Version:</label>
            <select id="diffRightSelect" bind:value={diffRightId}>
              {#each activeDiffGroupExercises as ex}
                <option value={ex.id}>
                  {getDiffSelectLabel(ex)}
                </option>
              {/each}
            </select>
          </div>
        </div>

        <div class="diff-panes">
          <div class="diff-pane">
            <div class="diff-pane-header">
              <h4>Left: {diffLeftEx?.name || "Original"} (v{diffLeftEx?.version || 1})</h4>
              <div class="pane-controls">
                <div class="mode-toggle">
                  <button
                    type="button"
                    class="toggle-btn"
                    class:active={diffLeftMode === "diff"}
                    on:click={() => (diffLeftMode = "diff")}
                  >
                    Diff View
                  </button>
                  <button
                    type="button"
                    class="toggle-btn"
                    class:active={diffLeftMode === "edit"}
                    on:click={() => (diffLeftMode = "edit")}
                  >
                    Edit Code
                  </button>
                </div>
                {#if isDiffLeftDirty}
                  <button
                    type="button"
                    class="save-pane-btn"
                    on:click={handleSaveDiffLeft}
                    disabled={isSavingDiffLeft}
                  >
                    {isSavingDiffLeft ? "Saving..." : "Save Left"}
                  </button>
                {/if}
              </div>
            </div>

            {#if diffLeftMode === "edit"}
              <div class="diff-editor-wrapper">
                <LatexEditor bind:value={diffLeftLatex} rows={14} />
              </div>
            {:else}
              <div class="code-diff-container">
                {#each sideBySideDiff.leftLines as line}
                  <div class="diff-line {line.type}">
                    <span class="line-num">{line.lineNumber ?? ""}</span>
                    <span class="line-content">
                      {#if line.tokens}
                        {#each line.tokens as token}
                          <span class="word-token {token.type}">{@html highlightLatexToHtml(token.text)}</span>
                        {/each}
                      {:else}
                        {@html highlightLatexToHtml(line.text || "")}
                      {/if}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="diff-pane">
            <div class="diff-pane-header">
              <h4>Right: {diffRightEx?.name || "Compared"} (v{diffRightEx?.version || 1})</h4>
              <div class="pane-controls">
                <div class="mode-toggle">
                  <button
                    type="button"
                    class="toggle-btn"
                    class:active={diffRightMode === "diff"}
                    on:click={() => (diffRightMode = "diff")}
                  >
                    Diff View
                  </button>
                  <button
                    type="button"
                    class="toggle-btn"
                    class:active={diffRightMode === "edit"}
                    on:click={() => (diffRightMode = "edit")}
                  >
                    Edit Code
                  </button>
                </div>
                {#if isDiffRightDirty}
                  <button
                    type="button"
                    class="save-pane-btn"
                    on:click={handleSaveDiffRight}
                    disabled={isSavingDiffRight}
                  >
                    {isSavingDiffRight ? "Saving..." : "Save Right"}
                  </button>
                {/if}
              </div>
            </div>

            {#if diffRightMode === "edit"}
              <div class="diff-editor-wrapper">
                <LatexEditor bind:value={diffRightLatex} rows={14} />
              </div>
            {:else}
              <div class="code-diff-container">
                {#each sideBySideDiff.rightLines as line}
                  <div class="diff-line {line.type}">
                    <span class="line-num">{line.lineNumber ?? ""}</span>
                    <span class="line-content">
                      {#if line.tokens}
                        {#each line.tokens as token}
                          <span class="word-token {token.type}">{@html highlightLatexToHtml(token.text)}</span>
                        {/each}
                      {:else}
                        {@html highlightLatexToHtml(line.text || "")}
                      {/if}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="cancel-btn" on:click={requestCloseDiffModal}>Close</button>
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog
  isOpen={showDiffConfirmClose}
  title="Discard Unsaved Diff Changes?"
  message="You have unsaved changes in the LaTeX diff editor. Discarding will lose your changes."
  confirmText="Discard Changes"
  cancelText="Keep Editing"
  on:confirm={forceCloseDiffModal}
  on:cancel={() => (showDiffConfirmClose = false)}
/>

<style>
  .exercise-library-page {
    max-width: 1100px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  h2 {
    margin: 0;
    color: #38bdf8;
  }

  .subtitle {
    margin: 0.25rem 0 0 0;
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .create-btn {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .create-btn:hover {
    background: #0369a1;
  }

  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .search-box input {
    width: 100%;
    padding: 0.75rem;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    color: white;
    box-sizing: border-box;
  }

  .topic-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .pill {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.375rem 0.75rem;
    border-radius: 16px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .pill.active {
    background: #0284c7;
    border-color: #38bdf8;
    color: white;
    font-weight: 600;
  }

  /* ── Group List Layout ── */
  .exercise-group-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .exercise-group-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 10px;
    overflow: hidden;
  }

  /* ── Group Header ── */
  .group-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 1.25rem;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s ease;
  }

  .group-header:hover {
    background: rgba(56, 189, 248, 0.04);
  }

  .group-title-row {
    flex: 1;
    min-width: 0;
  }

  .group-title-row h3 {
    margin: 0 0 0.5rem 0;
    color: #38bdf8;
    font-size: 1.1rem;
  }

  .group-meta {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .topic-badge {
    background: #334155;
    color: #cbd5e1;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .meta-badge {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .grade-badge {
    background: #1e1b4b;
    color: #c7d2fe;
    border: 1px solid #4338ca;
  }

  .subject-badge {
    background: #064e3b;
    color: #a7f3d0;
    border: 1px solid #047857;
  }

  .filter-selects {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .select-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #cbd5e1;
    font-size: 0.875rem;
  }

  .select-group select {
    background: #1e293b;
    border: 1px solid #334155;
    color: white;
    padding: 0.375rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .score-badge {
    background: #0369a1;
    color: #e0f2fe;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .variant-count-badge {
    background: #0f172a;
    color: #94a3b8;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  /* Variant pills shown in collapsed state */
  .variant-pills-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }

  .variant-pill {
    font-size: 0.78rem;
    padding: 0.2rem 0.6rem;
    border-radius: 12px;
    background: #0f172a;
    color: #94a3b8;
    border: 1px solid #334155;
  }

  .variant-pill.has-variant {
    background: rgba(139, 92, 246, 0.15);
    color: #c4b5fd;
    border-color: #8b5cf6;
  }

  .expand-toggle {
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 1rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    transition: color 0.15s ease, transform 0.2s ease;
    flex-shrink: 0;
    margin-top: 0.25rem;
  }

  .expand-toggle.expanded {
    color: #38bdf8;
  }

  /* ── Group Body (expanded) ── */
  .group-body {
    border-top: 1px solid #334155;
    padding: 1rem 1.25rem 1.25rem;
    background: rgba(15, 23, 42, 0.3);
  }

  .variant-section {
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid rgba(51, 65, 85, 0.5);
  }

  .variant-section:last-of-type {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }

  .variant-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .variant-label {
    font-size: 0.9rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    background: #334155;
    color: #cbd5e1;
  }

  .variant-label.has-variant {
    background: rgba(139, 92, 246, 0.25);
    color: #ddd6fe;
  }

  .variant-version {
    font-size: 0.8rem;
    color: #64748b;
  }

  .variant-member {
    margin-left: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .member-info {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .member-version-badge {
    background: #0f172a;
    color: #64748b;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .current-tag {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    background: rgba(34, 197, 94, 0.15);
    color: #86efac;
    font-weight: 600;
    text-transform: uppercase;
  }

  .snippet-preview {
    background: #0f172a;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 0.75rem;
    font-size: 0.8rem;
    color: #94a3b8;
    max-height: 80px;
    overflow: hidden;
  }

  .member-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    justify-content: flex-end;
  }

  /* ── Group-level actions ── */
  .group-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px dashed rgba(51, 65, 85, 0.6);
    margin-top: 0.5rem;
    justify-content: flex-end;
  }

  .group-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.75rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  /* ── Action Buttons ── */
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.375rem 0.55rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 0.775rem;
    font-weight: 600;
    white-space: nowrap;
    line-height: 1;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .action-btn svg {
    flex-shrink: 0;
  }

  .edit-btn {
    background: #334155;
    color: white;
  }

  .delete-btn {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  .version-btn {
    background: #334155;
    color: #38bdf8;
  }

  .group-action-btn.version-btn {
    background: #334155;
    color: #38bdf8;
  }

  .variant-btn {
    background: #4c1d95;
    color: #ddd6fe;
  }

  .group-action-btn.variant-btn {
    background: #4c1d95;
    color: #ddd6fe;
  }

  .diff-btn {
    background: #1e3a8a;
    color: #93c5fd;
  }

  /* ── Modal styling ── */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
  }

  .modal-content {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 90%;
    max-width: 800px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #334155;
  }

  .modal-header h3 {
    margin: 0;
    color: #38bdf8;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 1.25rem;
    cursor: pointer;
  }

  .live-notice {
    background: rgba(2, 132, 199, 0.2);
    color: #7dd3fc;
    padding: 0.5rem 1.5rem;
    font-size: 0.85rem;
  }

  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-bottom: 1rem;
  }

  label {
    font-size: 0.875rem;
    color: #cbd5e1;
  }

  input,
  textarea {
    padding: 0.625rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    color: white;
  }

  .label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .score-indicator {
    font-size: 0.85rem;
    color: #38bdf8;
  }

  .preview-btn {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }

  .preview-box {
    margin-top: 1rem;
    background: #0f172a;
    padding: 1rem;
    border-radius: 8px;
  }

  .preview-box h4 {
    margin-top: 0;
    color: #38bdf8;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid #334155;
  }

  .cancel-btn {
    background: #334155;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .save-btn {
    background: #16a34a;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .loading,
  .empty-state {
    text-align: center;
    padding: 3rem;
    color: #94a3b8;
  }

  .delete-confirm-btn {
    background: #dc2626;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .delete-confirm-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .small-modal {
    max-width: 500px;
  }

  .large-modal {
    max-width: 1000px;
    max-height: 95vh;
  }

  .warning-box {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid #ef4444;
    border-radius: 8px;
    padding: 1rem;
    color: #fca5a5;
  }

  .warning-box h4 {
    margin: 0 0 0.5rem 0;
    color: #f87171;
  }

  .exam-list {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
    color: #e2e8f0;
  }

  .exam-date {
    color: #94a3b8;
    font-size: 0.85rem;
    margin-left: 0.35rem;
  }

  .warning-note {
    font-size: 0.85rem;
    margin-top: 0.75rem;
    color: #cbd5e1;
  }

  .diff-selectors {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
    background: #0f172a;
    padding: 1rem;
    border-radius: 8px;
  }

  .diff-select-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    flex: 1;
  }

  .diff-select-group select {
    padding: 0.5rem;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    color: white;
  }

  .diff-panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .diff-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .pane-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mode-toggle {
    display: flex;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 2px;
  }

  .mode-toggle .toggle-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mode-toggle .toggle-btn.active {
    background: #38bdf8;
    color: #0f172a;
    font-weight: 600;
  }

  .save-pane-btn {
    background: #10b981;
    color: white;
    border: none;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .save-pane-btn:hover:not(:disabled) {
    background: #059669;
  }

  .save-pane-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .diff-editor-wrapper {
    max-height: 450px;
    height: 450px;
    border-radius: 8px;
    overflow: hidden;
  }

  .diff-pane h4 {
    margin: 0;
    color: #38bdf8;
    font-size: 0.9rem;
  }

  .code-diff-container {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    font-family: "Fira Code", monospace;
    font-size: 0.85rem;
    line-height: 1.5;
    max-height: 450px;
    overflow-y: auto;
    overflow-x: auto;
    padding: 0.5rem 0;
  }

  .diff-line {
    display: flex;
    min-height: 1.5rem;
    padding: 0 0.5rem;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .line-num {
    display: inline-block;
    width: 2.2rem;
    min-width: 2.2rem;
    color: #64748b;
    font-size: 0.75rem;
    user-select: none;
    text-align: right;
    padding-right: 0.6rem;
    border-right: 1px solid #1e293b;
    margin-right: 0.6rem;
  }

  .line-content {
    flex: 1;
  }

  .diff-line.removed {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  .diff-line.removed .line-num {
    color: #f87171;
    border-right-color: rgba(239, 68, 68, 0.3);
  }

  .diff-line.added {
    background: rgba(34, 197, 94, 0.2);
    color: #86efac;
  }

  .diff-line.added .line-num {
    color: #4ade80;
    border-right-color: rgba(34, 197, 94, 0.3);
  }

  .diff-line.modified {
    background: rgba(234, 179, 8, 0.08);
  }

  .diff-line.modified .line-num {
    color: #fbbf24;
    border-right-color: rgba(234, 179, 8, 0.2);
  }

  .diff-line.unchanged {
    color: #cbd5e1;
  }

  .diff-line.empty {
    background: rgba(15, 23, 42, 0.5);
  }

  .word-token {
    display: inline;
    border-radius: 3px;
    padding: 0 2px;
  }

  .word-token.removed {
    background: rgba(239, 68, 68, 0.35);
    color: #fca5a5;
    text-decoration: line-through;
  }

  .word-token.added {
    background: rgba(34, 197, 94, 0.35);
    color: #86efac;
    font-weight: 600;
  }

  .word-token.unchanged {
    color: inherit;
  }

  .desc-text {
    font-size: 0.875rem;
    color: #94a3b8;
    margin: 0 0 1rem 0;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .local-fallback-banner {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid #eab308;
    color: #fef08a;
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .sync-now-btn {
    background: #eab308;
    color: #0f172a;
    font-weight: 700;
    border: none;
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .sync-now-btn:hover {
    background: #facc15;
  }
</style>