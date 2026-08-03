<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    storagePolicyStore,
    type StorageMode,
  } from "$lib/stores/storagePolicy";
  import { backendStore, effectiveBackendStore } from "$lib/stores/backendStore";
  import { isAuthenticated } from "$lib/stores/session";
  import { wipeDatabase } from "$lib/db/hygiene";

  export let isOpen = false;

  const dispatch = createEventDispatcher<{
    close: void;
  }>();

  let statusMsg = "";
  let customBackendUrl = "";

  $: if (isOpen) {
    customBackendUrl = get(backendStore);
  }

  function handleClose() {
    statusMsg = "";
    dispatch("close");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === "Escape") {
      handleClose();
    }
  }

  async function handleStorageModeChange(val: StorageMode) {
    if (val === $storagePolicyStore.storageMode) return;

    if ((val === "all-server" || val === "hybrid") && !get(isAuthenticated)) {
      alert("Server storage modes require an authenticated session. Please log in.");
      window.location.href = "/unlock";
      return;
    }

    const confirmed = confirm(
      "Changing storage mode requires clearing the current active session state. Please make sure you have exported a .bgproj backup first!\n\nDo you want to proceed and switch storage mode?"
    );
    if (!confirmed) return;

    await wipeDatabase();
    storagePolicyStore.updateSetting("storageMode", val);
    statusMsg = `Global Storage Mode updated to ${val}. Session cleared.`;
    window.location.reload();
  }

  async function handleLatexChange(val: "server" | "local") {
    if (val === $storagePolicyStore.latexCompilation) return;

    if (val === "server" && !get(isAuthenticated)) {
      alert("Server compilation requires an authenticated session. Please log in.");
      window.location.href = "/unlock";
      return;
    }
    storagePolicyStore.updateSetting("latexCompilation", val);
    statusMsg = `LaTeX Compilation set to ${val}.`;
  }

  function handleSaveBackendUrl() {
    const trimmed = customBackendUrl.trim();
    if (!trimmed) {
      statusMsg = "Please enter a backend server address.";
      return;
    }
    backendStore.saveSuccessfulBackendUrl(trimmed);
    statusMsg = `Backend server address updated to: ${$effectiveBackendStore}`;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={handleClose}
  >
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h3 id="modal-title">Storage & Server Configuration</h3>
        <button type="button" class="close-btn" on:click={handleClose}>×</button>
      </div>

      {#if statusMsg}
        <div class="status-banner">{statusMsg}</div>
      {/if}

      <div class="modal-body">
        <div class="section">
          <h4>1. Storage Policy</h4>
          <p class="description">Select where exam data and student grades are stored:</p>

          <div class="options-grid">
            <label class="option-card" class:active={$storagePolicyStore.storageMode === "all-local"}>
              <input
                type="radio"
                name="storageMode"
                value="all-local"
                checked={$storagePolicyStore.storageMode === "all-local"}
                on:change={() => handleStorageModeChange("all-local")}
              />
              <div class="option-content">
                <strong>🔒 All Local (Zero Cloud)</strong>
                <p>All data stays on this device in encrypted IndexedDB. No backend required.</p>
              </div>
            </label>

            <label class="option-card" class:active={$storagePolicyStore.storageMode === "all-server"}>
              <input
                type="radio"
                name="storageMode"
                value="all-server"
                checked={$storagePolicyStore.storageMode === "all-server"}
                on:change={() => handleStorageModeChange("all-server")}
              />
              <div class="option-content">
                <strong>☁️ All Server</strong>
                <p>All data synchronized and stored on the secure BlindGrade server.</p>
              </div>
            </label>

            <label class="option-card" class:active={$storagePolicyStore.storageMode === "hybrid"}>
              <input
                type="radio"
                name="storageMode"
                value="hybrid"
                checked={$storagePolicyStore.storageMode === "hybrid"}
                on:change={() => handleStorageModeChange("hybrid")}
              />
              <div class="option-content">
                <strong>⚖️ Hybrid Mode</strong>
                <p>Exercise library and exam templates on server, but student identities stay 100% local.</p>
              </div>
            </label>
          </div>
        </div>

        <div class="section">
          <h4>2. LaTeX Compilation Engine</h4>
          <p class="description">Select engine for rendering LaTeX exam documents to PDF:</p>

          <div class="options-grid">
            <label class="option-card" class:active={$storagePolicyStore.latexCompilation === "local"}>
              <input
                type="radio"
                name="latexMode"
                value="local"
                checked={$storagePolicyStore.latexCompilation === "local"}
                on:change={() => handleLatexChange("local")}
              />
              <div class="option-content">
                <strong>⚡ Browser Local (WASM BusyTeX)</strong>
                <p>Compiles inside browser without sending source to any server.</p>
              </div>
            </label>

            <label class="option-card" class:active={$storagePolicyStore.latexCompilation === "server"}>
              <input
                type="radio"
                name="latexMode"
                value="server"
                checked={$storagePolicyStore.latexCompilation === "server"}
                on:change={() => handleLatexChange("server")}
              />
              <div class="option-content">
                <strong>⚡ Server (Tectonic)</strong>
                <p>High performance server-side compilation. Requires authenticated account.</p>
              </div>
            </label>
          </div>
        </div>

        <div class="section">
          <h4>3. Backend Server Address</h4>
          <p class="description">Configure custom API server address (e.g. local backend server):</p>
          <div class="backend-input-row">
            <input
              type="text"
              bind:value={customBackendUrl}
              placeholder="e.g. http://localhost:8000"
              class="url-input"
            />
            <button type="button" class="apply-btn" on:click={handleSaveBackendUrl}>Save</button>
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <a href="/settings" class="advanced-link" on:click={handleClose}>
          Full Settings & GDPR Erasure ↗
        </a>
        <button type="button" class="close-modal-btn" on:click={handleClose}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    padding: 1rem;
  }

  .modal-card {
    background: #1e293b;
    border: 1px solid #38bdf8;
    border-radius: 12px;
    max-width: 900px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    color: #f8fafc;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    animation: scaleIn 0.15s ease-out;
  }

  @keyframes scaleIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #334155;
    background: #0f172a;
  }

  .modal-header h3 {
    margin: 0;
    color: #38bdf8;
    font-size: 1.15rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
    border-radius: 4px;
    transition: color 0.15s ease;
  }

  .close-btn:hover {
    color: #f1f5f9;
  }

  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .section h4 {
    margin: 0 0 0.25rem 0;
    color: #f8fafc;
    font-size: 1rem;
  }

  .description {
    color: #94a3b8;
    font-size: 0.85rem;
    margin: 0 0 0.75rem 0;
  }

  .options-grid {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  @media (min-width: 900px) {
    .options-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }
  }

  .option-card {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    background: #0f172a;
    border: 1px solid #334155;
    padding: 0.85rem;
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .option-card:hover {
    border-color: #475569;
  }

  .option-card.active {
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.08);
  }

  .option-card input {
    margin-top: 0.2rem;
  }

  .option-card strong {
    color: #f8fafc;
    display: block;
    font-size: 0.9rem;
    margin-bottom: 0.2rem;
  }

  .option-card p {
    margin: 0;
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .backend-input-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .url-input {
    flex: 1;
    background: #0f172a;
    border: 1px solid #334155;
    color: #f8fafc;
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .url-input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .apply-btn {
    background: #0284c7;
    color: white;
    font-weight: 600;
    border: none;
    padding: 0.55rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .apply-btn:hover {
    background: #0369a1;
  }

  .reset-btn {
    background: #334155;
    color: #94a3b8;
    border: none;
    padding: 0.55rem 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .reset-btn:hover {
    background: #475569;
    color: #f8fafc;
  }

  .status-banner {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid #22c55e;
    color: #86efac;
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: #0f172a;
    border-top: 1px solid #334155;
  }

  .advanced-link {
    color: #38bdf8;
    font-size: 0.85rem;
    text-decoration: none;
  }

  .advanced-link:hover {
    text-decoration: underline;
  }

  .close-modal-btn {
    background: #334155;
    color: #f8fafc;
    border: none;
    padding: 0.55rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }

  .close-modal-btn:hover {
    background: #475569;
  }
</style>
