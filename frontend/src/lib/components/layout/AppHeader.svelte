<script lang="ts">
  import WorkspaceMenu from "./WorkspaceMenu.svelte";
  import SessionInfo from "./SessionInfo.svelte";

  export let isWorkspaceMenuOpen = false;
  export let onToggleWorkspaceMenu: () => void;
  export let onOpenArchive: () => void;
  export let onExportArchive: () => void;
  export let onClearWorkspace: () => void;
  export let onLock: () => void;
  export let authenticated: boolean = false;
  export let userRole: string | null = null;
  export let userEmail: string | null = null;
</script>

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
    {#if userRole === "admin"}
      <a href="/admin/users">User Management</a>
    {/if}
    <a href="/settings">Settings</a>
  </nav>
  <div class="header-right">
    <div class="workspace-menu-container">
      <button class="action-btn" on:click={onToggleWorkspaceMenu}>
        ⚙️ Workspace ▾
      </button>
      <WorkspaceMenu
        isOpen={isWorkspaceMenuOpen}
        onToggleMenu={onToggleWorkspaceMenu}
        onOpenArchive={onOpenArchive}
        onExportArchive={onExportArchive}
        onClearWorkspace={onClearWorkspace}
      />
    </div>

    <SessionInfo
      {authenticated}
      {userRole}
      {userEmail}
      onLock={onLock}
    />
  </div>
</header>

<style>
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

  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .workspace-menu-container {
    position: relative;
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
</style>