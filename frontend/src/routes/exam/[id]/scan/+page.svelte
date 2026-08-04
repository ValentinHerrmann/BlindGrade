<script lang="ts">
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import {
    detectHardware,
    PipelineMonitor,
    type HardwareProfile,
  } from "$lib/hardware/detect";
  import { db } from "$lib/db/db";
  import { encrypt, decrypt, uint8ArrayToBase64 } from "$lib/crypto/aesGcm";
  import { ensure64CharHex } from "$lib/crypto/hmac";
  import { sessionStore } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import {
    loadStudentsEncrypted,
    saveStudentEncrypted,
    saveSubmissionEncrypted,
    decryptStudent,
  } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { submissionRepository } from "$lib/repositories/submissionRepository";
  import { studentRepository } from "$lib/repositories/studentRepository";
  import type { StudentRecord } from "$lib/db/schema";
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { WorkerPool } from "$lib/workers/pool";
  import type {
    QrWorkerRequest,
    QrWorkerResponse,
  } from "$lib/workers/qrWorker";
  import { parseStudentQr } from "$lib/utils/studentQr";
  import ZoomableImage from "$lib/components/ZoomableImage.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import type { PDFDocument, PDFPage } from "pdf-lib";

  const examId = $page.params.id || "";

  let hwProfile: HardwareProfile = {
    logicalCores: 4,
    estimatedRAMGB: 8,
    simdSupported: true,
    fileSystemAccessAPI: true,
    recommendedMode: "parallel",
  };
  let monitor: PipelineMonitor;
  let isProcessing = false;
  let progress = 0;
  let statusText = "Ready to ingest scan files.";
  let scannedCount = 0;

  interface UnmatchedSubmission {
    submissionId: string;
    studentId: string;
    currentFallback: string;
    newCode: string;
  }

  interface PdfPageRef {
    doc: PDFDocument;
    index: number;
  }

  interface ScannedSubmissionItem {
    id: string;
    pseudonymHash: string;
    fallbackCode: string;
    studentName?: string;
    studentNumber?: string;
    createdAt: string;
    scanCt?: Uint8Array;
    scanIv?: Uint8Array;
    totalScore?: number;
    annotationCt?: Uint8Array;
    annotationIv?: Uint8Array;
  }

  let unmatchedList: UnmatchedSubmission[] = [];
  let scannedSubmissions: ScannedSubmissionItem[] = [];
  let previewModalOpen = false;
  let previewItem: ScannedSubmissionItem | null = null;
  let previewObjectUrl: string | null = null;
  let previewIsPdf = false;
  let previewLoading = false;
  let previewError = "";
  let qrPool: WorkerPool<QrWorkerRequest, QrWorkerResponse> | null = null;

  onMount(() => {
    if (browser) {
      hwProfile = detectHardware();
      monitor = new PipelineMonitor(hwProfile);
      monitor.on("downgrade", () => {
        statusText =
          "Memory limit reached! Downgraded to assembly-line processing mode.";
      });
      qrPool = new WorkerPool(
        () =>
          new Worker(new URL("$lib/workers/qrWorker.ts", import.meta.url), {
            type: "module",
          }),
        monitor,
      );
      refreshUnmatched();
      loadScannedSubmissions();
    }

    return () => {
      qrPool?.terminate();
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }
    };
  });

  async function loadScannedSubmissions() {
    const key = get(sessionStore).sessionKey;
    const submissions = await submissionRepository.getByExamId(examId, key);
    const students = await studentRepository.getByExamId(examId, key);

    const studentMap = new Map<string, StudentRecord>();
    for (const st of students) {
      if (st.pseudonymId) {
        studentMap.set(st.pseudonymId, st);
        const hex = await ensure64CharHex(st.pseudonymId);
        studentMap.set(hex, st);
      }
      if (st.fallbackCode) {
        studentMap.set(st.fallbackCode, st);
      }
    }

    const items: ScannedSubmissionItem[] = [];
    for (const sub of submissions) {
      let st = studentMap.get(sub.pseudonymHash);
      if (!st) {
        const hex = await ensure64CharHex(sub.pseudonymHash);
        st = studentMap.get(hex);
      }

      let sName = st?.studentName;
      let sNumber = st?.studentNumber;
      let fCode = st?.fallbackCode;

      const qrCandidate =
        (st?.pseudonymId && st.pseudonymId.includes('_') ? st.pseudonymId : null) ||
        (sub.pseudonymHash && sub.pseudonymHash.includes('_') ? sub.pseudonymHash : null) ||
        (fCode && fCode.includes('_') ? fCode : null);

      if (qrCandidate) {
        const parsed = parseStudentQr(qrCandidate);
        if (parsed) {
          sName = sName || parsed.displayName;
          sNumber = sNumber || parsed.studentNumber;
          if (!fCode || fCode === "UNKNOWN" || fCode.length === 64) {
            fCode = parsed.displayName;
          }
        }
      }

      if (!fCode || fCode === "UNKNOWN") {
        fCode = sName || (sub.pseudonymHash.length > 16 ? sub.pseudonymHash.substring(0, 8) : sub.pseudonymHash);
      }

      items.push({
        id: sub.id,
        pseudonymHash: sub.pseudonymHash,
        fallbackCode: fCode,
        studentName: sName,
        studentNumber: sNumber,
        createdAt: sub.createdAt || new Date().toISOString(),
        scanCt: sub.scanCt,
        scanIv: sub.scanIv,
        totalScore: sub.totalScore,
        annotationCt: sub.annotationCt,
        annotationIv: sub.annotationIv,
      });
    }

    scannedSubmissions = items;
  }

  async function openPreview(item: ScannedSubmissionItem) {
    closePreview();
    previewItem = item;
    previewModalOpen = true;
    previewLoading = true;
    previewError = "";

    const key = get(sessionStore).sessionKey;
    let scanCt = item.scanCt;
    let scanIv = item.scanIv;

    if (!scanCt || !scanIv) {
      const fullSub = await submissionRepository.getById(examId, item.id, key);
      if (fullSub) {
        scanCt = fullSub.scanCt;
        scanIv = fullSub.scanIv;
      }
    }

    if (!scanCt || !scanIv || !key) {
      previewLoading = false;
      previewError = "Scan data or session encryption key missing.";
      return;
    }

    try {
      const decryptedBytes = await decrypt(key, scanCt, scanIv);
      const isPdf =
        decryptedBytes.length > 4 &&
        decryptedBytes[0] === 0x25 && // %
        decryptedBytes[1] === 0x50 && // P
        decryptedBytes[2] === 0x44 && // D
        decryptedBytes[3] === 0x46; // F

      previewIsPdf = isPdf;
      const mimeType = isPdf ? "application/pdf" : "image/png";
      const blob = new Blob([decryptedBytes as unknown as BlobPart], { type: mimeType });
      previewObjectUrl = URL.createObjectURL(blob);
    } catch (err) {
      console.error("Preview decryption failed:", err);
      previewError = "Failed to decrypt scan data.";
    } finally {
      previewLoading = false;
    }
  }

  function closePreview() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
    previewModalOpen = false;
    previewItem = null;
    previewIsPdf = false;
    previewError = "";
  }

  async function handleDeleteScan(item: ScannedSubmissionItem) {
    if (!confirm("Are you sure you want to delete this scan submission?")) return;
    try {
      await submissionRepository.delete(examId, item.id);
      await loadScannedSubmissions();
    } catch (err: any) {
      alert(`Failed to delete scan: ${err?.message || err}`);
    }
  }

  function isGraded(item: ScannedSubmissionItem): boolean {
    return item.totalScore !== undefined || item.annotationCt !== undefined;
  }

  async function handleDeleteGrading(item: ScannedSubmissionItem) {
    if (!confirm("Are you sure you want to delete the grading for this submission? This will clear all annotations and the score.")) return;
    try {
      const key = get(sessionStore).sessionKey;
      await submissionRepository.clearGrading(examId, item.id, key);
      await loadScannedSubmissions();
    } catch (err: any) {
      alert(`Failed to delete grading: ${err?.message || err}`);
    }
  }

  let exportingId: string | null = null;

  function drawStrokesOnCanvas(ctx: CanvasRenderingContext2D, strokes: any[]) {
    for (const stroke of strokes) {
      ctx.strokeStyle = "#ef4444";
      ctx.fillStyle = "#ef4444";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      if (stroke.tool === "pen") {
        ctx.beginPath();
        stroke.points.forEach((p: any, idx: number) => {
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
        ctx.beginPath();
        ctx.moveTo(p.x - 2, p.y - 13);
        ctx.lineTo(p.x + 8, p.y - 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x + 5, p.y - 13);
        ctx.lineTo(p.x + 15, p.y - 3);
        ctx.stroke();
      } else if (stroke.tool === "minus_full") {
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("-1BE", stroke.points[0].x, stroke.points[0].y);
      } else if (stroke.tool === "minus_half") {
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("-0,5BE", stroke.points[0].x, stroke.points[0].y);
      } else if (stroke.tool === "minus_quarter") {
        ctx.font = "bold 26px sans-serif";
        ctx.fillText("-0,25BE", stroke.points[0].x, stroke.points[0].y);
      } else if (stroke.tool === "wrong" || stroke.tool === "cross") {
        ctx.font = "bold italic 30px serif";
        ctx.fillText("f", stroke.points[0].x, stroke.points[0].y);
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
        ctx.font = "bold 24px sans-serif";
        ctx.fillText("WF", stroke.points[0].x, stroke.points[0].y);
      } else if (stroke.tool === "ff") {
        ctx.font = "bold 24px sans-serif";
        ctx.fillText("FF", stroke.points[0].x, stroke.points[0].y);
      }
    }
  }

  async function handleExportPdf(item: ScannedSubmissionItem) {
    exportingId = item.id;
    try {
      const key = get(sessionStore).sessionKey;
      if (!key) throw new Error("Session not unlocked");

      const sub = await submissionRepository.getById(examId, item.id, key);
      if (!sub?.scanCt || !sub.scanIv) throw new Error("Scan data not found");

      const scanBytes = await decrypt(key, sub.scanCt, sub.scanIv);

      // Load annotations
      let strokes: any[] = [];
      if (sub.annotationCt && sub.annotationIv) {
        const annBytes = await decrypt(key, sub.annotationCt, sub.annotationIv);
        strokes = JSON.parse(new TextDecoder().decode(annBytes));
      }

      const { PDFDocument } = await import("pdf-lib");
      const outputPdf = await PDFDocument.create();

      // Helper: convert canvas to PNG bytes
      const canvasToPng = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
        new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) { reject(new Error("Canvas export failed")); return; }
            blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
          }, "image/png");
        });

      // Helper: load Uint8Array as HTMLImageElement
      const loadImageFromBytes = (bytes: Uint8Array): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const blob = new Blob([bytes], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
          img.src = url;
        });

      // Detect whether scanBytes is a PDF or an image
      const isPdf =
        scanBytes.length > 4 &&
        scanBytes[0] === 0x25 && // %
        scanBytes[1] === 0x50 && // P
        scanBytes[2] === 0x44 && // D
        scanBytes[3] === 0x46; // F

      if (isPdf) {
        // Original PDF path: render each page with pdf.js, draw annotations, embed as PNG
        const pdfjsLib = await import("pdfjs-dist");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        }

        const pdfDoc = await pdfjsLib.getDocument({ data: scanBytes }).promise;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          const pdfPage = await pdfDoc.getPage(pageNum);
          const viewport = pdfPage.getViewport({ scale: 2 });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;

          await pdfPage.render({ canvasContext: ctx, canvas, viewport } as any).promise;

          if (strokes.length > 0) {
            drawStrokesOnCanvas(ctx, strokes);
          }

          const pngBytes = await canvasToPng(canvas);
          const pngImage = await outputPdf.embedPng(pngBytes);
          // use half the canvas size (scale=2) as the PDF page dimensions in pt
          const outPage = outputPdf.addPage([viewport.width / 2, viewport.height / 2]);
          outPage.drawImage(pngImage, { x: 0, y: 0, width: viewport.width / 2, height: viewport.height / 2 });
        }
      } else {
        // Image path (default for ingested scans): load image, draw annotations, embed directly
        const img = await loadImageFromBytes(scanBytes);
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);

        if (strokes.length > 0) {
          drawStrokesOnCanvas(ctx, strokes);
        }

        const pngBytes = await canvasToPng(canvas);
        const pngImage = await outputPdf.embedPng(pngBytes);

        // Convert pixel dimensions to PDF points at 72 DPI.
        // Scanned images are rendered at scale=2 (~192 DPI from a 96 DPI base),
        // so scale down to obtain a natural page size in points.
        const dpi = 192;
        const pageWidth = img.width * (72 / dpi);
        const pageHeight = img.height * (72 / dpi);
        const outPage = outputPdf.addPage([pageWidth, pageHeight]);
        outPage.drawImage(pngImage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      }

      const pdfBytes = await outputPdf.save();
      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.fallbackCode || item.id}_graded.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Failed to export PDF: ${err?.message || err}`);
    } finally {
      exportingId = null;
    }
  }

  async function handleDeleteAllScans() {
    if (scannedSubmissions.length === 0) return;
    if (
      !confirm(
        `Are you sure you want to delete ALL ${scannedSubmissions.length} ingested scan(s) for this exam? This action cannot be undone.`
      )
    ) {
      return;
    }
    try {
      for (const item of scannedSubmissions) {
        await submissionRepository.delete(examId, item.id);
      }
      await refreshUnmatched();
      await loadScannedSubmissions();
    } catch (err: any) {
      alert(`Failed to delete all scans: ${err?.message || err}`);
    }
  }

  async function combinePageBuffers(pageBuffers: Uint8Array[]): Promise<Uint8Array> {
    if (pageBuffers.length === 1) return pageBuffers[0];
    const images = await Promise.all(
      pageBuffers.map((buf) => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const blob = new Blob([buf.buffer as ArrayBuffer], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
          };
          img.src = url;
        });
      })
    );

    const totalHeight = images.reduce((acc, img) => acc + img.height, 0);
    const maxWidth = Math.max(...images.map((img) => img.width));
    const canvas = document.createElement("canvas");
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d")!;

    let currentY = 0;
    for (const img of images) {
      ctx.drawImage(img, 0, currentY);
      currentY += img.height;
    }

    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), "image/png")
    );
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function refreshUnmatched() {
    const key = get(sessionStore).sessionKey;
    const students = await studentRepository.getByExamId(examId, key);
    const unmatched = students.filter((s) =>
      s.fallbackCode && s.fallbackCode.startsWith("UNMATCHED-"),
    );
    unmatchedList = unmatched.map((s) => ({
      submissionId: s.pseudonymId,
      studentId: s.pseudonymId,
      currentFallback: s.fallbackCode || "",
      newCode: "",
    }));
  }

  async function loadImageData(
    file: File,
  ): Promise<{ imageData: ImageData; buffer: Uint8Array }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        URL.revokeObjectURL(url);

        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error("Canvas blob generation failed"));
            return;
          }
          const buffer = new Uint8Array(await blob.arrayBuffer());
          resolve({ imageData, buffer });
        }, "image/png");
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image file: ${file.name}`));
      };

      img.src = url;
    });
  }

  async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    isProcessing = true;
    progress = 0;
    const files = Array.from(input.files);

    interface StudentBooklet {
      pseudonymId: string;
      fallbackCode: string;
      studentName?: string;
      studentNumber?: string;
      isUnmatched: boolean;
      pageRefs: PdfPageRef[];
    }

    const booklets: StudentBooklet[] = [];
    let processedPages = 0;
    let totalPagesCount = 0;

    // --- PASS 1: Calculate total pages for progress bar ---
    const fileInfos: any[] = [];
    statusText = "Analyzing files...";

    for (const file of files) {
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        try {
          const pdfjsLib = await import("pdfjs-dist");
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
          }
          const fileUrl = URL.createObjectURL(file);
          const loadingTask = pdfjsLib.getDocument({ url: fileUrl });
          const pdf = await loadingTask.promise;

          totalPagesCount += pdf.numPages;
          fileInfos.push({ file, type: "pdf", pdf, loadingTask, fileUrl });
        } catch (pdfErr) {
          console.error("Failed to load PDF:", pdfErr);
        }
      } else {
        totalPagesCount += 1;
        fileInfos.push({ file, type: "image" });
      }
    }

    // --- HELPER: Process Single Page ---
    async function processScannedPage(fileName: string, imageData: ImageData, pageRef: PdfPageRef) {
      processedPages++;
      progress = Math.round((processedPages / Math.max(totalPagesCount, 1)) * 50);
      statusText = `Scanning page ${processedPages} of ${totalPagesCount}: ${fileName}`;

      let qrResult: QrWorkerResponse | null = null;
      if (qrPool) {
        try {
          const res = await qrPool.dispatch({
            type: "QR_DECODE",
            imageData: imageData,
          });
          if (res.type === "QR_RESULT") {
            qrResult = res;
          }
        } catch {
          // No QR on this page
        }
      }

      if (qrResult) {
        const pseudoId: string = qrResult.pseudonymId;
        const parsedStudent = parseStudentQr(pseudoId) || (qrResult.rawText ? parseStudentQr(qrResult.rawText) : null);
        const fallbackCode =
          (parsedStudent ? parsedStudent.displayName : null) ||
          qrResult.fallbackCode ||
          `F-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        booklets.push({
          pseudonymId: pseudoId,
          fallbackCode,
          studentName: parsedStudent?.displayName,
          studentNumber: parsedStudent?.studentNumber,
          isUnmatched: false,
          pageRefs: [pageRef],
        });
      } else {
        if (booklets.length > 0) {
          booklets[booklets.length - 1].pageRefs.push(pageRef);
        } else {
          const pseudoId: string = crypto.randomUUID();
          booklets.push({
            pseudonymId: pseudoId,
            fallbackCode: `UNMATCHED-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            isUnmatched: true,
            pageRefs: [pageRef],
          });
        }
      }

      monitor?.checkMemoryHealth();
    }

    // --- PASS 2: Extract & Process Iteratively ---
    for (let i = 0; i < fileInfos.length; i++) {
      const info = fileInfos[i];
      const fileName = info.file.name;

      if (info.type === "pdf") {
        const pdfJsDoc = info.pdf;

        // Load the same file with pdf-lib for page copying
        const fileBytes = await info.file.arrayBuffer();
        const { PDFDocument: PDFDocClass } = await import("pdf-lib");
        const pdfLibDoc = await PDFDocClass.load(fileBytes, { ignoreEncryption: true });
        const numPages = pdfJsDoc.numPages;

        for (let pIdx = 1; pIdx <= numPages; pIdx++) {
          const page = await pdfJsDoc.getPage(pIdx);
          const viewport = page.getViewport({ scale: 2.0 }); // ~200 DPI
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, canvas, viewport } as any).promise;

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Reference the page in the pdf-lib document (0-based index)
          const pageRef: PdfPageRef = { doc: pdfLibDoc, index: pIdx - 1 };

          // Scan and group immediately, dropping imageData after use
          await processScannedPage(fileName, imageData, pageRef);

          // Clean up page resources
          page.cleanup();
        }

        // Clean up PDF.js resources
        await info.loadingTask.destroy();
        URL.revokeObjectURL(info.fileUrl);

      } else {
        // Image files are no longer supported — skip with warning
        console.warn(`Skipping unsupported file type (image): ${fileName}. Only PDF files are supported.`);
      }
    }

    let newlyIngestedCount = 0;
    for (let bIdx = 0; bIdx < booklets.length; bIdx++) {
      const booklet = booklets[bIdx];
      statusText = `Saving student booklet ${bIdx + 1} of ${booklets.length} (${booklet.pageRefs.length} page(s))...`;
      progress = 50 + Math.round(((bIdx + 1) / Math.max(booklets.length, 1)) * 50);

      // Assemble a new PDF by copying pages from the source documents
      const { PDFDocument: PDFDocClass } = await import("pdf-lib");
      const assembledPdf = await PDFDocClass.create();
      for (const ref of booklet.pageRefs) {
        const copiedPages = await assembledPdf.copyPages(ref.doc, [ref.index]);
        assembledPdf.addPage(copiedPages[0]);
      }
      const scanBuffer = await assembledPdf.save();

      let scanCt: Uint8Array | undefined;
      let scanIv: Uint8Array | undefined;
      if ($sessionStore.sessionKey) {
        const encRes = await encrypt($sessionStore.sessionKey, scanBuffer);
        scanCt = encRes.ciphertext;
        scanIv = encRes.iv;
      }

      const key = get(sessionStore).sessionKey;
      await saveStudentEncrypted(
        {
          pseudonymId: booklet.pseudonymId,
          examId,
          fallbackCode: booklet.fallbackCode,
          studentName: booklet.studentName,
          studentNumber: booklet.studentNumber,
          piiCt: new Uint8Array([0]),
          piiIv: new Uint8Array(12),
        },
        key,
      );

      const subId: string = crypto.randomUUID();
      await saveSubmissionEncrypted(
        {
          id: subId,
          examId,
          pseudonymHash: booklet.pseudonymId,
          scanCt,
          scanIv: scanIv || new Uint8Array(12),
          createdAt: new Date().toISOString(),
        },
        key,
      );

      newlyIngestedCount++;
      scannedCount++;

    }

    await refreshUnmatched();
    await loadScannedSubmissions();
    isProcessing = false;
    statusText = `Complete! Ingested ${files.length} file(s) (${processedPages} page(s)) into ${newlyIngestedCount} student submission booklet(s).`;
  }

  async function updateFallbackCode(item: UnmatchedSubmission) {
    const code = item.newCode.trim();
    if (!code) return;
    const key = get(sessionStore).sessionKey;
    const students = await studentRepository.getByExamId(examId, key);
    let st = students.find((s) => s.pseudonymId === item.studentId);
    if (!st) {
      const rawSt = await db.students.get(item.studentId);
      if (rawSt) st = await decryptStudent(rawSt, key);
    }
    if (st) {
      st.fallbackCode = code;
      const parsed = parseStudentQr(code);
      if (parsed) {
        st.studentName = parsed.displayName;
        st.studentNumber = parsed.studentNumber;
      }
      await saveStudentEncrypted(st, key);
      await refreshUnmatched();
      await loadScannedSubmissions();
      alert(`Updated fallback code to "${st.fallbackCode}"`);
    }
  }
</script>

<div class="scan-ingestion-page">
  <h2>Scan Ingestion Pipeline</h2>

  <div class="hw-profile-card">
    <h3>Hardware Environment Profile</h3>
    <div class="profile-grid">
      <div>CPU Cores: <strong>{hwProfile.logicalCores}</strong></div>
      <div>RAM Estimate: <strong>{hwProfile.estimatedRAMGB} GB</strong></div>
      <div>
        WASM SIMD: <strong
          >{hwProfile.simdSupported ? "Supported" : "Not Supported"}</strong
        >
      </div>
      <div>
        Active Mode:
        <span class="mode-tag" class:constrained={monitor?.inConstrainedMode}>
          {monitor?.inConstrainedMode
            ? "Constrained Assembly-Line"
            : "Parallel Multi-Core"}
        </span>
      </div>
    </div>
  </div>

  <div class="upload-box">
    <input
      type="file"
      id="scanFiles"
      multiple
      accept="application/pdf"
      on:change={handleFileUpload}
      disabled={isProcessing}
    />
    <label for="scanFiles">Select Scan Files (PDF only)</label>
  </div>

  {#if isProcessing}
    <div class="progress-section">
      <div class="progress-bar">
        <div class="fill" style="width: {progress}%"></div>
      </div>
      <p class="status">{statusText}</p>
    </div>
  {:else if statusText}
    <p class="status-msg">{statusText}</p>
  {/if}

  {#if unmatchedList.length > 0}
    <div class="unmatched-section">
      <h3>Unmatched Submissions (Fallback Code Entry Needed)</h3>
      <p class="desc">
        The following booklet submissions could not read a QR code
        automatically. Enter the fallback code printed on the cover page.
      </p>

      <div class="unmatched-table">
        {#each unmatchedList as item}
          <div class="unmatched-row">
            <span class="current-tag">{item.currentFallback}</span>
            <input
              type="text"
              placeholder="Enter printed fallback code (e.g. A-X7K2M9)"
              bind:value={item.newCode}
            />
            <button on:click={() => updateFallbackCode(item)}>Link Code</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="scans-overview-section">
    <div class="scans-overview-header">
      <h3>Ingested Scans ({scannedSubmissions.length})</h3>
      {#if scannedSubmissions.length > 0}
        <button class="btn-delete-all" on:click={handleDeleteAllScans}>
          Delete All Scans
        </button>
      {/if}
    </div>
    {#if scannedSubmissions.length === 0}
      <p class="empty-msg">No scans ingested for this exam yet.</p>
    {:else}
      <div class="scans-table">
        <div class="table-header">
          <span>Student Name</span>
          <span>Student ID</span>
          <span>Fallback Code</span>
          <span>Date Ingested</span>
          <span>Action</span>
        </div>
        {#each scannedSubmissions as item}
          <div class="table-row">
            <span class="student-name" title={`Submission ID: ${item.id}`}>
              {item.studentName || 'Unmatched Student'}
            </span>
            <span class="student-number" title={`Pseudonym: ${item.pseudonymHash}`}>
              {item.studentNumber || '—'}
            </span>
            <span class="badge" class:unmatched={item.fallbackCode.startsWith('UNMATCHED-')}>
              {item.fallbackCode}
            </span>
            <span class="time">{new Date(item.createdAt).toLocaleString()}</span>
            <div class="action-buttons">
              <button class="btn-preview" on:click={() => openPreview(item)}>Preview Scan</button>
              <button class="btn-grade" on:click={() => goto(`/exam/${examId}/grade?submissionId=${item.id}`)}>Go to Grading</button>
              <button class="btn-export" disabled={exportingId === item.id} on:click={() => handleExportPdf(item)}>
                {exportingId === item.id ? 'Exporting…' : 'Export PDF'}
              </button>
              <button class="btn-delete-grading" disabled={!isGraded(item)} on:click={() => handleDeleteGrading(item)}>Delete Grading</button>
              <button class="btn-delete" on:click={() => handleDeleteScan(item)}>Delete</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if previewModalOpen}
  <div class="modal-backdrop" on:click={closePreview} role="presentation">
    <div class="modal-card" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>Scan Preview — {previewItem?.fallbackCode || previewItem?.id}</h3>
        <button class="close-btn" on:click={closePreview}>&times;</button>
      </div>
      <div class="modal-body">
        {#if previewLoading}
          <div class="preview-status">Decrypting scan...</div>
        {:else if previewError}
          <div class="preview-error">{previewError}</div>
        {:else if previewObjectUrl}
          {#if previewIsPdf}
            <object data={previewObjectUrl} type="application/pdf" class="preview-pdf">
              <iframe src={previewObjectUrl} title="Scan PDF Preview" class="preview-pdf"></iframe>
            </object>
          {:else}
            <ZoomableImage src={previewObjectUrl} alt="Decrypted Scan Preview" />
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scan-ingestion-page {
    max-width: 100%;
    margin: 2rem auto;
    padding: 1rem;
  }

  h2 {
    color: #38bdf8;
  }

  .hw-profile-card {
    background: #1e293b;
    padding: 1.25rem;
    border-radius: 8px;
    margin-bottom: 2rem;
    border: 1px solid #334155;
  }

  .profile-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.75rem;
    font-size: 0.875rem;
    margin-top: 0.5rem;
  }

  .mode-tag {
    background: #0284c7;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .mode-tag.constrained {
    background: #eab308;
    color: black;
  }

  .upload-box {
    background: #0f172a;
    border: 2px dashed #334155;
    padding: 3rem;
    text-align: center;
    border-radius: 12px;
  }

  input[type="file"] {
    display: none;
  }

  label {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    background: #0284c7;
    color: white;
    font-weight: 600;
    border-radius: 6px;
    cursor: pointer;
  }

  .progress-section {
    margin-top: 2rem;
  }

  .progress-bar {
    height: 12px;
    background: #1e293b;
    border-radius: 6px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: #38bdf8;
    transition: width 0.2s ease;
  }

  .status-msg {
    margin-top: 1rem;
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .unmatched-section {
    margin-top: 2.5rem;
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    border: 1px solid #eab308;
  }

  .unmatched-section h3 {
    margin-top: 0;
    color: #fef08a;
  }

  .unmatched-section .desc {
    font-size: 0.875rem;
    color: #94a3b8;
    margin-bottom: 1rem;
  }

  .unmatched-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
    background: #0f172a;
    padding: 0.75rem;
    border-radius: 6px;
  }

  .current-tag {
    font-family: monospace;
    color: #fca5a5;
    font-size: 0.875rem;
  }

  .unmatched-row input {
    flex: 1;
    padding: 0.5rem;
    background: #1e293b;
    border: 1px solid #334155;
    color: white;
    border-radius: 4px;
  }

  .unmatched-row button {
    padding: 0.5rem 1rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }

  .scans-overview-section {
    margin-top: 2.5rem;
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    border: 1px solid #334155;
  }

  .scans-overview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .scans-overview-header h3 {
    margin: 0;
    color: #38bdf8;
  }

  .btn-delete-all {
    padding: 0.45rem 0.85rem;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-delete-all:hover {
    background: #b91c1c;
  }

  .empty-msg {
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .scans-table {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .table-header {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1.2fr 1.2fr 1fr;
    gap: 0.75rem;
    font-weight: 600;
    font-size: 0.8rem;
    color: #94a3b8;
    text-transform: uppercase;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #334155;
  }

  .table-row {
    display: grid;
    grid-template-columns: 1.5fr 1fr 1.2fr 1.2fr 1fr;
    gap: 0.75rem;
    align-items: center;
    background: #0f172a;
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .student-name {
    font-weight: 600;
    color: #f8fafc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .student-number {
    font-family: monospace;
    color: #38bdf8;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: #0284c7;
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .badge.unmatched {
    background: #eab308;
    color: black;
  }

  .time {
    color: #94a3b8;
    font-size: 0.8rem;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .btn-preview {
    padding: 0.4rem 0.8rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8rem;
    transition: background 0.2s ease;
  }

  .btn-preview:hover {
    background: #0369a1;
  }

  .btn-delete {
    padding: 0.4rem 0.8rem;
    background: #dc2626;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8rem;
    transition: background 0.2s ease;
  }

  .btn-delete:hover {
    background: #b91c1c;
  }

  .btn-grade {
    padding: 0.4rem 0.8rem;
    background: #7c3aed;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8rem;
    transition: background 0.2s ease;
  }

  .btn-grade:hover {
    background: #6d28d9;
  }

  .btn-export {
    padding: 0.4rem 0.8rem;
    background: #059669;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8rem;
    transition: background 0.2s ease;
  }

  .btn-export:hover:not(:disabled) {
    background: #047857;
  }

  .btn-export:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .btn-delete-grading {
    padding: 0.4rem 0.8rem;
    background: #d97706;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.8rem;
    transition: background 0.2s ease;
  }

  .btn-delete-grading:hover:not(:disabled) {
    background: #b45309;
  }

  .btn-delete-grading:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 90%;
    max-width: 1100px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: #0f172a;
    border-bottom: 1px solid #334155;
  }

  .modal-header h3 {
    margin: 0;
    color: #38bdf8;
    font-size: 1.1rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 1.5rem;
    cursor: pointer;
    line-height: 1;
  }

  .close-btn:hover {
    color: white;
  }

  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 300px;
  }

  .preview-status {
    color: #38bdf8;
    font-weight: 500;
  }

  .preview-error {
    color: #f87171;
    font-weight: 500;
  }

  .preview-img {
    max-width: 100%;
    max-height: 70vh;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  }

  .preview-pdf {
    width: 100%;
    height: 75vh;
    border: none;
    border-radius: 8px;
  }
</style>
