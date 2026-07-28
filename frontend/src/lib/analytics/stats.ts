/**
 * Statistics calculations (mean, std dev, median, histogram).
 */

export interface SummaryStats {
  count: number;
  mean: number;
  stdDev: number;
  median: number;
  min: number;
  max: number;
  histogram: { binStart: number; binEnd: number; count: number }[];
}

export function calculateSummaryStats(scores: number[]): SummaryStats | null {
  if (scores.length === 0) return null;

  const count = scores.length;
  const sorted = [...scores].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[count - 1];

  const sum = scores.reduce((acc, x) => acc + x, 0);
  const mean = sum / count;

  const variance = scores.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  const mid = Math.floor(count / 2);
  const median = count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  // Build 5 histogram bins
  const binCount = 5;
  const step = (max - min) / binCount || 1;
  const histogram = Array.from({ length: binCount }).map((_, i) => ({
    binStart: Math.round((min + i * step) * 10) / 10,
    binEnd: Math.round((min + (i + 1) * step) * 10) / 10,
    count: 0,
  }));

  scores.forEach((s) => {
    let binIdx = Math.floor((s - min) / step);
    if (binIdx >= binCount) binIdx = binCount - 1;
    histogram[binIdx].count++;
  });

  return {
    count,
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    median: Math.round(median * 100) / 100,
    min,
    max,
    histogram,
  };
}
