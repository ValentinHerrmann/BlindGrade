<script lang="ts">
  import { onMount } from 'svelte';
  import { db } from '$lib/db/db';
  import { sessionStore } from '$lib/stores/session';
  import type { ExerciseRecord } from '$lib/db/schema';
  import { api } from '$lib/api/client';
  import { parseExerciseScore } from '$lib/latex/scoreParser';

  let exercises: ExerciseRecord[] = [];
  let selectedTopic: string = 'ALL';
  let searchQuery: string = '';
  let isLoading = false;
  let errorMsg = '';

  // Editor modal state
  let isEditorOpen = false;
  let editingId: string | null = null;
  let editorName = '';
  let editorTopicTag = '_General';
  let editorLatexBody = '';

  // Preview state
  let isPreviewLoading = false;
  let previewPdfUrl: string | null = null;

  $: availableTopics = Array.from(
    new Set(exercises.map((e) => e.topicTag).filter((t): t is string => Boolean(t)))
  ).sort();

  $: filteredExercises = exercises.filter((ex) => {
    const matchesTopic = selectedTopic === 'ALL' || ex.topicTag === selectedTopic;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (ex.name && ex.name.toLowerCase().includes(q)) ||
      (ex.topicTag && ex.topicTag.toLowerCase().includes(q)) ||
      (ex.latexBody && ex.latexBody.toLowerCase().includes(q));
    return matchesTopic && matchesSearch;
  });

  onMount(() => {
    loadExercises();
  });

  async function loadExercises() {
    isLoading = true;
    errorMsg = '';
    try {
      if ($sessionStore.mode === 'hybrid') {
        try {
          const remoteExs = (await api.get('/exercises')) as any[];
          exercises = remoteExs.map((e: any) => ({
            id: e.id,
            teacherId: e.teacher_id,
            name: e.name,
            topicTag: e.topic_tag,
            latexBody: e.latex_body,
            maxPoints: e.max_points,
            version: e.version || 1,
            questionType: e.question_type || 'free_text',
            penalty: e.penalty || 0,
          }));
          await db.exercises.bulkPut(exercises);
        } catch (apiErr) {
          console.warn('Failed to fetch remote exercises, falling back to IDB:', apiErr);
          exercises = await db.exercises.toArray();
        }
      } else {
        exercises = await db.exercises.toArray();
      }
    } catch (err: any) {
      errorMsg = err.message || 'Failed to load exercise library.';
    } finally {
      isLoading = false;
    }
  }

  function openCreateModal() {
    editingId = null;
    editorName = 'New_Exercise';
    editorTopicTag = '_General';
    editorLatexBody = `\\begin{Aufgabe}{Neue Aufgabe}
Frage hier eingeben... \\BE
\\end{Aufgabe}`;
    if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
    previewPdfUrl = null;
    isEditorOpen = true;
  }

  function openEditModal(ex: ExerciseRecord) {
    editingId = ex.id;
    editorName = ex.name || 'Untitled';
    editorTopicTag = ex.topicTag || '_General';
    editorLatexBody = ex.latexBody || '';
    if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
    previewPdfUrl = null;
    isEditorOpen = true;
  }

  function closeEditor() {
    isEditorOpen = false;
    if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
    previewPdfUrl = null;
  }

  async function handlePreviewExercise() {
    isPreviewLoading = true;
    try {
      const fullTex = `\\documentclass[a4paper]{article}
\\usepackage[sans,punkte]{sty/Schulaufgabe}
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
\\Testart{Vorschau}
\\Klasse{10a}
\\Datum{Vorschau}
\\Nr{1}

${editorLatexBody}

\\end{document}`;

      const pdfBuffer = await api.postJsonForBinary('/compile/latex', { latex: fullTex });
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      previewPdfUrl = URL.createObjectURL(blob);
    } catch (err: any) {
      alert(`Preview failed: ${err.message || 'Unknown compilation error'}`);
    } finally {
      isPreviewLoading = false;
    }
  }

  async function handleSaveExercise() {
    if (!editorName.trim()) {
      alert('Exercise name is required.');
      return;
    }

    const computedScore = parseExerciseScore(editorLatexBody);
    const id = editingId || crypto.randomUUID();

    const record: ExerciseRecord = {
      id,
      teacherId: $sessionStore.email || 'local-teacher',
      name: editorName,
      topicTag: editorTopicTag,
      latexBody: editorLatexBody,
      maxPoints: computedScore,
      version: (exercises.find((e) => e.id === id)?.version || 0) + 1,
      questionType: 'free_text',
      penalty: 0,
      updatedAt: new Date().toISOString(),
    };

    try {
      await db.exercises.put(record);

      if ($sessionStore.mode === 'hybrid') {
        try {
          if (editingId) {
            await api.patch(`/exercises/${id}`, {
              name: record.name,
              topic_tag: record.topicTag,
              latex_body: record.latexBody,
            });
          } else {
            await api.post('/exercises', {
              id: record.id,
              name: record.name,
              topic_tag: record.topicTag,
              latex_body: record.latexBody,
            });
          }
        } catch (apiErr) {
          console.warn('Failed to sync exercise to server:', apiErr);
        }
      }

      await loadExercises();
      closeEditor();
    } catch (err: any) {
      alert(`Failed to save exercise: ${err.message}`);
    }
  }

  async function handleDeleteExercise(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}" from your library?`)) return;

    try {
      await db.exercises.delete(id);
      if ($sessionStore.mode === 'hybrid') {
        try {
          await api.delete(`/exercises/${id}`);
        } catch (apiErr) {
          console.warn('Failed to delete on server:', apiErr);
        }
      }
      await loadExercises();
    } catch (err: any) {
      alert(`Failed to delete exercise: ${err.message}`);
    }
  }
</script>

<div class="exercise-library-page">
  <div class="page-header">
    <div>
      <h2>Exercise Library (Aufgabenkatalog)</h2>
      <p class="subtitle">Reusable LaTeX exercise collection live-linked across your exams.</p>
    </div>
    <button class="create-btn" on:click={openCreateModal}>+ Create New Exercise</button>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  <div class="filter-bar">
    <div class="search-box">
      <input
        type="text"
        placeholder="Search exercises by name, topic, or LaTeX content..."
        bind:value={searchQuery}
      />
    </div>

    <div class="topic-pills">
      <button
        class="pill"
        class:active={selectedTopic === 'ALL'}
        on:click={() => (selectedTopic = 'ALL')}
      >
        All ({exercises.length})
      </button>
      {#each availableTopics as topic}
        {@const count = exercises.filter((e) => e.topicTag === topic).length}
        <button
          class="pill"
          class:active={selectedTopic === topic}
          on:click={() => (selectedTopic = topic)}
        >
          {topic} ({count})
        </button>
      {/each}
    </div>
  </div>

  {#if isLoading}
    <div class="loading">Loading exercise library...</div>
  {:else if filteredExercises.length === 0}
    <div class="empty-state">
      <p>No exercises found matching your criteria.</p>
      <button class="create-btn" on:click={openCreateModal}>Create First Exercise</button>
    </div>
  {:else}
    <div class="exercise-grid">
      {#each filteredExercises as ex}
        {@const score = parseExerciseScore(ex.latexBody || '')}
        <div class="exercise-card">
          <div class="card-header">
            <h4>{ex.name || 'Untitled'}</h4>
            <div class="badges">
              {#if ex.topicTag}
                <span class="topic-badge">{ex.topicTag}</span>
              {/if}
              <span class="score-badge">{score} Pkt</span>
              <span class="version-badge">v{ex.version || 1}</span>
            </div>
          </div>

          <div class="snippet-preview">
            <code>{(ex.latexBody || '').slice(0, 150)}...</code>
          </div>

          <div class="card-actions">
            <button class="action-btn edit-btn" on:click={() => openEditModal(ex)}>Edit</button>
            <button
              class="action-btn delete-btn"
              on:click={() => handleDeleteExercise(ex.id, ex.name || 'this exercise')}
            >
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if isEditorOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={closeEditor}
    on:keydown|self={(e) => e.key === 'Escape' && closeEditor()}
  >
    <div class="modal-content">
      <div class="modal-header">
        <h3>{editingId ? `Edit Exercise: ${editorName}` : 'Create New Exercise'}</h3>
        <button class="close-btn" on:click={closeEditor}>✕</button>
      </div>

      {#if editingId}
        <div class="live-notice">
          ℹ️ Editing this exercise will live-update all exams that reference it.
        </div>
      {/if}

      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group">
            <label for="editorName">Exercise Name</label>
            <input id="editorName" type="text" bind:value={editorName} required />
          </div>

          <div class="form-group">
            <label for="editorTopic">Topic Tag</label>
            <input
              id="editorTopic"
              type="text"
              bind:value={editorTopicTag}
              placeholder="_Vererbung"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <div class="label-row">
            <label for="editorBody">LaTeX Body (\\begin&#123;Aufgabe&#125;...)</label>
            <span class="score-indicator">
              Auto-Score: <strong>{parseExerciseScore(editorLatexBody)} Pkt</strong>
            </span>
          </div>
          <textarea
            id="editorBody"
            rows="10"
            class="code-editor"
            bind:value={editorLatexBody}
          ></textarea>
        </div>

        <div class="editor-actions-row">
          <button
            type="button"
            class="preview-btn"
            on:click={handlePreviewExercise}
            disabled={isPreviewLoading}
          >
            {isPreviewLoading ? 'Compiling Preview...' : '🔍 Live Preview PDF'}
          </button>
        </div>

        {#if previewPdfUrl}
          <div class="preview-box">
            <h4>Single Exercise PDF Preview</h4>
            <iframe src={previewPdfUrl} title="Exercise Preview" width="100%" height="350px"></iframe>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="cancel-btn" on:click={closeEditor}>Cancel</button>
        <button class="save-btn" on:click={handleSaveExercise}>Save Exercise</button>
      </div>
    </div>
  </div>
{/if}

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

  .exercise-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.25rem;
  }

  .exercise-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .card-header h4 {
    margin: 0 0 0.5rem 0;
    color: #38bdf8;
  }

  .badges {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .topic-badge {
    background: #334155;
    color: #cbd5e1;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
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

  .version-badge {
    background: #0f172a;
    color: #64748b;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .snippet-preview {
    background: #0f172a;
    padding: 0.75rem;
    border-radius: 6px;
    margin: 1rem 0;
    font-size: 0.8rem;
    color: #94a3b8;
    max-height: 80px;
    overflow: hidden;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .action-btn {
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .edit-btn {
    background: #334155;
    color: white;
  }

  .delete-btn {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  /* Modal styling */
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

  input, textarea {
    padding: 0.625rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    color: white;
  }

  .code-editor {
    font-family: 'Fira Code', 'Courier New', Courier, monospace;
    font-size: 0.9rem;
    line-height: 1.4;
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

  .loading, .empty-state {
    text-align: center;
    padding: 3rem;
    color: #94a3b8;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }
</style>
