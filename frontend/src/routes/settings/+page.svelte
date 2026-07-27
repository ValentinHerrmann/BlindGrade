<script lang="ts">
  import { db } from "$lib/db/db";
  import { eraseStudent } from "$lib/gdpr/erasure";
  import { wipeDatabase } from "$lib/db/hygiene";
  import { sessionStore, isUnlocked } from "$lib/stores/session";
  import { loadStudentsEncrypted } from "$lib/db/dbEncryption";
  import { get } from "svelte/store";
  import {
    storagePolicyStore,
    getStoragePolicyLabel,
    type StoragePolicy,
  } from "$lib/stores/storagePolicy";
  import type { StudentRecord } from "$lib/db/schema";
  import {
    checkUnsyncedLocalCount,
    syncLocalDataToServer,
    downloadBackupAndPurgeServer,
    restoreServerData,
    type UnsyncedCounts,
  } from "$lib/services/migrationService";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";

  let students: StudentRecord[] = [];
  let isErasing = false;
  let statusMsg = "";

  // Migration modal state (Local -> Server)
  let showMigrationModal = false;
  let unsyncedCounts: UnsyncedCounts = {
    unsyncedExams: 0,
    unsyncedExercises: 0,
    unsyncedStudents: 0,
    unsyncedSubmissions: 0,
    total: 0,
  };
  let isSyncing = false;
  let syncProgressMsg = "";

  // Purge modal state (Server -> Local)
  let showPurgeModal = false;
  let purgePassword = "";
  let isPurging = false;
  let isRestoring = false;
  let showPurgeConfirmClose = false;

  function requestClosePurgeModal() {
    if (purgePassword) {
      showPurgeConfirmClose = true;
    } else {
      forceClosePurgeModal();
    }
  }

  function forceClosePurgeModal() {
    showPurgeConfirmClose = false;
    showPurgeModal = false;
    purgePassword = "";
  }

  onMount(async () => {
    if (!$isUnlocked) {
      goto("/unlock");
      return;
    }
    const key = get(sessionStore).sessionKey;
    students = await loadStudentsEncrypted(key);
  });

  async function handlePolicyChange(newPolicy: StoragePolicy) {
    if (newPolicy === $storagePolicyStore) return;

    if (newPolicy === "server-synced") {
      // Local -> Server transition: check unsynced counts
      const counts = await checkUnsyncedLocalCount();
      if (counts.total > 0) {
        unsyncedCounts = counts;
        showMigrationModal = true;
        return;
      }
    } else if (newPolicy === "local-only") {
      // Server -> Local transition: offer backup & purge modal
      showPurgeModal = true;
      return;
    }

    storagePolicyStore.setPolicy(newPolicy);
    statusMsg = `Personal data storage policy set to: ${getStoragePolicyLabel(newPolicy)}`;
  }

  async function startMigration() {
    isSyncing = true;
    try {
      await syncLocalDataToServer((step, current, total) => {
        syncProgressMsg = `${step} (${current}/${total})...`;
      });
      storagePolicyStore.setPolicy("server-synced");
      statusMsg = "All local data successfully synced to server!";
      showMigrationModal = false;
    } catch (err: any) {
      alert(`Migration failed: ${err.message}`);
    } finally {
      isSyncing = false;
      syncProgressMsg = "";
    }
  }

  function skipMigration() {
    storagePolicyStore.setPolicy("server-synced");
    statusMsg = `Storage policy changed to: ${getStoragePolicyLabel("server-synced")}`;
    showMigrationModal = false;
  }

  async function startPurgeAndBackup() {
    if (!purgePassword) {
      alert("Please enter a password for deriving the backup encryption key.");
      return;
    }
    isPurging = true;
    try {
      const result = await downloadBackupAndPurgeServer(purgePassword);
      storagePolicyStore.setPolicy("local-only");
      statusMsg = `Backup downloaded! ${result.purgedStudents} student records and ${result.purgedSubmissions} submissions soft-deleted on server (7-day retention until ${result.retentionUntil}).`;
      showPurgeModal = false;
      purgePassword = "";
    } catch (err: any) {
      alert(`Backup/Purge failed: ${err.message}`);
    } finally {
      isPurging = false;
    }
  }

  async function handleRestoreServerData() {
    isRestoring = true;
    try {
      const res = await restoreServerData();
      statusMsg = `Restored ${res.restoredStudents} student identities and ${res.restoredSubmissions} submissions on server!`;
      showPurgeModal = false;
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    } finally {
      isRestoring = false;
    }
  }

  async function handleEraseStudent(pseudonymId: string, examId: string) {
    if (
      !confirm(
        "Are you sure you want to permanently erase this student identity and all submissions?",
      )
    )
      return;
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
    if (!confirm("Wipe all local session data from IndexedDB?")) return;
    await wipeDatabase();
    sessionStore.lock();
    window.location.href = "/unlock";
  }
</script>

{#if $isUnlocked}
  <div class="settings-page">
    <h2>Settings & GDPR Compliance</h2>

    {#if statusMsg}
      <div class="status-banner">{statusMsg}</div>
    {/if}

    <div class="card" id="storage-policy">
      <h3>Data Storage & Privacy Policy</h3>
      <p class="description">
        Select where LaTeX templates and student data are stored:
      </p>
      <div class="policy-options">
        <label
          class="option-card"
          class:active={$storagePolicyStore === "local-only"}
        >
          <input
            type="radio"
            name="storagePolicy"
            value="local-only"
            checked={$storagePolicyStore === "local-only"}
            on:change={() => handlePolicyChange("local-only")}
          />
          <div>
            <strong
              >Latex on server + Student data local only (download before
              logout!)</strong
            >
            <p>
              LaTeX compilation runs on server. Student identities & scans
              remain exclusively in browser IndexedDB. Make sure to download
              after each session as data might be lost after logout!
            </p>
          </div>
        </label>

        <label
          class="option-card"
          class:active={$storagePolicyStore === "server-synced"}
        >
          <input
            type="radio"
            name="storagePolicy"
            value="server-synced"
            checked={$storagePolicyStore === "server-synced"}
            on:change={() => handlePolicyChange("server-synced")}
          />
          <div>
            <strong>Latex on server + Student data encrypted on server</strong>
            <p>
              LaTeX compilation runs on server. Student identities are
              AES-256-GCM encrypted client-side before syncing to database.
              Nobody except you can decrypt them; not even server admins.
            </p>
          </div>
        </label>
      </div>
    </div>

    <div class="card">
      <h3>GDPR Art. 17 — Manage Student Identities & Erasure</h3>
      {#if students.length === 0}
        <p class="empty">
          No student identity records stored in current session.
        </p>
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
                  <button
                    class="erase-btn"
                    on:click={() =>
                      handleEraseStudent(st.pseudonymId, st.examId)}
                    disabled={isErasing}
                  >
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
      <p>
        Permanently clear all cached exam, student, and scan data from local
        browser storage.
      </p>
      <button class="clear-btn" on:click={handleClearAllSessionData}
        >Clear All Session Data</button
      >
    </div>
  </div>

  {#if showMigrationModal}
    <div class="modal-backdrop">
      <div class="modal-card">
        <h3>Sync Local Data to Server</h3>
        <p>Found local items in browser storage:</p>
        <ul class="counts-list">
          <li><strong>{unsyncedCounts.unsyncedExams}</strong> exams</li>
          <li><strong>{unsyncedCounts.unsyncedExercises}</strong> exercises</li>
          <li>
            <strong>{unsyncedCounts.unsyncedStudents}</strong> student identities
          </li>
          <li>
            <strong>{unsyncedCounts.unsyncedSubmissions}</strong> scan submissions
          </li>
        </ul>
        <p class="modal-note">
          Syncing uploads your local data to the server. Student identities are
          AES-256-GCM encrypted client-side before upload.
        </p>
        {#if syncProgressMsg}
          <div class="progress-status">{syncProgressMsg}</div>
        {/if}
        <div class="modal-actions">
          <button
            class="primary-btn"
            on:click={startMigration}
            disabled={isSyncing}
          >
            {isSyncing ? "Syncing..." : "Sync All Local Data to Server"}
          </button>
          <button
            class="secondary-btn"
            on:click={skipMigration}
            disabled={isSyncing}
          >
            Skip Migration
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showPurgeModal}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="-1"
      on:click|self={requestClosePurgeModal}
      on:keydown|self={(e) => e.key === "Escape" && requestClosePurgeModal()}
    >
      <div class="modal-card">
        <h3>Switch to Local-Only & Server Student Data Purge</h3>
        <p>
          Switching to <strong>Local-Only</strong> mode will download an
          encrypted <code>.bgproj</code> archive backup of all your exams and remove
          active student data from your account on the server.
        </p>
        <div class="retention-notice">
          <strong>Data Retention Notes:</strong>
          <ul>
            <li>
              <strong>Student Data Purge</strong>: Student identities, scans,
              and grades will be soft-deleted on the server with a
              <strong>7-day temporary retention backup</strong> (for accidental recovery)
              before permanent deletion.
            </li>
            <li>
              <strong>LaTeX Templates</strong>: Anonymized LaTeX exercise code
              and exam preambles will
              <strong>remain stored on the server</strong> to preserve your reusable
              exercise library and allow server-side compilation.
            </li>
          </ul>
        </div>

        <div class="password-field">
          <label for="purge-password">Backup Encryption Password:</label>
          <input
            id="purge-password"
            type="password"
            placeholder="Enter password for backup key derivation"
            bind:value={purgePassword}
          />
        </div>

        <div class="modal-actions">
          <button
            class="danger-btn"
            on:click={startPurgeAndBackup}
            disabled={isPurging || !purgePassword}
          >
            {isPurging
              ? "Downloading & Purging..."
              : "Download Backup & Purge Server Student Data"}
          </button>
          <button
            class="secondary-btn"
            on:click={requestClosePurgeModal}
            disabled={isPurging}
          >
            Cancel
          </button>
        </div>

        <hr class="modal-divider" />

        <div class="restore-section">
          <p class="restore-hint">
            Made a mistake? You can restore soft-deleted student data within 7
            days.
          </p>
          <button
            class="restore-btn"
            on:click={handleRestoreServerData}
            disabled={isRestoring}
          >
            {isRestoring ? "Restoring..." : "Restore Soft-Deleted Student Data"}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<ConfirmDialog
  isOpen={showPurgeConfirmClose}
  title="Discard Backup Password?"
  message="You have entered a backup encryption password. Are you sure you want to cancel without purging?"
  confirmText="Discard & Cancel"
  cancelText="Keep Editing"
  on:confirm={forceClosePurgeModal}
  on:cancel={() => (showPurgeConfirmClose = false)}
/>

<style>
  .settings-page {
    max-width: 900px;
    margin: 2rem auto;
    padding: 1rem;
  }

  h2 {
    color: #38bdf8;
  }

  .card {
    background: #1e293b;
    padding: 1.5rem;
    border-radius: 10px;
    margin-bottom: 2rem;
    border: 1px solid #334155;
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
    margin-bottom: 1.25rem;
  }

  .policy-options {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .option-card {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    background: #0f172a;
    border: 1px solid #334155;
    padding: 1rem;
    border-radius: 8px;
    cursor: pointer;
  }

  .option-card.active {
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.05);
  }

  .option-card strong {
    color: #f8fafc;
    display: block;
    margin-bottom: 0.25rem;
  }

  .option-card p {
    margin: 0;
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .danger-card {
    border-color: #ef4444;
  }

  .students-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
  }

  th,
  td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid #334155;
  }

  .mono {
    font-family: monospace;
    font-size: 0.875rem;
    color: #38bdf8;
  }

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

  .empty {
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-card {
    background: #1e293b;
    border: 1px solid #38bdf8;
    border-radius: 12px;
    padding: 1.5rem 2rem;
    max-width: 550px;
    width: 90%;
    color: #f8fafc;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  }

  .modal-card h3 {
    margin-top: 0;
    color: #38bdf8;
  }

  .counts-list {
    background: #0f172a;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    border: 1px solid #334155;
  }

  .counts-list li {
    margin-bottom: 0.25rem;
  }

  .modal-note {
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .retention-notice {
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid #eab308;
    color: #fef08a;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .retention-notice ul {
    margin: 0.5rem 0 0 0;
    padding-left: 1.25rem;
  }

  .password-field {
    margin: 1rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .password-field label {
    font-size: 0.875rem;
    color: #cbd5e1;
  }

  .password-field input {
    background: #0f172a;
    border: 1px solid #334155;
    color: #f8fafc;
    padding: 0.6rem 0.75rem;
    border-radius: 6px;
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }

  .primary-btn {
    background: #0284c7;
    color: white;
    font-weight: 600;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .danger-btn {
    background: #dc2626;
    color: white;
    font-weight: 600;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .secondary-btn {
    background: #334155;
    color: #f8fafc;
    border: none;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .modal-divider {
    border: none;
    border-top: 1px solid #334155;
    margin: 1.25rem 0;
  }

  .restore-section {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .restore-hint {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0;
  }

  .restore-btn {
    background: transparent;
    border: 1px solid #38bdf8;
    color: #38bdf8;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .progress-status {
    color: #38bdf8;
    font-size: 0.85rem;
    margin-top: 0.5rem;
  }
</style>
