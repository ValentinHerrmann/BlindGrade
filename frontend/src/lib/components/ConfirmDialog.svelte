<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let isOpen = false;
  export let title = "Unsaved Changes";
  export let message = "You have unsaved changes that will be lost. Are you sure you want to exit without saving?";
  export let confirmText = "Discard Changes";
  export let cancelText = "Keep Editing";

  const dispatch = createEventDispatcher<{
    confirm: void;
    cancel: void;
  }>();

  function handleConfirm() {
    dispatch("confirm");
  }

  function handleCancel() {
    dispatch("cancel");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === "Escape") {
      handleCancel();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div
    class="confirm-backdrop"
    role="button"
    tabindex="-1"
    on:click|self={handleCancel}
  >
    <div
      class="confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div class="confirm-header">
        <h3 id="confirm-dialog-title">⚠️ {title}</h3>
        <button type="button" class="close-btn" on:click={handleCancel}>✕</button>
      </div>

      <div class="confirm-body">
        <p>{message}</p>
      </div>

      <div class="confirm-footer">
        <button type="button" class="keep-btn" on:click={handleCancel}>
          {cancelText}
        </button>
        <button type="button" class="discard-btn" on:click={handleConfirm}>
          {confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(4px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .confirm-modal {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
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

  .confirm-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #334155;
  }

  .confirm-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #f1f5f9;
    display: flex;
    align-items: center;
    gap: 0.5rem;
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

  .confirm-body {
    padding: 1.5rem;
    color: #cbd5e1;
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .confirm-body p {
    margin: 0;
  }

  .confirm-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    background: #0f172a;
    border-top: 1px solid #334155;
  }

  .keep-btn {
    background: #334155;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
    transition: background 0.15s ease;
  }

  .keep-btn:hover {
    background: #475569;
  }

  .discard-btn {
    background: #dc2626;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.875rem;
    transition: background 0.15s ease;
  }

  .discard-btn:hover {
    background: #b91c1c;
  }
</style>
