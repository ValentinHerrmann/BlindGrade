<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { get } from "svelte/store";
  import { registerHygieneListeners, lockSession } from "$lib/db/hygiene";
  import { sessionStore, isUnlocked, isAuthenticated } from "$lib/stores/session";
  import {
    storagePolicyStore,
    storagePolicyLabelStore,
    storagePolicyBadgeStore,
  } from "$lib/stores/storagePolicy";
  import { effectiveBackendStore } from "$lib/stores/backendStore";
  import { registerNavigationGuard, isGradeActivePath, isUnlockPath } from "$lib/stores/navigationStore";
  import {
    openBgprojArchive,
    exportBgprojArchive,
    clearWorkspace,
    confirmWorkspaceReplace,
    confirmWorkspaceClear,
    promptArchivePassword,
  } from "$lib/services/archiveService";
  import AppHeader from "$lib/components/layout/AppHeader.svelte";
  import StatusBar from "$lib/components/layout/StatusBar.svelte";
  import StoragePolicyModal from "$lib/components/StoragePolicyModal.svelte";
  import SessionTimeoutWarning from "$lib/components/SessionTimeoutWarning.svelte";

  let fileInput: HTMLInputElement;
  let isSettingsModalOpen = false;
  let isWorkspaceMenuOpen = false;
  let isInitializing = true;
  let showFocusNav = false;

  $: isGradeActive = isGradeActivePath($page.url.pathname);

  $: if (!isInitializing && !$isUnlocked && typeof window !== "undefined" && !isUnlockPath($page.url.pathname)) {
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
    registerNavigationGuard();

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

    if (!confirmWorkspaceReplace()) {
      input.value = "";
      return;
    }

    const password = promptArchivePassword("Enter password for this .bgproj archive:");
    if (!password) {
      input.value = "";
      return;
    }

    try {
      await openBgprojArchive(file, password);
      alert("Successfully imported project archive!");
      window.location.href = "/";
    } catch (err: any) {
      alert(`Failed to import archive: ${err.message}`);
    } finally {
      input.value = "";
    }
  }

  async function handleExportBgproj() {
    const password = promptArchivePassword("Enter password to encrypt .bgproj archive:");
    if (!password) return;

    try {
      await exportBgprojArchive(password);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    }
  }

  async function handleCloseWorkspace() {
    if (!confirmWorkspaceClear()) {
      return;
    }

    try {
      await clearWorkspace();
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
      <AppHeader
        bind:isWorkspaceMenuOpen
        onToggleWorkspaceMenu={() => (isWorkspaceMenuOpen = !isWorkspaceMenuOpen)}
        onOpenArchive={triggerOpenBgproj}
        onExportArchive={handleExportBgproj}
        onClearWorkspace={handleCloseWorkspace}
        onLock={handleLock}
        authenticated={$isAuthenticated}
        userRole={$sessionStore.role}
        userEmail={$sessionStore.email}
      />
    {/if}
  {/if}

  <main class="app-main">
    <slot />
  </main>

  <StatusBar
    onStorageClick={handleFooterClick}
    policyIcon={$storagePolicyBadgeStore.icon}
    policyLabel={$storagePolicyLabelStore}
    backendLabel={$effectiveBackendStore || ""}
    unlocked={$isUnlocked}
  />

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

  .app-main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
</style>
