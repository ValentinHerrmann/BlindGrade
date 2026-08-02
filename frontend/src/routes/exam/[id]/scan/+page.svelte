<script lang="ts">
  import { page } from "$app/stores";
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

  interface ScannedSubmissionItem {
    id: string;
    pseudonymHash: string;
    fallbackCode: string;
    studentName?: string;
    studentNumber?: string;
    createdAt: string;
    scanCt?: Uint8Array;
    scanIv?: Uint8Array;
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

  async function extractPagesFromFile(
    file: File,
  ): Promise<{ imageData: ImageData; buffer: Uint8Array }[]> {
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        }
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const pages: { imageData: ImageData; buffer: Uint8Array }[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 }); // ~200 DPI
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, canvas, viewport } as any)
            .promise;

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const blob: Blob = await new Promise((res) =>
            canvas.toBlob((b) => res(b!), "image/png"),
          );
          const buffer = new Uint8Array(await blob.arrayBuffer());
          pages.push({ imageData, buffer });
        }
        return pages;
      } catch (pdfErr) {
        console.error("PDF parsing error:", pdfErr);
        return [];
      }
    } else {
      const single = await loadImageData(file);
      return [single];
    }
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
      pageBuffers: Uint8Array[];
    }

    const booklets: StudentBooklet[] = [];
    let processedPages = 0;
    let totalPagesCount = 0;

    const extractedPages: { fileName: string; pageIndex: number; imageData: ImageData; buffer: Uint8Array }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      statusText = `Extracting file ${i + 1} of ${files.length}: ${file.name}`;
      const pages = await extractPagesFromFile(file);
      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        extractedPages.push({
          fileName: file.name,
          pageIndex: pIdx + 1,
          imageData: pages[pIdx].imageData,
          buffer: pages[pIdx].buffer,
        });
      }
    }
    totalPagesCount = extractedPages.length;

    for (let pIdx = 0; pIdx < extractedPages.length; pIdx++) {
      processedPages++;
      progress = Math.round((processedPages / Math.max(totalPagesCount, 1)) * 50);
      const pageItem = extractedPages[pIdx];
      statusText = `Scanning page ${processedPages} of ${totalPagesCount}: ${pageItem.fileName}`;

      let qrResult: QrWorkerResponse | null = null;
      if (qrPool) {
        try {
          const res = await qrPool.dispatch({
            type: "QR_DECODE",
            imageData: pageItem.imageData,
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
          pageBuffers: [pageItem.buffer],
        });
      } else {
        if (booklets.length > 0) {
          booklets[booklets.length - 1].pageBuffers.push(pageItem.buffer);
        } else {
          const pseudoId: string = crypto.randomUUID();
          booklets.push({
            pseudonymId: pseudoId,
            fallbackCode: `UNMATCHED-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
            isUnmatched: true,
            pageBuffers: [pageItem.buffer],
          });
        }
      }

      monitor?.checkMemoryHealth();
    }

    let newlyIngestedCount = 0;
    for (let bIdx = 0; bIdx < booklets.length; bIdx++) {
      const booklet = booklets[bIdx];
      statusText = `Saving student booklet ${bIdx + 1} of ${booklets.length} (${booklet.pageBuffers.length} page(s))...`;
      progress = 50 + Math.round(((bIdx + 1) / Math.max(booklets.length, 1)) * 50);

      const scanBuffer = await combinePageBuffers(booklet.pageBuffers);

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

      if ($storagePolicyStore.storageMode === "all-server") {
        try {
          const emptyCtB64 = uint8ArrayToBase64(new Uint8Array([0]));
          const emptyIvB64 = uint8ArrayToBase64(new Uint8Array(12));
          const emptySaltB64 = uint8ArrayToBase64(new Uint8Array(16));
          const pseudoHmac = await ensure64CharHex(booklet.pseudonymId);
          await api.post(`/exams/${examId}/students`, {
            pseudonym_hmac: pseudoHmac,
            pii_ciphertext_b64: emptyCtB64,
            iv_b64: emptyIvB64,
            encryption_salt_b64: emptySaltB64,
          });
          const subPayload: any = {
            id: subId,
            pseudonym_hmac: pseudoHmac,
          };
          if (scanCt && scanIv) {
            subPayload.scan_ciphertext_b64 = uint8ArrayToBase64(scanCt);
            subPayload.scan_iv_b64 = uint8ArrayToBase64(scanIv);
          }
          await api.post(`/exams/${examId}/submissions`, subPayload);
        } catch (syncErr) {
          console.warn(
            "Failed to sync student/submission to server:",
            syncErr,
          );
        }
      }
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
    const rawSt = await db.students.get(item.studentId);
    if (rawSt) {
      const st = await decryptStudent(rawSt, key);
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
      accept="image/*,application/pdf"
      on:change={handleFileUpload}
      disabled={isProcessing}
    />
    <label for="scanFiles">Select Scan Files (PNG / JPEG / PDF)</label>
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
