/**
 * Hardware Detection & Dynamic Heap Pipeline Monitor.
 *
 * Probes CPU cores, device memory estimation, and WebAssembly SIMD support.
 * Monitors heap usage in Chrome (performance.memory) to dynamically downgrade
 * parallel pipeline processing to assembly-line mode if heap exceeds 70% threshold.
 */

export interface HardwareProfile {
  logicalCores: number;
  estimatedRAMGB: number;
  simdSupported: boolean;
  fileSystemAccessAPI: boolean;
  recommendedMode: 'parallel' | 'constrained';
}

/** Check WebAssembly SIMD support via short probe. */
export function checkSimdSupport(): boolean {
  try {
    // 11-byte WASM SIMD probe module bytes
    const simdProbeBytes = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
    ]);
    return WebAssembly.validate(simdProbeBytes);
  } catch {
    return false;
  }
}

/** Probe current browser environment hardware profile. */
export function detectHardware(): HardwareProfile {
  const logicalCores = navigator.hardwareConcurrency || 2;
  // deviceMemory is rounded to powers of 2 by browsers; Firefox privacy.resistFingerprinting omits it
  const estimatedRAMGB = (navigator as any).deviceMemory || 2;
  const simdSupported = checkSimdSupport();
  const fileSystemAccessAPI = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  const isLowEnd = estimatedRAMGB < 4 || logicalCores < 4;
  const recommendedMode: 'parallel' | 'constrained' = isLowEnd ? 'constrained' : 'parallel';

  return {
    logicalCores,
    estimatedRAMGB,
    simdSupported,
    fileSystemAccessAPI,
    recommendedMode,
  };
}

export type PipelineMonitorEvent = 'downgrade';

export class PipelineMonitor {
  private listeners: Set<(evt: PipelineMonitorEvent) => void> = new Set();
  private isDowngraded = false;

  constructor(initialProfile?: HardwareProfile) {
    const profile = initialProfile || detectHardware();
    if (profile.recommendedMode === 'constrained') {
      this.isDowngraded = true;
    }
  }

  public on(event: PipelineMonitorEvent, callback: (evt: PipelineMonitorEvent) => void) {
    this.listeners.add(callback);
  }

  public off(event: PipelineMonitorEvent, callback: (evt: PipelineMonitorEvent) => void) {
    this.listeners.delete(callback);
  }

  /** Call after processing each scan page/group to monitor memory health. */
  public checkMemoryHealth(): void {
    if (this.isDowngraded) return;

    const perfMemory = (performance as any).memory;
    if (perfMemory && perfMemory.usedJSHeapSize && perfMemory.jsHeapSizeLimit) {
      const usageRatio = perfMemory.usedJSHeapSize / perfMemory.jsHeapSizeLimit;
      if (usageRatio > 0.7) {
        console.warn(
          `[PipelineMonitor] High memory usage detected (${(usageRatio * 100).toFixed(
            1
          )}%). Downgrading to constrained assembly-line mode.`
        );
        this.triggerDowngrade();
      }
    }
  }

  /** Explicitly trigger downgrade (e.g. on QuotaExceededError or RangeError). */
  public triggerDowngrade(): void {
    if (this.isDowngraded) return;
    this.isDowngraded = true;
    for (const listener of this.listeners) {
      listener('downgrade');
    }
  }

  public get inConstrainedMode(): boolean {
    return this.isDowngraded;
  }
}
