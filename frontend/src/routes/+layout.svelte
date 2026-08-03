<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto, beforeNavigate } from "$app/navigation";
  import { get } from "svelte/store";
  import { registerHygieneListeners, lockSession } from "$lib/db/hygiene";
  import { db, clearAllTables } from "$lib/db/db";
  import { projectStore } from "$lib/stores/project";
  import { sessionStore, isUnlocked, isAuthenticated } from "$lib/stores/session";
  import {
    storagePolicyStore,
    storagePolicyLabelStore,
    storagePolicyBadgeStore,
  } from "$lib/stores/storagePolicy";
  import { backendStore, effectiveBackendStore } from "$lib/stores/backendStore";
  import { packProject } from "$lib/archive/packer";
  import { unpackProject } from "$lib/archive/unpacker";
  import StoragePolicyModal from "$lib/components/StoragePolicyModal.svelte";
  import SessionTimeoutWarning from "$lib/components/SessionTimeoutWarning.svelte";

  let fileInput: HTMLInputElement;
  let isSettingsModalOpen = false;
  let isWorkspaceMenuOpen = false;
  let isInitializing = true;
  let showFocusNav = false;

  $: isGradeActive = $page.url.pathname.includes("/exam/") && $page.url.pathname.endsWith("/grade");

  $: if (!isInitializing && !$isUnlocked && typeof window !== "undefined" && $page.url.pathname !== "/unlock") {
    goto("/unlock");
  }

  function handleFooterClick() {
    if (get(isUnlocked)) {
      isSettingsModalOpen = true;
    } else {
      window.location.href = "/unlock";
    }
  }

  onMount(async () => {
    registerHygieneListeners();
    const isLockedInStorage =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("bg_session_locked") === "true";

    const savedMode =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("bg_session_mode")
        : null;

    const policy = get(storagePolicyStore);

    if (
      isLockedInStorage ||
      savedMode === "authenticated" ||
      policy.storageMode === "all-server"
    ) {
      if (!get(isUnlocked) && $page.url.pathname !== "/unlock") {
        await goto("/unlock");
      }
    } else {
      if (!get(isUnlocked)) {
        await sessionStore.initAnonymousSession();
      }
    }
    isInitializing = false;
  });

  beforeNavigate(({ cancel }) => {
    const session = get(sessionStore);
    if (session.isDirty) {
      if (!confirm("You have unsaved changes. Are you sure you want to leave this page?")) {
        cancel();
      }
    }
  });

  async function handleLock() {
    await lockSession();
    window.location.href = "/unlock";
  }

  function triggerOpenBgproj() {
    isWorkspaceMenuOpen = false;
    fileInput?.click();
  }

  async function handleFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    if (
      !confirm(
        "Opening a new .bgproj file will replace your current workspace and clear existing local data. Unsaved changes will be lost. Continue?"
      )
    ) {
      input.value = "";
      return;
    }

    const password = prompt("Enter password for this .bgproj archive:");
    if (!password) {
      input.value = "";
      return;
    }

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      await clearAllTables();
      projectStore.clear();
      await unpackProject(buffer, password);
      alert("Successfully imported project archive!");
      window.location.href = "/";
    } catch (err: any) {
      alert(`Failed to import archive: ${err.message}`);
    } finally {
      input.value = "";
    }
  }

  async function handleExportBgproj() {
    isWorkspaceMenuOpen = false;
    const password = prompt("Enter password to encrypt .bgproj archive:");
    if (!password) return;

    try {
      const bytes = await packProject(password);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "workspace.bgproj";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  }

  async function handleCloseWorkspace() {
    isWorkspaceMenuOpen = false;
    if (
      !confirm(
        "Are you sure you want to close this project and clear all local workspace data? Unsaved changes will be lost."
      )
    ) {
      return;
    }

    try {
      await clearAllTables();
      projectStore.clear();
      alert("Workspace cleared successfully.");
      window.location.href = "/";
    } catch (err: any) {
      alert(`Failed to clear workspace: ${err.message}`);
    }
  }
</script>

<input
  type="file"
  accept=".bgproj"
  style="display: none"
  bind:this={fileInput}
  on:change={handleFileSelected}
/>

<SessionTimeoutWarning />

<div class="app-layout">
  {#if $isUnlocked && $page.url.pathname !== "/unlock"}
    {#if !isGradeActive || showFocusNav}
      <header class="app-header">
        <div class="brand">
          <a href="/">
            <img src="/favicon.png" alt="Examance logo" class="brand-logo" />
            <span>Examance</span>
          </a>
        </div>
        <nav class="nav-links">
          <a href="/">Dashboard</a>
          <a href="/exercises">Exercise Library</a>
          <a href="/analytics">Analytics</a>
          {#if $sessionStore.role === "admin"}
            <a href="/admin/users">User Management</a>
          {/if}
          <a href="/settings">Settings</a>
        </nav>
        <div class="session-info">
          <div class="workspace-menu-container">
            <button class="action-btn" on:click={() => (isWorkspaceMenuOpen = !isWorkspaceMenuOpen)}>
              ⚙️ Workspace ▾
            </button>
            {#if isWorkspaceMenuOpen}
              <div class="workspace-dropdown">
                <button on:click={triggerOpenBgproj}>📂 Open .bgproj</button>
                <button on:click={handleExportBgproj}>💾 Export .bgproj</button>
                <button class="danger" on:click={handleCloseWorkspace}>❌ Clear Workspace</button>
              </div>
            {/if}
          </div>

          {#if $isAuthenticated}
            <span class="mode-badge cloud">☁️ Cloud Mode</span>
            {#if $sessionStore.email}
              <span class="user-email">{$sessionStore.email}</span>
            {/if}
            <button on:click={handleLock} class="lock-btn">Lock Session</button>
          {:else}
            <span class="mode-badge local">💻 Local Mode</span>
            <a href="/unlock" class="login-btn">Connect to Cloud</a>
            <button on:click={handleLock} class="lock-btn">Lock</button>
          {/if}
        </div>
      </header>
    {/if}
  {/if}

  <main class="app-main">
    <slot />
  </main>

  <footer class="vscode-statusbar">
    <button
      type="button"
      on:click={handleFooterClick}
      class="statusbar-item"
      title={$isUnlocked
        ? `Click to change storage & privacy settings`
        : "Session locked — Click to unlock"}
    >
      <span class="statusbar-icon">{$storagePolicyBadgeStore.icon}</span>
      <span class="statusbar-label">{$storagePolicyLabelStore}</span>
    </button>

    <button
      type="button"
      on:click={handleFooterClick}
      class="statusbar-item statusbar-right"
      title={$isUnlocked ? "Click to configure backend server address" : "Current Backend Server"}
    >
      <span class="statusbar-icon">🖥️</span>
      <span class="statusbar-label">{$effectiveBackendStore || "No Server Configured"}</span>
    </button>
  </footer>

  <StoragePolicyModal
    isOpen={isSettingsModalOpen}
    on:close={() => (isSettingsModalOpen = false)}
  />
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family:
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      sans-serif;
    background-color: #0f172a;
    color: #f8fafc;
  }

  :global(.is-loading) {
    animation: pulse 1.5s infinite ease-in-out !important;
    pointer-events: none;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    flex-shrink: 0;
  }

  .brand a {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 1.35rem;
    font-weight: 700;
    color: #38bdf8;
    text-decoration: none;
  }

  .brand-logo {
    width: 38px;
    height: 38px;
    object-fit: contain;
    border-radius: 6px;
  }

  .nav-links {
    display: flex;
    gap: 1.25rem;
  }

  .nav-links a {
    color: #cbd5e1;
    text-decoration: none;
    font-weight: 500;
    font-size: 0.95rem;
  }

  .nav-links a:hover {
    color: #38bdf8;
  }

  .session-info {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .mode-badge {
    text-transform: capitalize;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-weight: 600;
  }

  .mode-badge.cloud {
    background: #0284c7;
    color: white;
  }

  .mode-badge.local {
    background: #334155;
    color: #38bdf8;
    border: 1px solid #0284c7;
  }

  .workspace-menu-container {
    position: relative;
  }

  .workspace-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    padding: 0.4rem;
    min-width: 170px;
    z-index: 1000;
  }

  .workspace-dropdown button {
    background: transparent;
    border: none;
    color: #cbd5e1;
    text-align: left;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: background 0.15s ease;
  }

  .workspace-dropdown button:hover {
    background: #334155;
    color: white;
  }

  .workspace-dropdown button.danger {
    color: #fca5a5;
  }

  .workspace-dropdown button.danger:hover {
    background: #7f1d1d;
    color: white;
  }

  .user-email {
    font-size: 0.875rem;
    color: #94a3b8;
  }

  .login-btn {
    padding: 0.375rem 0.85rem;
    background: #0284c7;
    color: white;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .login-btn:hover {
    background: #0369a1;
  }

  .action-btn {
    padding: 0.375rem 0.65rem;
    background: #334155;
    color: #f8fafc;
    border: 1px solid #475569;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .action-btn:hover {
    background: #475569;
    border-color: #64748b;
  }

  .action-btn.danger {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fecdd3;
  }

  .action-btn.danger:hover {
    background: #991b1b;
  }

  .lock-btn {
    padding: 0.375rem 0.75rem;
    background: #334155;
    color: #f8fafc;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .lock-btn:hover {
    background: #475569;
  }

  .app-main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .vscode-statusbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 1rem;
    background: #007acc;
    color: #ffffff;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
    flex-shrink: 0;
  }

  .statusbar-item {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: #ffffff;
    text-decoration: none;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    transition: background 0.15s ease;
    background: none;
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }

  .statusbar-right {
    margin-left: auto;
  }

  .statusbar-item:hover {
    background: rgba(255, 255, 255, 0.2);
  }
</style>
