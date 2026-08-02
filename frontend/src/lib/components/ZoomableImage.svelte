<script lang="ts">
  export let src: string;
  export let alt: string = '';

  let zoomLevel = 1.0;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5.0;

  function resetPan() {
    if (zoomLevel <= 1) {
      panX = 0;
      panY = 0;
    }
  }

  function zoomIn() {
    zoomLevel = Math.min(zoomLevel + 0.25, MAX_ZOOM);
    resetPan();
  }

  function zoomOut() {
    const oldZoom = zoomLevel;
    zoomLevel = Math.max(zoomLevel - 0.25, MIN_ZOOM);
    if (zoomLevel <= 1) {
      panX = 0;
      panY = 0;
    } else if (oldZoom <= 1) {
      // transitioning from fit to zoomed, center the image
      panX = 0;
      panY = 0;
    }
  }

  function reset() {
    zoomLevel = 1.0;
    panX = 0;
    panY = 0;
  }

  function toggleZoom() {
    if (zoomLevel > 1.0) {
      reset();
    } else {
      zoomLevel = 2.0;
      panX = 0;
      panY = 0;
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const oldZoom = zoomLevel;
    zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + delta));
    if (oldZoom <= 1 && zoomLevel > 1) {
      panX = 0;
      panY = 0;
    } else if (zoomLevel <= 1) {
      panX = 0;
      panY = 0;
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (zoomLevel <= 1) return;
    isDragging = true;
    dragStartX = e.clientX - panX;
    dragStartY = e.clientY - panY;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    panX = e.clientX - dragStartX;
    panY = e.clientY - dragStartY;
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function handleMouseLeave() {
    isDragging = false;
  }
</script>

<div
  class="zoomable-container"
  class:grabbing={isDragging}
  class:zoomed={zoomLevel > 1}
  on:wheel|preventDefault={handleWheel}
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
  on:mouseleave={handleMouseLeave}
  on:dblclick={toggleZoom}
>
  <img
    src={src}
    alt={alt}
    class="zoomable-image"
    style="transform: translate({panX}px, {panY}px) scale({zoomLevel});"
    draggable="false"
  />

  <div class="zoom-controls">
    <button class="zoom-btn" on:click={zoomOut} title="Zoom Out">−</button>
    <span class="zoom-level">{Math.round(zoomLevel * 100)}%</span>
    <button class="zoom-btn" on:click={zoomIn} title="Zoom In">+</button>
    <button class="zoom-btn reset-btn" on:click={reset} title="Reset to Fit">Fit</button>
  </div>
</div>

<style>
  .zoomable-container {
    position: relative;
    width: 100%;
    min-height: 200px;
    max-height: 70vh;
    overflow: hidden;
    cursor: grab;
    background: #1e293b;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .zoomable-container.grabbing {
    cursor: grabbing;
  }

  .zoomable-container.zoomed {
    cursor: grab;
  }

  .zoomable-image {
    max-width: 100%;
    max-height: 70vh;
    object-fit: contain;
    transition: transform 0.05s ease-out;
    transform-origin: center center;
    pointer-events: none;
  }

  .zoom-controls {
    position: absolute;
    bottom: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(15, 23, 42, 0.85);
    border-radius: 8px;
    padding: 4px 8px;
    backdrop-filter: blur(4px);
    z-index: 10;
  }

  .zoom-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #f8fafc;
    font-size: 1.1rem;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s;
  }

  .zoom-btn:hover {
    background: rgba(148, 163, 184, 0.2);
  }

  .zoom-btn.reset-btn {
    width: auto;
    padding: 0 8px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .zoom-level {
    color: #94a3b8;
    font-size: 0.8rem;
    font-weight: 500;
    min-width: 42px;
    text-align: center;
    font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
  }
</style>
