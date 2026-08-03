<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { sessionStore, isUnlocked } from '$lib/stores/session';
  import { db } from '$lib/db/db';
  import type { ExamRecord } from '$lib/db/schema';
import { loadExamsEncrypted, decryptExercise, decryptScore } from '$lib/db/dbEncryption';
  import { submissionRepository } from '$lib/repositories/submissionRepository';

  interface ExercisePerformance {
    id: string;
    name: string;
    topicTag?: string;
    grade?: string;
    subject?: string;
    totalAppeared: number;
    avgScorePercent: number | null;
    flaggedProblematic: boolean;
  }

  interface VariantDetail {
    exerciseId: string;
    variantKey: string;
    name: string;
    maxPoints: number;
    totalAppeared: number;
    avgScorePercent: number | null;
  }

  interface VariantGroupComparison {
    groupId: string;
    groupName: string;
    topicTag?: string;
    variants: VariantDetail[];
    maxDeltaPercent: number | null;
    flaggedFairnessIssue: boolean;
  }

  let isInitializing = true;
  let exams: ExamRecord[] = [];
  let exerciseStats: ExercisePerformance[] = [];
  let variantGroups: VariantGroupComparison[] = [];
  let overallAvgScore: number | null = null;
  let totalSubmissionsCount = 0;
  let gradedSubmissionsCount = 0;
  let showAllExercises = false;

  $: displayedExerciseStats = showAllExercises
    ? exerciseStats
    : exerciseStats.filter((e) => e.avgScorePercent !== null);

  onMount(async () => {
    try {
      if (!$isUnlocked) {
        await sessionStore.initAnonymousSession();
      }
      await loadAnalytics();
    } finally {
      isInitializing = false;
    }
  });

  async function loadAnalytics() {
    const key = get(sessionStore).sessionKey;
    exams = await loadExamsEncrypted(key);

    const rawExercises = await db.exercises.toArray();
    const allExercises = await Promise.all(rawExercises.map((ex) => decryptExercise(ex, key)));
    const allExamExercises = await db.examExercises.toArray();
    const allSubmissions = await submissionRepository.getAll(key);
    const rawScores = await db.exerciseScores.toArray();
    const allScores = await Promise.all(rawScores.map((sc) => decryptScore(sc, key)));

    totalSubmissionsCount = allSubmissions.length;

    // Filter submissions that have been graded
    const gradedSubmissions = allSubmissions.filter(
      (s) => typeof s.totalScore === 'number' && !isNaN(s.totalScore)
    );
    gradedSubmissionsCount = gradedSubmissions.length;

    if (gradedSubmissionsCount > 0) {
      const sum = gradedSubmissions.reduce((acc, s) => acc + (s.totalScore || 0), 0);
      overallAvgScore = Math.round(sum / gradedSubmissionsCount);
    } else {
      overallAvgScore = null;
    }

    const validExamIds = new Set(exams.map((e) => e.id));

    // Map exercise IDs to parent exam IDs using examExercises junction table
    const examMapByExercise = new Map<string, Set<string>>();
    for (const ee of allExamExercises) {
      if (validExamIds.has(ee.examId)) {
        if (!examMapByExercise.has(ee.exerciseId)) {
          examMapByExercise.set(ee.exerciseId, new Set());
        }
        examMapByExercise.get(ee.exerciseId)!.add(ee.examId);
      }
    }

    // Group scores by exercise ID
    const scoresByExercise = new Map<string, number[]>();
    for (const sc of allScores) {
      if (typeof sc.score === 'number' && !isNaN(sc.score)) {
        if (!scoresByExercise.has(sc.exerciseId)) {
          scoresByExercise.set(sc.exerciseId, []);
        }
        scoresByExercise.get(sc.exerciseId)!.push(sc.score);
      }
    }

    // 1. Aggregate stats by exercise group key (group ID, name, or distinct ID)
    const exGroupMap = new Map<string, {
      name: string;
      tag?: string;
      grade?: string;
      subject?: string;
      examIds: Set<string>;
      scores: number[];
      maxPoints: number;
    }>();

    for (const ex of allExercises) {
      const groupKey = ex.exerciseGroupId || (ex.name && ex.name.trim() ? ex.name.trim() : null) || ex.id;
      const displayName = ex.name || ex.title || (ex.topicTag ? `${ex.topicTag} Question` : `Question ${ex.id.substring(0, 6)}`);

      if (!exGroupMap.has(groupKey)) {
        exGroupMap.set(groupKey, {
          name: displayName,
          tag: ex.topicTag,
          grade: ex.grade,
          subject: ex.subject,
          examIds: new Set<string>(),
          scores: [],
          maxPoints: ex.maxPoints || 10,
        });
      }

      const group = exGroupMap.get(groupKey)!;

      // Add linked active exam IDs
      const linkedExams = examMapByExercise.get(ex.id);
      if (linkedExams) {
        linkedExams.forEach((eId) => {
          if (validExamIds.has(eId)) group.examIds.add(eId);
        });
      }
      if (ex.examId && validExamIds.has(ex.examId)) {
        group.examIds.add(ex.examId);
      }

      // Add scores
      const exScores = scoresByExercise.get(ex.id);
      if (exScores) {
        group.scores.push(...exScores);
      }
    }

    // Build final performance list (only exercises linked to at least 1 active exam)
    const list: ExercisePerformance[] = [];

    exGroupMap.forEach((group, key) => {
      if (group.examIds.size === 0) return; // Skip unlinked library items

      let avgScorePct: number | null = null;
      let isProblematic = false;

      if (group.scores.length > 0 && group.maxPoints > 0) {
        const sumScores = group.scores.reduce((a, b) => a + b, 0);
        const avgRaw = sumScores / group.scores.length;
        avgScorePct = Math.min(100, Math.max(0, Math.round((avgRaw / group.maxPoints) * 100)));
        isProblematic = avgScorePct < 60;
      }

      list.push({
        id: key,
        name: group.name,
        topicTag: group.tag,
        grade: group.grade,
        subject: group.subject,
        totalAppeared: group.examIds.size,
        avgScorePercent: avgScorePct,
        flaggedProblematic: isProblematic,
      });
    });

    // Sort: Problematic first, then by score percentage, then by name
    exerciseStats = list.sort((a, b) => {
      if (a.avgScorePercent === null && b.avgScorePercent === null) return a.name.localeCompare(b.name);
      if (a.avgScorePercent === null) return 1;
      if (b.avgScorePercent === null) return -1;
      return a.avgScorePercent - b.avgScorePercent;
    });

    // 2. Build Variant Group Comparisons (for questions with multiple variants)
    const vGroupMap = new Map<string, {
      name: string;
      tag?: string;
      variants: Map<string, {
        exerciseId: string;
        variantKey: string;
        name: string;
        maxPoints: number;
        examIds: Set<string>;
        scores: number[];
      }>;
    }>();

    for (const ex of allExercises) {
      const gId = ex.exerciseGroupId || (ex.variantKey ? (ex.name || ex.title || ex.id) : null);
      if (!gId) continue;

      const vKey = ex.variantKey || 'Default Variant';
      const displayName = ex.name || ex.title || 'Untitled Exercise';

      if (!vGroupMap.has(gId)) {
        vGroupMap.set(gId, {
          name: displayName,
          tag: ex.topicTag,
          variants: new Map(),
        });
      }

      const vGroup = vGroupMap.get(gId)!;

      if (!vGroup.variants.has(vKey)) {
        vGroup.variants.set(vKey, {
          exerciseId: ex.id,
          variantKey: vKey,
          name: displayName,
          maxPoints: ex.maxPoints || 10,
          examIds: new Set<string>(),
          scores: [],
        });
      }

      const vItem = vGroup.variants.get(vKey)!;

      const linkedExams = examMapByExercise.get(ex.id);
      if (linkedExams) {
        linkedExams.forEach((eId) => {
          if (validExamIds.has(eId)) vItem.examIds.add(eId);
        });
      }
      if (ex.examId && validExamIds.has(ex.examId)) {
        vItem.examIds.add(ex.examId);
      }

      const exScores = scoresByExercise.get(ex.id);
      if (exScores) {
        vItem.scores.push(...exScores);
      }
    }

    const vList: VariantGroupComparison[] = [];

    vGroupMap.forEach((gData, gId) => {
      const variants: VariantDetail[] = [];
      const validPercents: number[] = [];

      gData.variants.forEach((vData) => {
        let avgPct: number | null = null;
        if (vData.scores.length > 0 && vData.maxPoints > 0) {
          const sum = vData.scores.reduce((a, b) => a + b, 0);
          avgPct = Math.min(100, Math.max(0, Math.round(((sum / vData.scores.length) / vData.maxPoints) * 100)));
          validPercents.push(avgPct);
        }

        variants.push({
          exerciseId: vData.exerciseId,
          variantKey: vData.variantKey,
          name: vData.name,
          maxPoints: vData.maxPoints,
          totalAppeared: vData.examIds.size,
          avgScorePercent: avgPct,
        });
      });

      let delta: number | null = null;
      let isFairnessIssue = false;
      if (validPercents.length >= 2) {
        delta = Math.max(...validPercents) - Math.min(...validPercents);
        isFairnessIssue = delta >= 15; // 15% discrepancy between variants
      }

      vList.push({
        groupId: gId,
        groupName: gData.name,
        topicTag: gData.tag,
        variants: variants.sort((a, b) => a.variantKey.localeCompare(b.variantKey)),
        maxDeltaPercent: delta,
        flaggedFairnessIssue: isFairnessIssue,
      });
    });

    variantGroups = vList;
  }
</script>

<div class="analytics-container">
  <div class="analytics-header">
    <div>
      <h1>Global Multi-Exam Analytics</h1>
      <p class="subtitle">Cross-exam performance tracking, exercise quality metrics & variant comparison</p>
    </div>
  </div>

  {#if isInitializing}
    <div class="loading-state">
      <p>Loading analytics data across all exams...</p>
    </div>
  {:else if !$isUnlocked}
    <div class="locked-state">
      <h2>Session Locked</h2>
      <p>Please unlock your session to access global analytics.</p>
      <a href="/unlock" class="unlock-link">Unlock Session</a>
    </div>
  {:else}
    <!-- KPI Overview Row -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-title">Total Analyzed Exams</span>
        <span class="kpi-value">{exams.length}</span>
      </div>

      <div class="kpi-card">
        <span class="kpi-title">Submissions Processed</span>
        <span class="kpi-value">{totalSubmissionsCount}</span>
        <span class="kpi-sub">({gradedSubmissionsCount} graded)</span>
      </div>

      <div class="kpi-card">
        <span class="kpi-title">Avg. Score (pts)</span>
        <span class="kpi-value">
          {overallAvgScore !== null ? `${overallAvgScore} pts` : 'N/A'}
        </span>
        <span class="kpi-sub">{overallAvgScore !== null ? 'Across graded exams' : 'No scores recorded'}</span>
      </div>

      <div class="kpi-card danger-card">
        <span class="kpi-title">Flagged Exercises (&lt; 60%)</span>
        <span class="kpi-value">{exerciseStats.filter((e) => e.flaggedProblematic).length}</span>
      </div>
    </div>

    {#if gradedSubmissionsCount === 0}
      <div class="notice-banner">
        ℹ️ <strong>No graded submissions recorded yet.</strong> As student scans are uploaded and scored, real-time cross-exam averages, quality metrics, and variant difficulty comparisons will automatically calculate below.
      </div>
    {/if}

    <div class="analytics-sections-grid">
      <!-- Section 1: Variant Fairness & Difficulty Comparison -->
      <div class="section-card margin-bottom">
      <div class="section-header-row">
        <div class="section-title-group">
          <h3>🔀 Exercise Variant Difficulty & Fairness Comparison</h3>
          <p>Compare performance between different question variants (e.g. Gruppe A vs Gruppe B) to detect unintended difficulty imbalances.</p>
        </div>
      </div>

      {#if variantGroups.length === 0}
        <div class="empty-analytics-box">
          <div class="empty-icon">🔀</div>
          <h4>No Multi-Variant Exercise Groups Configured</h4>
          <p>
            When you create exercises with variants (e.g. Variant A & Variant B for different test groups), side-by-side fairness ratings and difficulty delta metrics will appear here.
          </p>
        </div>
      {:else}
        <div class="variant-groups-list">
          {#each variantGroups as vGroup}
            <div class="variant-group-card" class:fairness-warning={vGroup.flaggedFairnessIssue}>
              <div class="variant-group-header">
                <div>
                  <h4>{vGroup.groupName}</h4>
                  {#if vGroup.topicTag}
                    <span class="tag">{vGroup.topicTag}</span>
                  {/if}
                </div>
                {#if vGroup.maxDeltaPercent !== null}
                  <div class="delta-badge" class:warning={vGroup.flaggedFairnessIssue}>
                    {#if vGroup.flaggedFairnessIssue}
                      ⚠️ {vGroup.maxDeltaPercent}% Difficulty Disparity
                    {:else}
                      ✓ {vGroup.maxDeltaPercent}% Variance (Balanced)
                    {/if}
                  </div>
                {:else}
                  <span class="status-badge neutral">Awaiting Grading Scores</span>
                {/if}
              </div>

              <table class="analytics-table compact">
                <thead>
                  <tr>
                    <th>Variant Key</th>
                    <th>Max Points</th>
                    <th>Avg Score %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {#each vGroup.variants as v}
                    <tr>
                      <td class="variant-key-cell">
                        <span class="variant-badge">{v.variantKey}</span>
                      </td>
                      <td>{v.maxPoints} Pkt</td>
                      <td>
                        {#if v.avgScorePercent !== null}
                          <div class="score-bar-container">
                            <div
                              class="score-bar"
                              style="width: {v.avgScorePercent}%"
                              class:low-bar={v.avgScorePercent < 60}
                            ></div>
                            <span class="score-text">{v.avgScorePercent}%</span>
                          </div>
                        {:else}
                          <span class="no-data-text">N/A (Not Graded)</span>
                        {/if}
                      </td>
                      <td>
                        {#if v.avgScorePercent === null}
                          <span class="status-badge neutral">No Graded Data</span>
                        {:else if v.avgScorePercent < 60}
                          <span class="status-badge danger">Harder Variant</span>
                        {:else}
                          <span class="status-badge success">Normal Range</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Section 2: Cross-Exam Exercise Quality Metrics -->
    <div class="section-card">
      <div class="section-header-row">
        <div class="section-title-group">
          <h3>📈 Exercise & Question Quality Metrics</h3>
          <p>Identify questions that consistently produce low average scores across multiple years or exam sessions.</p>
        </div>

        {#if exerciseStats.some((e) => e.avgScorePercent === null)}
          <button
            class="toggle-btn"
            on:click={() => (showAllExercises = !showAllExercises)}
          >
            {showAllExercises ? 'Show Only Graded Exercises' : 'Show All Exercises (Inc. Ungraded)'}
          </button>
        {/if}
      </div>

      {#if displayedExerciseStats.length === 0}
        <div class="empty-analytics-box">
          <div class="empty-icon">📊</div>
          <h4>No Graded Exercise Performance Data Available</h4>
          <p>
            {#if exerciseStats.length > 0}
              {exerciseStats.length} question(s) are linked across your {exams.length} exam(s), but none have student grades recorded yet.
            {:else}
              No exercises have been linked to your exams yet.
            {/if}
          </p>
          {#if exerciseStats.length > 0}
            <button
              class="secondary-toggle-btn"
              on:click={() => (showAllExercises = !showAllExercises)}
            >
              {showAllExercises ? 'Hide Ungraded Exercises' : `Show All ${exerciseStats.length} Linked Questions`}
            </button>
          {/if}
        </div>
      {:else}
        <table class="analytics-table">
          <thead>
            <tr>
              <th>Exercise Name</th>
              <th>Topic Tag</th>
              <th>Exams Included</th>
              <th>Avg Score %</th>
              <th>Quality Status</th>
            </tr>
          </thead>
          <tbody>
            {#each displayedExerciseStats as ex}
              <tr class:problematic-row={ex.flaggedProblematic}>
                <td class="ex-name">{ex.name}</td>
                <td><span class="tag">{ex.topicTag || 'General'}</span></td>
                <td>{ex.totalAppeared} Exam(s)</td>
                <td>
                  {#if ex.avgScorePercent !== null}
                    <div class="score-bar-container">
                      <div
                        class="score-bar"
                        style="width: {ex.avgScorePercent}%"
                        class:low-bar={ex.flaggedProblematic}
                      ></div>
                      <span class="score-text">{ex.avgScorePercent}%</span>
                    </div>
                  {:else}
                    <span class="no-data-text">N/A (Not Graded)</span>
                  {/if}
                </td>
                <td>
                  {#if ex.avgScorePercent === null}
                    <span class="status-badge neutral">No Graded Data</span>
                  {:else if ex.flaggedProblematic}
                    <span class="status-badge danger">⚠️ High Failure Rate</span>
                  {:else}
                    <span class="status-badge success">✓ Balanced</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
    </div>
  {/if}
</div>

<style>
  .analytics-container {
    padding: 2rem;
    width: 100%;
    box-sizing: border-box;
    color: #f8fafc;
  }

  .analytics-sections-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  @media (max-width: 1199px) {
    .analytics-sections-grid {
      grid-template-columns: 1fr;
    }
  }

  .analytics-header {
    margin-bottom: 2rem;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    color: #38bdf8;
  }

  .subtitle {
    margin: 0.35rem 0 0 0;
    color: #94a3b8;
    font-size: 0.95rem;
  }

  .loading-state,
  .locked-state {
    text-align: center;
    padding: 4rem 2rem;
    background: #1e293b;
    border-radius: 12px;
    border: 1px dashed #334155;
  }

  .unlock-link {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.625rem 1.25rem;
    background: #0284c7;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
  }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .kpi-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .kpi-card.danger-card {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
  }

  .kpi-title {
    font-size: 0.8rem;
    font-weight: 500;
    color: #94a3b8;
  }

  .kpi-value {
    font-size: 2rem;
    font-weight: 800;
    color: #f8fafc;
  }

  .kpi-sub {
    font-size: 0.75rem;
    color: #64748b;
  }

  .notice-banner {
    background: #1e293b;
    border: 1px solid #0284c7;
    color: #cbd5e1;
    padding: 0.85rem 1.25rem;
    border-radius: 8px;
    margin-bottom: 2rem;
    font-size: 0.9rem;
  }

  .section-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 1.75rem;
  }

  .section-card.margin-bottom {
    margin-bottom: 0;
  }

  .section-header-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .section-title-group h3 {
    margin: 0 0 0.35rem 0;
    font-size: 1.25rem;
    color: #f8fafc;
  }

  .section-title-group p {
    margin: 0;
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .toggle-btn {
    background: #334155;
    color: #38bdf8;
    border: 1px solid #0284c7;
    padding: 0.45rem 0.85rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;
  }

  .toggle-btn:hover {
    background: #0284c7;
    color: white;
  }

  .empty-analytics-box {
    text-align: center;
    padding: 3rem 1.5rem;
    background: #0f172a;
    border: 1px dashed #334155;
    border-radius: 10px;
    margin-top: 1rem;
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .empty-analytics-box h4 {
    margin: 0 0 0.5rem 0;
    font-size: 1.15rem;
    color: #f8fafc;
  }

  .empty-analytics-box p {
    margin: 0 0 1.25rem 0;
    font-size: 0.9rem;
    color: #94a3b8;
    max-width: 540px;
    margin-left: auto;
    margin-right: auto;
  }

  .secondary-toggle-btn {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .secondary-toggle-btn:hover {
    background: #0369a1;
  }

  .variant-groups-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .variant-group-card {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 1.25rem;
  }

  .variant-group-card.fairness-warning {
    border-color: #eab308;
  }

  .variant-group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .variant-group-header h4 {
    margin: 0 0 0.25rem 0;
    font-size: 1.1rem;
    color: #38bdf8;
  }

  .delta-badge {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.3rem 0.75rem;
    border-radius: 6px;
    background: #1e293b;
    color: #10b981;
    border: 1px solid #047857;
  }

  .delta-badge.warning {
    background: rgba(234, 179, 8, 0.15);
    color: #fef08a;
    border-color: #eab308;
  }

  .variant-key-cell {
    width: 130px;
  }

  .variant-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.2rem 0.55rem;
    background: #0284c7;
    color: white;
    border-radius: 4px;
  }

  .analytics-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .analytics-table.compact td,
  .analytics-table.compact th {
    padding: 0.65rem 0.85rem;
  }

  .analytics-table th {
    text-align: left;
    padding: 0.75rem 1rem;
    background: #0f172a;
    color: #cbd5e1;
    border-bottom: 1px solid #334155;
    font-weight: 600;
  }

  .analytics-table td {
    padding: 0.85rem 1rem;
    border-bottom: 1px solid #334155;
    color: #cbd5e1;
  }

  .problematic-row {
    background: rgba(239, 68, 68, 0.05);
  }

  .ex-name {
    font-weight: 600;
    color: #f8fafc;
  }

  .tag {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 4px;
    color: #38bdf8;
  }

  .score-bar-container {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 160px;
  }

  .score-bar {
    height: 8px;
    background: #10b981;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .score-bar.low-bar {
    background: #ef4444;
  }

  .score-text {
    font-weight: 600;
    font-size: 0.85rem;
  }

  .no-data-text {
    color: #64748b;
    font-size: 0.85rem;
    font-style: italic;
  }

  .status-badge {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
  }

  .status-badge.danger {
    background: #7f1d1d;
    color: #fecdd3;
  }

  .status-badge.success {
    background: #064e3b;
    color: #a7f3d0;
  }

  .status-badge.neutral {
    background: #334155;
    color: #94a3b8;
  }
</style>
