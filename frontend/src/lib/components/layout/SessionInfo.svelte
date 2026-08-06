<script lang="ts">
  export let onLock: () => void;
  export let authenticated: boolean = false;
  export let userRole: string | null = null;
  export let userEmail: string | null = null;
</script>

<div class="session-info">
  {#if authenticated}
    <span class="mode-badge cloud">☁️ Cloud Mode</span>
    {#if userEmail}
      <span class="user-email">{userEmail}</span>
    {/if}
    <button on:click={onLock} class="lock-btn">Lock Session</button>
  {:else}
    <span class="mode-badge local">💻 Local Mode</span>
    <a href="/unlock" class="login-btn">Connect to Cloud</a>
    <button on:click={onLock} class="lock-btn">Lock</button>
  {/if}
</div>

<style>
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
</style>