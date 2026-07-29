<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { db } from "$lib/db/db";
  import type {
    ExamRecord,
    ExerciseRecord,
    SubmissionRecord,
  } from "$lib/db/schema";
  import {
    loadExamEncrypted,
    saveExamEncrypted,
    loadExamExercisesEncrypted,
    loadExercisesEncrypted,
    loadStudentsEncrypted,
    loadSubmissionsEncrypted,
    decryptExercise,
    decryptSubmission,
    decryptStudent,
    encryptExercise,
  } from "$lib/db/dbEncryption";
  import { packProject } from "$lib/archive/packer";
  import { compileLatex } from "$lib/latex/compiler";
  import { formatExerciseLatex } from "$lib/latex/scoreParser";
  import { api } from "$lib/api/client";
  import { sessionStore, isAuthenticated } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import { get } from "svelte/store";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import DualPdfPreview from "$lib/components/DualPdfPreview.svelte";

  $: examId = $page.params.id || "";

  let exam: ExamRecord | null = null;
  let exercises: ExerciseRecord[] = [];
  let submissions: SubmissionRecord[] = [];
  let isExporting = false;
  let exportSuccess = false;

  let isCompiling = false;
  let isPreviewLoading = false;
  let compileNotice = "";
  let errorMsg = "";

  let previewPdfUrl: string | null = null;
  let previewSolutionPdfUrl: string | null = null;
  let showAngabePreview = true;
  let showLoesungPreview = false;

  $: if (examId) {
    loadExam(examId);
  }

  let isLocalFallback = false;
  let isSyncingSingle = false;

  async function loadExam(id: string) {
    const key = get(sessionStore).sessionKey;
    try {
      if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
        try {
          const remoteExam = (await api.get(`/exams/${id}`)) as any;
          exam = {
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
          exercises = remoteExam.exercises.map((e: any) => ({
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
          if (exercises.length > 0) {
            const encExs = await Promise.all(exercises.map((ex: any) => encryptExercise(ex, key)));
            await db.exercises.bulkPut(encExs);
            const junctions = exercises.map((ex: any, idx: number) => ({
              examId: id,
              exerciseId: ex.id,
              orderIndex: ex.orderIndex || (idx + 1),
            }));
            await db.examExercises.bulkPut(junctions);
          } else {
            const localExs = await loadExamExercisesEncrypted(id, key);
            if (localExs.length > 0) {
              exercises = localExs;
            }
          }
          isLocalFallback = false;
        } catch (serverErr) {
          // Fall back to IndexedDB if exam is not on server
          exam = (await loadExamEncrypted(id, key)) || null;
          if (exam) {
            isLocalFallback = true;
            exercises = await loadExamExercisesEncrypted(id, key);
          } else {
            console.error("Exam not found on server or locally:", serverErr);
          }
        }
      } else {
        isLocalFallback = false;
        exam = (await loadExamEncrypted(id, key)) || null;
        exercises = await loadExamExercisesEncrypted(id, key);
      }
      const rawSubs = await db.submissions.where("examId").equals(id).toArray();
      submissions = await Promise.all(rawSubs.map(s => decryptSubmission(s, key)));
    } catch (err) {
      console.error("Failed to load exam from DB:", err);
    }
  }

  async function syncCurrentExamToServer() {
    if (!exam) return;
    isSyncingSingle = true;
    try {
      // 1. Post exam
      await api.post("/exams", {
        id: exam.id,
        title: exam.title || "Unbenannte Prüfung",
        testart: exam.testart,
        klasse: exam.klasse,
        datum: exam.datum,
        nr: exam.nr,
        fach: exam.fach,
        lehrernachname: exam.lehrernachname,
        info_text: exam.infoText,
        latex_template: exam.latexTemplate,
        retention_until:
          exam.retentionUntil ||
          new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      });

      // 2. Post exercises
      for (const ex of exercises) {
        try {
          await api.post("/exercises", {
            id: ex.id,
            name: ex.title || ex.name || "Exercise",
            latex_body: ex.latexBody || "",
            max_points: ex.maxPoints,
            topic_tag: ex.topicTag,
            question_type: ex.questionType || "free_text",
            options: ex.options,
            correct_answers: ex.correctAnswers,
            penalty: ex.penalty || 0,
          });
        } catch {}
      }

      // Link exercises
      try {
        await api.patch(`/exams/${exam.id}`, {
          exercise_ids: exercises.map((e) => e.id),
        });
      } catch {}

      // 3. Post students
      const localStudents = await db.students
        .where("examId")
        .equals(exam.id)
        .toArray();
      for (const st of localStudents) {
        try {
          const emptyCtB64 = btoa(
            String.fromCharCode(...(st.piiCt || new Uint8Array([0]))),
          );
          const emptyIvB64 = btoa(
            String.fromCharCode(...(st.piiIv || new Uint8Array(12))),
          );
          const emptySaltB64 = btoa(String.fromCharCode(...new Uint8Array(16)));
          await api.post(`/exams/${exam.id}/students`, {
            pseudonym_hmac: st.pseudonymId,
            pii_ciphertext_b64: emptyCtB64,
            iv_b64: emptyIvB64,
            encryption_salt_b64: emptySaltB64,
          });
        } catch {}
      }

      // 4. Post submissions
      const localSubmissions = await db.submissions
        .where("examId")
        .equals(exam.id)
        .toArray();
      for (const sub of localSubmissions) {
        try {
          await api.post(`/exams/${exam.id}/submissions`, {
            id: sub.id,
            pseudonym_hmac: sub.pseudonymHash,
            total_score: sub.totalScore || 0,
            scan_ciphertext_b64: sub.scanCt
              ? btoa(String.fromCharCode(...sub.scanCt))
              : undefined,
            scan_iv_b64: sub.scanIv
              ? btoa(String.fromCharCode(...sub.scanIv))
              : undefined,
            annotation_ciphertext_b64: sub.annotationCt
              ? btoa(String.fromCharCode(...sub.annotationCt))
              : undefined,
            annotation_iv_b64: sub.annotationIv
              ? btoa(String.fromCharCode(...sub.annotationIv))
              : undefined,
          });
        } catch {}
      }

      isLocalFallback = false;
      alert("Exam successfully synced to server!");
    } catch (err: any) {
      alert(`Failed to sync exam to server: ${err.message}`);
    } finally {
      isSyncingSingle = false;
    }
  }

  async function handleDeleteExam() {
    if (!exam) return;
    if (
      !confirm(
        `Are you sure you want to delete exam "${exam.title}" and all its submissions?`,
      )
    )
      return;

    try {
      await db.exams.delete(exam.id);
      await db.exercises.where("examId").equals(exam.id).delete();
      await db.examExercises.where("examId").equals(exam.id).delete();
      await db.submissions.where("examId").equals(exam.id).delete();
      await db.students.where("examId").equals(exam.id).delete();

      if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
        try {
          await api.delete(`/exams/${exam.id}`);
        } catch (e) {
          console.warn("Failed to delete on server:", e);
        }
      }

      window.location.href = "/";
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  async function handleExportArchive() {
    const password = prompt("Enter password to encrypt .bgproj archive:");
    if (!password) return;

    isExporting = true;
    try {
      const bytes = await packProject(password);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exam?.title || "exam"}.bgproj`;
      a.click();
      URL.revokeObjectURL(url);
      exportSuccess = true;
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      isExporting = false;
    }
  }

  async function handleDownloadExamPdf(showAnswers = false) {
    if (!exam) return;
    isCompiling = true;
    errorMsg = "";

    const useLocal = $storagePolicyStore.latexCompilation === "local";
    if (!useLocal && !$isAuthenticated) {
      errorMsg = "Please log in to compile LaTeX on the server.";
      isCompiling = false;
      return;
    }

    compileNotice = "Compiling PDF...";

    try {
      if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
        const pdfBuffer = await api.getBinary(
          `/exams/${exam.id}/compile?answers=${showAnswers}`,
        );
        const blob = new Blob([pdfBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${exam.title}${showAnswers ? "_Loesung" : ""}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const exerciseInputs = exercises
          .map((ex, idx) =>
            formatExerciseLatex(
              ex.latexBody,
              ex.name || `Aufgabe ${idx + 1}`,
            ),
          )
          .join("\n\n");

        const opts = ["sans", "punkte"];
        if (showAnswers) opts.push("antworten");

        const fullTex = `\\documentclass[a4paper]{article}
\\usepackage[${opts.join(",")}]{sty/Schulaufgabe}
\\Info{${exam.infoText || ""}}
\\Fach{${exam.fach || "Informatik"}}
\\Lehrernachname{${exam.lehrernachname || ""}}
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
\\Testart{${exam.testart || "Kurzarbeit"}}
\\Klasse{${exam.klasse || ""}}
\\Datum{${exam.datum || ""}}
\\Nr{${exam.nr || "1"}}

${exerciseInputs}

\\end{document}`;

        const result = await compileLatex(fullTex, useLocal, (status) => {
          if (status === 'downloading') {
            compileNotice = "Loading local LaTeX compiler... (Downloading ~32MB on first load, please wait)";
          } else if (status === 'compiling') {
            compileNotice = "Compiling PDF...";
          }
        });
        const blob = new Blob([result.pdfBytes.buffer as ArrayBuffer], {
          type: "application/pdf",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${exam.title}${showAnswers ? "_Loesung" : ""}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }

      const key = get(sessionStore).sessionKey;
      exam.compilationStatus = "compiled";
      await saveExamEncrypted(exam, key);
      compileNotice = `Downloaded ${showAnswers ? "Solution / Answer Key" : "Exam PDF"}.`;
    } catch (err: any) {
      if (exam) {
        const key = get(sessionStore).sessionKey;
        exam.compilationStatus = "failed";
        await saveExamEncrypted(exam, key);
      }
      errorMsg = err.message || "Compilation failed.";
    } finally {
      isCompiling = false;
    }
  }

  async function handlePreviewExam() {
    if (!exam || exercises.length === 0) return;
    const currentExam = exam;
    isPreviewLoading = true;
    compileNotice = "";
    errorMsg = "";

    try {
      const exerciseInputs = exercises
        .map((ex, idx) =>
          formatExerciseLatex(
            ex.latexBody,
            ex.name || `Aufgabe ${idx + 1}`,
          ),
        )
        .join("\n\n");

      const getPreamble = (options: string) => `\\documentclass[a4paper]{article}
\\usepackage[${options}]{sty/Schulaufgabe}
\\Info{${currentExam.infoText || ""}}
\\Fach{${currentExam.fach || "Informatik"}}
\\Lehrernachname{${currentExam.lehrernachname || ""}}
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
\\Testart{${currentExam.testart || "Kurzarbeit"}}
\\Klasse{${currentExam.klasse || ""}}
\\Datum{${currentExam.datum || ""}}
\\Nr{${currentExam.nr || "1"}}

${exerciseInputs}

\\end{document}`;

      const fullTexAngabe = getPreamble("sans,punkte");
      const fullTexLoesung = getPreamble("sans,punkte,antworten");

      const useLocal = $storagePolicyStore.latexCompilation === "local";

      const [resAngabe, resLoesung] = await Promise.all([
        compileLatex(fullTexAngabe, useLocal, (status) => {
          if (status === 'downloading') {
            compileNotice = "Loading local LaTeX compiler... (Downloading ~32MB on first load, please wait)";
          } else if (status === 'compiling') {
            compileNotice = "Compiling PDF...";
          }
        }, false),
        compileLatex(fullTexLoesung, useLocal, undefined, false)
      ]);

      compileNotice = "";
      const blobAngabe = new Blob([resAngabe.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const blobLoesung = new Blob([resLoesung.pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });

      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      if (previewSolutionPdfUrl) URL.revokeObjectURL(previewSolutionPdfUrl);

      previewPdfUrl = URL.createObjectURL(blobAngabe);
      previewSolutionPdfUrl = URL.createObjectURL(blobLoesung);
    } catch (err: any) {
      errorMsg = `Preview failed: ${err.message || "Unknown compilation error"}`;
    } finally {
      isPreviewLoading = false;
    }
  }

  let isEditingMetadata = false;
  let editTitle = "";
  let editTestart = "";
  let editKlasse = "";
  let editDatum = "";
  let editNr = "";
  let editFach = "";
  let editLehrernachname = "";
  let editInfoText = "";
  let editRetentionUntil = "";

  let initialMetadata = {
    title: "",
    testart: "",
    klasse: "",
    datum: "",
    nr: "",
    fach: "",
    lehrernachname: "",
    infoText: "",
    retentionUntil: "",
  };
  let showMetadataConfirm = false;

  $: isMetadataDirty =
    isEditingMetadata &&
    (editTitle !== initialMetadata.title ||
      editTestart !== initialMetadata.testart ||
      editKlasse !== initialMetadata.klasse ||
      editDatum !== initialMetadata.datum ||
      editNr !== initialMetadata.nr ||
      editFach !== initialMetadata.fach ||
      editLehrernachname !== initialMetadata.lehrernachname ||
      editInfoText !== initialMetadata.infoText ||
      editRetentionUntil !== initialMetadata.retentionUntil);

  let isLibraryModalOpen = false;
  let libraryExercises: ExerciseRecord[] = [];
  let selectedLibraryIds: string[] = [];
  let initialSelectedLibraryIds: string[] = [];
  let showLibraryConfirm = false;
  let librarySearch = "";

  $: isLibraryDirty =
    isLibraryModalOpen &&
    (selectedLibraryIds.length !== initialSelectedLibraryIds.length ||
      selectedLibraryIds.some((id, i) => id !== initialSelectedLibraryIds[i]));

  function openMetadataEditor() {
    if (!exam) return;
    editTitle = exam.title || "";
    editTestart = exam.testart || "Kurzarbeit";
    editKlasse = exam.klasse || "";
    editDatum = exam.datum || "";
    editNr = exam.nr || "1";
    editFach = exam.fach || "Informatik";
    editLehrernachname = exam.lehrernachname || "";
    editInfoText = exam.infoText || "";
    editRetentionUntil = exam.retentionUntil || "";

    initialMetadata = {
      title: editTitle,
      testart: editTestart,
      klasse: editKlasse,
      datum: editDatum,
      nr: editNr,
      fach: editFach,
      lehrernachname: editLehrernachname,
      infoText: editInfoText,
      retentionUntil: editRetentionUntil,
    };
    showMetadataConfirm = false;
    isEditingMetadata = true;
  }

  function requestCancelMetadata() {
    if (isMetadataDirty) {
      showMetadataConfirm = true;
    } else {
      forceCancelMetadata();
    }
  }

  function forceCancelMetadata() {
    showMetadataConfirm = false;
    isEditingMetadata = false;
  }

  async function handleSaveMetadata() {
    if (!exam) return;
    try {
      if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
        await api.patch(`/exams/${exam.id}`, {
          title: editTitle,
          testart: editTestart,
          klasse: editKlasse,
          datum: editDatum,
          nr: editNr,
          fach: editFach,
          lehrernachname: editLehrernachname,
          info_text: editInfoText,
          retention_until: editRetentionUntil,
        });
      }

      exam.title = editTitle;
      exam.testart = editTestart;
      exam.klasse = editKlasse;
      exam.datum = editDatum;
      exam.nr = editNr;
      exam.fach = editFach;
      exam.lehrernachname = editLehrernachname;
      exam.infoText = editInfoText;
      exam.retentionUntil = editRetentionUntil;
      const key = get(sessionStore).sessionKey;
      await saveExamEncrypted(exam, key);

      forceCancelMetadata();
      alert("Exam details updated successfully.");
    } catch (err: any) {
      alert(`Failed to save exam details: ${err.message}`);
    }
  }

  async function openLibraryModal() {
    const key = get(sessionStore).sessionKey;
    try {
      if ($isAuthenticated && $storagePolicyStore.examAndExerciseStorage === "server") {
        const remoteExs = (await api.get("/exercises")) as any[];
        libraryExercises = remoteExs.map((e: any) => ({
          id: e.id,
          teacherId: e.teacher_id,
          name: e.name,
          topicTag: e.topic_tag,
          latexBody: e.latex_body,
          maxPoints: e.max_points,
          version: e.version || 1,
          variantKey: e.variant_key,
          isCurrent: e.is_current,
          isPublic: e.is_public,
          questionType: "free_text",
          penalty: 0,
        }));
      } else {
        libraryExercises = await loadExercisesEncrypted(key);
      }
      selectedLibraryIds = exercises.map((e) => e.id);
      initialSelectedLibraryIds = [...selectedLibraryIds];
      showLibraryConfirm = false;
      isLibraryModalOpen = true;
    } catch (err) {
      console.error("Failed to load library exercises:", err);
    }
  }

  function requestCloseLibraryModal() {
    if (isLibraryDirty) {
      showLibraryConfirm = true;
    } else {
      forceCloseLibraryModal();
    }
  }

  function forceCloseLibraryModal() {
    showLibraryConfirm = false;
    isLibraryModalOpen = false;
  }

  function moveExerciseOrder(index: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= exercises.length) return;
    const copy = [...exercises];
    [copy[index], copy[targetIdx]] = [copy[targetIdx], copy[index]];
    exercises = copy.map((ex, idx) => ({ ...ex, orderIndex: idx + 1 }));
    saveExerciseLinks();
  }

  function removeExerciseLink(id: string) {
    exercises = exercises
      .filter((ex) => ex.id !== id)
      .map((ex, idx) => ({ ...ex, orderIndex: idx + 1 }));
    saveExerciseLinks();
  }

  async function saveExerciseLinks() {
    if (!exam) return;
    const exerciseIds = exercises.map((e) => e.id);
    try {
      if ($storagePolicyStore.examAndExerciseStorage === "server") {
        await api.patch(`/exams/${exam.id}`, { exercise_ids: exerciseIds });
      }

      await db.examExercises.where("examId").equals(exam.id).delete();
      const links = exercises.map((ex, idx) => ({
        examId: exam!.id,
        exerciseId: ex.id,
        orderIndex: idx + 1,
      }));
      await db.examExercises.bulkPut(links);
    } catch (err) {
      console.error("Failed to update exercise links:", err);
    }
  }

  function toggleLibrarySelection(id: string) {
    if (selectedLibraryIds.includes(id)) {
      selectedLibraryIds = selectedLibraryIds.filter((i) => i !== id);
    } else {
      selectedLibraryIds = [...selectedLibraryIds, id];
    }
  }

  function applyLibrarySelection() {
    const newSelected = selectedLibraryIds
      .map((id) => libraryExercises.find((ex) => ex.id === id))
      .filter((ex): ex is ExerciseRecord => Boolean(ex))
      .map((ex, idx) => ({ ...ex, orderIndex: idx + 1 }));

    exercises = newSelected;
    saveExerciseLinks();
    isLibraryModalOpen = false;
  }
</script>

<div class="exam-detail-page">
  {#if isLocalFallback}
    <div class="local-fallback-banner">
      <span>ℹ️ This exam is currently loaded from local browser storage.</span>
      <button
        class="sync-now-btn"
        on:click={syncCurrentExamToServer}
        disabled={isSyncingSingle}
      >
        {isSyncingSingle ? "Syncing..." : "Sync to Server Now"}
      </button>
    </div>
  {/if}

  {#if !exam}
    <div class="loading">Loading exam details...</div>
  {:else}
    <div class="header">
      <div>
        <h2>{exam.title}</h2>
        <span class="meta">
          {exam.testart || "Kurzarbeit"} | Klasse: {exam.klasse || "-"} | Datum:
          {exam.datum || "-"} | Retention until: {exam.retentionUntil}
        </span>
      </div>
      <div class="header-btns">
        <button class="edit-btn" on:click={openMetadataEditor}
          >✏️ Edit Exam Details</button
        >
        <button class="delete-btn" on:click={handleDeleteExam}
          >Delete Exam</button
        >
        <button
          class="export-btn"
          on:click={handleExportArchive}
          disabled={isExporting}
        >
          {isExporting ? "Packing..." : "Export .bgproj Archive"}
        </button>
      </div>
    </div>

    {#if isEditingMetadata}
      <div class="metadata-editor-card">
        <h3>Edit Exam Metadata</h3>
        <div class="form-grid">
          <div class="form-group">
            <label for="editTitle">Exam Title</label>
            <input id="editTitle" type="text" bind:value={editTitle} />
          </div>
          <div class="form-group">
            <label for="editTestart">Testart</label>
            <input id="editTestart" type="text" bind:value={editTestart} />
          </div>
          <div class="form-group">
            <label for="editKlasse">Klasse</label>
            <input id="editKlasse" type="text" bind:value={editKlasse} />
          </div>
          <div class="form-group">
            <label for="editDatum">Datum / Dauer</label>
            <input id="editDatum" type="text" bind:value={editDatum} />
          </div>
          <div class="form-group">
            <label for="editNr">Prüfungsnummer (Nr)</label>
            <input id="editNr" type="text" bind:value={editNr} />
          </div>
          <div class="form-group">
            <label for="editFach">Fach</label>
            <input id="editFach" type="text" bind:value={editFach} />
          </div>
          <div class="form-group">
            <label for="editLehrernachname">Lehrernachname</label>
            <input
              id="editLehrernachname"
              type="text"
              bind:value={editLehrernachname}
            />
          </div>
          <div class="form-group">
            <label for="editRetention">Retention Until</label>
            <input
              id="editRetention"
              type="date"
              bind:value={editRetentionUntil}
            />
          </div>
        </div>
        <div class="form-group full-width">
          <label for="editInfoText">Info Text (LaTeX list)</label>
          <textarea id="editInfoText" rows="4" bind:value={editInfoText}
          ></textarea>
        </div>
        <div class="editor-actions">
          <button
            class="cancel-btn"
            on:click={requestCancelMetadata}>Cancel</button
          >
          <button class="save-btn" on:click={handleSaveMetadata}
            >Save Changes</button
          >
        </div>
      </div>
    {/if}

<ConfirmDialog
  isOpen={showMetadataConfirm}
  title="Discard Metadata Changes?"
  message="You have unsaved changes in metadata fields. Are you sure you want to discard them?"
  confirmText="Discard Changes"
  cancelText="Keep Editing"
  on:confirm={forceCancelMetadata}
  on:cancel={() => (showMetadataConfirm = false)}
/>

    {#if exportSuccess}
      <div class="success-banner">
        .bgproj archive successfully packed and downloaded.
      </div>
    {/if}

    <div class="pdf-compile-section">
      <h3>LaTeX Exam Compilation & Download</h3>
      <p class="desc">
        Generate printable A4 PDF exams using the Schulaufgabe template layout.
      </p>

      <div class="controls-row">
        <button
          class="compile-btn"
          class:is-loading={isPreviewLoading}
          on:click={handlePreviewExam}
          disabled={isPreviewLoading || exercises.length === 0}
        >
          {isPreviewLoading ? "Compiling Previews..." : "🔍 Live Preview PDF"}
        </button>

        <button
          class="compile-btn"
          class:is-loading={isCompiling}
          on:click={() => handleDownloadExamPdf(false)}
          disabled={isCompiling}
        >
          {isCompiling ? "Compiling..." : "📄 Download Exam PDF"}
        </button>

        <button
          class="solution-btn"
          class:is-loading={isCompiling}
          on:click={() => handleDownloadExamPdf(true)}
          disabled={isCompiling}
        >
          {isCompiling ? "Compiling..." : "📝 Download Answer Key"}
        </button>
      </div>

      {#if previewPdfUrl || previewSolutionPdfUrl}
        <div style="margin-top: 1rem;">
          <DualPdfPreview
            {previewPdfUrl}
            {previewSolutionPdfUrl}
            bind:showAngabePreview
            bind:showLoesungPreview
            titleAngabe="Exam"
            titleLoesung="Answer Key"
            height="550px"
            placeholderText="Click 'Live Preview PDF' to render"
          />
        </div>
      {/if}

      {#if compileNotice}
        <div class="notice">{compileNotice}</div>
      {/if}
      {#if errorMsg}
        <div class="error-banner">{errorMsg}</div>
      {/if}
    </div>

    <div class="nav-cards">
      <a href="/exam/{examId}/scan" class="nav-card">
        <h3>1. Scan Ingestion</h3>
        <p>Upload PDF/images. Hardware-adaptive QR & OMR processing.</p>
        <span class="count">{submissions.length} Submissions</span>
      </a>

      <a href="/exam/{examId}/grade" class="nav-card">
        <h3>2. Grading View</h3>
        <p>Anonymous grading with vector canvas overlay.</p>
      </a>

      <a href="/exam/{examId}/stats" class="nav-card">
        <h3>3. Statistics & Export</h3>
        <p>Histogram, std dev, k-anonymity (k≥5) gate & CSV export.</p>
      </a>
    </div>

    <div class="exercises-summary">
      <div class="section-header">
        <h3>Configured Exercises ({exercises.length})</h3>
        <button class="add-library-btn" on:click={openLibraryModal}
          >➕ Manage / Link Exercises</button
        >
      </div>

      {#if exercises.length === 0}
        <p class="empty-notice">
          No exercises linked to this exam yet. Click "Manage / Link Exercises"
          to add exercises from your library.
        </p>
      {:else}
        <ul class="exercise-list">
          {#each exercises as ex, idx}
            <li class="exercise-item">
              <div class="ex-info">
                <span class="ex-num">Question {idx + 1}:</span>
                <span class="ex-title">{ex.name || ex.title || "Untitled"}</span
                >
                {#if ex.topicTag}
                  <span class="topic-tag">{ex.topicTag}</span>
                {/if}
                {#if ex.variantKey}
                  <span class="variant-tag">Variant: {ex.variantKey}</span>
                {/if}
                <span class="ver-tag">v{ex.version || 1}</span>
              </div>
              <div class="ex-actions">
                <span class="pts">{ex.maxPoints} Pkt</span>
                <button
                  class="icon-btn"
                  disabled={idx === 0}
                  on:click={() => moveExerciseOrder(idx, "up")}
                  title="Move Up"
                >
                  ▲
                </button>
                <button
                  class="icon-btn"
                  disabled={idx === exercises.length - 1}
                  on:click={() => moveExerciseOrder(idx, "down")}
                  title="Move Down"
                >
                  ▼
                </button>
                <button
                  class="icon-btn delete"
                  on:click={() => removeExerciseLink(ex.id)}
                  title="Remove from Exam"
                >
                  ✕
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

{#if isLibraryModalOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={requestCloseLibraryModal}
    on:keydown|self={(e) => e.key === "Escape" && requestCloseLibraryModal()}
  >
    <div class="modal-content">
      <div class="modal-header">
        <h3>Link Exercises from Library</h3>
        <button class="close-btn" on:click={requestCloseLibraryModal}
          >✕</button
        >
      </div>

      <div class="modal-body">
        <input
          type="text"
          class="search-input"
          bind:value={librarySearch}
          placeholder="Search by name, topic, or content..."
        />

        <div class="library-picker-list">
          {#each libraryExercises.filter((ex) => !librarySearch || (ex.name && ex.name
                  .toLowerCase()
                  .includes(librarySearch.toLowerCase())) || (ex.topicTag && ex.topicTag
                  .toLowerCase()
                  .includes(librarySearch.toLowerCase()))) as ex}
            <label class="picker-item">
              <input
                type="checkbox"
                checked={selectedLibraryIds.includes(ex.id)}
                on:change={() => toggleLibrarySelection(ex.id)}
              />
              <div class="picker-info">
                <strong>{ex.name || "Untitled"}</strong>
                <span class="meta-row">
                  {#if ex.topicTag}<span class="topic">{ex.topicTag}</span>{/if}
                  {#if ex.variantKey}<span class="variant">{ex.variantKey}</span
                    >{/if}
                  <span class="pts">{ex.maxPoints} Pkt</span>
                </span>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <div class="modal-footer">
        <button class="cancel-btn" on:click={requestCloseLibraryModal}
          >Cancel</button
        >
        <button class="save-btn" on:click={applyLibrarySelection}
          >Apply Linked Exercises</button
        >
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog
  isOpen={showLibraryConfirm}
  title="Discard Exercise Selections?"
  message="You have unsaved changes in your selected exercises. Are you sure you want to exit without applying?"
  confirmText="Discard Changes"
  cancelText="Keep Editing"
  on:confirm={forceCloseLibraryModal}
  on:cancel={() => (showLibraryConfirm = false)}
/>

<style>
  .exam-detail-page {
    max-width: 900px;
    margin: 2rem auto;
    padding: 1rem;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  h2 {
    margin: 0;
    color: #38bdf8;
  }

  .meta {
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .header-btns {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .delete-btn {
    padding: 0.625rem 1rem;
    background: #ef4444;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .delete-btn:hover {
    background: #dc2626;
  }

  .export-btn {
    padding: 0.625rem 1.25rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .export-btn:hover {
    background: #0369a1;
  }

  .pdf-compile-section {
    background: #1e293b;
    border: 1px solid #334155;
    padding: 1.5rem;
    border-radius: 10px;
    margin-bottom: 2rem;
  }

  .pdf-compile-section h3 {
    margin-top: 0;
    color: #38bdf8;
  }

  .pdf-compile-section .desc {
    font-size: 0.875rem;
    color: #94a3b8;
    margin-bottom: 1rem;
  }

  .controls-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .compile-btn {
    padding: 0.625rem 1.25rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .compile-btn:hover {
    background: #0369a1;
  }

  .solution-btn {
    padding: 0.625rem 1.25rem;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .solution-btn:hover {
    background: #059669;
  }

  .notice {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    color: #38bdf8;
  }

  .error-banner {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    padding: 1rem;
    border-radius: 6px;
    margin-top: 1rem;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
    font-family: "Fira Code", monospace;
  }

  .nav-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }

  .nav-card {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    border: 1px solid #334155;
    text-decoration: none;
    color: inherit;
    transition:
      transform 0.15s ease,
      border-color 0.15s ease;
  }

  .nav-card:hover {
    transform: translateY(-2px);
    border-color: #38bdf8;
  }

  .nav-card h3 {
    margin: 0 0 0.5rem 0;
    color: #38bdf8;
  }

  .nav-card p {
    font-size: 0.875rem;
    color: #94a3b8;
    margin: 0 0 1rem 0;
  }

  .nav-card .count {
    font-size: 0.75rem;
    background: #0f172a;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: #cbd5e1;
  }

  .exercises-summary {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    border: 1px solid #334155;
  }

  .pts {
    font-weight: 600;
    color: #38bdf8;
  }

  .success-banner {
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid #22c55e;
    color: #86efac;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .edit-btn {
    padding: 0.625rem 1rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }
  .edit-btn:hover {
    background: #2563eb;
  }

  .metadata-editor-card {
    background: #1e293b;
    border: 1px solid #3b82f6;
    padding: 1.5rem;
    border-radius: 10px;
    margin-bottom: 2rem;
  }

  .metadata-editor-card h3 {
    margin-top: 0;
    color: #38bdf8;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .form-group.full-width {
    grid-column: span 2;
  }

  .form-group label {
    font-size: 0.8125rem;
    color: #94a3b8;
  }

  .form-group input,
  .form-group textarea {
    background: #0f172a;
    border: 1px solid #334155;
    color: #f8fafc;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-family: inherit;
  }

  .editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .cancel-btn {
    padding: 0.5rem 1rem;
    background: #475569;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .save-btn {
    padding: 0.5rem 1.25rem;
    background: #10b981;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .add-library-btn {
    padding: 0.5rem 1rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .empty-notice {
    color: #94a3b8;
    font-style: italic;
    margin: 0;
  }

  .exercise-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .exercise-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0f172a;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    border: 1px solid #334155;
  }

  .ex-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .ex-num {
    font-weight: 600;
    color: #cbd5e1;
  }

  .ex-title {
    color: #f8fafc;
  }

  .topic-tag {
    font-size: 0.75rem;
    background: #0284c7;
    color: white;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
  }

  .variant-tag {
    font-size: 0.75rem;
    background: #8b5cf6;
    color: white;
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
  }

  .ver-tag {
    font-size: 0.75rem;
    background: #334155;
    color: #94a3b8;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
  }

  .ex-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .icon-btn {
    background: #334155;
    color: white;
    border: none;
    border-radius: 4px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .icon-btn.delete {
    background: #ef4444;
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
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
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 1.25rem;
    cursor: pointer;
  }

  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .search-input {
    background: #0f172a;
    border: 1px solid #334155;
    color: white;
    padding: 0.625rem 1rem;
    border-radius: 6px;
    width: 100%;
  }

  .library-picker-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 350px;
    overflow-y: auto;
  }

  .picker-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background: #0f172a;
    padding: 0.75rem;
    border-radius: 6px;
    border: 1px solid #334155;
    cursor: pointer;
  }

  .picker-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .meta-row {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid #334155;
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
