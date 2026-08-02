<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { sessionStore } from "$lib/stores/session";
  import { loadExamEncrypted } from "$lib/db/dbEncryption";
  import { submissionRepository } from "$lib/repositories/submissionRepository";
  import { db } from "$lib/db/db";
  import type { ExamRecord } from "$lib/db/schema";

  $: examId = $page.params.id || "";
  $: pathname = $page.url.pathname;

  let exam: ExamRecord | null = null;
  let submissionCount = 0;

  $: if (examId) {
    loadExamHeaderData(examId);
  }

  async function loadExamHeaderData(id: string) {
    const key = get(sessionStore).sessionKey;
    try {
      exam = (await loadExamEncrypted(id, key)) || null;
      const subs = await submissionRepository.getByExamId(id, key);
      submissionCount = subs.length;
    } catch (e) {
      console.error(e);
    }
  }

  $: isSetupActive = pathname === `/exam/${examId}` || pathname === `/exam/${examId}/`;
  $: isScanActive = pathname.startsWith(`/exam/${examId}/scan`);
  $: isGradeActive = pathname.startsWith(`/exam/${examId}/grade`);
  $: isStatsActive = pathname.startsWith(`/exam/${examId}/stats`);
</script>

<div class="exam-layout">
  {#if exam}
    <div class="exam-header-bar">
      <div class="header-main">
        <h2>{exam.title || "Exam"}</h2>
        <span class="meta">
          {exam.testart || "Kurzarbeit"} | Klasse: {exam.klasse || "-"} | Fach: {exam.fach || "-"} | Datum: {exam.datum || "-"}
        </span>
      </div>
      <a href="/" class="back-link">← Back to Dashboard</a>
    </div>

    <div class="exam-workflow-tabs">
      <a href="/exam/{examId}" class="tab-btn" class:active={isSetupActive}>1. Setup & Exercises</a>
      <a href="/exam/{examId}/scan" class="tab-btn" class:active={isScanActive}>2. Scan Ingestion ({submissionCount})</a>
      <a href="/exam/{examId}/grade" class="tab-btn" class:active={isGradeActive}>3. Anonymous Grading</a>
      <a href="/exam/{examId}/stats" class="tab-btn highlight" class:active={isStatsActive}>📊 4. Analysis & Statistics</a>
    </div>
  {/if}

  <div class="exam-content">
    <slot />
  </div>
</div>

<style>
  .exam-layout {
    padding: 2rem;
    max-width: 1400px;
    width: 95%;
    margin: 0 auto;
  }

  .exam-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.25rem;
  }

  .header-main h2 {
    margin: 0 0 0.35rem 0;
    font-size: 1.85rem;
    color: #38bdf8;
  }

  .meta {
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .back-link {
    color: #94a3b8;
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
  }

  .back-link:hover {
    color: #38bdf8;
  }

  .exam-workflow-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 2rem;
    background: #1e293b;
    padding: 0.4rem;
    border-radius: 8px;
    border: 1px solid #334155;
  }

  .tab-btn {
    flex: 1;
    text-align: center;
    padding: 0.65rem 0.85rem;
    color: #cbd5e1;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.875rem;
    border-radius: 6px;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .tab-btn:hover {
    background: #334155;
    color: white;
  }

  .tab-btn.active {
    background: #0284c7;
    color: white;
    font-weight: 600;
  }

  .tab-btn.highlight {
    color: #38bdf8;
  }

  .tab-btn.highlight:hover {
    background: rgba(2, 132, 199, 0.2);
  }

  .exam-content {
    width: 100%;
  }
</style>
