<script lang="ts">
  export let isOpen = false;
  export let onToggleMenu: () => void;
  export let onOpenArchive: () => void;
  export let onExportArchive: () => void;
  export let onClearWorkspace: () => void;

  function handleOpen() {
    onToggleMenu();
    onOpenArchive();
  }

  function handleExport() {
    onToggleMenu();
    onExportArchive();
  }

  function handleClear() {
    onToggleMenu();
    onClearWorkspace();
  }
</script>

{#if isOpen}
  <div class="workspace-dropdown">
    <button on:click={handleOpen}>📂 Open .bgproj</button>
    <button on:click={handleExport}>💾 Export .bgproj</button>
    <button class="danger" on:click={handleClear}>❌ Clear Workspace</button>
  </div>
{/if}

<style>
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
</style>