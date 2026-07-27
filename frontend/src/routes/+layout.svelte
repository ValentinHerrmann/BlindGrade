<script lang="ts">
  import { onMount } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { get } from "svelte/store";
  import { registerHygieneListeners, lockSession } from "$lib/db/hygiene";
  import { sessionStore, isUnlocked } from "$lib/stores/session";
  import {
    storagePolicyStore,
    storagePolicyLabelStore,
    storagePolicyBadgeStore,
  } from "$lib/stores/storagePolicy";

  onMount(() => {
    registerHygieneListeners();
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
</script>

<div class="app-layout">
  {#if $isUnlocked}
    <header class="app-header">
      <div class="brand">
        <a href="/">
          <img src="/favicon.png" alt="BlindGrade logo" class="brand-logo" />
          <span>BlindGrade</span>
        </a>
      </div>
      <nav class="nav-links">
        <a href="/">Dashboard</a>
        <a href="/exercises">Exercise Library</a>
        {#if $sessionStore.role === "admin"}
          <a href="/admin/users">User Management</a>
        {/if}
        <a href="/settings">Settings</a>
      </nav>
      <div class="session-info">
        {#if $sessionStore.role}
          <span class="mode-badge">{$sessionStore.role}</span>
        {/if}
        {#if $sessionStore.email}
          <span class="user-email">{$sessionStore.email}</span>
        {/if}
        <button on:click={handleLock} class="lock-btn">Lock Session</button>
      </div>
    </header>
  {/if}

  <main class="app-main">
    <slot />
  </main>

  <footer class="vscode-statusbar">
    <a
      href={$isUnlocked ? "/settings#storage-policy" : "/unlock"}
      class="statusbar-item"
      title={$isUnlocked
        ? `Click to change data storage mode: ${$storagePolicyLabelStore}`
        : "Session locked — Click to unlock"}
    >
      <span class="statusbar-icon">{$storagePolicyBadgeStore.icon}</span>
      <span class="statusbar-label">{$storagePolicyLabelStore}</span>
    </a>
  </footer>
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
    background: #0284c7;
    border-radius: 4px;
    font-weight: 600;
  }

  .user-email {
    font-size: 0.875rem;
    color: #94a3b8;
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
    overflow-y: auto;
  }

  .vscode-statusbar {
    display: flex;
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
  }

  .statusbar-item:hover {
    background: rgba(255, 255, 255, 0.2);
  }
</style>
