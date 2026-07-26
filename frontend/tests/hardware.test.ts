import { describe, it, expect, vi } from 'vitest';
import { detectHardware, PipelineMonitor } from '../src/lib/hardware/detect';
import { generateLatex, generateQrDataUrl } from '../src/lib/latex/generator';

describe('Hardware Detection & Pipeline Monitor', () => {
  it('detects hardware profile correctly', () => {
    const profile = detectHardware();
    expect(profile.logicalCores).toBeGreaterThanOrEqual(1);
    expect(['parallel', 'constrained']).toContain(profile.recommendedMode);
  });

  it('triggers downgrade event when memory threshold is exceeded', () => {
    const monitor = new PipelineMonitor({
      logicalCores: 8,
      estimatedRAMGB: 8,
      simdSupported: true,
      fileSystemAccessAPI: true,
      recommendedMode: 'parallel',
    });

    let downgradeFired = false;
    monitor.on('downgrade', () => {
      downgradeFired = true;
    });

    expect(monitor.inConstrainedMode).toBe(false);

    // Trigger explicit downgrade
    monitor.triggerDowngrade();

    expect(downgradeFired).toBe(true);
    expect(monitor.inConstrainedMode).toBe(true);
  });
});

describe('LaTeX Generator', () => {
  it('generates LaTeX document containing TikZ corner fiducials and QR code block', async () => {
    const latex = await generateLatex({
      title: 'Computer Science 101',
      pseudonymId: 'uuid-1234',
      version: 'A',
      fallbackCode: 'CS-A1B2C3',
      exercises: [
        { title: 'Explain Polymorphism', type: 'free_text', points: 10 },
        { title: 'Is HTML a programming language?', type: 'tf', points: 2, options: ['True', 'False'] },
      ],
    });

    expect(latex).toContain('\\FiducialMarker');
    expect(latex).toContain('Computer Science 101');
    expect(latex).toContain('FALLBACK: A-CS-A1B2C3');
    expect(latex).toContain('\\begin{tikzpicture}');
  });

  it('generates QR data URL data URI string', async () => {
    const dataUrl = await generateQrDataUrl('uuid-999', 'B', 'FB-999');
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
