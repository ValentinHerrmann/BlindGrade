<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import type { ExerciseRecord } from "$lib/db/schema";
  import { db } from "$lib/db/db";
  import { sessionStore, isAuthenticated } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import { saveExerciseEncrypted } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { parseExerciseScore, formatExerciseLatex } from "$lib/latex/scoreParser";
  import { compileLatex } from "$lib/latex/compiler";
  import LatexEditor from "./LatexEditor.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import DualPdfPreview from "./DualPdfPreview.svelte";

  export let isOpen = false;
  export let editingExercise: ExerciseRecord | null = null;
  export let isCreatingVersion = false;
  export let versionBaseEx: ExerciseRecord | null = null;

  const dispatch = createEventDispatcher<{
    close: void;
    save: { exercise: ExerciseRecord; isNewVersion: boolean };
  }>();

  // Form field state
  let editorName = "";
  let editorTopicTag = "_General";
  let editorGrade = "";
  let editorSubject = "";
  let editorVariantKey = "";
  let editorLatexBody = "";

  // Initial state for dirty tracking
  let initialName = "";
  let initialTopicTag = "";
  let initialGrade = "";
  let initialSubject = "";
  let initialVariantKey = "";
  let initialLatexBody = "";

  // Confirmation modal state
  let showConfirmClose = false;

  // Preview state
  let isPreviewLoading = false;
  let previewPdfUrl: string | null = null;
  let previewSolutionPdfUrl: string | null = null;
  let showAngabePreview = true;
  let showLoesungPreview = false;
  $: hasAnyPreview = showAngabePreview || showLoesungPreview;
  let isSaving = false;
  let errorMsg = "";

  // Track initialization on isOpen or exercise props change
  let lastOpenState = false;
  $: if (isOpen && !lastOpenState) {
    initForm();
    lastOpenState = true;
  } else if (!isOpen && lastOpenState) {
    lastOpenState = false;
    cleanupPreview();
  }

  function initForm() {
    if (isCreatingVersion && versionBaseEx) {
      editorName = versionBaseEx.name || "Untitled";
      editorTopicTag = versionBaseEx.topicTag || "_General";
      editorGrade = versionBaseEx.grade || "";
      editorSubject = versionBaseEx.subject || "";
      editorVariantKey = versionBaseEx.variantKey || "";
      editorLatexBody = versionBaseEx.latexBody || "";
    } else if (editingExercise) {
      editorName = editingExercise.name || "Untitled";
      editorTopicTag = editingExercise.topicTag || "_General";
      editorGrade = editingExercise.grade || "";
      editorSubject = editingExercise.subject || "";
      editorVariantKey = editingExercise.variantKey || "";
      editorLatexBody = editingExercise.latexBody || "";
    } else {
      editorName = "New_Exercise";
      editorTopicTag = "_General";
      editorGrade = "";
      editorSubject = "";
      editorVariantKey = "";
      editorLatexBody = `\\begin{Aufgabe}{Neue Aufgabe}\nFrage hier eingeben... \\BE\n\\end{Aufgabe}`;
    }

    initialName = editorName;
    initialTopicTag = editorTopicTag;
    initialGrade = editorGrade;
    initialSubject = editorSubject;
    initialVariantKey = editorVariantKey;
    initialLatexBody = editorLatexBody;
    showAngabePreview = true;
    showLoesungPreview = false;
    showConfirmClose = false;
    errorMsg = "";

    cleanupPreview();
  }

  function cleanupPreview() {
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
      previewPdfUrl = null;
    }
    if (previewSolutionPdfUrl) {
      URL.revokeObjectURL(previewSolutionPdfUrl);
      previewSolutionPdfUrl = null;
    }
  }

  onDestroy(() => {
    cleanupPreview();
  });

  $: isDirty =
    editorName !== initialName ||
    editorTopicTag !== initialTopicTag ||
    editorGrade !== initialGrade ||
    editorSubject !== initialSubject ||
    editorVariantKey !== initialVariantKey ||
    editorLatexBody !== initialLatexBody;

  function requestClose() {
    if (isDirty) {
      showConfirmClose = true;
    } else {
      forceClose();
    }
  }

  function forceClose() {
    showConfirmClose = false;
    cleanupPreview();
    dispatch("close");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen || showConfirmClose) return;
    if (e.key === "Escape") {
      requestClose();
    }
  }

  async function handlePreviewExercise() {
    isPreviewLoading = true;
    errorMsg = "";
    try {
      const getPreamble = (extraOpts: string) => `\\documentclass[a4paper]{article}
\\usepackage[${extraOpts}]{sty/Schulaufgabe}
\\usepackage{bbding}
\\usepackage{pifont}
\\usepackage{fontspec}
\\usepackage{framed}
\\usepackage{enumitem}
\\usetikzlibrary{shapes.geometric, arrows}
\\usepackage{sty/tikz-uml}
\\neverindent
\\WarningsOff
\\renewcommand{\\Namenszeile}{}
\\AtBeginDocument{
  \\pagestyle{empty}
  \\thispagestyle{empty}
  \\lhead{}
  \\chead{}
  \\rhead{}
  \\lfoot{}
  \\cfoot{}
  \\rfoot{}
}`;

      const formattedBody = formatExerciseLatex(editorLatexBody, editorName || "Aufgabe");

      const fullTexAngabe = `${getPreamble('sans')}\n\\setboolean{Antworten}{false}\n\\begin{document}\n\\leavevmode\\par\n${formattedBody}\n\\end{document}`;
      const fullTexLoesung = `${getPreamble('sans,antworten')}\n\\setboolean{Antworten}{true}\n\\begin{document}\n\\leavevmode\\par\n${formattedBody}\n\\end{document}`;

      const useLocal = $storagePolicyStore.latexCompilation === "local";

      const [resAngabe, resLoesung] = await Promise.all([
        compileLatex(fullTexAngabe, useLocal, undefined, false),
        compileLatex(fullTexLoesung, useLocal, undefined, false)
      ]);

      const blobAngabe = new Blob([resAngabe.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const blobLoesung = new Blob([resLoesung.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });

      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      if (previewSolutionPdfUrl) URL.revokeObjectURL(previewSolutionPdfUrl);

      previewPdfUrl = URL.createObjectURL(blobAngabe);
      previewSolutionPdfUrl = URL.createObjectURL(blobLoesung);
    } catch (err: any) {
      console.error("Exercise preview failed:", err);
      errorMsg = `Preview failed: ${err.message || "Unknown compilation error"}`;
    } finally {
      isPreviewLoading = false;
    }
  }

  async function handleSaveExercise() {
    if (!editorName.trim()) {
      errorMsg = "Exercise name is required.";
      return;
    }

    isSaving = true;
    errorMsg = "";
    const key = get(sessionStore).sessionKey;

    try {
      if (isCreatingVersion && versionBaseEx) {
        let savedEx: ExerciseRecord;
        if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
          const res = (await api.post(`/exercises/${versionBaseEx.id}/new-version`, {
            name: editorName,
            topic_tag: editorTopicTag,
            grade: editorGrade.trim() || null,
            subject: editorSubject.trim() || null,
            latex_body: editorLatexBody,
          })) as any;

          savedEx = {
            id: res.id || crypto.randomUUID(),
            teacherId: res.teacher_id || $sessionStore.email || "local-teacher",
            name: res.name || editorName,
            topicTag: res.topic_tag || editorTopicTag,
            grade: res.grade || editorGrade.trim() || undefined,
            subject: res.subject || editorSubject.trim() || undefined,
            latexBody: res.latex_body || editorLatexBody,
            maxPoints: res.max_points || parseExerciseScore(editorLatexBody),
            version: res.version || (versionBaseEx.version || 1) + 1,
            questionType: res.question_type || "free_text",
            penalty: res.penalty || 0,
            exerciseGroupId: res.exercise_group_id || versionBaseEx.exerciseGroupId,
            variantKey: res.variant_key || editorVariantKey.trim() || undefined,
            isCurrent: res.is_current ?? true,
            updatedAt: new Date().toISOString(),
          };
          await saveExerciseEncrypted(savedEx, key);
        } else {
          const groupId = versionBaseEx.exerciseGroupId || crypto.randomUUID();
          if (!versionBaseEx.exerciseGroupId) {
            versionBaseEx.exerciseGroupId = groupId;
            await saveExerciseEncrypted(versionBaseEx, key);
          }
          savedEx = {
            ...versionBaseEx,
            id: crypto.randomUUID(),
            name: editorName,
            topicTag: editorTopicTag,
            grade: editorGrade.trim() || undefined,
            subject: editorSubject.trim() || undefined,
            latexBody: editorLatexBody,
            maxPoints: parseExerciseScore(editorLatexBody),
            version: (versionBaseEx.version || 1) + 1,
            exerciseGroupId: groupId,
            variantKey: editorVariantKey.trim() || undefined,
            isCurrent: true,
            updatedAt: new Date().toISOString(),
          };
          await saveExerciseEncrypted({ ...versionBaseEx, isCurrent: false }, key);
          await saveExerciseEncrypted(savedEx, key);
        }

        dispatch("save", { exercise: savedEx, isNewVersion: true });
        forceClose();
        return;
      }

      const computedScore = parseExerciseScore(editorLatexBody);
      const id = editingExercise?.id || crypto.randomUUID();

      const record: ExerciseRecord = {
        id,
        teacherId: editingExercise?.teacherId || $sessionStore.email || "local-teacher",
        name: editorName,
        topicTag: editorTopicTag,
        grade: editorGrade.trim() || undefined,
        subject: editorSubject.trim() || undefined,
        latexBody: editorLatexBody,
        maxPoints: computedScore,
        version: editingExercise ? editingExercise.version : 1,
        questionType: editingExercise?.questionType || "free_text",
        penalty: editingExercise?.penalty || 0,
        exerciseGroupId: editingExercise?.exerciseGroupId,
        variantKey: editorVariantKey.trim() || undefined,
        isCurrent: editingExercise?.isCurrent ?? true,
        updatedAt: new Date().toISOString(),
      };

      await saveExerciseEncrypted(record, key);

      if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
        try {
          if (editingExercise) {
            await api.patch(`/exercises/${id}`, {
              name: record.name,
              topic_tag: record.topicTag,
              grade: record.grade || null,
              subject: record.subject || null,
              latex_body: record.latexBody,
              variant_key: record.variantKey || null,
            });
          } else {
            await api.post("/exercises", {
              id: record.id,
              name: record.name,
              topic_tag: record.topicTag,
              grade: record.grade || null,
              subject: record.subject || null,
              latex_body: record.latexBody,
              variant_key: record.variantKey || null,
            });
          }
        } catch (apiErr) {
          console.warn("Failed to sync exercise to server:", apiErr);
        }
      }

      dispatch("save", { exercise: record, isNewVersion: false });
      forceClose();
    } catch (err: any) {
      errorMsg = `Failed to save exercise: ${err.message}`;
    } finally {
      isSaving = false;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={requestClose}
  >
    <div
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exercise-editor-title"
    >
      <div class="modal-header">
        <h3 id="exercise-editor-title">
          {isCreatingVersion
            ? `New Version: ${editorName}`
            : editingExercise
              ? `Edit Exercise: ${editorName}`
              : "Create New Exercise"}
        </h3>
        <button type="button" class="close-btn" on:click={requestClose}>✕</button>
      </div>

      {#if isCreatingVersion}
        <div class="live-notice">
          ℹ️ Creating new version v{(versionBaseEx?.version || 1) + 1}. The previous version will be preserved.
        </div>
      {:else if editingExercise}
        <div class="live-notice">
          ℹ️ Editing this exercise will live-update globally across all exams referencing it.
        </div>
      {/if}

      {#if errorMsg}
        <div class="error-banner">{errorMsg}</div>
      {/if}

      <div class="modal-body">
        <div class="editor-column">
          <div class="form-grid">
            <div class="form-group">
              <label for="editorName">Exercise Name</label>
              <input
                id="editorName"
                type="text"
                bind:value={editorName}
                required
              />
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

            <div class="form-group">
              <label for="editorGrade">Grade / Klasse</label>
              <input
                id="editorGrade"
                type="text"
                bind:value={editorGrade}
                placeholder="e.g. 10, 10a, 12"
              />
            </div>

            <div class="form-group">
              <label for="editorSubject">Subject / Fach</label>
              <input
                id="editorSubject"
                type="text"
                bind:value={editorSubject}
                placeholder="e.g. Informatik, Mathematik"
              />
            </div>

            <div class="form-group full-width">
              <label for="editorVariantKey">Variant Key (optional)</label>
              <input
                id="editorVariantKey"
                type="text"
                bind:value={editorVariantKey}
                placeholder="e.g. Moebel, Fahrzeug, Wildtier (leave empty for default)"
              />
            </div>
          </div>

          <div class="form-group latex-editor-group">
            <div class="label-row">
              <label for="editorBody"
                >LaTeX Body (\\begin&#123;Aufgabe&#125;...)</label
              >
              <span class="score-indicator">
                Auto-Score: <strong
                  >{parseExerciseScore(editorLatexBody)} Pkt</strong
                >
              </span>
            </div>
            <LatexEditor bind:value={editorLatexBody} rows={12} />
          </div>

          <div class="editor-actions-row">
            <button
              type="button"
              class="preview-btn"
              class:is-loading={isPreviewLoading}
              on:click={handlePreviewExercise}
              disabled={isPreviewLoading}
            >
              {isPreviewLoading ? "Compiling Previews..." : "🔍 Live Preview PDF"}
            </button>
          </div>
        </div>

        <DualPdfPreview
          {previewPdfUrl}
          {previewSolutionPdfUrl}
          bind:showAngabePreview
          bind:showLoesungPreview
          titleAngabe="Exercise"
          titleLoesung="Solution"
          placeholderText="Click 'Live Preview PDF' to render"
        />
      </div>

      <div class="modal-footer">
        <button type="button" class="cancel-btn" on:click={requestClose}>Cancel</button>
        <button
          type="button"
          class="save-btn"
          class:is-loading={isSaving}
          on:click={handleSaveExercise}
          disabled={isSaving}
        >
          {isSaving
            ? "Saving..."
            : isCreatingVersion
              ? "Save New Version"
              : "Save Exercise"}
        </button>
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog
  isOpen={showConfirmClose}
  title="Discard Exercise Changes?"
  message="You have modified fields in this exercise. Discarding will lose your unsaved changes."
  confirmText="Discard Changes"
  cancelText="Keep Editing"
  on:confirm={forceClose}
  on:cancel={() => (showConfirmClose = false)}
/>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .modal-content {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 95vw;
    max-width: 1700px;
    height: 92vh;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #334155;
    flex-shrink: 0;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.2rem;
    color: #f1f5f9;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
    border-radius: 4px;
  }

  .close-btn:hover {
    color: #f1f5f9;
  }

  .live-notice {
    background: rgba(56, 189, 248, 0.1);
    border-left: 4px solid #38bdf8;
    color: #38bdf8;
    padding: 0.75rem 1.5rem;
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.15);
    border-left: 4px solid #ef4444;
    color: #fca5a5;
    padding: 0.75rem 1.5rem;
    font-size: 0.875rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    font-family: "Fira Code", monospace;
    flex-shrink: 0;
  }

  .modal-body {
    padding: 1.25rem;
    overflow: hidden;
    display: flex;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }

  @media (max-width: 1100px) {
    .modal-body {
      flex-direction: column;
      overflow-y: auto;
    }
  }

  .editor-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .form-group.latex-editor-group {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .form-group label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #94a3b8;
  }

  .form-group input {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 0.6rem 0.8rem;
    color: #f1f5f9;
    font-size: 0.9rem;
  }

  .form-group input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .label-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .score-indicator {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .score-indicator strong {
    color: #38bdf8;
  }

  .editor-actions-row {
    display: flex;
    justify-content: flex-end;
  }

  .preview-btn {
    background: #334155;
    color: #38bdf8;
    border: 1px solid #475569;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .preview-btn:hover:not(:disabled) {
    background: #475569;
  }

  .preview-box {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 1rem;
    margin-top: 0.5rem;
  }

  .preview-box h4 {
    margin: 0 0 0.75rem 0;
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .preview-box iframe {
    border: none;
    border-radius: 4px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    background: #0f172a;
    border-top: 1px solid #334155;
  }

  .cancel-btn {
    background: #334155;
    color: white;
    border: none;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .cancel-btn:hover {
    background: #475569;
  }

  .save-btn {
    background: #2563eb;
    color: white;
    border: none;
    padding: 0.6rem 1.2rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .save-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
