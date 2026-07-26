<script lang="ts">
  import { onMount } from 'svelte';
  import { registerHygieneListeners } from '$lib/db/hygiene';
  import { sessionStore, isUnlocked } from '$lib/stores/session';

  onMount(() => {
    registerHygieneListeners();
  });

  function handleLock() {
    sessionStore.lock();
    window.location.href = '/unlock';
  }
</script>

<div class="app-layout">
  <header class="app-header">
    <div class="brand">
      <a href="/">BlindGrade</a>
    </div>
    {#if $isUnlocked}
      <nav class="nav-links">
        <a href="/">Dashboard</a>
        <a href="/exercises">Exercise Library</a>
        <a href="/settings">Settings</a>
      </nav>
      <div class="session-info">
        <span class="mode-badge">{$sessionStore.mode} mode</span>
        {#if $sessionStore.email}
          <span class="user-email">{$sessionStore.email}</span>
        {/if}
        <button on:click={handleLock} class="lock-btn">Lock Session</button>
      </div>
    {/if}
  </header>

  <main class="app-main">
    <slot />
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: #0f172a;
    color: #f8fafc;
  }

  .app-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
  }

  .brand a {
    font-size: 1.25rem;
    font-weight: 700;
    color: #38bdf8;
    text-decoration: none;
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
  }
</style>
