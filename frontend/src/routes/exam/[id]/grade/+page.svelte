<script lang="ts">
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { db } from "$lib/db/db";
  import type { SubmissionRecord, ExerciseRecord } from "$lib/db/schema";
  import {
    loadExamExercisesEncrypted,
    loadSubmissionsEncrypted,
    loadScoresEncrypted,
    saveScoreEncrypted,
    saveSubmissionEncrypted,
    decryptSubmission,
  } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { submissionRepository } from "$lib/repositories/submissionRepository";
  import { sessionStore } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import { decrypt, encrypt } from "$lib/crypto/aesGcm";
  import { get } from "svelte/store";

  const examId = $page.params.id || "";

  let submissions: SubmissionRecord[] = [];
  let exercises: ExerciseRecord[] = [];
  let currentIndex = 0;
  let scoreInputs: Record<string, number> = {};
  let totalScore = 0;
  let isSaving = false;

  let scanCanvas: HTMLCanvasElement;
  let overlayCanvas: HTMLCanvasElement;
  let isDrawing = false;
  let drawTool: "pen" | "check" | "cross" = "pen";
  let penColor = "#ef4444";

  interface VectorStroke {
    tool: "pen" | "check" | "cross";
    points: { x: number; y: number }[];
    color: string;
  }

  let currentStrokes: VectorStroke[] = [];

  $: currentSub = submissions[currentIndex];

  $: if (currentSub) {
    loadSubmissionCanvas(currentSub);
  }

  $: {
    totalScore = Object.values(scoreInputs).reduce(
      (sum, val) => sum + (Number(val) || 0),
      0,
    );
  }

  onMount(async () => {
    if (!examId) return;
    const key = get(sessionStore).sessionKey;
    exercises = await loadExamExercisesEncrypted(examId, key);
    submissions = await submissionRepository.getByExamId(examId, key);
    if (submissions.length > 0) {
      initExerciseScores(submissions[0]);
    }
  });

  async function initExerciseScores(sub: SubmissionRecord) {
    scoreInputs = {};
    const key = get(sessionStore).sessionKey;
    const existingScores = await loadScoresEncrypted(sub.id, key);
    if (existingScores.length > 0) {
      existingScores.forEach((es) => {
        if (es.score !== undefined) {
          scoreInputs[es.exerciseId] = es.score;
        }
      });
    } else if (sub.totalScore !== undefined) {
      const perEx = sub.totalScore / (exercises.length || 1);
      exercises.forEach((ex) => {
        scoreInputs[ex.id] = perEx;
      });
    } else {
      exercises.forEach((ex) => {
        scoreInputs[ex.id] = 0;
      });
    }
  }

  async function loadSubmissionCanvas(sub: SubmissionRecord) {
    await tick();
    if (!scanCanvas || !overlayCanvas) return;

    const ctx = scanCanvas.getContext("2d")!;
    const overlayCtx = overlayCanvas.getContext("2d")!;

    ctx.clearRect(0, 0, scanCanvas.width, scanCanvas.height);
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    currentStrokes = [];

    const key = get(sessionStore).sessionKey;
    if ((!sub.scanCt || !sub.scanIv) && key) {
      const fullSub = await submissionRepository.getById(examId, sub.id, key);
      if (fullSub && fullSub.scanCt && fullSub.scanIv) {
        sub = fullSub;
        submissions[currentIndex] = fullSub;
      }
    }

    if (!sub.scanCt || !sub.scanIv || !$sessionStore.sessionKey) {
      // Render fallback blank canvas
      scanCanvas.width = 600;
      scanCanvas.height = 800;
      overlayCanvas.width = 600;
      overlayCanvas.height = 800;
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, 600, 800);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "16px sans-serif";
      ctx.fillText("[ Scan Image Missing / Unencrypted ]", 150, 400);
      return;
    }

    try {
      // Decrypt in-memory
      const decryptedBytes = await decrypt(
        $sessionStore.sessionKey,
        sub.scanCt,
        sub.scanIv,
      );
      const blob = new Blob([decryptedBytes.buffer as ArrayBuffer], {
        type: "image/png",
      });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        scanCanvas.width = img.width;
        scanCanvas.height = img.height;
        overlayCanvas.width = img.width;
        overlayCanvas.height = img.height;

        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        // Load encrypted annotations vector if available
        if (sub.annotationCt && sub.annotationIv && $sessionStore.sessionKey) {
          decrypt(
            $sessionStore.sessionKey,
            sub.annotationCt,
            sub.annotationIv,
          ).then((annBytes) => {
            const jsonStr = new TextDecoder().decode(annBytes);
            currentStrokes = JSON.parse(jsonStr);
            redrawOverlay();
          });
        }
      };
      img.src = url;
    } catch (err) {
      console.error("Failed to decrypt scan for grading:", err);
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (!overlayCanvas) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (drawTool === "check" || drawTool === "cross") {
      currentStrokes.push({
        tool: drawTool,
        points: [{ x, y }],
        color: drawTool === "check" ? "#22c55e" : "#ef4444",
      });
      sessionStore.setDirty(true);
      redrawOverlay();
      return;
    }

    isDrawing = true;
    currentStrokes.push({
      tool: "pen",
      points: [{ x, y }],
      color: penColor,
    });
    sessionStore.setDirty(true);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDrawing || !overlayCanvas) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const currentStroke = currentStrokes[currentStrokes.length - 1];
    currentStroke.points.push({ x, y });
    redrawOverlay();
  }

  function handleMouseUp() {
    isDrawing = false;
  }

  function redrawOverlay() {
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    for (const stroke of currentStrokes) {
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";

      if (stroke.tool === "pen") {
        ctx.beginPath();
        stroke.points.forEach((p, idx) => {
          if (idx === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      } else if (stroke.tool === "check") {
        const p = stroke.points[0];
        ctx.font = "bold 36px sans-serif";
        ctx.fillText("✓", p.x, p.y);
      } else if (stroke.tool === "cross") {
        const p = stroke.points[0];
        ctx.font = "bold 36px sans-serif";
        ctx.fillText("✗", p.x, p.y);
      }
    }
  }

  function clearAnnotations() {
    currentStrokes = [];
    redrawOverlay();
  }

  async function handleSaveScore() {
    if (!currentSub) return;
    isSaving = true;

    try {
      currentSub.totalScore = Number(totalScore);
      const key = get(sessionStore).sessionKey;

      // Save individual exercise scores
      for (const ex of exercises) {
        const scoreVal = Number(scoreInputs[ex.id]) || 0;
        const existing = await db.exerciseScores
          .where("submissionId")
          .equals(currentSub.id)
          .and((item) => item.exerciseId === ex.id)
          .first();

        await saveScoreEncrypted({
          id: existing ? existing.id : crypto.randomUUID(),
          submissionId: currentSub.id,
          exerciseId: ex.id,
          score: scoreVal,
        }, key);
      }

      // Encrypt annotations vector layer
      if ($sessionStore.sessionKey && currentStrokes.length > 0) {
        const annJson = JSON.stringify(currentStrokes);
        const encAnn = await encrypt(
          $sessionStore.sessionKey,
          new TextEncoder().encode(annJson),
        );
        currentSub.annotationCt = encAnn.ciphertext;
        currentSub.annotationIv = encAnn.iv;
      }

      await saveSubmissionEncrypted(currentSub, key);

      if ($storagePolicyStore.storageMode === "all-server") {
        await api.patch(`/exams/${examId}/submissions/${currentSub.id}/score`, {
          total_score: Number(totalScore),
        });
      }
      sessionStore.setDirty(false);
      alert("Score and annotations saved successfully!");
    } catch (err: any) {
      alert(`Failed to save score: ${err.message}`);
    } finally {
      isSaving = false;
    }
  }

  function nextStudent() {
    if (currentStrokes.length > 0) {
      if (!confirm("You have unsaved annotations for this student. Move to next student anyway?")) {
        return;
      }
    }
    if (currentIndex < submissions.length - 1) {
      currentIndex++;
      initExerciseScores(submissions[currentIndex]);
    }
  }

  function prevStudent() {
    if (currentStrokes.length > 0) {
      if (!confirm("You have unsaved annotations for this student. Move to previous student anyway?")) {
        return;
      }
    }
    if (currentIndex > 0) {
      currentIndex--;
      initExerciseScores(submissions[currentIndex]);
    }
  }
</script>

<div class="grading-page">
  {#if submissions.length === 0}
    <div class="empty">No submissions to grade for this exam.</div>
  {:else}
    <div class="grading-header">
      <h2>Anonymous Student #{currentIndex + 1} of {submissions.length}</h2>
      <span class="pseudonym-tag"
        >HMAC ID: {currentSub.pseudonymHash.substring(0, 12)}...</span
      >
    </div>

    <div class="grading-workspace">
      <div class="canvas-panel">
        <div class="toolbar">
          <button
            class:active={drawTool === "pen"}
            on:click={() => (drawTool = "pen")}>🖊 Red Pen</button
          >
          <button
            class:active={drawTool === "check"}
            on:click={() => (drawTool = "check")}>✓ Correct Stamp</button
          >
          <button
            class:active={drawTool === "cross"}
            on:click={() => (drawTool = "cross")}>✗ Wrong Stamp</button
          >
          <button class="clear-btn" on:click={clearAnnotations}
            >Clear Overlay</button
          >
        </div>

        <div class="canvas-container">
          <canvas bind:this={scanCanvas} class="scan-canvas"></canvas>
          <canvas
            bind:this={overlayCanvas}
            class="overlay-canvas"
            on:mousedown={handleMouseDown}
            on:mousemove={handleMouseMove}
            on:mouseup={handleMouseUp}
          ></canvas>
        </div>
      </div>

      <div class="grading-panel">
        <h3>Exercise Scores</h3>
        {#each exercises as ex}
          <div class="ex-item">
            <label for={`score-${ex.id}`}
              >Question {ex.orderIndex} ({ex.questionType}, max {ex.maxPoints} pts)</label
            >
            <input
              id={`score-${ex.id}`}
              type="number"
              step="0.5"
              min="0"
              max={ex.maxPoints}
              bind:value={scoreInputs[ex.id]}
            />
          </div>
        {/each}

        <div class="total-section">
          <label for="totalScore">Calculated Total Score</label>
          <input
            id="totalScore"
            type="number"
            step="0.5"
            value={totalScore}
            readonly
          />
          <button
            class="save-btn"
            on:click={handleSaveScore}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Grade & Annotations"}
          </button>
        </div>

        <div class="nav-buttons">
          <button on:click={prevStudent} disabled={currentIndex === 0}
            >Previous</button
          >
          <button
            on:click={nextStudent}
            disabled={currentIndex === submissions.length - 1}
            >Next Student</button
          >
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .grading-page {
    max-width: 1100px;
    margin: 2rem auto;
    padding: 1rem;
  }

  .grading-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  h2 {
    margin: 0;
    color: #38bdf8;
  }

  .pseudonym-tag {
    background: #1e293b;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    font-family: monospace;
    font-size: 0.875rem;
    border: 1px solid #334155;
  }

  .grading-workspace {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.5rem;
  }

  .canvas-panel {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .toolbar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    width: 100%;
  }

  .toolbar button {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
  }

  .toolbar button.active {
    background: #0284c7;
    color: white;
    border-color: #38bdf8;
  }

  .clear-btn {
    margin-left: auto;
    background: #334155 !important;
  }

  .canvas-container {
    position: relative;
    max-width: 100%;
    overflow: auto;
    border: 1px solid #334155;
    background: #000;
  }

  .scan-canvas {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  .grading-panel {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 8px;
    height: fit-content;
  }

  .ex-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 1rem;
    font-size: 0.875rem;
  }

  .total-section {
    margin-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-top: 1px solid #334155;
    padding-top: 1rem;
  }

  input {
    padding: 0.5rem;
    background: #0f172a;
    border: 1px solid #334155;
    color: white;
    border-radius: 4px;
  }

  .save-btn {
    background: #0284c7;
    color: white;
    font-weight: 600;
  }

  button {
    padding: 0.5rem 1rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .nav-buttons {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .nav-buttons button {
    flex: 1;
    background: #334155;
  }

  .empty {
    text-align: center;
    padding: 4rem;
    color: #94a3b8;
  }
</style>
