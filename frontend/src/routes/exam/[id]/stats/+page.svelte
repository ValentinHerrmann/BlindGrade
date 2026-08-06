<script lang="ts">
  import { page } from '$app/stores';
  export let params;
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { afterNavigate } from '$app/navigation';
  import type { ExamRecord, ExerciseRecord, SubmissionRecord, StudentRecord, ExerciseScoreRecord } from '$lib/db/schema';
  import {
    loadExamEncrypted,
    loadExamExercisesEncrypted,
    decryptScore,
  } from '$lib/db/dbEncryption';
  import { submissionRepository } from '$lib/repositories/submissionRepository';
  import { studentRepository } from '$lib/repositories/studentRepository';
  import { sessionStore } from '$lib/stores/session';
  import {
    calculateSummaryStats,
    calculateSubmissionPercentage,
    calculatePercentageHistogram,
    type SummaryStats,
    type PercentageHistogramBin,
  } from '$lib/analytics/stats';
  import {
    calculateGradeDistribution,
    getPresetCutoffs,
    type GradeDistributionBucket,
  } from '$lib/analytics/gradingKey';
  import { exportGradesToCsv } from '$lib/analytics/csvExport';
  import { get } from 'svelte/store';
  import { db } from '$lib/db/db';

  $: examId = $page.params.id || '';

  let exam: ExamRecord | null = null;
  let exercises: ExerciseRecord[] = [];
  let submissions: SubmissionRecord[] = [];
  let students: StudentRecord[] = [];
  let stats: SummaryStats | null = null;
  let showConfirmModal = false;

  // Percentage-based stats (includes partially graded)
  let percentageBins: PercentageHistogramBin[] = [];
  let gradeBuckets: GradeDistributionBucket[] = [];
  let meanPercentage = 0;
  let medianPercentage = 0;
  let stdDevPercentage = 0;
  // Raw percentages array, used reactively to recalculate grade distribution when grading key changes
  let allPercentages: number[] = [];

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
    exercises = await loadExamExercisesEncrypted(id, key);
    submissions = await submissionRepository.getByExamId(id, key);
    students = await studentRepository.getByExamId(id, key);

    // --- Legacy stats based on fully graded totalScore ---
    const scores = submissions
      .map((s) => s.totalScore)
      .filter((s): s is number => s !== undefined && s !== null);
    stats = calculateSummaryStats(scores);

    // --- Percentage-based stats including partially graded submissions ---
    const exerciseMaxPoints = exercises.map((ex) => ex.maxPoints || 0);

    // Load and decrypt all exercise scores, grouped by submissionId
    const rawAllScores = await db.exerciseScores.toArray();
    const decryptedScores = await Promise.all(
      rawAllScores.map((sc) => decryptScore(sc, key))
    );
    const scoresBySubmission = new Map<string, ExerciseScoreRecord[]>();
    for (const sc of decryptedScores) {
      if (!scoresBySubmission.has(sc.submissionId)) {
        scoresBySubmission.set(sc.submissionId, []);
      }
      scoresBySubmission.get(sc.submissionId)!.push(sc);
    }

    const percentages: number[] = [];

    for (const sub of submissions) {
      const rawScores = scoresBySubmission.get(sub.id) || [];
      // Build a map of exerciseId -> score
      const scoreMap = new Map<string, number>();
      for (const rs of rawScores) {
        if (typeof rs.score === 'number' && !isNaN(rs.score)) {
          scoreMap.set(rs.exerciseId, rs.score);
        }
      }

      // Build ordered score array matching exercise order
      const orderedScores = exercises.map((ex) => scoreMap.get(ex.id) ?? null);
      const entry = calculateSubmissionPercentage(exerciseMaxPoints, orderedScores);
      if (entry) {
        percentages.push(entry.percentage);
      }
    }

    // Store raw percentages for reactive grade recalculation
    allPercentages = percentages;

    // Calculate percentage histogram
    percentageBins = calculatePercentageHistogram(percentages);

    // Calculate grade distribution based on exam's grading key
    gradeBuckets = calculateGradeDistribution(percentages, exam?.gradingKey);

    // Calculate mean/median/stdDev of percentages
    if (percentages.length > 0) {
      const sorted = [...percentages].sort((a, b) => a - b);
      const sum = percentages.reduce((a, b) => a + b, 0);
      meanPercentage = Math.round((sum / percentages.length) * 10) / 10;
      const variance = percentages.reduce((acc, x) => acc + Math.pow(x - meanPercentage, 2), 0) / percentages.length;
      stdDevPercentage = Math.round(Math.sqrt(variance) * 10) / 10;
      const mid = Math.floor(percentages.length / 2);
      medianPercentage = percentages.length % 2 !== 0
        ? Math.round(sorted[mid] * 10) / 10
        : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
    } else {
      meanPercentage = 0;
      medianPercentage = 0;
      stdDevPercentage = 0;
    }
  }

  $: fullyGradedCount = submissions.filter(
    (s) => typeof s.totalScore === 'number' && !isNaN(s.totalScore)
  ).length;

  $: submissionsWithAnyGrade = percentageBins.reduce((sum, b) => sum + b.count, 0);

  $: maxBinCount = percentageBins.length > 0 ? Math.max(...percentageBins.map((b) => b.count), 1) : 1;

  // Reactive: recalculate grade distribution whenever grading key or percentages change
  // Fall back to default linear_50 grading key if none is configured
  $: {
    const effectiveKey = exam?.gradingKey || { preset: 'linear_50' as const, cutoffs: getPresetCutoffs('linear_50') };
    gradeBuckets = calculateGradeDistribution(allPercentages, effectiveKey);
  }
  $: maxGradeCount = gradeBuckets.length > 0 ? Math.max(...gradeBuckets.map((b) => b.count), 1) : 1;

  async function confirmAndExport() {
    showConfirmModal = false;
    const key = get(sessionStore).sessionKey;
    const rows = students.map((st) => {
      const sub = submissions.find((s) => s.pseudonymHash === st.pseudonymId);
      return {
        studentPseudonymId: st.pseudonymId,
        fallbackCode: st.fallbackCode || '',
        totalScore: typeof sub?.totalScore === 'number' ? sub.totalScore : 'Ungraded',
      };
    });

    await exportGradesToCsv(examId, exam?.title || 'Exam', rows, key);
  }
</script>

<div class="stats-page">
  <h2>Class Grade Analytics & Export</h2>

  {#if submissions.length > 0}
    <div class="status-banner">
      <span>
        Status: <strong>{submissionsWithAnyGrade} von {submissions.length}</strong> Abgaben mit mindestens einer korrigierten Aufgabe.
      </span>
      {#if fullyGradedCount < submissionsWithAnyGrade}
        <span class="partial-indicator">
          ({submissionsWithAnyGrade - fullyGradedCount} teilweise korrigiert, {fullyGradedCount} vollständig)
        </span>
      {/if}
      {#if submissionsWithAnyGrade < submissions.length}
        <span class="pending-indicator">
          ({submissions.length - submissionsWithAnyGrade} noch nicht begonnen)
        </span>
      {/if}
    </div>
  {/if}

  {#if submissionsWithAnyGrade > 0}
    <!-- Percentage-based Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="label">Submissions (mit Noten)</span>
        <span class="value">{submissionsWithAnyGrade}</span>
      </div>
      <div class="stat-card">
        <span class="label">Ø Prozent</span>
        <span class="value">{meanPercentage}%</span>
      </div>
      <div class="stat-card">
        <span class="label">StdAbw</span>
        <span class="value">{stdDevPercentage}%</span>
      </div>
      <div class="stat-card">
        <span class="label">Median</span>
        <span class="value">{medianPercentage}%</span>
      </div>
    </div>

    <!-- Percentage Histogram -->
    <div class="histogram-section">
      <h3>📊 Prozentverteilung</h3>
      <div class="bars">
        {#each percentageBins as bin}
          <div class="bar-col">
            <span class="count">{bin.count}</span>
            <div class="bar" style="height: {Math.round((bin.count / maxBinCount) * 160)}px"></div>
            <span class="range">{bin.binStart}-{bin.binEnd}%</span>
          </div>
        {/each}
      </div>
    </div>

  <!-- Grade Distribution Bar Diagram -->
  {#if gradeBuckets.length > 0}
    <div class="grade-distribution-section">
      <h3>🎯 Notenverteilung</h3>
      <p class="grading-key-label">
        Bewertungsmaßstab: {exam?.gradingKey?.preset === 'linear_50' ? 'Linear (50%)' : exam?.gradingKey?.preset === 'linear_40' ? 'Linear (40%)' : exam?.gradingKey?.preset === 'even_split' ? 'Gleichmäßig' : exam?.gradingKey ? 'Benutzerdefiniert' : 'Standard (50%)'}
      </p>
        <div class="grade-bars">
          {#each gradeBuckets as bucket}
            <div class="grade-bar-row">
              <div class="grade-label">
                <span class="grade-number">{bucket.grade}</span>
                <span class="grade-text">{bucket.label}</span>
              </div>
              <div class="grade-bar-track">
                <div
                  class="grade-bar-fill"
                  style="width: {Math.max(bucket.count > 0 ? (bucket.count / maxGradeCount) * 100 : 0)}%"
                ></div>
              </div>
              <span class="grade-count">{bucket.count}</span>
            </div>
          {/each}
        </div>
      </div>
  {/if}
  {:else}
    <div class="empty-stats">
      <p>Noch keine Aufgaben korrigiert. Die Statistiken erscheinen hier, sobald du mit der Korrektur beginnst.</p>
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

  .status-banner {
    margin-bottom: 1rem;
    color: #94a3b8;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .partial-indicator {
    color: #fbbf24;
  }

  .pending-indicator {
    color: #64748b;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
    margin-bottom: 2rem;
  }

  @media (max-width: 768px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
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

  .histogram-section h3 {
    margin-top: 0;
    color: #f8fafc;
  }

  .bars {
    display: flex;
    justify-content: space-around;
    align-items: flex-end;
    height: 200px;
    margin-top: 1rem;
    padding: 0 0.5rem;
  }

  .bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    flex: 1;
  }

  .bar-col .count {
    font-size: 0.8rem;
    font-weight: 600;
    color: #cbd5e1;
  }

  .bar {
    width: 32px;
    background: #0284c7;
    border-radius: 4px 4px 0 0;
    min-height: 3px;
    transition: height 0.2s ease;
  }

  .bar-col:hover .bar {
    background: #38bdf8;
  }

  .range {
    font-size: 0.7rem;
    color: #64748b;
  }

  /* Grade Distribution */
  .grade-distribution-section {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 8px;
    margin-bottom: 2rem;
  }

  .grade-distribution-section h3 {
    margin-top: 0;
    color: #f8fafc;
  }

  .grading-key-label {
    font-size: 0.8rem;
    color: #64748b;
    margin-bottom: 1rem;
  }

  .grade-bars {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .grade-bar-row {
    display: grid;
    grid-template-columns: 120px 1fr 40px;
    align-items: center;
    gap: 0.75rem;
  }

  .grade-label {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .grade-number {
    font-size: 1.25rem;
    font-weight: 700;
    color: #38bdf8;
    line-height: 1;
  }

  .grade-text {
    font-size: 0.7rem;
    color: #94a3b8;
  }

  .grade-bar-track {
    width: 100%;
    height: 24px;
    background: #0f172a;
    border-radius: 4px;
    overflow: hidden;
  }

  .grade-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #0284c7, #38bdf8);
    border-radius: 4px;
    transition: width 0.3s ease;
    min-width: 0;
  }

  .grade-bar-row:hover .grade-bar-fill {
    background: linear-gradient(90deg, #0369a1, #7dd3fc);
  }

  .grade-count {
    font-size: 0.95rem;
    font-weight: 600;
    color: #cbd5e1;
    text-align: right;
  }

  .empty-stats {
    background: #1e293b;
    padding: 2rem;
    border-radius: 8px;
    margin-bottom: 2rem;
    text-align: center;
    color: #64748b;
    border: 1px dashed #334155;
  }

  .export-btn {
    padding: 0.875rem 1.5rem;
    background: #0284c7;
    color: white;
    font-weight: 600;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .export-btn:hover {
    background: #0369a1;
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
    border: 1px solid #334155;
  }

  .modal-card h3 {
    color: #38bdf8;
    margin-top: 0;
  }

  .modal-card p {
    color: #cbd5e1;
  }

  .modal-actions {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .cancel-btn, .confirm-btn {
    padding: 0.625rem 1rem;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    color: white;
  }

  .cancel-btn { background: #334155; }
  .cancel-btn:hover { background: #475569; }
  .confirm-btn { background: #0284c7; }
  .confirm-btn:hover { background: #0369a1; }
</style>