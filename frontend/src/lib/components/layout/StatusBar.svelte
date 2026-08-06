<script lang="ts">
  export let onStorageClick: () => void;
  export let policyIcon: string = "";
  export let policyLabel: string = "";
  export let backendLabel: string = "";
  export let unlocked: boolean = true;
</script>

<footer class="vscode-statusbar">
  <button
    type="button"
    on:click={onStorageClick}
    class="statusbar-item"
    title={unlocked
      ? "Click to change storage & privacy settings"
      : "Session locked — Click to unlock"}
  >
    <span class="statusbar-icon">{policyIcon}</span>
    <span class="statusbar-label">{policyLabel}</span>
  </button>

  <button
    type="button"
    on:click={onStorageClick}
    class="statusbar-item statusbar-right"
    title={unlocked ? "Click to configure backend server address" : "Current Backend Server"}
  >
    <span class="statusbar-icon">🖥️</span>
    <span class="statusbar-label">{backendLabel || "No Server Configured"}</span>
  </button>
</footer>

<style>
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