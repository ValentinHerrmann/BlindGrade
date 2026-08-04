<script lang="ts">
  import { page } from "$app/stores";
  export let params;
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { afterNavigate } from "$app/navigation";
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

  $: if (browser && examId && $sessionStore.sessionKey) {
    loadExamHeaderData(examId);
  }

  afterNavigate(() => {
    if (examId && $sessionStore.sessionKey) {
      loadExamHeaderData(examId);
    }
  });

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

<div class="exam-layout" class:is-grading={isGradeActive}>
  {#if exam && !isGradeActive}
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
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0.75rem 1.25rem;
    max-width: 100%;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .exam-layout.is-grading {
    padding: 0;
    height: 100%;
  }

  .exam-header-bar {
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .header-main h2 {
    margin: 0 0 0.15rem 0;
    font-size: 1.35rem;
    color: #38bdf8;
  }

  .meta {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .back-link {
    color: #94a3b8;
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .back-link:hover {
    color: #38bdf8;
  }

  .exam-workflow-tabs {
    flex-shrink: 0;
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
    background: #1e293b;
    padding: 0.25rem;
    border-radius: 8px;
    border: 1px solid #334155;
  }

  .tab-btn {
    flex: 1;
    text-align: center;
    padding: 0.4rem 0.65rem;
    color: #cbd5e1;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.825rem;
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
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
  }
</style>
