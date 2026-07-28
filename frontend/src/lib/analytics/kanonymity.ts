/**
 * k-Anonymity gate (k >= 5).
 *
 * Suppresses class group statistics if the sample size is under 5 students.
 */

export const K_ANONYMITY_MIN_K = 5;

export interface KAnonymityCheckResult {
  satisfied: boolean;
  sampleSize: number;
  minRequired: number;
  message?: string;
}

export function checkKAnonymity(sampleSize: number): KAnonymityCheckResult {
  const satisfied = sampleSize >= K_ANONYMITY_MIN_K;
  return {
    satisfied,
    sampleSize,
    minRequired: K_ANONYMITY_MIN_K,
    message: satisfied
      ? undefined
      : `Class statistics suppressed: minimum k=${K_ANONYMITY_MIN_K} students required (currently ${sampleSize}).`,
  };
}
