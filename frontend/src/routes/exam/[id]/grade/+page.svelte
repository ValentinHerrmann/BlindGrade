<script lang="ts">
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { db } from "$lib/db/db";
  import type { SubmissionRecord, ExerciseRecord, ExamRecord } from "$lib/db/schema";
  import {
    loadExamEncrypted,
    loadExamExercisesEncrypted,
    loadSubmissionsEncrypted,
    loadScoresEncrypted,
    saveScoreEncrypted,
    saveSubmissionEncrypted,
    decryptSubmission,
  } from "$lib/db/dbEncryption";
  import { calculateGrade, calculateGradeDetail, type GradeDetail } from "$lib/analytics/gradingKey";
  import { api } from "$lib/api/client";
  import { submissionRepository } from "$lib/repositories/submissionRepository";
  import { sessionStore, isUnlocked } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import { decrypt, encrypt } from "$lib/crypto/aesGcm";
  import { get } from "svelte/store";
  import type { PDFPageProxy } from "pdfjs-dist";

  const examId = $page.params.id || "";

  let exam: ExamRecord | null = null;
  let submissions: SubmissionRecord[] = [];
  let exercises: ExerciseRecord[] = [];
  let currentIndex = 0;
  let scoreInputs: Record<string, number> = {};
  let manualOverride: Record<string, boolean> = {};
  let activeExerciseId: string = "";
  let totalScore = 0;
  let isSaving = false;
  let showLastSubModal = false;
  let showClearConfirmModal = false;
  let zoomScale = 1.0;
  let isErasing = false;
  let isAutoCropEnabled = true;

  let scanCanvas: HTMLCanvasElement;
  let overlayCanvas: HTMLCanvasElement;
  let canvasViewport: HTMLDivElement;
  let isDrawing = false;
  type ToolType =
    | "pen"
    | "line"
    | "eraser"
    | "check_full"
    | "check_half"
    | "check_quarter"
    | "minus_full"
    | "minus_half"
    | "minus_quarter"
    | "wrong"
    | "missing"
    | "wf"
    | "ff"
    | "cross"
    | "check";
  let drawTool: ToolType = "pen";
  let penColor = "#ef4444";

  let activePointers = new Map<number, { x: number; y: number }>();
  let initialPinchDistance: number | null = null;
  let initialZoomScale: number = 1.0;

  interface VectorStroke {
    tool: ToolType;
    points: { x: number; y: number }[];
    color: string;
    exerciseId?: string;
    pageNumber?: number;
  }

  let currentStrokes: VectorStroke[] = [];
  let loadedSubId: string | null = null;

  // PDF page navigation state
  let pdfDoc: any = null;
  let currentPage = 1;
  let totalPages = 1;
  let pdfBytes: Uint8Array | null = null;
  let isScanPdf = false;

  $: currentSub = submissions[currentIndex];

  $: if (currentSub && currentSub.id !== loadedSubId) {
    loadedSubId = currentSub.id;
    loadSubmissionCanvas(currentSub);
  }

  $: {
    totalScore = Math.round(
      Object.values(scoreInputs).reduce(
        (sum, val) => sum + (Number(val) || 0),
        0
      ) * 100
    ) / 100;
  }

  $: totalMaxPoints = exercises.reduce((sum, ex) => sum + (ex.maxPoints || 0), 0);
  $: calculatedGradeDetail = calculateGradeDetail(totalScore, totalMaxPoints, exam?.gradingKey);
  $: calculatedGrade = calculatedGradeDetail
    ? { grade: calculatedGradeDetail.grade, label: calculatedGradeDetail.label }
    : null;

  function recalculateAutoScores() {
    for (const ex of exercises) {
      if (manualOverride[ex.id]) continue;
      let positivePoints = 0;
      let negativePoints = 0;

      for (const stroke of currentStrokes) {
        const targetId = stroke.exerciseId || (exercises[0] ? exercises[0].id : undefined);
        if (targetId === ex.id) {
          if (stroke.tool === "check_full" || stroke.tool === "check") {
            positivePoints += 1.0;
          } else if (stroke.tool === "check_half") {
            positivePoints += 0.5;
          } else if (stroke.tool === "check_quarter") {
            positivePoints += 0.25;
          } else if (stroke.tool === "minus_full") {
            negativePoints += 1.0;
          } else if (stroke.tool === "minus_half") {
            negativePoints += 0.5;
          } else if (stroke.tool === "minus_quarter") {
            negativePoints += 0.25;
          }
        }
      }

      const calculated = positivePoints - negativePoints;
      scoreInputs[ex.id] = Math.max(0, Math.min(ex.maxPoints, Math.round(calculated * 100) / 100));
    }
    scoreInputs = scoreInputs;
  }

  function addAutoScore(exId: string, maxPoints: number, points: number) {
    const current = Number(scoreInputs[exId]) || 0;
    scoreInputs[exId] = Math.min(maxPoints, Math.round((current + points) * 100) / 100);
    manualOverride[exId] = false;
    scoreInputs = scoreInputs;
  }

  function subtractAutoScore(exId: string, points: number) {
    const current = Number(scoreInputs[exId]) || 0;
    scoreInputs[exId] = Math.max(0, Math.round((current - points) * 100) / 100);
    manualOverride[exId] = false;
    scoreInputs = scoreInputs;
  }

  function getAutoCropBounds(ctx: CanvasRenderingContext2D, width: number, height: number) {
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;

      const step = 4;
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          if (lum < 225) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX <= minX || maxY <= minY) {
        return { x: 0, y: 0, w: width, h: height };
      }

      const pad = 20;
      const cropX = Math.max(0, minX - pad);
      const cropY = Math.max(0, minY - pad);
      const cropW = Math.min(width - cropX, (maxX - minX) + pad * 2);
      const cropH = Math.min(height - cropY, (maxY - minY) + pad * 2);

      if (cropW < width * 0.95 || cropH < height * 0.95) {
        return { x: cropX, y: cropY, w: cropW, h: cropH };
      }
    } catch (e) {
      console.error("Auto crop calculation failed:", e);
    }
    return { x: 0, y: 0, w: width, h: height };
  }

  function toggleAutoCrop() {
    isAutoCropEnabled = !isAutoCropEnabled;
    if (currentSub) {
      loadSubmissionCanvas(currentSub);
    }
  }

  onMount(async () => {
    if (!examId) return;
    if (!get(isUnlocked)) {
      await sessionStore.initAnonymousSession();
    }
    const key = get(sessionStore).sessionKey;
    exam = (await loadExamEncrypted(examId, key)) || null;
    exercises = await loadExamExercisesEncrypted(examId, key);
    if (exercises.length > 0 && !activeExerciseId) {
      activeExerciseId = exercises[0].id;
    }
    submissions = await submissionRepository.getByExamId(examId, key);
    const targetId = $page.url.searchParams.get('submissionId');
    if (targetId) {
      const idx = submissions.findIndex((s) => s.id === targetId);
      if (idx >= 0) currentIndex = idx;
    }
    if (submissions.length > 0) {
      await initExerciseScores(submissions[currentIndex]);
    }
  });

  async function initExerciseScores(sub: SubmissionRecord) {
    manualOverride = {};
    scoreInputs = {};
    if (exercises.length > 0 && !activeExerciseId) {
      activeExerciseId = exercises[0].id;
    }
    const key = get(sessionStore).sessionKey;
    const existingScores = await loadScoresEncrypted(sub.id, key);
    const validScores = existingScores.filter(
      (es) => typeof es.score === "number" && !isNaN(es.score)
    );

    if (validScores.length > 0) {
      validScores.forEach((es) => {
        scoreInputs[es.exerciseId] = es.score!;
      });
      exercises.forEach((ex) => {
        if (scoreInputs[ex.id] === undefined) {
          scoreInputs[ex.id] = 0;
        }
      });
    } else if (existingScores.length === 0 && sub.totalScore !== undefined) {
      // In-memory UI fallback ONLY — DO NOT write fake scores to IndexedDB
      const totalMax = exercises.reduce((s, ex) => s + (ex.maxPoints || 0), 0);
      for (const ex of exercises) {
        scoreInputs[ex.id] = totalMax > 0
          ? Math.round(sub.totalScore! * (ex.maxPoints / totalMax) * 100) / 100
          : 0;
      }
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

    // Reset PDF state
    pdfDoc = null;
    pdfBytes = null;
    isScanPdf = false;
    currentPage = 1;
    totalPages = 1;

    const key = get(sessionStore).sessionKey;
    if ((!sub.scanCt || !sub.scanIv || !sub.annotationCt) && key) {
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
        $sessionStore.fallbackSessionKey
      );

      // Detect format: PDF or PNG
      const isPdf =
        decryptedBytes.length > 4 &&
        decryptedBytes[0] === 0x25 &&
        decryptedBytes[1] === 0x50 &&
        decryptedBytes[2] === 0x44 &&
        decryptedBytes[3] === 0x46;

      if (isPdf) {
        // PDF path: load with pdf.js and render current page
        isScanPdf = true;
        pdfBytes = decryptedBytes;

        const pdfjsLib = await import("pdfjs-dist");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        }

        pdfDoc = await pdfjsLib.getDocument({ data: decryptedBytes }).promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;

        await renderCurrentPage();

        // Load annotations
        if (sub.annotationCt && sub.annotationIv && $sessionStore.sessionKey) {
          const annBytes = await decrypt(
            $sessionStore.sessionKey,
            sub.annotationCt,
            sub.annotationIv,
            $sessionStore.fallbackSessionKey
          );
          const jsonStr = new TextDecoder().decode(annBytes);
          currentStrokes = JSON.parse(jsonStr);
          redrawOverlay();
          if (currentStrokes.some((s) => s.tool !== "pen" && s.tool !== "line" && s.tool !== "eraser")) {
            recalculateAutoScores();
          }
        } else {
          currentStrokes = [];
          redrawOverlay();
        }
      } else {
        // PNG/image path (legacy submissions)
        isScanPdf = false;
        totalPages = 1;
        currentPage = 1;

        const blob = new Blob([decryptedBytes.buffer as ArrayBuffer], { type: "image/png" });
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.onload = () => {
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = img.width;
          tempCanvas.height = img.height;
          const tempCtx = tempCanvas.getContext("2d")!;
          tempCtx.drawImage(img, 0, 0);

          let crop = { x: 0, y: 0, w: img.width, h: img.height };
          if (isAutoCropEnabled) {
            crop = getAutoCropBounds(tempCtx, img.width, img.height);
          }

          scanCanvas.width = crop.w;
          scanCanvas.height = crop.h;
          overlayCanvas.width = crop.w;
          overlayCanvas.height = crop.h;

          ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
          URL.revokeObjectURL(url);
          tick().then(() => fitToPage());

          // Load annotations
          if (sub.annotationCt && sub.annotationIv && $sessionStore.sessionKey) {
            decrypt(
              $sessionStore.sessionKey,
              sub.annotationCt,
              sub.annotationIv,
              $sessionStore.fallbackSessionKey
            ).then((annBytes) => {
              const jsonStr = new TextDecoder().decode(annBytes);
              currentStrokes = JSON.parse(jsonStr);
              redrawOverlay();
              if (currentStrokes.some((s) => s.tool !== "pen" && s.tool !== "line" && s.tool !== "eraser")) {
                recalculateAutoScores();
              }
            });
          } else {
            currentStrokes = [];
            redrawOverlay();
          }
        };
        img.src = url;
      }
    } catch (err) {
      console.error("Failed to decrypt scan for grading:", err);
      if (scanCanvas && overlayCanvas) {
        scanCanvas.width = 600;
        scanCanvas.height = 800;
        overlayCanvas.width = 600;
        overlayCanvas.height = 800;
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, 600, 800);
        ctx.fillStyle = "#ef4444";
        ctx.font = "16px sans-serif";
        ctx.fillText("[ Scan Decryption Failed — Key Mismatch or Data Corrupted ]", 80, 400);
      }
    }
  }

  async function renderCurrentPage() {
    if (!pdfDoc || !scanCanvas || !overlayCanvas) return;
    const ctx = scanCanvas.getContext("2d")!;
    const pdfPage = await pdfDoc.getPage(currentPage);
    const viewport = pdfPage.getViewport({ scale: 2 });

    scanCanvas.width = viewport.width;
    scanCanvas.height = viewport.height;
    overlayCanvas.width = viewport.width;
    overlayCanvas.height = viewport.height;

    await pdfPage.render({ canvasContext: ctx, canvas: scanCanvas, viewport } as any).promise;
    tick().then(() => fitToPage());
    redrawOverlay();
  }

  function goPagePrev() {
    if (currentPage > 1) {
      isDrawing = false;
      isErasing = false;
      currentPage--;
      renderCurrentPage();
    }
  }

  function goPageNext() {
    if (currentPage < totalPages) {
      isDrawing = false;
      isErasing = false;
      currentPage++;
      renderCurrentPage();
    }
  }

  function eraseAt(x: number, y: number) {
    const radius = 25;
    const remainingStrokes: VectorStroke[] = [];
    let erasedAny = false;

    for (const stroke of currentStrokes) {
      const strokePage = stroke.pageNumber ?? 1;
      if (strokePage === currentPage) {
        const isHit = stroke.points.some(
          (p) => Math.hypot(p.x - x, p.y - y) <= radius
        );
        if (isHit) {
          erasedAny = true;
        } else {
          remainingStrokes.push(stroke);
        }
      } else {
        remainingStrokes.push(stroke);
      }
    }

    if (erasedAny) {
      currentStrokes = remainingStrokes;
      recalculateAutoScores();
      sessionStore.setDirty(true);
      redrawOverlay();
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (!overlayCanvas) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      isDrawing = false;
      isErasing = false;
      const pts = Array.from(activePointers.values());
      initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialZoomScale = zoomScale;
      return;
    }

    if (activePointers.size > 2) return;

    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (drawTool === "eraser") {
      isErasing = true;
      eraseAt(x, y);
      return;
    }

    if (drawTool === "line") {
      isDrawing = true;
      currentStrokes.push({
        tool: "line",
        points: [{ x, y }, { x, y }],
        color: penColor,
        exerciseId: activeExerciseId || (exercises[0] ? exercises[0].id : undefined),
        pageNumber: currentPage,
      });
      sessionStore.setDirty(true);
      return;
    }

    const isStamp = drawTool !== "pen";
    if (isStamp) {
      const color = "#ef4444";
      const targetEx = exercises.find((ex) => ex.id === activeExerciseId) || exercises[0];
      currentStrokes.push({
        tool: drawTool,
        points: [{ x, y }],
        color,
        exerciseId: targetEx ? targetEx.id : undefined,
        pageNumber: currentPage,
      });

      recalculateAutoScores();
      sessionStore.setDirty(true);
      redrawOverlay();
      return;
    }

    isDrawing = true;
    currentStrokes.push({
      tool: "pen",
      points: [{ x, y }],
      color: penColor,
      exerciseId: activeExerciseId || (exercises[0] ? exercises[0].id : undefined),
      pageNumber: currentPage,
    });
    sessionStore.setDirty(true);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!overlayCanvas) return;
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointers.size === 2 && initialPinchDistance !== null) {
      const pts = Array.from(activePointers.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (initialPinchDistance > 0) {
        const factor = currentDist / initialPinchDistance;
        zoomScale = Math.min(4.0, Math.max(0.5, Math.round(initialZoomScale * factor * 100) / 100));
      }
      return;
    }

    if (!isDrawing && !isErasing) return;

    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (isErasing && drawTool === "eraser") {
      eraseAt(x, y);
      return;
    }

    if (!isDrawing) return;
    const currentStroke = currentStrokes[currentStrokes.length - 1];
    if (currentStroke) {
      if (currentStroke.tool === "line") {
        currentStroke.points[1] = { x, y };
      } else if (currentStroke.tool === "pen") {
        currentStroke.points.push({ x, y });
      }
      redrawOverlay();
    }
  }

  function handlePointerUp(e?: PointerEvent) {
    if (e && e.pointerId !== undefined) {
      activePointers.delete(e.pointerId);
    } else {
      activePointers.clear();
    }
    if (activePointers.size < 2) {
      initialPinchDistance = null;
    }
    isDrawing = false;
    isErasing = false;
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      zoomScale = Math.min(4.0, Math.max(0.5, Math.round((zoomScale + delta) * 100) / 100));
    }
  }

  function zoomIn() {
    zoomScale = Math.min(4.0, Math.round((zoomScale + 0.25) * 100) / 100);
  }

  function zoomOut() {
    zoomScale = Math.max(0.5, Math.round((zoomScale - 0.25) * 100) / 100);
  }

  function fitToPage() {
    if (!canvasViewport || !scanCanvas || scanCanvas.width === 0 || scanCanvas.height === 0) {
      zoomScale = 1.0;
      return;
    }
    const availWidth = canvasViewport.clientWidth - 16;
    const availHeight = canvasViewport.clientHeight - 16;
    if (availWidth <= 0 || availHeight <= 0) {
      zoomScale = 1.0;
      return;
    }
    const scaleX = availWidth / scanCanvas.width;
    const scaleY = availHeight / scanCanvas.height;
    const idealScale = Math.min(scaleX, scaleY);
    const scaleIfWidth100 = availWidth / scanCanvas.width;
    const ratio = idealScale / scaleIfWidth100;
    zoomScale = Math.min(4.0, Math.max(0.1, Math.round(ratio * 100) / 100));
  }

  function resetZoom() {
    fitToPage();
  }

  function redrawOverlay() {
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const visibleStrokes = currentStrokes.filter(
      (stroke) => (stroke.pageNumber ?? 1) === currentPage
    );

    for (const stroke of visibleStrokes) {
      ctx.strokeStyle = "#ef4444";
      ctx.fillStyle = "#ef4444";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";

      if (stroke.tool === "pen") {
        ctx.beginPath();
        stroke.points.forEach((p, idx) => {
          if (idx === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      } else if (stroke.tool === "line") {
        if (stroke.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          ctx.lineTo(stroke.points[1].x, stroke.points[1].y);
          ctx.stroke();
        }
      } else if (stroke.tool === "check_full" || stroke.tool === "check") {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.moveTo(p.x - 14, p.y - 2);
        ctx.lineTo(p.x - 4, p.y + 10);
        ctx.lineTo(p.x + 16, p.y - 18);
        ctx.stroke();
      } else if (stroke.tool === "check_half") {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.moveTo(p.x - 14, p.y - 2);
        ctx.lineTo(p.x - 4, p.y + 10);
        ctx.lineTo(p.x + 16, p.y - 18);
        ctx.stroke();
        // 1 crossing line
        ctx.beginPath();
        ctx.moveTo(p.x + 1, p.y - 12);
        ctx.lineTo(p.x + 11, p.y - 2);
        ctx.stroke();
      } else if (stroke.tool === "check_quarter") {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.moveTo(p.x - 14, p.y - 2);
        ctx.lineTo(p.x - 4, p.y + 10);
        ctx.lineTo(p.x + 16, p.y - 18);
        ctx.stroke();
        // 2 crossing lines
        ctx.beginPath();
        ctx.moveTo(p.x - 2, p.y - 13);
        ctx.lineTo(p.x + 8, p.y - 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x + 5, p.y - 13);
        ctx.lineTo(p.x + 15, p.y - 3);
        ctx.stroke();
      } else if (stroke.tool === "minus_full") {
        const p = stroke.points[0];
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("-1BE", p.x, p.y);
      } else if (stroke.tool === "minus_half") {
        const p = stroke.points[0];
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("-0,5BE", p.x, p.y);
      } else if (stroke.tool === "minus_quarter") {
        const p = stroke.points[0];
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("-0,25BE", p.x, p.y);
      } else if (stroke.tool === "wrong" || stroke.tool === "cross") {
        const p = stroke.points[0];
        ctx.font = "bold italic 30px serif";
        ctx.fillText("f", p.x, p.y);
      } else if (stroke.tool === "missing") {
        const p = stroke.points[0];
        ctx.beginPath();
        ctx.moveTo(p.x - 12, p.y - 18);
        ctx.lineTo(p.x, p.y + 4);
        ctx.lineTo(p.x + 12, p.y - 18);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 15, p.y - 8);
        ctx.lineTo(p.x + 15, p.y - 8);
        ctx.stroke();
      } else if (stroke.tool === "wf") {
        const p = stroke.points[0];
        ctx.font = "bold 24px sans-serif";
        ctx.fillText("WF", p.x, p.y);
      } else if (stroke.tool === "ff") {
        const p = stroke.points[0];
        ctx.font = "bold 24px sans-serif";
        ctx.fillText("FF", p.x, p.y);
      }
    }
  }

  function requestClearAnnotations() {
    showClearConfirmModal = true;
  }

  function confirmClearAnnotations() {
    currentStrokes = [];
    recalculateAutoScores();
    redrawOverlay();
    sessionStore.setDirty(true);
    showClearConfirmModal = false;
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
      } else {
        currentSub.annotationCt = undefined;
        currentSub.annotationIv = undefined;
      }

      await saveSubmissionEncrypted(currentSub, key);
      submissions[currentIndex] = { ...currentSub };
      submissions = submissions;

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
    if (currentIndex >= submissions.length - 1) {
      showLastSubModal = true;
      return;
    }
    if (currentStrokes.length > 0) {
      if (!confirm("You have unsaved annotations for this student. Move to next student anyway?")) {
        return;
      }
    }
    currentIndex++;
    initExerciseScores(submissions[currentIndex]);
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
    <!-- Single Compact Header Row combining Exam metadata & Student identifier -->
    <div class="grading-header-row">
      <div class="header-left">
        <a href="/exam/{examId}" class="back-btn" title="Back to Exam Setup">← Exam</a>
        <div class="exam-info">
          <span class="exam-title">{exam?.title || "Exam"}</span>
          <span class="exam-meta">
            {exam?.testart || "Kurzarbeit"} • Klasse: {exam?.klasse || "-"} • Fach: {exam?.fach || "-"}
          </span>
        </div>
      </div>

      <div class="header-center">
        <div class="student-pill">
          <span class="student-label">Anonymous Student #{currentIndex + 1} of {submissions.length}</span>
          <span class="pseudonym-hash" title={currentSub?.pseudonymHash}>
            ID: {currentSub?.pseudonymHash ? currentSub.pseudonymHash.substring(0, 10) : ''}...
          </span>
        </div>
      </div>

      <div class="header-right">
        {#if calculatedGrade}
          <div class="grade-pill">
            <span class="grade-pill-label">Grade:</span>
            <span class="grade-pill-val">{calculatedGrade.grade}</span>
            <span class="grade-pill-desc">({calculatedGrade.label})</span>
          </div>
        {/if}
      </div>
    </div>

    <div class="grading-workspace">
      <!-- Document Viewer Panel -->
      <div class="canvas-panel">
        <!-- Floating Vertical Annotation Toolbar -->
        <div class="floating-annotation-palette">
          <button
            class:active={drawTool === "pen"}
            on:click={() => (drawTool = "pen")}
            title="Freihand-Stift (Rot)"
          >
            <span class="tool-icon">🖊</span>
            <span class="tool-label">Stift</span>
          </button>
          <button
            class:active={drawTool === "line"}
            on:click={() => (drawTool = "line")}
            title="Gerade Linie zeichnen"
          >
            <span class="tool-icon">📏</span>
            <span class="tool-label">Linie</span>
          </button>
          <button
            class:active={drawTool === "eraser"}
            on:click={() => (drawTool = "eraser")}
            title="Radiergummi"
          >
            <span class="tool-icon">🧹</span>
            <span class="tool-label">Radierer</span>
          </button>

          <div class="palette-divider"></div>

          <button
            class:active={drawTool === "check_full" || drawTool === "check"}
            on:click={() => (drawTool = "check_full")}
            title="Richtig (+1.0 Pkt.)"
          >
            <span class="tool-icon text-emerald-400">✓</span>
            <span class="tool-label">+1.0</span>
          </button>
          <button
            class:active={drawTool === "check_half"}
            on:click={() => (drawTool = "check_half")}
            title="Halb Richtig (1 Strich, +0.5 Pkt.)"
          >
            <span class="tool-icon text-amber-400">✓̷</span>
            <span class="tool-label">+0.5</span>
          </button>
          <button
            class:active={drawTool === "check_quarter"}
            on:click={() => (drawTool = "check_quarter")}
            title="Viertel Richtig (2 Striche, +0.25 Pkt.)"
          >
            <span class="tool-icon text-amber-300">✓̷̷</span>
            <span class="tool-label">+0.25</span>
          </button>

          <div class="palette-divider"></div>

          <button
            class:active={drawTool === "minus_full"}
            on:click={() => (drawTool = "minus_full")}
            title="Abzug (-1.0 Pkt.)"
          >
            <span class="tool-icon text-rose-400 font-bold">-1</span>
            <span class="tool-label">-1.0</span>
          </button>
          <button
            class:active={drawTool === "minus_half"}
            on:click={() => (drawTool = "minus_half")}
            title="Halber Abzug (-0.5 Pkt.)"
          >
            <span class="tool-icon text-rose-400 font-bold">-½</span>
            <span class="tool-label">-0.5</span>
          </button>
          <button
            class:active={drawTool === "minus_quarter"}
            on:click={() => (drawTool = "minus_quarter")}
            title="Viertel Abzug (-0.25 Pkt.)"
          >
            <span class="tool-icon text-rose-300 font-bold">-¼</span>
            <span class="tool-label">-0.25</span>
          </button>

          <div class="palette-divider"></div>

          <button
            class:active={drawTool === "wrong" || drawTool === "cross"}
            on:click={() => (drawTool = "wrong")}
            title="Falsch (0 Pkt.)"
          >
            <span class="tool-icon text-rose-500 font-serif italic font-bold">f</span>
            <span class="tool-label">Falsch</span>
          </button>
          <button
            class:active={drawTool === "missing"}
            on:click={() => (drawTool = "missing")}
            title="Fehlt (0 Pkt.)"
          >
            <span class="tool-icon text-amber-500 font-bold">∀</span>
            <span class="tool-label">Fehlt</span>
          </button>
          <button
            class:active={drawTool === "wf"}
            on:click={() => (drawTool = "wf")}
            title="Wiederholungsfehler"
          >
            <span class="tool-icon text-purple-400 font-bold">WF</span>
            <span class="tool-label">WF</span>
          </button>
          <button
            class:active={drawTool === "ff"}
            on:click={() => (drawTool = "ff")}
            title="Folgefehler"
          >
            <span class="tool-icon text-indigo-400 font-bold">FF</span>
            <span class="tool-label">FF</span>
          </button>

          <div class="palette-divider"></div>

          <button
            class="clear-btn"
            on:click={requestClearAnnotations}
            title="Alle Anmerkungen löschen"
          >
            <span class="tool-icon">🗑</span>
            <span class="tool-label">Löschen</span>
          </button>
        </div>

        <!-- Canvas Viewport (Fit to whole page, continuous vertical scrolling) -->
        <div class="canvas-viewport" bind:this={canvasViewport} on:wheel={handleWheel}>
          <div class="canvas-zoom-wrapper" style="width: {zoomScale * 100}%; max-width: 100%; position: relative; display: block; margin: 0 auto;">
            <canvas bind:this={scanCanvas} class="scan-canvas"></canvas>
            <canvas
              bind:this={overlayCanvas}
              class="overlay-canvas"
              on:pointerdown={handlePointerDown}
              on:pointermove={handlePointerMove}
              on:pointerup={handlePointerUp}
              on:pointercancel={handlePointerUp}
            ></canvas>
          </div>
        </div>

        <!-- Floating Zoom & Controls Overlay -->
        <div class="floating-zoom-overlay">
          {#if isScanPdf && totalPages > 1}
            <button
              type="button"
              class="zoom-btn"
              on:click={goPagePrev}
              disabled={currentPage <= 1}
              title="Vorherige Seite (Pfeil links)"
            >◀</button>
            <span class="page-indicator">S. {currentPage}/{totalPages}</span>
            <button
              type="button"
              class="zoom-btn"
              on:click={goPageNext}
              disabled={currentPage >= totalPages}
              title="Nächste Seite (Pfeil rechts)"
            >▶</button>
            <div class="zoom-divider"></div>
          {/if}
          <button
            type="button"
            class="zoom-btn"
            class:active={isAutoCropEnabled}
            on:click={toggleAutoCrop}
            title={isAutoCropEnabled ? "Ränder zugeschnitten (Klicken zum Zurücksetzen)" : "Ränder zuschneiden"}
          >
            ✂️ {isAutoCropEnabled ? "Zuschnitt" : "Ganze Seite"}
          </button>
          <div class="zoom-divider"></div>
          <button
            type="button"
            class="zoom-btn"
            on:click={zoomOut}
            title="Verkleinern (-)"
          >➖</button>
          <span class="zoom-level">{zoomScale === 1.0 ? "Fit" : `${Math.round(zoomScale * 100)}%`}</span>
          <button
            type="button"
            class="zoom-btn"
            on:click={zoomIn}
            title="Vergrößern (+)"
          >➕</button>
          <button
            type="button"
            class="zoom-btn"
            on:click={resetZoom}
            title="Anpassen (Fit)"
          >Fit</button>
        </div>
      </div>

      <!-- Compact Exercise Scores Sidebar -->
      <div class="grading-panel">
        <div class="ex-list-header">
          <h3>Exercises ({exercises.length})</h3>
          <span class="header-sub">Click row to set stamp target</span>
        </div>

        <!-- Scrollable exercise list -->
        <div class="ex-list-scroll">
          {#each exercises as ex}
            <div
              class="ex-item-compact"
              class:active={ex.id === activeExerciseId}
              on:click={() => (activeExerciseId = ex.id)}
              role="button"
              tabindex="0"
              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') activeExerciseId = ex.id; }}
            >
              <div class="ex-num-box">
                <span class="ex-num">Q{ex.orderIndex}</span>
                {#if ex.id === activeExerciseId}
                  <span class="target-dot" title="Stamp Target">🎯</span>
                {/if}
              </div>

              <div class="ex-score-wrap">
                <input
                  id={`score-${ex.id}`}
                  type="number"
                  step="0.25"
                  min="0"
                  max={ex.maxPoints}
                  bind:value={scoreInputs[ex.id]}
                  on:input={() => { manualOverride[ex.id] = true; }}
                />
                <span class="ex-max-pts">/ {ex.maxPoints}</span>
                <button
                  type="button"
                  class="reset-btn-compact"
                  title="Reset to 0"
                  on:click={(e) => {
                    e.stopPropagation();
                    scoreInputs[ex.id] = 0;
                    manualOverride[ex.id] = false;
                    scoreInputs = scoreInputs;
                  }}>×</button>
              </div>

              {#if manualOverride[ex.id]}
                <span class="override-indicator" title="Manually edited">•</span>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Pinned Primary Actions at bottom -->
        <div class="grading-panel-pinned">
          <div class="total-score-card">
            <div class="total-score-top-row">
              <span class="total-score-label">Gesamtpunkte</span>
              <div class="total-score-val-wrap">
                <span class="total-score-val">{totalScore}</span>
                <span class="total-score-max">/ {totalMaxPoints} Pkt.</span>
              </div>
            </div>

            {#if calculatedGradeDetail}
              <div class="grade-detail-box">
                <div class="current-grade-row">
                  <span class="grade-badge">Note {calculatedGradeDetail.grade}</span>
                  <span class="grade-desc">({calculatedGradeDetail.label})</span>
                </div>

                <div class="grade-margins-list">
                  {#if calculatedGradeDetail.nextHigher}
                    <div class="margin-item higher" title="Benötigte Punkte zur nächstbesseren Note">
                      <span class="margin-icon">▲</span>
                      <span class="margin-text">+{calculatedGradeDetail.nextHigher.pointsNeeded} Pkt. zu Note {calculatedGradeDetail.nextHigher.grade}</span>
                    </div>
                  {:else}
                    <div class="margin-item max-achieved" title="Beste Note erreicht">
                      <span class="margin-icon">★</span>
                      <span class="margin-text">Höchste Note erreicht</span>
                    </div>
                  {/if}

                  {#if calculatedGradeDetail.nextLower}
                    <div class="margin-item lower" title="Punkte-Puffer vor der nächstschlechteren Note">
                      <span class="margin-icon">▼</span>
                      <span class="margin-text">-{calculatedGradeDetail.nextLower.pointsBuffer} Pkt. zu Note {calculatedGradeDetail.nextLower.grade}</span>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <button
            class="save-btn-pinned"
            on:click={handleSaveScore}
            disabled={isSaving}
          >
            {isSaving ? "Speichern..." : "💾 Note & Anmerkungen speichern"}
          </button>

          <div class="nav-buttons-pinned">
            <button on:click={prevStudent} disabled={currentIndex === 0}>◀ Vorheriger</button>
            <button on:click={nextStudent}>Nächster Schüler ▶</button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

{#if showLastSubModal}
  <div class="last-sub-backdrop">
    <div class="last-sub-card">
      <div class="last-sub-icon">
        🏁
      </div>
      <h3>Ende der Arbeiten</h3>
      <p>
        Du hast die letzte Arbeit dieser Prüfung erreicht. Alle vorliegenden Abgaben wurden korrigiert.
      </p>
      <div class="modal-btn-group">
        <a href="/exam/{examId}" class="modal-primary-btn">
          Zurück zur Prüfungsübersicht
        </a>
        <button
          type="button"
          class="modal-secondary-btn"
          on:click={() => (showLastSubModal = false)}
        >
          Auf dieser Seite bleiben
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showClearConfirmModal}
  <div class="last-sub-backdrop" on:click|self={() => (showClearConfirmModal = false)} role="dialog">
    <div class="last-sub-card">
      <div class="last-sub-icon" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;">
        🗑
      </div>
      <h3>Alle Anmerkungen löschen?</h3>
      <p>
        Möchtest du wirklich alle Zeichnungen und Stempel auf dieser Seite löschen? Dies setzt auch die automatisch berechneten Punkte zurück.
      </p>
      <div class="modal-btn-group">
        <button
          type="button"
          class="modal-danger-btn"
          on:click={confirmClearAnnotations}
        >
          Löschen bestätigen
        </button>
        <button
          type="button"
          class="modal-secondary-btn"
          on:click={() => (showClearConfirmModal = false)}
        >
          Abbrechen
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .grading-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    min-height: 0;
    max-width: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #090d16;
    color: #f8fafc;
  }

  .last-sub-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(4px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .last-sub-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 16px;
    padding: 2rem;
    max-width: 420px;
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  }

  .last-sub-icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(99, 102, 241, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.75rem;
  }

  .last-sub-card h3 {
    margin: 0;
    color: #f8fafc;
    font-size: 1.25rem;
  }

  .last-sub-card p {
    margin: 0;
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .modal-close-btn {
    width: 100%;
    padding: 0.75rem 1rem;
    background: #4f46e5;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .modal-close-btn:hover {
    background: #4338ca;
  }

  /* Single Compact Header Row */
  .grading-header-row {
    flex-shrink: 0;
    height: 44px;
    background: #0f172a;
    border-bottom: 1px solid #1e293b;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.75rem;
    gap: 1rem;
    z-index: 10;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .back-btn {
    background: #1e293b;
    color: #94a3b8;
    text-decoration: none;
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #334155;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .back-btn:hover {
    color: #38bdf8;
    border-color: #38bdf8;
    background: #334155;
  }

  .exam-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }

  .exam-title {
    font-weight: 700;
    color: #38bdf8;
    font-size: 0.95rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .exam-meta {
    font-size: 0.75rem;
    color: #64748b;
  }

  .header-center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .student-pill {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #1e293b;
    border: 1px solid #334155;
    padding: 0.2rem 0.65rem;
    border-radius: 9999px;
    font-size: 0.8rem;
  }

  .student-label {
    font-weight: 600;
    color: #f1f5f9;
  }

  .pseudonym-hash {
    font-family: monospace;
    font-size: 0.725rem;
    color: #94a3b8;
    background: #0f172a;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .grade-pill {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid rgba(99, 102, 241, 0.3);
    padding: 0.2rem 0.65rem;
    border-radius: 8px;
    font-size: 0.8rem;
  }

  .grade-pill-label {
    color: #818cf8;
    font-size: 0.75rem;
  }

  .grade-pill-val {
    font-weight: 700;
    color: #e0e7ff;
    font-size: 0.95rem;
  }

  .grade-pill-desc {
    color: #a5b4fc;
    font-size: 0.725rem;
  }

  /* Main Workspace */
  .grading-workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 0.5rem;
    padding: 0.5rem;
    width: 100%;
    height: calc(100vh - 44px);
    box-sizing: border-box;
    overflow: hidden;
  }

  /* Document Viewer Panel */
  .canvas-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 8px;
    overflow: hidden;
    width: 100%;
    min-width: 0;
  }

  /* Floating Vertical Palette */
  .floating-annotation-palette {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.35rem;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(51, 65, 85, 0.8);
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    max-height: calc(100% - 3rem);
    overflow-y: auto;
  }

  .floating-annotation-palette button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 40px;
    padding: 0.15rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .floating-annotation-palette button:hover {
    background: #1e293b;
    color: #f8fafc;
  }

  .floating-annotation-palette button.active {
    background: #0284c7;
    color: #ffffff;
    border-color: #38bdf8;
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
  }

  .tool-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .tool-label {
    font-size: 0.625rem;
    font-weight: 600;
    margin-top: 0.1rem;
  }

  .palette-divider {
    height: 1px;
    background: #334155;
    margin: 0.15rem 0.2rem;
  }

  .clear-btn:hover {
    background: rgba(239, 68, 68, 0.2) !important;
    color: #f87171 !important;
  }

  /* Canvas Viewport */
  .canvas-viewport {
    flex: 1;
    min-height: 0;
    width: 100%;
    height: 100%;
    overflow: auto;
    position: relative;
    background: #020617;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 0.5rem;
  }

  .scan-canvas {
    display: block;
    width: 100%;
    height: auto;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.7);
    border-radius: 4px;
  }

  .overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }

  /* Floating Zoom Overlay */
  .floating-zoom-overlay {
    position: absolute;
    bottom: 0.75rem;
    right: 0.75rem;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    background: rgba(15, 23, 42, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(51, 65, 85, 0.8);
    border-radius: 10px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    font-size: 0.75rem;
  }

  .zoom-btn {
    background: #1e293b;
    border: 1px solid #334155;
    color: #cbd5e1;
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .zoom-btn:hover {
    background: #334155;
    color: #f8fafc;
  }

  .zoom-btn.active {
    background: #0284c7;
    color: white;
    border-color: #38bdf8;
  }

  .zoom-level {
    font-family: monospace;
    font-weight: 700;
    color: #e2e8f0;
    padding: 0 0.25rem;
  }

  .zoom-divider {
    width: 1px;
    height: 16px;
    background: #334155;
    margin: 0 0.15rem;
  }

  /* Compact Right-Hand Sidebar */
  .grading-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 8px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .ex-list-header {
    flex-shrink: 0;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid #1e293b;
    background: #1e293b;
  }

  .ex-list-header h3 {
    margin: 0;
    font-size: 0.875rem;
    color: #38bdf8;
    font-weight: 700;
  }

  .header-sub {
    font-size: 0.675rem;
    color: #64748b;
  }

  .ex-list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .ex-item-compact {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.5rem;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    gap: 0.4rem;
  }

  .ex-item-compact:hover {
    border-color: #475569;
    background: #273549;
  }

  .ex-item-compact.active {
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    box-shadow: 0 0 8px rgba(56, 189, 248, 0.15);
  }

  .ex-num-box {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .ex-num {
    font-weight: 700;
    font-size: 0.8rem;
    color: #f1f5f9;
  }

  .target-dot {
    font-size: 0.75rem;
  }

  .ex-score-wrap {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .ex-score-wrap input {
    width: 48px;
    padding: 0.2rem 0.3rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 4px;
    color: #38bdf8;
    font-weight: 700;
    font-size: 0.8rem;
    text-align: right;
  }

  .ex-max-pts {
    font-size: 0.725rem;
    color: #94a3b8;
  }

  .reset-btn-compact {
    padding: 0 0.3rem;
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    font-size: 0.9rem;
    line-height: 1;
    border-radius: 3px;
  }

  .reset-btn-compact:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
  }

  .override-indicator {
    color: #f59e0b;
    font-size: 1rem;
    line-height: 1;
  }

  /* Pinned Bottom Actions */
  .grading-panel-pinned {
    flex-shrink: 0;
    padding: 0.65rem 0.75rem;
    background: #1e293b;
    border-top: 1px solid #334155;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .total-score-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: #0f172a;
    padding: 0.5rem 0.65rem;
    border-radius: 6px;
    border: 1px solid #334155;
  }

  .total-score-top-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .total-score-label {
    font-size: 0.775rem;
    color: #94a3b8;
    font-weight: 600;
  }

  .total-score-val-wrap {
    display: flex;
    align-items: baseline;
    gap: 0.2rem;
  }

  .total-score-val {
    font-size: 1.1rem;
    font-weight: 800;
    color: #38bdf8;
  }

  .total-score-max {
    font-size: 0.725rem;
    color: #64748b;
  }

  .grade-detail-box {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.35rem;
    border-top: 1px dashed #1e293b;
  }

  .current-grade-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .grade-badge {
    background: rgba(99, 102, 241, 0.2);
    color: #818cf8;
    font-weight: 700;
    font-size: 0.8rem;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    border: 1px solid rgba(99, 102, 241, 0.3);
  }

  .grade-desc {
    font-size: 0.75rem;
    color: #cbd5e1;
    font-weight: 500;
  }

  .grade-margins-list {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.7rem;
    margin-top: 0.1rem;
  }

  .margin-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .margin-item.higher {
    color: #34d399;
  }

  .margin-item.lower {
    color: #fb7185;
  }

  .margin-item.max-achieved {
    color: #fbbf24;
  }

  .margin-icon {
    font-size: 0.65rem;
  }

  .margin-text {
    font-weight: 500;
  }

  .modal-btn-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    margin-top: 0.5rem;
  }

  .modal-primary-btn {
    width: 100%;
    padding: 0.65rem 1rem;
    background: #4f46e5;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.875rem;
    text-decoration: none;
    text-align: center;
    box-sizing: border-box;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .modal-primary-btn:hover {
    background: #4338ca;
  }

  .modal-danger-btn {
    width: 100%;
    padding: 0.65rem 1rem;
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .modal-danger-btn:hover {
    background: #b91c1c;
  }

  .modal-secondary-btn {
    width: 100%;
    padding: 0.55rem 1rem;
    background: #334155;
    color: #cbd5e1;
    border: 1px solid #475569;
    border-radius: 8px;
    font-weight: 500;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .modal-secondary-btn:hover {
    background: #475569;
    color: #ffffff;
  }

  .save-btn-pinned {
    width: 100%;
    padding: 0.5rem;
    background: #0284c7;
    color: white;
    font-weight: 600;
    font-size: 0.825rem;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .save-btn-pinned:hover:not(:disabled) {
    background: #0369a1;
  }

  .save-btn-pinned:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .nav-buttons-pinned {
    display: flex;
    gap: 0.5rem;
  }

  .nav-buttons-pinned button {
    flex: 1;
    padding: 0.4rem 0.5rem;
    background: #334155;
    color: #cbd5e1;
    border: none;
    border-radius: 6px;
    font-size: 0.775rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .nav-buttons-pinned button:hover:not(:disabled) {
    background: #475569;
    color: #f8fafc;
  }

  .nav-buttons-pinned button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .empty {
    text-align: center;
    padding: 4rem;
    color: #94a3b8;
  }
</style>
