<script lang="ts">
  import { db } from '$lib/db/db';
  import { eraseStudent } from '$lib/gdpr/erasure';
  import { wipeDatabase } from '$lib/db/hygiene';
  import { sessionStore } from '$lib/stores/session';
  import type { StudentRecord } from '$lib/db/schema';
  import { onMount } from 'svelte';

  let students: StudentRecord[] = [];
  let isErasing = false;
  let statusMsg = '';

  onMount(async () => {
    students = await db.students.toArray();
  });

  async function handleEraseStudent(pseudonymId: string, examId: string) {
    if (!confirm('Are you sure you want to permanently erase this student identity and all submissions?')) return;
    isErasing = true;
    try {
      await eraseStudent(pseudonymId, examId);
      students = students.filter((s) => s.pseudonymId !== pseudonymId);
      statusMsg = `Student ${pseudonymId} successfully erased.`;
    } catch (err: any) {
      alert(`Erasure failed: ${err.message}`);
    } finally {
      isErasing = false;
    }
  }

  async function handleClearAllSessionData() {
    if (!confirm('Wipe all local session data from IndexedDB?')) return;
    await wipeDatabase();
    sessionStore.lock();
    window.location.href = '/unlock';
  }
</script>

<div class="settings-page">
  <h2>Settings & GDPR Compliance</h2>

  {#if statusMsg}
    <div class="status-banner">{statusMsg}</div>
  {/if}

  <div class="card">
    <h3>GDPR Art. 17 — Manage Student Identities & Erasure</h3>
    {#if students.length === 0}
      <p class="empty">No student identity records stored in current session.</p>
    {:else}
      <table class="students-table">
        <thead>
          <tr>
            <th>Pseudonym ID</th>
            <th>Fallback Code</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {#each students as st}
            <tr>
              <td class="mono">{st.pseudonymId}</td>
              <td>{st.fallbackCode}</td>
              <td>
                <button class="erase-btn" on:click={() => handleEraseStudent(st.pseudonymId, st.examId)} disabled={isErasing}>
                  Erase (Art. 17)
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="card danger-card">
    <h3>Session Data Hygiene</h3>
    <p>Permanently clear all cached exam, student, and scan data from local browser storage.</p>
    <button class="clear-btn" on:click={handleClearAllSessionData}>Clear All Session Data</button>
  </div>
</div>

<style>
  .settings-page {
    max-width: 900px;
    margin: 2rem auto;
    padding: 1rem;
  }

  h2 { color: #38bdf8; }

  .card {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    margin-bottom: 2rem;
    border: 1px solid #334155;
  }

  .danger-card { border-color: #ef4444; }

  .students-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
  }

  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid #334155;
  }

  .mono { font-family: monospace; font-size: 0.875rem; color: #38bdf8; }

  .erase-btn {
    background: #ef4444;
    color: white;
    border: none;
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .clear-btn {
    background: #dc2626;
    color: white;
    font-weight: 600;
    border: none;
    padding: 0.75rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .status-banner {
    background: rgba(34, 197, 94, 0.2);
    color: #86efac;
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1.5rem;
  }

  .empty { color: #94a3b8; font-size: 0.875rem; }
</style>
