<script lang="ts">
  import { onMount } from "svelte";
  import { db } from "$lib/db/db";
  import { sessionStore } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import type { ExerciseRecord } from "$lib/db/schema";
  import { loadExercisesEncrypted, saveExerciseEncrypted, saveExamEncrypted, encryptExercise } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { parseExerciseScore } from "$lib/latex/scoreParser";
  import { get } from "svelte/store";

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
  let searchQuery: string = "";
  let activeTab: "library" | "custom" = "library";

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
  let isPreviewLoading = false;

  $: availableTopics = Array.from(
    new Set(
      libraryExercises
        .map((e) => e.topicTag)
        .filter((t): t is string => Boolean(t)),
    ),
  ).sort();

  $: filteredLibrary = libraryExercises.filter((ex) => {
    const matchesTopic =
      selectedTopicFilter === "ALL" || ex.topicTag === selectedTopicFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (ex.name && ex.name.toLowerCase().includes(q)) ||
      (ex.topicTag && ex.topicTag.toLowerCase().includes(q)) ||
      (ex.latexBody && ex.latexBody.toLowerCase().includes(q));
    return matchesTopic && matchesSearch;
  });

  $: selectedExercises = selectedLibraryIds
    .map((id) => libraryExercises.find((e) => e.id === id))
    .filter((e): e is ExerciseRecord => Boolean(e));

  $: totalPoints = selectedExercises.reduce(
    (sum, ex) => sum + parseExerciseScore(ex.latexBody || ""),
    0,
  );

  onMount(() => {
    loadLibrary();
  });

  async function loadLibrary() {
    const key = get(sessionStore).sessionKey;
    try {
      if ($storagePolicyStore === "server-synced") {
        try {
          const remoteExs = (await api.get("/exercises")) as any[];
          libraryExercises = remoteExs.map((e: any) => ({
            id: e.id,
            teacherId: e.teacher_id,
            name: e.name,
            topicTag: e.topic_tag,
            latexBody: e.latex_body,
            maxPoints: e.max_points,
            version: e.version || 1,
            questionType: "free_text",
            penalty: 0,
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
      if ($storagePolicyStore === "server-synced") {
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
        .map(
          (ex) => ex.latexBody || `\\begin{Aufgabe}{${ex.name}}\\end{Aufgabe}`,
        )
        .join("\n\n");

      const fullTex = `\\documentclass[a4paper]{article}
\\usepackage[sans,punkte]{sty/Schulaufgabe}
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

      const pdfBuffer = await api.postJsonForBinary("/compile/latex", {
        latex: fullTex,
      });
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      previewPdfUrl = URL.createObjectURL(blob);
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

      if ($storagePolicyStore === "server-synced") {
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
          <input
            type="text"
            placeholder="Search exercise library..."
            bind:value={searchQuery}
            class="search-input"
          />
          <div class="topic-pills">
            <button
              type="button"
              class="pill"
              class:active={selectedTopicFilter === "ALL"}
              on:click={() => (selectedTopicFilter = "ALL")}
            >
              All
            </button>
            {#each availableTopics as topic}
              <button
                type="button"
                class="pill"
                class:active={selectedTopicFilter === topic}
                on:click={() => (selectedTopicFilter = topic)}
              >
                {topic}
              </button>
            {/each}
          </div>
        </div>

        {#if filteredLibrary.length === 0}
          <div class="empty-hint">
            No exercises found in library matching filter.
          </div>
        {:else}
          <div class="library-checklist">
            {#each filteredLibrary as ex}
              {@const isSelected = selectedLibraryIds.includes(ex.id)}
              {@const score = parseExerciseScore(ex.latexBody || "")}
              <div class="library-item" class:selected={isSelected}>
                <label class="item-label">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    on:change={() => toggleLibrarySelection(ex.id)}
                  />
                  <span class="item-name">{ex.name}</span>
                  {#if ex.topicTag}
                    <span class="topic-tag">{ex.topicTag}</span>
                  {/if}
                </label>
                <span class="score-badge">{score} Pkt</span>
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
            <textarea
              id="customBody"
              rows="6"
              class="code-editor"
              bind:value={customLatexBody}
            ></textarea>
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
            {@const score = parseExerciseScore(ex.latexBody || "")}
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

    {#if previewPdfUrl}
      <div class="preview-container">
        <h4>Complete Exam PDF Live Preview</h4>
        <iframe
          src={previewPdfUrl}
          title="LaTeX Exam Preview"
          width="100%"
          height="500px"
        ></iframe>
      </div>
    {/if}

    <button
      type="submit"
      class="submit-btn"
      disabled={isLoading || selectedExercises.length === 0}
    >
      {isLoading ? "Creating Exam..." : "Save Exam & Continue"}
    </button>
  </form>
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
  }
</style>
