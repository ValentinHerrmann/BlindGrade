<script lang="ts">
  import { isUnlocked, sessionStore } from '$lib/stores/session';
  import { db } from '$lib/db/db';
  import type { ExamRecord } from '$lib/db/schema';
  import { loadExamsEncrypted, saveExamEncrypted } from '$lib/db/dbEncryption';
  import { unpackProject } from '$lib/archive/unpacker';
  import { checkRetention, type RetentionCheckResult } from '$lib/gdpr/retention';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  let exams: ExamRecord[] = [];
  let isImporting = false;
  let importStatus = '';
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
    if (!$isUnlocked) {
      await sessionStore.initAnonymousSession();
    }
    await refreshExams();
  });

  async function refreshExams() {
    const key = get(sessionStore).sessionKey;
    exams = await loadExamsEncrypted(key);
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
    await db.submissions.where('examId').equals(expiredExam.exam.id).delete();
    await db.students.where('examId').equals(expiredExam.exam.id).delete();
    expiredExam = null;
    await refreshExams();
  }
</script>

<div class="dashboard">
  {#if !$isUnlocked}
    <div class="locked-state">
      <h2>Session Locked</h2>
      <p>Please unlock your session to access projects.</p>
      <a href="/unlock" class="unlock-link">Unlock Session</a>
    </div>
  {:else}
    <div class="dashboard-header">
      <h2>Exams Dashboard</h2>
      <div class="header-actions">
        <label for="importFile" class="import-btn">
          {isImporting ? 'Importing...' : 'Import .bgproj'}
        </label>
        <input type="file" id="importFile" accept=".bgproj" on:change={handleImportArchive} disabled={isImporting} hidden />
        <a href="/exam/new" class="create-btn">+ Create New Exam</a>
      </div>
    </div>

    {#if importStatus}
      <div class="import-status">{importStatus}</div>
    {/if}

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
      <div class="empty-state">
        <p>No exams found in current session.</p>
        <p class="sub">Create a new exam or import a .bgproj archive above.</p>
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
            <div class="exam-card">
              <h3>{exam.title}</h3>
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
              </div>
              <p class="date">Retention until: {exam.retentionUntil}</p>
              <div class="actions">
                <a href="/exam/{exam.id}">Open Exam</a>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>


<style>
  .dashboard {
    padding: 2rem;
    max-width: 1000px;
    margin: 0 auto;
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

  .exam-card h3 {
    margin: 0 0 0.5rem 0;
    color: #38bdf8;
  }

  .exam-card .date {
    font-size: 0.875rem;
    color: #94a3b8;
    margin-bottom: 1rem;
  }

  .exam-card .actions a {
    color: #38bdf8;
    text-decoration: none;
    font-weight: 500;
  }
</style>
