<script lang="ts">
  import type { GradingKeyConfig, GradeCutoff } from '$lib/db/schema';
  import { getPresetCutoffs } from '$lib/analytics/gradingKey';

  export let gradingKey: GradingKeyConfig = {
    preset: 'linear_50',
    cutoffs: getPresetCutoffs('linear_50'),
  };

  $: if (!gradingKey || !gradingKey.cutoffs || gradingKey.cutoffs.length === 0) {
    gradingKey = {
      preset: 'linear_50',
      cutoffs: getPresetCutoffs('linear_50'),
    };
  }

  function applyPreset(preset: GradingKeyConfig['preset']) {
    gradingKey = {
      preset,
      cutoffs: getPresetCutoffs(preset),
    };
  }

  function handleInputChange() {
    gradingKey.preset = 'custom';
    gradingKey = { ...gradingKey };
  }
</script>

<div class="grading-key-editor">
  <div class="editor-header">
    <div class="title-group">
      <h4 class="title">
        <svg class="header-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Notenschlüssel (Noten 1 bis 6)
      </h4>
      <p class="subtitle">
        Definiere die Mindestprozentgrenzen für die automatische Notenberechnung in der Korrekturansicht.
      </p>
    </div>

    <!-- Presets -->
    <div class="presets-bar">
      <button
        type="button"
        class="preset-btn"
        class:active={gradingKey.preset === 'linear_50'}
        on:click={() => applyPreset('linear_50')}
      >
        Klassisch (50% = Note 4)
      </button>
      <button
        type="button"
        class="preset-btn"
        class:active={gradingKey.preset === 'linear_40'}
        on:click={() => applyPreset('linear_40')}
      >
        Oberstufe (40% = Note 4)
      </button>
      <button
        type="button"
        class="preset-btn"
        class:active={gradingKey.preset === 'even_split'}
        on:click={() => applyPreset('even_split')}
      >
        Gleichmäßig
      </button>
      {#if gradingKey.preset === 'custom'}
        <span class="custom-badge">Individuell</span>
      {/if}
    </div>
  </div>

  <!-- Cutoffs Grid -->
  <div class="cutoffs-grid">
    {#each gradingKey.cutoffs as cutoff, idx}
      <div class="cutoff-card">
        <div class="card-header">
          <span class="grade-badge">
            Note {cutoff.grade}
          </span>
          <span class="grade-label">{cutoff.label}</span>
        </div>

        <div class="card-input-row">
          <span class="input-prefix">Ab</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            class="percentage-input"
            bind:value={cutoff.minPercentage}
            on:input={handleInputChange}
          />
          <span class="input-suffix">%</span>
        </div>

        <div class="range-hint">
          {#if idx === 0}
            {cutoff.minPercentage}% – 100%
          {:else}
            {cutoff.minPercentage}% – &lt;{gradingKey.cutoffs[idx - 1].minPercentage}%
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .grading-key-editor {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1rem;
    margin-bottom: 1rem;
  }

  .editor-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .title-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: #f8fafc;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .header-icon {
    width: 20px;
    height: 20px;
    color: #818cf8;
    flex-shrink: 0;
  }

  .subtitle {
    margin: 0;
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .presets-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    background: #1e293b;
    padding: 0.25rem;
    border-radius: 8px;
    border: 1px solid #334155;
  }

  .preset-btn {
    background: transparent;
    border: none;
    color: #cbd5e1;
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .preset-btn:hover {
    background: #334155;
    color: #ffffff;
  }

  .preset-btn.active {
    background: #4f46e5;
    color: #ffffff;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .custom-badge {
    font-size: 0.7rem;
    color: #818cf8;
    font-family: monospace;
    padding: 0 0.5rem;
  }

  .cutoffs-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
  }

  .cutoff-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .grade-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.15rem 0.5rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 700;
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
    border: 1px solid rgba(99, 102, 241, 0.3);
  }

  .grade-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: #cbd5e1;
  }

  .card-input-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .input-prefix, .input-suffix {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .percentage-input {
    width: 75px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 0.25rem 0.35rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: #f8fafc;
    text-align: center;
  }

  .percentage-input:focus {
    outline: none;
    border-color: #6366f1;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
  }

  .range-hint {
    font-size: 0.7rem;
    color: #64748b;
    font-family: monospace;
  }
</style>
