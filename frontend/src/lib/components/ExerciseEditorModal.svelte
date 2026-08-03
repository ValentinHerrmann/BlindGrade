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
  let showLatexPanel = true;
  $: hasAnyPreview = showAngabePreview || showLoesungPreview;
  let isSaving = false;
  let errorMsg = "";

  function handleToggleLatex() {
    showLatexPanel = !showLatexPanel;
  }

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
    (editingExercise || isCreatingVersion
      ? false
      : editorName !== initialName ||
        editorTopicTag !== initialTopicTag ||
        editorGrade !== initialGrade ||
        editorSubject !== initialSubject) ||
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

      const resAngabe = await compileLatex(fullTexAngabe, useLocal, undefined, false);
      const blobAngabe = new Blob([resAngabe.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      previewPdfUrl = URL.createObjectURL(blobAngabe);

      const resLoesung = await compileLatex(fullTexLoesung, useLocal, undefined, false);
      const blobLoesung = new Blob([resLoesung.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      if (previewSolutionPdfUrl) URL.revokeObjectURL(previewSolutionPdfUrl);
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
        if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
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

      // If exercise belongs to a group, cascade group metadata updates (name, topicTag, grade, subject) to all sister exercises locally
      if (record.exerciseGroupId) {
        const allLocal = await loadExercisesEncrypted(key);
        for (const sister of allLocal) {
          if (sister.exerciseGroupId === record.exerciseGroupId && sister.id !== record.id) {
            const updatedSister: ExerciseRecord = {
              ...sister,
              name: record.name,
              topicTag: record.topicTag,
              grade: record.grade,
              subject: record.subject,
              updatedAt: new Date().toISOString(),
            };
            await saveExerciseEncrypted(updatedSister, key);
          }
        }
      }

      if ($isAuthenticated && $storagePolicyStore.storageMode !== "all-local") {
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
        <div class="modal-header-top">
          <div class="modal-title-group">
            <h3 id="exercise-editor-title">
              {isCreatingVersion
                ? `New Version: ${editorName}`
                : editingExercise
                  ? `Edit Exercise: ${editorName}`
                  : "Create New Exercise"}
            </h3>
            {#if isCreatingVersion}
              <span class="version-badge">v{(versionBaseEx?.version || 1) + 1}</span>
            {/if}
          </div>
          <button type="button" class="close-btn" on:click={requestClose}>✕</button>
        </div>

        <div class="modal-header-meta">
          {#if editingExercise || isCreatingVersion}
            <div class="hdr-group-info">
              <span class="hdr-label">Exercise Group:</span>
              <strong class="hdr-name">{editorName}</strong>
              <span class="hdr-pill">🏷️ {editorTopicTag}</span>
              {#if editorGrade}
                <span class="hdr-pill">🎓 Grade {editorGrade}</span>
              {/if}
              {#if editorSubject}
                <span class="hdr-pill">📚 {editorSubject}</span>
              {/if}
            </div>

            <div class="hdr-field">
              <label for="editorVariantKey">Variant Key:</label>
              <input
                id="editorVariantKey"
                type="text"
                bind:value={editorVariantKey}
                placeholder="e.g. Moebel, Fahrzeug"
              />
            </div>
          {:else}
            <div class="hdr-form-grid">
              <div class="hdr-field">
                <label for="editorName">Name *</label>
                <input
                  id="editorName"
                  type="text"
                  bind:value={editorName}
                  required
                  placeholder="Group Name"
                />
              </div>

              <div class="hdr-field">
                <label for="editorTopic">Topic *</label>
                <input
                  id="editorTopic"
                  type="text"
                  bind:value={editorTopicTag}
                  placeholder="_Vererbung"
                  required
                />
              </div>

              <div class="hdr-field">
                <label for="editorGrade">Grade</label>
                <input
                  id="editorGrade"
                  type="text"
                  bind:value={editorGrade}
                  placeholder="e.g. 10"
                />
              </div>

              <div class="hdr-field">
                <label for="editorSubject">Subject</label>
                <input
                  id="editorSubject"
                  type="text"
                  bind:value={editorSubject}
                  placeholder="e.g. Informatik"
                />
              </div>

              <div class="hdr-field">
                <label for="editorVariantKey">Variant Key</label>
                <input
                  id="editorVariantKey"
                  type="text"
                  bind:value={editorVariantKey}
                  placeholder="e.g. Moebel"
                />
              </div>
            </div>
          {/if}
        </div>
      </div>

      {#if errorMsg}
        <div class="error-banner">{errorMsg}</div>
      {/if}

      <div class="modal-body">
        <div
          class="editor-column"
          class:expanded={showLatexPanel}
          class:collapsed={!showLatexPanel}
        >
          {#if showLatexPanel}
            <button
              type="button"
              class="panel-header-bar"
              on:click={handleToggleLatex}
              title="Click to collapse LaTeX Code Panel"
            >
              <div class="panel-header-left">
                <span class="panel-title">💻 LaTeX Source Code</span>
                <span class="score-indicator-badge">
                  Auto-Score: <strong>{parseExerciseScore(editorLatexBody)} Pkt</strong>
                </span>
              </div>
              <div class="panel-header-right">
                <button
                  type="button"
                  class="preview-btn-inline"
                  class:is-loading={isPreviewLoading}
                  on:click|stopPropagation={handlePreviewExercise}
                  disabled={isPreviewLoading}
                  title="Compile & preview exercise PDF"
                >
                  {isPreviewLoading ? "Compiling..." : "🔍 Live Preview PDF"}
                </button>
                <span class="header-icon">›</span>
              </div>
            </button>

            <div class="form-group latex-editor-group">
              <LatexEditor bind:value={editorLatexBody} rows={12} />
            </div>
          {:else}
            <button
              type="button"
              class="vertical-latex-strip"
              on:click={handleToggleLatex}
              title="Click to expand LaTeX Code Panel"
            >
              <span class="strip-icon">›</span>
              <span class="strip-emoji">💻</span>
              <span class="strip-title">LaTeX Source Code ({parseExerciseScore(editorLatexBody)} Pkt)</span>
            </button>
          {/if}
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
    flex-direction: column;
    gap: 0.65rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #334155;
    flex-shrink: 0;
    background: #1e293b;
  }

  .modal-header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .modal-title-group {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .version-badge {
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.15rem;
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

  .modal-header-meta {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
  }

  .hdr-group-info {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
  }

  .hdr-label {
    color: #94a3b8;
    font-size: 0.8rem;
  }

  .hdr-name {
    color: #f1f5f9;
    font-weight: 600;
  }

  .hdr-pill {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .hdr-form-grid {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
    width: 100%;
  }

  .hdr-field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
  }

  .hdr-field label {
    color: #94a3b8;
    font-weight: 600;
    white-space: nowrap;
  }

  .hdr-field input {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 4px;
    color: #f1f5f9;
    padding: 0.3rem 0.5rem;
    font-size: 0.825rem;
  }

  .hdr-field input:focus {
    outline: none;
    border-color: #38bdf8;
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
    display: flex;
    flex-direction: column;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .editor-column.expanded {
    flex: 1;
    min-width: 0;
    padding: 0;
    gap: 0;
  }

  .editor-column.collapsed {
    width: 38px;
    flex: 0 0 38px;
    min-width: 38px;
    padding: 0;
  }

  .panel-header-bar {
    background: #1e293b;
    border: none;
    border-bottom: 1px solid #334155;
    padding: 0.5rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }

  .panel-header-bar:hover {
    background: #334155;
  }

  .panel-header-bar:hover .header-icon {
    color: #38bdf8;
  }

  .header-icon {
    font-size: 1rem;
    font-weight: bold;
    color: #94a3b8;
    transition: color 0.15s ease;
    flex-shrink: 0;
  }

  .panel-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .panel-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f1f5f9;
    white-space: nowrap;
  }

  .score-indicator-badge {
    font-size: 0.75rem;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.2);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }

  .score-indicator-badge strong {
    color: #38bdf8;
  }

  .panel-header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .preview-btn-inline {
    background: #0284c7;
    color: #ffffff;
    border: none;
    padding: 0.35rem 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }

  .preview-btn-inline:hover:not(:disabled) {
    background: #0369a1;
  }

  .vertical-latex-strip {
    width: 100%;
    height: 100%;
    background: #0f172a;
    border: none;
    color: #94a3b8;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.75rem 0.2rem;
    gap: 1rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .vertical-latex-strip:hover {
    background: #1e293b;
    color: #38bdf8;
  }

  .vertical-latex-strip .strip-icon {
    font-size: 0.9rem;
    font-weight: bold;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 4px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .vertical-latex-strip:hover .strip-icon {
    background: #0284c7;
    color: #ffffff;
    border-color: #38bdf8;
  }

  .vertical-latex-strip .strip-emoji {
    font-size: 0.95rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .vertical-latex-strip .strip-title {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    letter-spacing: 0.5px;
  }

  .form-group.latex-editor-group {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
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
