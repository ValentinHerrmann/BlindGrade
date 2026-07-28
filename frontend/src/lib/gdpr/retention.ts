/**
 * GDPR Retention Verification.
 *
 * Checks project/exam retention period against current date per Art. 5(1)(e).
 */

export interface RetentionCheckResult {
  isExpired: boolean;
  expiresAt: string;
  daysRemaining: number;
}

/**
 * Check if the project/exam has exceeded its retention date.
 *
 * @param expiresAtIso ISO date string (e.g. "2026-07-25T00:00:00Z" or "2026-07-25")
 */
export function checkRetention(expiresAtIso: string): RetentionCheckResult {
  const expiresAt = new Date(expiresAtIso).getTime();
  const now = Date.now();
  const diffMs = expiresAt - now;
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    isExpired: diffMs <= 0,
    expiresAt: expiresAtIso,
    daysRemaining,
  };
}
