<script lang="ts">
  import { onMount } from "svelte";
  import { db } from "$lib/db/db";
  import { sessionStore, isAuthenticated } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import type { ExerciseRecord } from "$lib/db/schema";
  import { loadExercisesEncrypted, saveExerciseEncrypted, saveExamEncrypted, encryptExercise } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { parseExerciseScore, formatExerciseLatex } from "$lib/latex/scoreParser";
  import { compileLatex } from "$lib/latex/compiler";
  import { get } from "svelte/store";
  import LatexEditor from "$lib/components/LatexEditor.svelte";
  import LatexViewer from "$lib/components/LatexViewer.svelte";
  import ExerciseEditorModal from "$lib/components/ExerciseEditorModal.svelte";
  import DualPdfPreview from "$lib/components/DualPdfPreview.svelte";

  // Metadata
  let title = "";
  let testart = "Kurzarbeit";
  let klasse = "10a";
  let datum = new Date().toLocaleDateString("de-DE") + " (30 Minuten)";
  let nr = "1";
  let fach = "Informatik";
  let lehrernachname = "";
  let infoText = `\\begin{itemize}
    \\item Die Arbeit wird anonymisiert korrigiert. Trage deine Initialen ins QR-Code-Feld ein.
    \\item Mit Bleistift oder rot/rosa Geschriebenes kann \\textbf{nicht} gewertet werden!
\\end{itemize}`;
  let retentionDays = 365;

  // Library & Selection state
  let libraryExercises: ExerciseRecord[] = [];
  let selectedLibraryIds: string[] = [];
  let selectedTopicFilter: string = "ALL";
  let selectedGradeFilter: string = "ALL";
  let selectedSubjectFilter: string = "ALL";
  let searchQuery: string = "";
  let activeTab: "library" | "custom" = "library";

  // Quick exercise editor state
  let isQuickEditorOpen = false;
  let editingExerciseForQuickEdit: ExerciseRecord | null = null;

  function openQuickEdit(ex: ExerciseRecord) {
    editingExerciseForQuickEdit = ex;
    isQuickEditorOpen = true;
  }

  async function handleQuickEditSaved() {
    await loadLibrary();
  }

  $: {
    if (title.trim() || selectedLibraryIds.length > 0) {
      sessionStore.setDirty(true);
    }
  }

  // Exercise grouping & preview modal state
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

  let activeVariantPerGroup: Record<string, string> = {};
  let isPreviewModalOpen = false;
  let previewModalEx: ExerciseRecord | null = null;

  // Inline custom exercise form
  let customName = "Custom_Exercise";
  let customTopicTag = "_General";
  let customLatexBody = `\\begin{Aufgabe}{Eigene Aufgabe}
Frage hier eingeben... \\BE
\\end{Aufgabe}`;
  let saveCustomToLibrary = true;

  // State
  let isLoading = false;
  let errorMsg = "";
  let previewPdfUrl: string | null = null;
  let previewSolutionPdfUrl: string | null = null;
  let showAngabePreview = true;
  let showLoesungPreview = false;
  let isPreviewLoading = false;

  $: availableTopics = Array.from(
    new Set(
      libraryExercises
        .map((e) => e.topicTag)
        .filter((t): t is string => Boolean(t)),
    ),
  ).sort();

  $: availableGrades = Array.from(
    new Set(
      libraryExercises
        .map((e) => e.grade)
        .filter((g): g is string => Boolean(g)),
    ),
  ).sort();

  $: availableSubjects = Array.from(
    new Set(
      libraryExercises
        .map((e) => e.subject)
        .filter((s): s is string => Boolean(s)),
    ),
  ).sort();

  $: filteredLibrary = libraryExercises.filter((ex) => {
    const matchesTopic =
      selectedTopicFilter === "ALL" || ex.topicTag === selectedTopicFilter;
    const matchesGrade =
      selectedGradeFilter === "ALL" || ex.grade === selectedGradeFilter;
    const matchesSubject =
      selectedSubjectFilter === "ALL" || ex.subject === selectedSubjectFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (ex.name && ex.name.toLowerCase().includes(q)) ||
      (ex.topicTag && ex.topicTag.toLowerCase().includes(q)) ||
      (ex.grade && ex.grade.toLowerCase().includes(q)) ||
      (ex.subject && ex.subject.toLowerCase().includes(q)) ||
      (ex.variantKey && ex.variantKey.toLowerCase().includes(q)) ||
      (ex.latexBody && ex.latexBody.toLowerCase().includes(q));
    return matchesTopic && matchesGrade && matchesSubject && matchesSearch;
  });

  $: filteredGroups = groupExercises(filteredLibrary);
  $: totalVariantsCount = filteredGroups.reduce((acc, g) => acc + g.variants.size, 0);

  $: selectedExercises = selectedLibraryIds
    .map((id) => libraryExercises.find((e) => e.id === id))
    .filter((e): e is ExerciseRecord => Boolean(e));

  $: totalPoints = selectedExercises.reduce(
    (sum, ex) => sum + (parseExerciseScore(ex.latexBody || "") || ex.maxPoints || 0),
    0,
  );

  onMount(() => {
    loadLibrary();
  });

  function groupExercises(exs: ExerciseRecord[]): ExerciseGroup[] {
    const buckets = new Map<string, ExerciseRecord[]>();

    for (const ex of exs) {
      const key = ex.exerciseGroupId || `name:${ex.name || "Untitled"}`;
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

      groups.push({
        groupId,
        name,
        topicTag,
        maxPoints,
        minPoints,
        variants: sortedVariants,
        allMembers,
      });
    }

    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  async function loadLibrary() {
    const key = get(sessionStore).sessionKey;
    try {
      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
        try {
          const remoteExs = (await api.get("/exercises")) as any[];
          libraryExercises = remoteExs.map((e: any) => ({
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
          const encryptedExs = await Promise.all(libraryExercises.map(ex => encryptExercise(ex, key)));
          await db.exercises.bulkPut(encryptedExs);
        } catch (apiErr) {
          console.warn("Failed to fetch remote library, using IDB:", apiErr);
          libraryExercises = await loadExercisesEncrypted(key);
        }
      } else {
        libraryExercises = await loadExercisesEncrypted(key);
      }
    } catch (err) {
      console.error("Failed to load exercise library:", err);
    }
  }

  function setGroupVariant(groupId: string, vKey: string) {
    activeVariantPerGroup = { ...activeVariantPerGroup, [groupId]: vKey };
  }

  function openPreviewModal(ex: ExerciseRecord) {
    previewModalEx = ex;
    isPreviewModalOpen = true;
  }

  function closePreviewModal() {
    isPreviewModalOpen = false;
    previewModalEx = null;
  }

  function getCleanSnippet(latexBody: string | undefined, maxLen = 140): string {
    if (!latexBody) return "No content preview available.";
    const clean = latexBody
      .replace(/\\begin\{[^}]+\}/g, "")
      .replace(/\\end\{[^}]+\}/g, "")
      .replace(/\\(BE|hBE|qBE|textbf|textit|emph|section|subsection|item|Info|Fach|Klasse|Datum|Nr|Testart|Lehrernachname)/g, "")
      .replace(/[\{\}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return latexBody.slice(0, maxLen) + "...";
    return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
  }

  function toggleLibrarySelection(id: string) {
    if (selectedLibraryIds.includes(id)) {
      selectedLibraryIds = selectedLibraryIds.filter((i) => i !== id);
    } else {
      selectedLibraryIds = [...selectedLibraryIds, id];
    }
  }

  function moveExercise(index: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= selectedLibraryIds.length) return;
    const copy = [...selectedLibraryIds];
    [copy[index], copy[targetIdx]] = [copy[targetIdx], copy[index]];
    selectedLibraryIds = copy;
  }

  async function handleAddCustomExercise() {
    if (!customName.trim()) {
      alert("Exercise name is required.");
      return;
    }

    const computedScore = parseExerciseScore(customLatexBody);
    const newEx: ExerciseRecord = {
      id: crypto.randomUUID(),
      teacherId: $sessionStore.email || "local-teacher",
      name: customName,
      topicTag: customTopicTag,
      latexBody: customLatexBody,
      maxPoints: computedScore,
      version: 1,
      questionType: "free_text",
      penalty: 0,
      createdAt: new Date().toISOString(),
    };

    if (saveCustomToLibrary) {
      const key = get(sessionStore).sessionKey;
      await saveExerciseEncrypted(newEx, key);
      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
        try {
          await api.post("/exercises", {
            id: newEx.id,
            name: newEx.name,
            topic_tag: newEx.topicTag,
            latex_body: newEx.latexBody,
          });
        } catch (apiErr) {
          console.warn("Failed to sync new exercise to server:", apiErr);
        }
      }
      libraryExercises = [...libraryExercises, newEx];
    } else {
      libraryExercises = [...libraryExercises, newEx];
    }

    selectedLibraryIds = [...selectedLibraryIds, newEx.id];
    activeTab = "library";
  }

  async function handleLivePreview() {
    if (selectedExercises.length === 0) {
      alert("Please select at least one exercise to preview.");
      return;
    }

    isPreviewLoading = true;
    errorMsg = "";
    try {
      const exerciseInputs = selectedExercises
        .map((ex, idx) =>
          formatExerciseLatex(
            ex.latexBody,
            ex.name || `Aufgabe ${idx + 1}`,
          ),
        )
        .join("\n\n");

      const getPreamble = (options: string) => `\\documentclass[a4paper]{article}
\\usepackage[${options}]{sty/Schulaufgabe}
\\Info{${infoText}}
\\Fach{${fach}}
\\Lehrernachname{${lehrernachname}}
\\usepackage{bbding}
\\usepackage{pifont}
\\usepackage{fontspec}
\\usepackage{framed}
\\usepackage{enumitem}
\\usetikzlibrary{shapes.geometric, arrows}
\\usepackage{sty/tikz-uml}
\\neverindent
\\WarningsOff
\\begin{document}
\\Testart{${testart}}
\\Klasse{${klasse}}
\\Datum{${datum}}
\\Nr{${nr}}

${exerciseInputs}

\\end{document}`;

      const fullTexAngabe = getPreamble("sans,punkte");
      const fullTexLoesung = getPreamble("sans,punkte,antworten");

      const useLocal = $storagePolicyStore.latexCompilation === "local";
      if (useLocal) {
        errorMsg = "Compiling PDF...";
      }

      const resAngabe = await compileLatex(fullTexAngabe, useLocal, (status) => {
        if (status === 'downloading') {
          errorMsg = "Loading local LaTeX compiler... (Downloading ~32MB on first load, please wait)";
        } else if (status === 'compiling') {
          errorMsg = "Compiling PDF...";
        }
      }, false);

      const blobAngabe = new Blob([resAngabe.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      previewPdfUrl = URL.createObjectURL(blobAngabe);

      const resLoesung = await compileLatex(fullTexLoesung, useLocal, undefined, false);
      const blobLoesung = new Blob([resLoesung.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      if (previewSolutionPdfUrl) URL.revokeObjectURL(previewSolutionPdfUrl);
      previewSolutionPdfUrl = URL.createObjectURL(blobLoesung);

      errorMsg = ""; // clear loading message
    } catch (err: any) {
      errorMsg = err.message || "Preview compilation failed.";
    } finally {
      isPreviewLoading = false;
    }
  }

  async function handleCreateExam() {
    if (!title.trim()) {
      errorMsg = "Exam title is required.";
      return;
    }
    if (selectedLibraryIds.length === 0) {
      errorMsg = "Please select at least one exercise for the exam.";
      return;
    }

    isLoading = true;
    errorMsg = "";
    const examId = crypto.randomUUID();
    const retentionUntil = new Date(Date.now() + retentionDays * 86400000)
      .toISOString()
      .split("T")[0];

    try {
      const key = get(sessionStore).sessionKey;
      await saveExamEncrypted({
        id: examId,
        teacherId: $sessionStore.email || "local-teacher",
        title,
        testart,
        klasse,
        datum,
        nr,
        fach,
        lehrernachname,
        infoText,
        retentionUntil,
        compilationStatus: "pending",
        createdAt: new Date().toISOString(),
      }, key);

      // Save junction links in IDB
      const examExerciseRecords = selectedLibraryIds.map((exId, idx) => ({
        examId,
        exerciseId: exId,
        orderIndex: idx + 1,
      }));
      await db.examExercises.bulkPut(examExerciseRecords);

      if ($storagePolicyStore.storageMode !== "all-local") {
        try {
          await api.post("/exams", {
            id: examId,
            title,
            testart,
            klasse,
            datum,
            nr,
            fach,
            lehrernachname,
            info_text: infoText,
            retention_until: retentionUntil,
            exercise_ids: selectedLibraryIds,
          });
        } catch (apiErr) {
          console.warn("Failed to sync exam to server:", apiErr);
        }
      }

      sessionStore.setDirty(false);
      window.location.href = `/exam/${examId}`;
    } catch (err: any) {
      errorMsg = err.message || "Failed to create exam.";
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="new-exam-page">
  <h2>Create Exam (Assembly from Exercise Library)</h2>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  <form on:submit|preventDefault={handleCreateExam}>
    <!-- Metadata Section -->
    <div class="section-card">
      <h3>1. Exam Metadata</h3>

      <div class="form-group">
        <label for="title">Exam Title</label>
        <input
          id="title"
          type="text"
          bind:value={title}
          placeholder="e.g. 2. Kurzarbeit 10a Informatik"
          required
        />
      </div>

      <div class="form-grid-3">
        <div class="form-group">
          <label for="testart">Testart (\\Testart)</label>
          <input
            id="testart"
            type="text"
            bind:value={testart}
            placeholder="Kurzarbeit"
            required
          />
        </div>

        <div class="form-group">
          <label for="klasse">Klasse (\\Klasse)</label>
          <input
            id="klasse"
            type="text"
            bind:value={klasse}
            placeholder="10a"
            required
          />
        </div>

        <div class="form-group">
          <label for="nr">Nummer (\\Nr)</label>
          <input id="nr" type="text" bind:value={nr} placeholder="1" required />
        </div>
      </div>

      <div class="form-grid-3">
        <div class="form-group">
          <label for="datum">Datum & Dauer (\\Datum)</label>
          <input
            id="datum"
            type="text"
            bind:value={datum}
            placeholder="20.05.2025 (30 Min)"
            required
          />
        </div>

        <div class="form-group">
          <label for="fach">Fach (\\Fach)</label>
          <input
            id="fach"
            type="text"
            bind:value={fach}
            placeholder="Informatik"
            required
          />
        </div>

        <div class="form-group">
          <label for="lehrer">Lehrer Nachname (\\Lehrernachname)</label>
          <input
            id="lehrer"
            type="text"
            bind:value={lehrernachname}
            placeholder="Her"
            required
          />
        </div>
      </div>

      <div class="form-group">
        <label for="info">Header Info Instructions (\\Info)</label>
        <textarea id="info" rows="2" bind:value={infoText}></textarea>
      </div>
    </div>

    <!-- Exercise Selection Section -->
    <div class="section-card">
      <div class="section-header">
        <h3>2. Select Exercises</h3>
        <div class="tabs">
          <button
            type="button"
            class="tab-btn"
            class:active={activeTab === "library"}
            on:click={() => (activeTab = "library")}
          >
            📚 From Library ({selectedLibraryIds.length} Selected)
          </button>
          <button
            type="button"
            class="tab-btn"
            class:active={activeTab === "custom"}
            on:click={() => (activeTab = "custom")}
          >
            ✏️ Create Custom Exercise
          </button>
        </div>
      </div>

      {#if activeTab === "library"}
        <div class="filter-row">
          <div class="search-metrics-row">
            <input
              type="text"
              placeholder="Search exercise library by name, topic, grade, subject, variant, or LaTeX content..."
              bind:value={searchQuery}
              class="search-input"
            />
            <span class="library-metrics">
              {filteredGroups.length} Exercise Groups ({totalVariantsCount} Variants)
            </span>
          </div>

          <div class="filter-selects-row">
            {#if availableGrades.length > 0}
              <div class="select-group">
                <label for="picker-grade">Grade:</label>
                <select id="picker-grade" bind:value={selectedGradeFilter}>
                  <option value="ALL">All Grades</option>
                  {#each availableGrades as g}
                    <option value={g}>Grade {g}</option>
                  {/each}
                </select>
              </div>
            {/if}

            {#if availableSubjects.length > 0}
              <div class="select-group">
                <label for="picker-subject">Subject:</label>
                <select id="picker-subject" bind:value={selectedSubjectFilter}>
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
              type="button"
              class="pill"
              class:active={selectedTopicFilter === "ALL"}
              on:click={() => (selectedTopicFilter = "ALL")}
            >
              All ({filteredGroups.length})
            </button>
            {#each availableTopics as topic}
              {@const groupCount = filteredGroups.filter((g) => g.topicTag === topic).length}
              <button
                type="button"
                class="pill"
                class:active={selectedTopicFilter === topic}
                on:click={() => (selectedTopicFilter = topic)}
              >
                {topic} ({groupCount})
              </button>
            {/each}
          </div>
        </div>

        {#if filteredGroups.length === 0}
          <div class="empty-hint">
            No exercise groups found in library matching filter criteria.
          </div>
        {:else}
          <div class="compact-exercise-list">
            {#each filteredGroups as group}
              {@const activeVKey = activeVariantPerGroup[group.groupId] || Array.from(group.variants.keys())[0] || "_General"}
              {@const vMembers = group.variants.get(activeVKey) || []}
              {@const activeMember = vMembers[0]}
              {@const activeEx = activeMember?.ex}
              {@const isSelected = activeEx ? selectedLibraryIds.includes(activeEx.id) : false}
              {@const groupSelectedCount = group.allMembers.filter(m => selectedLibraryIds.includes(m.ex.id)).length}
              {@const score = activeEx ? (parseExerciseScore(activeEx.latexBody || "") || activeEx.maxPoints || 0) : 0}

              <div class="compact-group-row" class:row-selected={groupSelectedCount > 0}>
                <!-- Selection Checkbox -->
                <div class="row-checkbox-col">
                  {#if activeEx}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      on:change={() => toggleLibrarySelection(activeEx.id)}
                      title={isSelected ? "Remove from exam" : "Add to exam"}
                    />
                  {/if}
                </div>

                <!-- Main Info: Title, Topic, Variants -->
                <div class="row-main-col">
                  <div class="row-title-line">
                    <span class="group-title-text">{group.name}</span>
                    
                    {#if group.topicTag}
                      <span class="compact-topic-tag">{group.topicTag}</span>
                    {/if}

                    {#if groupSelectedCount > 0}
                      <span class="selected-indicator-badge">
                        ✓ {groupSelectedCount} in exam
                      </span>
                    {/if}
                  </div>

                  <!-- Inline Variant Selector Pills (if multiple variants exist) -->
                  {#if group.variants.size > 1}
                    <div class="compact-variant-bar">
                      {#each group.variants.keys() as vKey}
                        {@const members = group.variants.get(vKey) || []}
                        {@const hasSelected = members.some(m => selectedLibraryIds.includes(m.ex.id))}
                        <button
                          type="button"
                          class="compact-variant-pill"
                          class:active={vKey === activeVKey}
                          class:has-selected={hasSelected}
                          on:click={() => setGroupVariant(group.groupId, vKey)}
                          title={`Switch to variant "${vKey}"`}
                        >
                          {#if hasSelected}
                            <span class="v-check">✓</span>
                          {/if}
                          <span>{vKey}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- Right Actions: Points, Quick Edit & Preview Button -->
                <div class="row-actions-col">
                  <span class="compact-score-badge">
                    {group.variants.size > 1 && group.minPoints !== group.maxPoints
                      ? `${group.minPoints}-${group.maxPoints} Pkt`
                      : `${score} Pkt`}
                  </span>

                  {#if activeEx}
                    <button
                      type="button"
                      class="icon-edit-btn"
                      title="Quick Edit Exercise Globally"
                      on:click={() => openQuickEdit(activeEx)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                      <span class="preview-text">Quick Edit</span>
                    </button>
                    <button
                      type="button"
                      class="icon-preview-btn"
                      title="Quick Preview LaTeX Code"
                      on:click={() => openPreviewModal(activeEx)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                      <span class="preview-text">Preview</span>
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- Custom Inline Form -->
        <div class="custom-exercise-form">
          <div class="form-grid">
            <div class="form-group">
              <label for="customName">Exercise Name</label>
              <input
                id="customName"
                type="text"
                bind:value={customName}
                placeholder="Custom_1"
              />
            </div>
            <div class="form-group">
              <label for="customTopic">Topic Tag</label>
              <input
                id="customTopic"
                type="text"
                bind:value={customTopicTag}
                placeholder="_Vererbung"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="customBody"
              >LaTeX Body (\\begin&#123;Aufgabe&#125;...)</label
            >
            <LatexEditor bind:value={customLatexBody} rows={6} />
          </div>

          <div class="custom-actions">
            <label class="checkbox-label">
              <input type="checkbox" bind:checked={saveCustomToLibrary} />
              Save to Exercise Library for future exams
            </label>
            <button
              type="button"
              class="add-custom-btn"
              on:click={handleAddCustomExercise}
            >
              + Add to Exam
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Selected Exercises Reorder & Summary -->
    <div class="section-card">
      <div class="section-header">
        <h3>
          3. Exam Structure ({selectedExercises.length} Exercises | Total: {totalPoints}
          Pkt)
        </h3>
        <button
          type="button"
          class="preview-btn"
          class:is-loading={isPreviewLoading}
          on:click={handleLivePreview}
          disabled={isPreviewLoading || selectedExercises.length === 0}
        >
          {isPreviewLoading ? "Compiling Preview..." : "🔍 Live Preview PDF"}
        </button>
      </div>

      {#if selectedExercises.length === 0}
        <div class="empty-hint">
          No exercises selected yet. Pick exercises from the library above.
        </div>
      {:else}
        <div class="selected-list">
          {#each selectedExercises as ex, idx}
            {@const score = parseExerciseScore(ex.latexBody || "") || ex.maxPoints || 0}
            <div class="selected-item">
              <div class="item-info">
                <span class="order-num">({idx + 1})</span>
                <strong>{ex.name}</strong>
                {#if ex.topicTag}
                  <span class="topic-tag">{ex.topicTag}</span>
                {/if}
                <span class="score-badge">{score} Pkt</span>
              </div>
              <div class="order-controls">
                <button
                  type="button"
                  class="edit-item-btn"
                  title="Quick Edit Exercise Globally"
                  on:click={() => openQuickEdit(ex)}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  class="order-btn"
                  disabled={idx === 0}
                  on:click={() => moveExercise(idx, "up")}
                >
                  ▲
                </button>
                <button
                  type="button"
                  class="order-btn"
                  disabled={idx === selectedExercises.length - 1}
                  on:click={() => moveExercise(idx, "down")}
                >
                  ▼
                </button>
                <button
                  type="button"
                  class="remove-btn"
                  on:click={() => toggleLibrarySelection(ex.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if previewPdfUrl || previewSolutionPdfUrl}
      <div class="preview-container">
        <h4>Complete Exam PDF Live Preview</h4>
        <DualPdfPreview
          {previewPdfUrl}
          {previewSolutionPdfUrl}
          bind:showAngabePreview
          bind:showLoesungPreview
          titleAngabe="Exam"
          titleLoesung="Answer Key"
          height="600px"
          placeholderText="Click 'Generate Live Preview' to render"
        />
      </div>
    {/if}

    <button
      type="submit"
      class="submit-btn"
      class:is-loading={isLoading}
      disabled={isLoading || selectedExercises.length === 0}
    >
      {isLoading ? "Creating Exam..." : "Save Exam & Continue"}
    </button>
  </form>

  <!-- Exercise Preview Modal Drawer -->
  {#if isPreviewModalOpen && previewModalEx}
    {@const modalScore = parseExerciseScore(previewModalEx.latexBody || "") || previewModalEx.maxPoints || 0}
    {@const isModalSelected = selectedLibraryIds.includes(previewModalEx.id)}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      on:click={closePreviewModal}
      on:keydown={(e) => e.key === "Escape" && closePreviewModal()}
    >
      <div
        class="modal-drawer"
        role="dialog"
        aria-modal="true"
        on:click|stopPropagation
      >
        <div class="modal-header">
          <div>
            <div class="modal-title-row">
              <h3>{previewModalEx.name}</h3>
              {#if previewModalEx.variantKey && previewModalEx.variantKey !== "_General"}
                <span class="variant-key-tag">{previewModalEx.variantKey}</span>
              {/if}
            </div>
            <div class="modal-meta-pills">
              {#if previewModalEx.topicTag}
                <span class="topic-badge">{previewModalEx.topicTag}</span>
              {/if}
              <span class="score-badge">{modalScore} Pkt</span>
              <span class="variant-version-badge"
                >Version {previewModalEx.version}</span
              >
              {#if previewModalEx.questionType}
                <span class="question-type-badge"
                  >{previewModalEx.questionType}</span
                >
              {/if}
            </div>
          </div>
          <button class="modal-close-btn" on:click={closePreviewModal}>✕</button>
        </div>

        <div class="modal-body">
          <div class="latex-code-section">
            <div class="section-label">LaTeX Source Code</div>
            <LatexViewer code={previewModalEx.latexBody || "\\begin{Aufgabe}{}\n\\end{Aufgabe}"} maxHeight="350px" />
          </div>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="modal-select-btn"
            class:selected={isModalSelected}
            on:click={() => previewModalEx && toggleLibrarySelection(previewModalEx.id)}
          >
            {isModalSelected
              ? "✓ Selected in Exam (Click to Remove)"
              : "+ Select for Exam"}
          </button>
          <button
            type="button"
            class="modal-edit-btn"
            on:click={() => {
              const exToEdit = previewModalEx;
              closePreviewModal();
              if (exToEdit) openQuickEdit(exToEdit);
            }}
          >
            ✏️ Quick Edit
          </button>
          <button
            type="button"
            class="modal-cancel-btn"
            on:click={closePreviewModal}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  {/if}

  <ExerciseEditorModal
    isOpen={isQuickEditorOpen}
    editingExercise={editingExerciseForQuickEdit}
    on:close={() => (isQuickEditorOpen = false)}
    on:save={handleQuickEditSaved}
  />
</div>

<style>
  .new-exam-page {
    max-width: 950px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  h2 {
    color: #38bdf8;
    margin-bottom: 1.5rem;
  }

  .section-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .section-card h3 {
    margin-top: 0;
    color: #f8fafc;
    font-size: 1.1rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-bottom: 1rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .form-grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 1rem;
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

  .code-editor {
    font-family: "Fira Code", "Courier New", Courier, monospace;
    font-size: 0.9rem;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
  }

  .tab-btn {
    background: #0f172a;
    border: 1px solid #334155;
    color: #94a3b8;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }

  .tab-btn.active {
    background: #0284c7;
    border-color: #38bdf8;
    color: white;
  }

  .filter-row {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
  }

  .topic-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .pill {
    background: #0f172a;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.25rem 0.6rem;
    border-radius: 12px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .pill.active {
    background: #0284c7;
    color: white;
  }

  .library-checklist {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.75rem;
    max-height: 300px;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .library-item {
    background: #0f172a;
    border: 1px solid #334155;
    padding: 0.75rem;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .library-item.selected {
    border-color: #38bdf8;
    background: rgba(2, 132, 199, 0.15);
  }

  .item-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .item-name {
    font-weight: 600;
    color: #f8fafc;
  }

  .topic-tag {
    font-size: 0.75rem;
    background: #334155;
    color: #cbd5e1;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }

  .score-badge {
    background: #0369a1;
    color: #e0f2fe;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .custom-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .add-custom-btn {
    background: #16a34a;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .selected-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .selected-item {
    background: #0f172a;
    border: 1px solid #334155;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .item-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .order-num {
    color: #38bdf8;
    font-weight: bold;
  }

  .order-controls {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .order-btn {
    background: #334155;
    color: white;
    border: none;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .order-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .remove-btn {
    background: transparent;
    color: #ef4444;
    border: none;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 1rem;
  }

  .preview-btn {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .preview-container {
    background: #1e293b;
    border: 1px solid #0284c7;
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 1.5rem;
  }

  .preview-container h4 {
    margin-top: 0;
    color: #38bdf8;
  }

  .submit-btn {
    width: 100%;
    padding: 0.875rem;
    background: #16a34a;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-hint {
    color: #94a3b8;
    text-align: center;
    padding: 1.5rem;
    font-size: 0.9rem;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
    font-family: "Fira Code", monospace;
  }

  /* Search & Metrics Header */
  .search-metrics-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .library-metrics {
    font-size: 0.8rem;
    color: #94a3b8;
    white-space: nowrap;
    font-weight: 500;
  }

  /* Compact Exercise List */
  .compact-exercise-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 480px;
    overflow-y: auto;
    padding-right: 0.35rem;
  }

  .compact-group-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 0.5rem 0.85rem;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .compact-group-row:hover {
    border-color: #475569;
    background: #152035;
  }

  .compact-group-row.row-selected {
    border-color: #0284c7;
    background: rgba(2, 132, 199, 0.1);
  }

  .row-checkbox-col {
    display: flex;
    align-items: center;
  }

  .row-checkbox-col input[type="checkbox"] {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: #0284c7;
  }

  .row-main-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .row-title-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .group-title-text {
    font-weight: 600;
    color: #f8fafc;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compact-topic-tag {
    font-size: 0.72rem;
    background: #334155;
    color: #cbd5e1;
    padding: 0.1rem 0.45rem;
    border-radius: 4px;
    font-weight: 500;
  }

  .selected-indicator-badge {
    font-size: 0.72rem;
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid #10b981;
    color: #34d399;
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .compact-variant-bar {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
  }

  .compact-variant-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    padding: 0.1rem 0.455rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .compact-variant-pill:hover {
    border-color: #38bdf8;
    color: #f8fafc;
  }

  .compact-variant-pill.active {
    background: #0284c7;
    border-color: #38bdf8;
    color: white;
    font-weight: 600;
  }

  .compact-variant-pill.has-selected {
    border-color: #10b981;
  }

  .compact-variant-pill.active.has-selected {
    background: #059669;
    border-color: #34d399;
  }

  .v-check {
    color: #34d399;
    font-weight: bold;
    font-size: 0.7rem;
  }

  .row-actions-col {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    white-space: nowrap;
  }

  .compact-score-badge {
    background: #0369a1;
    color: #e0f2fe;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .icon-preview-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: transparent;
    border: 1px solid #334155;
    color: #38bdf8;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .icon-preview-btn:hover {
    background: #1e293b;
    border-color: #38bdf8;
  }

  /* Modal Drawer Overlay */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(3px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-drawer {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 100%;
    max-width: 700px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #334155;
    background: #0f172a;
  }

  .modal-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .modal-title-row h3 {
    margin: 0;
    color: #f8fafc;
    font-size: 1.15rem;
  }

  .modal-meta-pills {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .question-type-badge {
    font-size: 0.75rem;
    background: #475569;
    color: #f1f5f9;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .modal-close-btn {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    line-height: 1;
    border-radius: 4px;
  }

  .modal-close-btn:hover {
    color: white;
    background: #334155;
  }

  .modal-body {
    padding: 1.25rem 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .latex-code-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .section-label {
    font-size: 0.78rem;
    color: #94a3b8;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .latex-preview-code {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 1rem;
    margin: 0;
    overflow-x: auto;
    color: #e2e8f0;
    font-family: "Fira Code", "Courier New", Courier, monospace;
    font-size: 0.85rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-top: 1px solid #334155;
    background: #0f172a;
  }

  .modal-select-btn {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .modal-select-btn:hover {
    background: #0369a1;
  }

  .modal-select-btn.selected {
    background: #16a34a;
  }

  .modal-select-btn.selected:hover {
    background: #15803d;
  }

  .modal-cancel-btn {
    background: #334155;
    color: #cbd5e1;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .modal-cancel-btn:hover {
    background: #475569;
    color: white;
  }

  .icon-edit-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: #334155;
    border: 1px solid #475569;
    color: #f1f5f9;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .icon-edit-btn:hover {
    background: #475569;
    border-color: #38bdf8;
    color: #38bdf8;
  }

  .edit-item-btn {
    background: #334155;
    color: white;
    border: none;
    padding: 0.25rem 0.4rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    margin-right: 0.2rem;
  }

  .edit-item-btn:hover {
    background: #475569;
  }

  .modal-edit-btn {
    background: #334155;
    color: #38bdf8;
    border: 1px solid #475569;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .modal-edit-btn:hover {
    background: #475569;
  }
</style>
