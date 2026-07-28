<script lang="ts">
  import { highlightLatexToHtml } from "$lib/latex/highlighter";

  export let code: string = "";
  export let snippet: boolean = false;
  export let maxHeight: string = "none";

  $: highlightedHtml = highlightLatexToHtml(code || "");
</script>

{#if snippet}
  <code class="latex-viewer-snippet">{@html highlightedHtml}</code>
{:else}
  <pre class="latex-viewer-container" style="max-height: {maxHeight}"><code>{@html highlightedHtml}</code></pre>
{/if}

<style>
  .latex-viewer-snippet {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.8125rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-all;
    color: #e2e8f0;
  }

  .latex-viewer-container {
    margin: 0;
    padding: 0.75rem 1rem;
    background-color: #0f172a;
    border: 1px solid #334155;
    border-radius: 0.375rem;
    color: #e2e8f0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.875rem;
    line-height: 1.5;
    overflow-x: auto;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .latex-viewer-container code {
    font-family: inherit;
    font-size: inherit;
    background: transparent;
    padding: 0;
    color: inherit;
  }

  :global(.token-comment) {
    color: #94a3b8;
    font-style: italic;
  }
  :global(.token-keyword) {
    color: #ec4899;
    font-weight: bold;
  }
  :global(.token-macro) {
    color: #38bdf8;
    font-weight: 600;
  }
  :global(.token-bracket) {
    color: #f59e0b;
  }
  :global(.token-string) {
    color: #a855f7;
  }
  :global(.token-number) {
    color: #10b981;
  }
</style>
