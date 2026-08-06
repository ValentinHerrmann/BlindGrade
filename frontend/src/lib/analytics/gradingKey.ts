import type { GradeCutoff, GradingKeyConfig } from '$lib/db/schema';

export const DEFAULT_CUTOFFS_LINEAR_50: GradeCutoff[] = [
  { grade: '1', label: 'Sehr gut', minPercentage: 87.5 },
  { grade: '2', label: 'Gut', minPercentage: 75 },
  { grade: '3', label: 'Befriedigend', minPercentage: 62.5 },
  { grade: '4', label: 'Ausreichend', minPercentage: 50 },
  { grade: '5', label: 'Mangelhaft', minPercentage: 25 },
  { grade: '6', label: 'Ungenügend', minPercentage: 0 },
];

export const DEFAULT_CUTOFFS_LINEAR_40: GradeCutoff[] = [
  { grade: '1', label: 'Sehr gut', minPercentage: 85 },
  { grade: '2', label: 'Gut', minPercentage: 70 },
  { grade: '3', label: 'Befriedigend', minPercentage: 55 },
  { grade: '4', label: 'Ausreichend', minPercentage: 40 },
  { grade: '5', label: 'Mangelhaft', minPercentage: 20 },
  { grade: '6', label: 'Ungenügend', minPercentage: 0 },
];

export const DEFAULT_CUTOFFS_EVEN_SPLIT: GradeCutoff[] = [
  { grade: '1', label: 'Sehr gut', minPercentage: 83.33 },
  { grade: '2', label: 'Gut', minPercentage: 66.66 },
  { grade: '3', label: 'Befriedigend', minPercentage: 50 },
  { grade: '4', label: 'Ausreichend', minPercentage: 33.33 },
  { grade: '5', label: 'Mangelhaft', minPercentage: 16.66 },
  { grade: '6', label: 'Ungenügend', minPercentage: 0 },
];

export function getPresetCutoffs(preset: GradingKeyConfig['preset']): GradeCutoff[] {
  switch (preset) {
    case 'linear_50':
      return structuredClone(DEFAULT_CUTOFFS_LINEAR_50);
    case 'linear_40':
      return structuredClone(DEFAULT_CUTOFFS_LINEAR_40);
    case 'even_split':
      return structuredClone(DEFAULT_CUTOFFS_EVEN_SPLIT);
    case 'custom':
    default:
      return structuredClone(DEFAULT_CUTOFFS_LINEAR_50);
  }
}

/**
 * Calculate grade from a raw percentage (0-100) using the grading key.
 */
export function calculateGradeFromPercentage(
  percentage: number,
  keyConfig?: GradingKeyConfig
): { grade: string; label: string } | null {
  if (!keyConfig?.cutoffs || keyConfig.cutoffs.length === 0) {
    return null;
  }

  // Sort cutoffs descending by minPercentage
  const sorted = [...keyConfig.cutoffs].sort((a, b) => b.minPercentage - a.minPercentage);

  for (const item of sorted) {
    if (percentage >= item.minPercentage) {
      return { grade: item.grade, label: item.label };
    }
  }

  const fallback = sorted.at(-1);
  return fallback ? { grade: fallback.grade, label: fallback.label } : null;
}

export function calculateGrade(
  score: number,
  maxPoints: number,
  keyConfig?: GradingKeyConfig
): { grade: string; label: string } | null {
  if (!keyConfig?.cutoffs || keyConfig.cutoffs.length === 0 || maxPoints <= 0) {
    return null;
  }

  const percentage = (score / maxPoints) * 100;
  return calculateGradeFromPercentage(percentage, keyConfig);
}

export interface GradeDetail {
  grade: string;
  label: string;
  minPercentage: number;
  minPoints: number;
  nextHigher?: {
    grade: string;
    label: string;
    pointsNeeded: number;
  };
  nextLower?: {
    grade: string;
    label: string;
    pointsBuffer: number;
  };
}

export function calculateGradeDetail(
  score: number,
  maxPoints: number,
  keyConfig?: GradingKeyConfig
): GradeDetail | null {
  if (!keyConfig?.cutoffs || keyConfig.cutoffs.length === 0 || maxPoints <= 0) {
    return null;
  }

  const percentage = (score / maxPoints) * 100;
  const sorted = [...keyConfig.cutoffs].sort((a, b) => b.minPercentage - a.minPercentage);

  let currIdx = sorted.findIndex((item) => percentage >= item.minPercentage);
  if (currIdx === -1) {
    currIdx = sorted.length - 1;
  }

  const currentCutoff = sorted[currIdx];
  const currentMinPoints = (currentCutoff.minPercentage / 100) * maxPoints;

  let nextHigher: GradeDetail['nextHigher'] = undefined;
  if (currIdx > 0) {
    const higherCutoff = sorted[currIdx - 1];
    const higherMinPoints = (higherCutoff.minPercentage / 100) * maxPoints;
    const pointsNeeded = Math.max(0, Math.round((higherMinPoints - score) * 100) / 100);
    nextHigher = {
      grade: higherCutoff.grade,
      label: higherCutoff.label,
      pointsNeeded,
    };
  }

  let nextLower: GradeDetail['nextLower'] = undefined;
  if (currIdx < sorted.length - 1) {
    const lowerCutoff = sorted[currIdx + 1];
    const pointsBuffer = Math.max(0, Math.round((score - currentMinPoints) * 100) / 100);
    nextLower = {
      grade: lowerCutoff.grade,
      label: lowerCutoff.label,
      pointsBuffer,
    };
  }

  return {
    grade: currentCutoff.grade,
    label: currentCutoff.label,
    minPercentage: currentCutoff.minPercentage,
    minPoints: currentMinPoints,
    nextHigher,
    nextLower,
  };
}

/**
 * Grade distribution: counts how many submissions fall into each grade bracket.
 */
export interface GradeDistributionBucket {
  grade: string;
  label: string;
  count: number;
  minPercentage: number;
}

export function calculateGradeDistribution(
  percentages: number[],
  keyConfig?: GradingKeyConfig
): GradeDistributionBucket[] {
  if (!keyConfig?.cutoffs || keyConfig.cutoffs.length === 0) {
    return [];
  }

  // Sort cutoffs ascending by minPercentage (worst grade first) so we can display 1..6
  const sorted = [...keyConfig.cutoffs].sort((a, b) => b.minPercentage - a.minPercentage);

  // Initialize buckets
  const buckets = sorted.map((cutoff) => ({
    grade: cutoff.grade,
    label: cutoff.label,
    count: 0,
    minPercentage: cutoff.minPercentage,
  }));

  // Assign each percentage to a grade bucket
  percentages.forEach((p) => {
    const gradeInfo = calculateGradeFromPercentage(p, keyConfig);
    if (gradeInfo) {
      const bucket = buckets.find((b) => b.grade === gradeInfo.grade);
      if (bucket) {
        bucket.count++;
      }
    }
  });

  return buckets;
}