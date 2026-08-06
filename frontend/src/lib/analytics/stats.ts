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

export interface PercentageEntry {
  percentage: number;
  gradedCount: number;
  totalCount: number;
}

/**
 * Calculate preliminary percentage for a submission based on graded exercises only.
 * For example, if exercises have maxPoints {5,3,10,15} and scores are {4,1,null,null},
 * the percentage is (4+1)/(5+3) = 62.5%
 *
 * @param exerciseMaxPoints - array of max points per exercise in order
 * @param exerciseScores - array of actual scores (null/undefined = not graded)
 * @returns percentage entry or null if no exercises are graded
 */
export function calculateSubmissionPercentage(
  exerciseMaxPoints: number[],
  exerciseScores: (number | null | undefined)[]
): PercentageEntry | null {
  let gradedSum = 0;
  let gradedMaxSum = 0;
  let gradedCount = 0;
  const totalCount = exerciseMaxPoints.length;

  for (let i = 0; i < exerciseMaxPoints.length; i++) {
    const score = exerciseScores[i];
    if (score !== null && score !== undefined) {
      gradedSum += score;
      gradedMaxSum += exerciseMaxPoints[i];
      gradedCount++;
    }
  }

  if (gradedCount === 0 || gradedMaxSum === 0) return null;

  const percentage = (gradedSum / gradedMaxSum) * 100;
  return { percentage, gradedCount, totalCount };
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

/**
 * Build a percentage-based histogram (0-100%, fixed 10 bins of 10% each).
 */
export interface PercentageHistogramBin {
  binStart: number;
  binEnd: number;
  count: number;
}

export function calculatePercentageHistogram(percentages: number[]): PercentageHistogramBin[] {
  const bins: PercentageHistogramBin[] = Array.from({ length: 10 }).map((_, i) => ({
    binStart: i * 10,
    binEnd: (i + 1) * 10,
    count: 0,
  }));

  percentages.forEach((p) => {
    let binIdx = Math.floor(p / 10);
    if (binIdx < 0) binIdx = 0;
    if (binIdx >= 10) binIdx = 9;
    bins[binIdx].count++;
  });

  return bins;
}
