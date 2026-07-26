<script lang="ts">
  import { page } from "$app/stores";
  import {
    detectHardware,
    PipelineMonitor,
    type HardwareProfile,
  } from "$lib/hardware/detect";
  import { db } from "$lib/db/db";
  import { encrypt } from "$lib/crypto/aesGcm";
  import { sessionStore } from "$lib/stores/session";
  import { storagePolicyStore } from "$lib/stores/storagePolicy";
  import {
    loadStudentsEncrypted,
    saveStudentEncrypted,
    saveSubmissionEncrypted,
    decryptStudent,
  } from "$lib/db/dbEncryption";
  import { api } from "$lib/api/client";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { WorkerPool } from "$lib/workers/pool";
  import { browser } from "$app/environment";
  import type {
    QrWorkerRequest,
    QrWorkerResponse,
  } from "$lib/workers/qrWorker";

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

  let unmatchedList: UnmatchedSubmission[] = [];
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
    }

    return () => {
      qrPool?.terminate();
    };
  });

  async function refreshUnmatched() {
    const key = get(sessionStore).sessionKey;
    const rawStudents = await db.students.where("examId").equals(examId).toArray();
    const students = await Promise.all(rawStudents.map(s => decryptStudent(s, key)));
    const unmatched = students.filter((s) =>
      s.fallbackCode && s.fallbackCode.startsWith("UNMATCHED-"),
    );
    unmatchedList = unmatched.map((s) => {
      return {
        submissionId: s.pseudonymId,
        studentId: s.pseudonymId,
        currentFallback: s.fallbackCode || "",
        newCode: "",
      };
    });
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

    let activePseudonymId: string | null = null;
    let activeSubmissionId: string | null = null;

    let totalPagesCount = 0;
    let processedPages = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      statusText = `Extracting file ${i + 1} of ${files.length}: ${file.name}`;

      const pages = await extractPagesFromFile(file);
      totalPagesCount += pages.length;

      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        processedPages++;
        progress = Math.round((processedPages / totalPagesCount) * 100);
        statusText = `Processing page ${processedPages}: ${file.name} (page ${pIdx + 1}/${pages.length})`;

        const pageItem = pages[pIdx];
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

        // Encrypt page buffer
        let scanCt: Uint8Array | undefined;
        let scanIv: Uint8Array | undefined;
        if ($sessionStore.sessionKey) {
          const encRes = await encrypt(
            $sessionStore.sessionKey,
            pageItem.buffer,
          );
          scanCt = encRes.ciphertext;
          scanIv = encRes.iv;
        }

        if (qrResult) {
          // New student booklet detected
          const pseudoId: string = qrResult.pseudonymId;
          activePseudonymId = pseudoId;
          const fallbackCode =
            qrResult.fallbackCode ||
            `F-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

          const key = get(sessionStore).sessionKey;
          await saveStudentEncrypted({
            pseudonymId: pseudoId,
            examId,
            fallbackCode,
            piiCt: new Uint8Array([0]),
            piiIv: new Uint8Array(12),
          }, key);

          const subId: string = crypto.randomUUID();
          activeSubmissionId = subId;
          await saveSubmissionEncrypted({
            id: subId,
            examId,
            pseudonymHash: pseudoId,
            scanCt,
            scanIv: scanIv || new Uint8Array(12),
            createdAt: new Date().toISOString(),
          }, key);
          scannedCount++;

          if ($storagePolicyStore === "server-synced") {
            try {
              const emptyCtB64 = btoa(String.fromCharCode(0));
              const emptyIvB64 = btoa(
                String.fromCharCode(...new Uint8Array(12)),
              );
              const emptySaltB64 = btoa(
                String.fromCharCode(...new Uint8Array(16)),
              );
              await api.post(`/exams/${examId}/students`, {
                pseudonym_hmac: pseudoId,
                pii_ciphertext_b64: emptyCtB64,
                iv_b64: emptyIvB64,
                encryption_salt_b64: emptySaltB64,
              });
              await api.post(`/exams/${examId}/submissions`, {
                id: subId,
                pseudonym_hmac: pseudoId,
              });
            } catch (syncErr) {
              console.warn(
                "Failed to sync student/submission to server:",
                syncErr,
              );
            }
          }
        } else {
          // Additional page in current booklet or orphaned initial page
          if (!activeSubmissionId || !activePseudonymId) {
            const pseudoId: string = crypto.randomUUID();
            const subId: string = crypto.randomUUID();
            activePseudonymId = pseudoId;
            activeSubmissionId = subId;

            const key = get(sessionStore).sessionKey;
            await saveStudentEncrypted({
              pseudonymId: pseudoId,
              examId,
              fallbackCode: `UNMATCHED-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              piiCt: new Uint8Array([0]),
              piiIv: new Uint8Array(12),
            }, key);

            await saveSubmissionEncrypted({
              id: subId,
              examId,
              pseudonymHash: pseudoId,
              scanCt,
              scanIv: scanIv || new Uint8Array(12),
              createdAt: new Date().toISOString(),
            }, key);
            scannedCount++;

            if ($storagePolicyStore === "server-synced") {
              try {
                const emptyCtB64 = btoa(String.fromCharCode(0));
                const emptyIvB64 = btoa(
                  String.fromCharCode(...new Uint8Array(12)),
                );
                const emptySaltB64 = btoa(
                  String.fromCharCode(...new Uint8Array(16)),
                );
                await api.post(`/exams/${examId}/students`, {
                  pseudonym_hmac: pseudoId,
                  pii_ciphertext_b64: emptyCtB64,
                  iv_b64: emptyIvB64,
                  encryption_salt_b64: emptySaltB64,
                });
                await api.post(`/exams/${examId}/submissions`, {
                  id: subId,
                  pseudonym_hmac: pseudoId,
                });
              } catch (syncErr) {
                console.warn(
                  "Failed to sync unmatched student/submission to server:",
                  syncErr,
                );
              }
            }
          }
        }

        monitor?.checkMemoryHealth();
      }
    }

    await refreshUnmatched();
    isProcessing = false;
    statusText = `Complete! Ingested ${files.length} file(s) (${processedPages} page(s)) into ${scannedCount} submission booklet(s).`;
  }

  async function updateFallbackCode(item: UnmatchedSubmission) {
    if (!item.newCode.trim()) return;
    const key = get(sessionStore).sessionKey;
    const rawSt = await db.students.get(item.studentId);
    if (rawSt) {
      const st = await decryptStudent(rawSt, key);
      st.fallbackCode = item.newCode.trim();
      await saveStudentEncrypted(st, key);
      await refreshUnmatched();
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
</div>

<style>
  .scan-ingestion-page {
    max-width: 850px;
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
</style>
