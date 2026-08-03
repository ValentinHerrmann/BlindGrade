<script lang="ts">
  import { isUnlocked, isAuthenticated, sessionStore } from '$lib/stores/session';
  import { db } from '$lib/db/db';
  import type { ExamRecord } from '$lib/db/schema';
  import { loadExamsEncrypted, saveExamEncrypted, encryptExam, encryptExercise } from '$lib/db/dbEncryption';
  import { unpackProject } from '$lib/archive/unpacker';
  import { clearAllTables } from '$lib/db/db';
  import { projectStore } from '$lib/stores/project';
  import { checkRetention, type RetentionCheckResult } from '$lib/gdpr/retention';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  import { storagePolicyStore } from '$lib/stores/storagePolicy';
  import { api } from '$lib/api/client';
  import { examRepository } from '$lib/repositories/examRepository';
  import { submissionRepository } from '$lib/repositories/submissionRepository';
  import { offlineQueue } from '$lib/services/offlineQueue';
  import { goto } from '$app/navigation';


  let exams: ExamRecord[] = [];
  let examStatsMap = new Map<string, { avgScore: number | null; count: number }>();
  let isImporting = false;
  let importStatus = '';
  let isInitializing = true;
  let expiredExam: { exam: ExamRecord; check: RetentionCheckResult } | null = null;

  let searchQuery = '';
  let selectedGradeFilter = 'ALL';
  let selectedSubjectFilter = 'ALL';

  $: availableGrades = Array.from(
    new Set(exams.map((e) => e.klasse).filter((k): k is string => Boolean(k)))
  ).sort();

  $: availableSubjects = Array.from(
    new Set(exams.map((e) => e.fach).filter((f): f is string => Boolean(f)))
  ).sort();

  $: filteredExams = exams.filter((e) => {
    const matchesGrade = selectedGradeFilter === 'ALL' || e.klasse === selectedGradeFilter;
    const matchesSubject = selectedSubjectFilter === 'ALL' || e.fach === selectedSubjectFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      (e.title && e.title.toLowerCase().includes(q)) ||
      (e.klasse && e.klasse.toLowerCase().includes(q)) ||
      (e.fach && e.fach.toLowerCase().includes(q)) ||
      (e.testart && e.testart.toLowerCase().includes(q));
    return matchesGrade && matchesSubject && matchesSearch;
  });

  onMount(async () => {
    try {
      if (!$isUnlocked) {
        await sessionStore.initAnonymousSession();
      }
      await refreshExams();
    } finally {
      isInitializing = false;
    }
  });

  async function refreshExams() {
    const key = get(sessionStore).sessionKey;
    const localExams = await loadExamsEncrypted(key);

    if ($isAuthenticated && $storagePolicyStore.storageMode !== 'all-local') {
      try {
        const remoteExamsRaw = (await api.get('/exams')) as any[];
        const remoteExams: ExamRecord[] = remoteExamsRaw.map((e: any) => ({
          id: e.id,
          teacherId: e.teacher_id,
          title: e.title,
          testart: e.testart || undefined,
          klasse: e.klasse || undefined,
          datum: e.datum || undefined,
          nr: e.nr || undefined,
          fach: e.fach || undefined,
          lehrernachname: e.lehrernachname || undefined,
          infoText: e.info_text || undefined,
          latexTemplate: e.latex_template || '',
          compilationStatus: e.compilation_status || 'pending',
          retentionUntil: e.retention_until || '',
          createdAt: e.created_at || new Date().toISOString(),
        }));

        // Check offline queue for pending exam creations
        const pendingQueue = get(offlineQueue);
        const pendingExamIds = new Set(
          pendingQueue
            .filter((req) => req.url === '/exams' && req.method === 'POST' && req.body?.id)
            .map((req) => req.body.id)
        );

        // Merge remote and local exams (preserve only local IDB exams pending offline sync)
        const remoteIds = new Set(remoteExams.map((e) => e.id));
        const pendingLocalExams = localExams.filter((e) => !remoteIds.has(e.id) && pendingExamIds.has(e.id));
        const deletedStaleExams = localExams.filter((e) => !remoteIds.has(e.id) && !pendingExamIds.has(e.id));

        // Purge deleted/stale exams from local IDB
        for (const stale of deletedStaleExams) {
          await db.exams.delete(stale.id);
          await db.exercises.where('examId').equals(stale.id).delete();
          await db.examExercises.where('examId').equals(stale.id).delete();
        }

        exams = [...remoteExams, ...pendingLocalExams];

        const encryptedExams = await Promise.all(exams.map((ex) => encryptExam(ex, key)));
        await db.exams.bulkPut(encryptedExams);


        // Also sync remote exercises and junction records to IndexedDB for offline export
        const remoteExercises: any[] = [];
        const junctionRecords: any[] = [];
        for (const e of remoteExamsRaw) {
          if (Array.isArray(e.exercises)) {
            for (let idx = 0; idx < e.exercises.length; idx++) {
              const ex = e.exercises[idx];
              const orderIndex = ex.order_index ?? (idx + 1);
              remoteExercises.push({
                id: ex.id,
                teacherId: ex.teacher_id,
                name: ex.name,
                topicTag: ex.topic_tag,
                grade: ex.grade,
                subject: ex.subject,
                latexBody: ex.latex_body,
                maxPoints: ex.max_points,
                version: ex.version || 1,
                questionType: ex.question_type || 'free_text',
                penalty: ex.penalty || 0,
                exerciseGroupId: ex.exercise_group_id,
                variantKey: ex.variant_key,
                isCurrent: ex.is_current,
              });
              junctionRecords.push({
                examId: e.id,
                exerciseId: ex.id,
                orderIndex,
              });
            }
          }
        }
        if (remoteExercises.length > 0) {
          const encExercises = await Promise.all(remoteExercises.map((ex) => encryptExercise(ex, key)));
          await db.exercises.bulkPut(encExercises);
        }
        if (junctionRecords.length > 0) {
          await db.examExercises.bulkPut(junctionRecords);
        }
      } catch (apiErr) {
        console.warn('Failed to fetch remote exams, falling back to IDB:', apiErr);
        exams = localExams;
      }
    } else {
      exams = localExams;
    }

    try {
      const allSubmissions = await submissionRepository.getAll(key);
      const tempMap = new Map<string, { sum: number; count: number }>();
      for (const s of allSubmissions) {
        if (typeof s.totalScore === 'number' && !isNaN(s.totalScore)) {
          const curr = tempMap.get(s.examId) || { sum: 0, count: 0 };
          curr.sum += s.totalScore;
          curr.count += 1;
          tempMap.set(s.examId, curr);
        }
      }
      const newStats = new Map<string, { avgScore: number | null; count: number }>();
      for (const [eId, data] of tempMap.entries()) {
        if (data.count > 0) {
          newStats.set(eId, {
            avgScore: Math.round((data.sum / data.count) * 10) / 10,
            count: data.count,
          });
        }
      }
      examStatsMap = newStats;
    } catch (e) {
      console.warn('Could not load submission stats for dashboard:', e);
    }

    for (const exam of exams) {
      if (exam.retentionUntil) {
        const check = checkRetention(exam.retentionUntil);
        if (check.isExpired) {
          expiredExam = { exam, check };
          break;
        }
      }
    }
  }

  async function handleImportArchive(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    const password = prompt('Enter password to decrypt and import .bgproj archive:');
    if (!password) return;

    isImporting = true;
    importStatus = 'Decrypting & unpacking archive...';

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await clearAllTables();
      projectStore.clear();
      const res = await unpackProject(buffer, password, (p) => {
        importStatus = `Status: ${p.stage} (${p.current}%)`;
      });



      alert(`Import successful! Loaded ${res.examCount} exam(s) and ${res.submissionCount} submission(s).`);
      await refreshExams();
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    } finally {
      isImporting = false;
      importStatus = '';
      input.value = '';
    }
  }

  async function handleExtendRetention() {
    if (!expiredExam) return;
    const newDate = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0];
    expiredExam.exam.retentionUntil = newDate;
    const key = get(sessionStore).sessionKey;
    await saveExamEncrypted(expiredExam.exam, key);
    expiredExam = null;
    await refreshExams();
  }

  async function handleDeleteExpiredExam() {
    if (!expiredExam) return;
    await db.exams.delete(expiredExam.exam.id);
    await db.exercises.where('examId').equals(expiredExam.exam.id).delete();
    await db.examExercises.where('examId').equals(expiredExam.exam.id).delete();
    await db.submissions.where('examId').equals(expiredExam.exam.id).delete();
    await db.students.where('examId').equals(expiredExam.exam.id).delete();
    expiredExam = null;
    await refreshExams();
  }

  async function handleDeleteDashboardExam(id: string, title?: string) {
    if (!confirm(`Are you sure you want to delete exam "${title || 'Untitled'}"?`)) return;
    try {
      await examRepository.delete(id);
      await refreshExams();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }
</script>

<div class="dashboard">
  {#if isInitializing}
    <div class="loading-state">
      <p>Initializing local session...</p>
    </div>
  {:else if !$isUnlocked}
    <div class="locked-state">
      <h2>Session Locked</h2>
      <p>Please unlock your session to access projects.</p>
      <a href="/unlock" class="unlock-link">Unlock Session</a>
    </div>
  {:else}
    <div class="dashboard-header">
      <div>
        <h2>Exams Dashboard</h2>
        <p class="header-subtitle">Manage, grade, and analyze your Schulaufgabe exams</p>
      </div>
      <div class="header-actions">
        <label for="importFile" class="import-btn">
          {isImporting ? 'Importing...' : '📂 Import .bgproj'}
        </label>
        <input type="file" id="importFile" accept=".bgproj" on:change={handleImportArchive} disabled={isImporting} hidden />
        <a href="/exam/new" class="create-btn">➕ Create New Exam</a>
      </div>
    </div>

    {#if importStatus}
      <div class="import-status">{importStatus}</div>
    {/if}

    <div class="dashboard-body">
      <div class="kpi-sidebar">
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-title">Total Exams</span>
            <span class="kpi-value">{exams.length}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-title">Configured Subjects</span>
            <span class="kpi-value">{availableSubjects.length}</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-title">Grade Levels</span>
            <span class="kpi-value">{availableGrades.length}</span>
          </div>
          <div class="kpi-card highlight">
            <span class="kpi-title">Global Analytics</span>
            <a href="/analytics" class="kpi-link">View Multi-Exam Stats →</a>
          </div>
        </div>
      </div>

      <div class="exam-main">
        {#if expiredExam}
          <div class="modal-overlay">
            <div class="modal-card">
              <h3>GDPR Retention Warning (Art. 5)</h3>
              <p>
                Exam <strong>{expiredExam.exam.title}</strong> passed its retention period on
                <strong>{expiredExam.exam.retentionUntil}</strong> ({Math.abs(expiredExam.check.daysRemaining)} days ago).
              </p>
              <p>Would you like to extend retention by 1 year or permanently delete local project data?</p>
              <div class="modal-actions">
                <button class="delete-btn" on:click={handleDeleteExpiredExam}>Delete Data</button>
                <button class="extend-btn" on:click={handleExtendRetention}>Extend Retention (+1 Year)</button>
              </div>
            </div>
          </div>
        {/if}

        {#if exams.length === 0}
          <div class="onboarding-card">
            <div class="onboarding-icon">🎓</div>
            <h3>Welcome to Examance!</h3>
            <p>You don't have any exams in your workspace yet. Follow these quick steps to get started:</p>

            <div class="onboarding-steps">
              <div class="step-item">
                <span class="step-num">1</span>
                <div class="step-text">
                  <strong>Create an Exam</strong>
                  <p>Configure LaTeX template, total points, and grade thresholds.</p>
                </div>
              </div>

              <div class="step-item">
                <span class="step-num">2</span>
                <div class="step-text">
                  <strong>Link Exercises</strong>
                  <p>Add questions from your Exercise Library or create new ones.</p>
                </div>
              </div>

              <div class="step-item">
                <span class="step-num">3</span>
                <div class="step-text">
                  <strong>Scan & Grade</strong>
                  <p>Upload student PDFs, anonymously score, and review analytics.</p>
                </div>
              </div>
            </div>

            <div class="onboarding-actions">
              <a href="/exam/new" class="create-btn">+ Create First Exam</a>
              <label for="importFile" class="import-btn">Or Import .bgproj Archive</label>
            </div>
          </div>
        {:else}
          <div class="dashboard-filter-bar">
            <input
              type="text"
              placeholder="Search exams by title, class, subject..."
              bind:value={searchQuery}
              class="dashboard-search-input"
            />

            {#if availableGrades.length > 0}
              <div class="select-group">
                <label for="dashboard-grade">Grade:</label>
                <select id="dashboard-grade" bind:value={selectedGradeFilter}>
                  <option value="ALL">All Grades</option>
                  {#each availableGrades as g}
                    <option value={g}>Grade {g}</option>
                  {/each}
                </select>
              </div>
            {/if}

            {#if availableSubjects.length > 0}
              <div class="select-group">
                <label for="dashboard-subject">Subject:</label>
                <select id="dashboard-subject" bind:value={selectedSubjectFilter}>
                  <option value="ALL">All Subjects</option>
                  {#each availableSubjects as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </div>
            {/if}
          </div>

          {#if filteredExams.length === 0}
            <div class="empty-state">
              <p>No exams match your search or filter criteria.</p>
            </div>
          {:else}
            <div class="exams-grid">
              {#each filteredExams as exam}
                {@const stats = examStatsMap.get(exam.id)}
                <div
                  class="exam-card clickable-card"
                  role="button"
                  tabindex="0"
                  on:click={() => goto(`/exam/${exam.id}`)}
                  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto(`/exam/${exam.id}`); } }}
                >
                  <h3>{exam.title || 'Untitled Exam'}</h3>
                  <div class="exam-tags">
                    {#if exam.klasse}
                      <span class="exam-tag grade-tag">Klasse {exam.klasse}</span>
                    {/if}
                    {#if exam.fach}
                      <span class="exam-tag subject-tag">{exam.fach}</span>
                    {/if}
                    {#if exam.testart}
                      <span class="exam-tag testart-tag">{exam.testart}</span>
                    {/if}
                    {#if stats?.avgScore !== undefined && stats.avgScore !== null}
                      <span class="exam-tag avg-grade-tag">Ø {stats.avgScore} Pkt</span>
                    {/if}
                  </div>
                  {#if exam.datum}
                    <p class="date">Datum: {exam.datum}</p>
                  {:else if exam.createdAt}
                    <p class="date">Datum: {new Date(exam.createdAt).toLocaleDateString()}</p>
                  {/if}
                  {#if exam.retentionUntil}
                    <p class="retention-info">Retention until: {exam.retentionUntil}</p>
                  {/if}
                  <div class="actions">
                    <a href="/exam/{exam.id}" on:click|stopPropagation>Open Exam</a>
                    <button class="card-delete-btn" on:click|stopPropagation={() => handleDeleteDashboardExam(exam.id, exam.title)}>Delete</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>



<style>
  .dashboard {
    padding: 1.5rem;
    width: 100%;
    box-sizing: border-box;
  }

  .dashboard-body {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  .kpi-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .exam-main {
    min-width: 0;
  }

  @media (max-width: 1199px) {
    .dashboard-body {
      grid-template-columns: 1fr;
    }
    .kpi-sidebar .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.75rem;
    }
  }

  .header-subtitle {
    margin: 0.35rem 0 0 0;
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .kpi-grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .kpi-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .kpi-card.highlight {
    border-color: #0284c7;
    background: rgba(2, 132, 199, 0.1);
  }

  .kpi-title {
    font-size: 0.8rem;
    font-weight: 500;
    color: #94a3b8;
  }

  .kpi-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: #f8fafc;
  }

  .kpi-link {
    font-size: 0.9rem;
    font-weight: 600;
    color: #38bdf8;
    text-decoration: none;
    margin-top: auto;
  }

  .kpi-link:hover {
    text-decoration: underline;
  }

  .onboarding-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 2.5rem 2rem;
    text-align: center;
    max-width: 680px;
    margin: 2rem auto;
  }

  .onboarding-icon {
    font-size: 3rem;
    margin-bottom: 0.5rem;
  }

  .onboarding-card h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    color: #38bdf8;
  }

  .onboarding-card p {
    color: #cbd5e1;
    font-size: 0.95rem;
    margin-bottom: 2rem;
  }

  .onboarding-steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1.25rem;
    margin-bottom: 2rem;
    text-align: left;
  }

  .step-item {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .step-num {
    width: 28px;
    height: 28px;
    background: #0284c7;
    color: white;
    font-weight: 700;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
  }

  .step-text strong {
    color: #f8fafc;
    font-size: 0.9rem;
    display: block;
    margin-bottom: 0.25rem;
  }

  .step-text p {
    margin: 0;
    font-size: 0.8rem;
    color: #94a3b8;
    line-height: 1.35;
  }

  .onboarding-actions {
    display: flex;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  h2 {
    margin: 0;
    font-size: 1.75rem;
    color: #f8fafc;
  }

  .header-actions {
    display: flex;
    gap: 1rem;
    align-items: center;
  }

  .import-btn {
    padding: 0.625rem 1.25rem;
    background: #334155;
    color: white;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .import-btn:hover {
    background: #475569;
  }

  .create-btn, .unlock-link {
    padding: 0.625rem 1.25rem;
    background: #0284c7;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
  }

  .create-btn:hover, .unlock-link:hover {
    background: #0369a1;
  }

  .import-status {
    background: #0f172a;
    border: 1px solid #0284c7;
    color: #38bdf8;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
    font-size: 0.875rem;
  }

  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.75);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
  }

  .modal-card {
    background: #1e293b;
    border: 1px solid #eab308;
    padding: 2rem;
    border-radius: 12px;
    max-width: 480px;
  }

  .modal-card h3 {
    margin-top: 0;
    color: #fef08a;
  }

  .modal-actions {
    display: flex;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .delete-btn {
    background: #ef4444;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .extend-btn {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.625rem 1.25rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }


  .locked-state, .empty-state {
    text-align: center;
    padding: 4rem 2rem;
    background: #1e293b;
    border-radius: 12px;
    border: 1px dashed #334155;
  }

  .empty-state p {
    font-size: 1.125rem;
    color: #94a3b8;
  }

  .empty-state .sub {
    font-size: 0.875rem;
    color: #64748b;
  }

  .dashboard-filter-bar {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .dashboard-search-input {
    flex: 1;
    min-width: 240px;
    padding: 0.625rem 0.875rem;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    color: white;
  }

  .select-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #cbd5e1;
    font-size: 0.875rem;
  }

  .select-group select {
    background: #1e293b;
    border: 1px solid #334155;
    color: white;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
  }

  .exam-tags {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .exam-tag {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
  }

  .grade-tag {
    background: #1e1b4b;
    color: #c7d2fe;
    border: 1px solid #4338ca;
  }

  .subject-tag {
    background: #064e3b;
    color: #a7f3d0;
    border: 1px solid #047857;
  }

  .testart-tag {
    background: #334155;
    color: #e2e8f0;
  }

  .avg-grade-tag {
    background: #0284c7;
    color: #e0f2fe;
    font-weight: 600;
  }

  .exams-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .exam-card {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 8px;
    border: 1px solid #334155;
  }

  .exam-card.clickable-card {
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .exam-card.clickable-card:hover {
    border-color: #38bdf8;
    background: #24334a;
  }

  .exam-card h3 {
    margin: 0 0 0.5rem 0;
    color: #38bdf8;
  }

  .exam-card .date {
    font-size: 0.875rem;
    color: #cbd5e1;
    margin-bottom: 0.25rem;
  }

  .exam-card .retention-info {
    font-size: 0.75rem;
    color: #64748b;
    margin-bottom: 1rem;
  }

  .exam-card .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .exam-card .actions a {
    color: #38bdf8;
    text-decoration: none;
    font-weight: 500;
  }

  .card-delete-btn {
    background: transparent;
    color: #ef4444;
    border: 1px solid #ef4444;
    padding: 0.25rem 0.625rem;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .card-delete-btn:hover {
    background: #ef4444;
    color: white;
  }
</style>
