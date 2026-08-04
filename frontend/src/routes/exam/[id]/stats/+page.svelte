<script lang="ts">
  import { page } from '$app/stores';
  export let params;
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import type { ExamRecord, SubmissionRecord, StudentRecord } from '$lib/db/schema';
  import { loadExamEncrypted } from '$lib/db/dbEncryption';
  import { submissionRepository } from '$lib/repositories/submissionRepository';
  import { studentRepository } from '$lib/repositories/studentRepository';
  import { sessionStore } from '$lib/stores/session';
  import { calculateSummaryStats, type SummaryStats } from '$lib/analytics/stats';
  import { exportGradesToCsv } from '$lib/analytics/csvExport';
  import { get } from 'svelte/store';

  $: examId = $page.params.id || '';

  let exam: ExamRecord | null = null;
  let submissions: SubmissionRecord[] = [];
  let students: StudentRecord[] = [];
  let stats: SummaryStats | null = null;
  let showConfirmModal = false;

  $: if (browser && examId && $sessionStore.sessionKey) {
    loadStats(examId);
  }

  afterNavigate(() => {
    if (examId && $sessionStore.sessionKey) {
      loadStats(examId);
    }
  });

  onMount(async () => {
    if (examId && $sessionStore.sessionKey) {
      await loadStats(examId);
    }
  });

  async function loadStats(id: string) {
    if (!id) return;
    const key = get(sessionStore).sessionKey;
    exam = (await loadExamEncrypted(id, key)) || null;
    submissions = await submissionRepository.getByExamId(id, key);
    students = await studentRepository.getByExamId(id, key);

    const scores = submissions
      .map((s) => s.totalScore)
      .filter((s): s is number => s !== undefined && s !== null);

    stats = calculateSummaryStats(scores);
  }

  $: maxBinCount = stats ? Math.max(...stats.histogram.map((b) => b.count), 1) : 1;

  async function confirmAndExport() {
    showConfirmModal = false;
    const key = get(sessionStore).sessionKey;
    const rows = students.map((st) => {
      const sub = submissions.find((s) => s.pseudonymHash === st.pseudonymId);
      return {
        studentPseudonymId: st.pseudonymId,
        fallbackCode: st.fallbackCode || '',
        totalScore: sub?.totalScore ?? 'N/A',
      };
    });

    await exportGradesToCsv(examId, exam?.title || 'Exam', rows, key);
  }
</script>

<div class="stats-page">
  <h2>Class Grade Analytics & Export</h2>

  {#if stats}
    <div class="stats-grid">
      <div class="stat-card">
        <span class="label">Submissions</span>
        <span class="value">{stats.count}</span>
      </div>
      <div class="stat-card">
        <span class="label">Mean Score</span>
        <span class="value">{stats.mean}</span>
      </div>
      <div class="stat-card">
        <span class="label">Std Deviation</span>
        <span class="value">{stats.stdDev}</span>
      </div>
      <div class="stat-card">
        <span class="label">Median</span>
        <span class="value">{stats.median}</span>
      </div>
    </div>

    <div class="histogram-section">
      <h3>Score Distribution</h3>
      <div class="bars">
        {#each stats.histogram as bin}
          <div class="bar-col">
            <span class="count">{bin.count}</span>
            <div class="bar" style="height: {Math.round((bin.count / maxBinCount) * 160)}px"></div>
            <span class="range">{bin.binStart} - {bin.binEnd}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="export-section">
    <button class="export-btn" on:click={() => (showConfirmModal = true)}>
      Export Grades CSV (Excel Compatible)
    </button>
  </div>

  {#if showConfirmModal}
    <div class="modal-overlay">
      <div class="modal-card">
        <h3>Confirm Data Export</h3>
        <p>
          You are exporting unencrypted student grade data to CSV.
          An immutable audit log entry will be created capturing this action.
        </p>
        <div class="modal-actions">
          <button class="cancel-btn" on:click={() => (showConfirmModal = false)}>Cancel</button>
          <button class="confirm-btn" on:click={confirmAndExport}>
            I confirm I am authorized to export this data
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .stats-page {
    padding: 1.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  h2 { color: #38bdf8; }

  .k-suppressed-banner {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid #eab308;
    color: #fef08a;
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: #1e293b;
    padding: 1.25rem;
    border-radius: 8px;
    text-align: center;
    border: 1px solid #334155;
  }

  .stat-card .label { font-size: 0.75rem; color: #94a3b8; display: block; }
  .stat-card .value { font-size: 1.75rem; font-weight: 700; color: #38bdf8; }

  .histogram-section {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
  }

  .bars {
    display: flex;
    justify-content: space-around;
    align-items: flex-end;
    height: 280px;
    margin-top: 1rem;
  }

  .bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .bar {
    width: 40px;
    background: #0284c7;
    border-radius: 4px 4px 0 0;
    min-height: 4px;
  }

  .range { font-size: 0.75rem; color: #94a3b8; }

  .export-btn {
    padding: 0.875rem 1.5rem;
    background: #0284c7;
    color: white;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .modal-card {
    background: #1e293b;
    padding: 2rem;
    border-radius: 10px;
    max-width: 450px;
  }

  .modal-actions {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .cancel-btn { background: #334155; }
  .confirm-btn { background: #0284c7; }
</style>
