<script lang="ts">
  import { timeUntilLock, keepSessionAlive } from '$lib/db/hygiene';

  $: formattedTime = $timeUntilLock !== null
    ? `${Math.floor($timeUntilLock / 60)}m ${$timeUntilLock % 60}s`
    : '';
</script>

{#if $timeUntilLock !== null}
  <div class="timeout-modal-overlay">
    <div class="timeout-modal">
      <div class="icon">⏳</div>
      <h3>Session Timeout Warning</h3>
      <p>
        Your session will lock in <strong>{formattedTime}</strong> due to inactivity to protect sensitive data.
      </p>
      <div class="modal-actions">
        <button class="keep-alive-btn" on:click={keepSessionAlive}>
          Keep Session Alive
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .timeout-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 9999;
  }

  .timeout-modal {
    background: #1e293b;
    border: 1px solid #eab308;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    border-radius: 12px;
    padding: 2rem;
    max-width: 420px;
    width: 90%;
    text-align: center;
    color: #f8fafc;
  }

  .icon {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  h3 {
    margin: 0 0 0.75rem 0;
    color: #fef08a;
    font-size: 1.35rem;
  }

  p {
    color: #cbd5e1;
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 1.5rem;
  }

  .modal-actions {
    display: flex;
    justify-content: center;
  }

  .keep-alive-btn {
    padding: 0.75rem 1.5rem;
    background: #0284c7;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .keep-alive-btn:hover {
    background: #0369a1;
  }
</style>
