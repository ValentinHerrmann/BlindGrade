<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let previewPdfUrl: string | null = null;
  export let previewSolutionPdfUrl: string | null = null;
  export let showAngabePreview: boolean = true;
  export let showLoesungPreview: boolean = false;
  export let titleAngabe: string = "Exercise";
  export let titleLoesung: string = "Solution";
  export let emojiAngabe: string = "📄";
  export let emojiLoesung: string = "📝";
  export let height: string = "100%";
  export let placeholderText: string = "Click compile to render preview";

  const dispatch = createEventDispatcher<{
    toggleAngabe: boolean;
    toggleLoesung: boolean;
  }>();

  function handleToggleAngabe() {
    showAngabePreview = !showAngabePreview;
    dispatch('toggleAngabe', showAngabePreview);
  }

  function handleToggleLoesung() {
    showLoesungPreview = !showLoesungPreview;
    dispatch('toggleLoesung', showLoesungPreview);
  }
</script>

<div
  class="previews-container"
  class:all-collapsed={!showAngabePreview && !showLoesungPreview}
  style="height: {height};"
>
  <!-- Tab 1: Angabe / Exercise / Exam -->
  <div
    class="pdf-panel"
    class:expanded={showAngabePreview}
    class:collapsed={!showAngabePreview}
  >
    {#if showAngabePreview}
      <button
        type="button"
        class="pdf-panel-header"
        on:click={handleToggleAngabe}
        title="Click to collapse {titleAngabe} PDF"
      >
        <span class="panel-title">{emojiAngabe} {titleAngabe}</span>
        <span class="header-icon">›</span>
      </button>
      <div class="pdf-panel-body">
        {#if previewPdfUrl}
          <iframe
            src={previewPdfUrl}
            title="{titleAngabe} Preview"
            width="100%"
            height="100%"
          ></iframe>
        {:else}
          <div class="preview-placeholder">
            {placeholderText}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        class="vertical-header-strip"
        on:click={handleToggleAngabe}
        title="Click to expand {titleAngabe} PDF"
      >
        <span class="strip-icon">‹</span>
        <span class="strip-emoji">{emojiAngabe}</span>
        <span class="strip-title">{titleAngabe} PDF</span>
      </button>
    {/if}
  </div>

  <!-- Tab 2: Lösung / Solution / Answer Key -->
  <div
    class="pdf-panel"
    class:expanded={showLoesungPreview}
    class:collapsed={!showLoesungPreview}
  >
    {#if showLoesungPreview}
      <button
        type="button"
        class="pdf-panel-header"
        on:click={handleToggleLoesung}
        title="Click to collapse {titleLoesung} PDF"
      >
        <span class="panel-title">{emojiLoesung} {titleLoesung}</span>
        <span class="header-icon">›</span>
      </button>
      <div class="pdf-panel-body">
        {#if previewSolutionPdfUrl}
          <iframe
            src={previewSolutionPdfUrl}
            title="{titleLoesung} Preview"
            width="100%"
            height="100%"
          ></iframe>
        {:else}
          <div class="preview-placeholder">
            {placeholderText}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        class="vertical-header-strip"
        on:click={handleToggleLoesung}
        title="Click to expand {titleLoesung} PDF"
      >
        <span class="strip-icon">‹</span>
        <span class="strip-emoji">{emojiLoesung}</span>
        <span class="strip-title">{titleLoesung} PDF</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .previews-container {
    flex: 1;
    display: flex;
    gap: 0.75rem;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .previews-container.all-collapsed {
    flex: 0 0 auto;
  }

  .pdf-panel {
    display: flex;
    flex-direction: column;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .pdf-panel.expanded {
    flex: 1;
    min-width: 0;
  }

  .pdf-panel.collapsed {
    width: 38px;
    flex: 0 0 38px;
  }

  .pdf-panel-header {
    background: #1e293b;
    border: none;
    border-bottom: 1px solid #334155;
    padding: 0.5rem 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }

  .pdf-panel-header:hover {
    background: #334155;
  }

  .pdf-panel-header:hover .header-icon {
    color: #38bdf8;
  }

  .panel-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-icon {
    font-size: 1rem;
    font-weight: bold;
    color: #94a3b8;
    transition: color 0.15s ease;
    flex-shrink: 0;
  }

  .pdf-panel-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: #1e293b;
  }

  .pdf-panel-body iframe {
    border: none;
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
  }

  .preview-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: #64748b;
    font-size: 0.85rem;
    font-style: italic;
    padding: 1rem;
    text-align: center;
    min-height: 0;
  }

  .vertical-header-strip {
    width: 100%;
    height: 100%;
    background: #0f172a;
    border: none;
    color: #94a3b8;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.75rem 0.2rem;
    gap: 1rem;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .vertical-header-strip:hover {
    background: #1e293b;
    color: #38bdf8;
  }

  .strip-icon {
    font-size: 0.9rem;
    font-weight: bold;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 4px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .vertical-header-strip:hover .strip-icon {
    background: #0284c7;
    color: #ffffff;
    border-color: #38bdf8;
  }

  .strip-emoji {
    font-size: 0.95rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .strip-title {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    letter-spacing: 0.5px;
  }
</style>
