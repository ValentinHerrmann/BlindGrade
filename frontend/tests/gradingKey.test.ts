import { describe, it, expect } from 'vitest';
import { calculateGrade, calculateGradeDetail, DEFAULT_CUTOFFS_LINEAR_50 } from '../src/lib/analytics/gradingKey';
import type { GradingKeyConfig } from '../src/lib/db/schema';

describe('gradingKey analytics', () => {
  const config: GradingKeyConfig = {
    preset: 'linear_50',
    cutoffs: DEFAULT_CUTOFFS_LINEAR_50,
  };

  it('calculates grade correctly for top score', () => {
    const detail = calculateGradeDetail(28, 30, config);
    expect(detail).not.toBeNull();
    expect(detail?.grade).toBe('1');
    expect(detail?.label).toBe('Sehr gut');
    expect(detail?.nextHigher).toBeUndefined();
    expect(detail?.nextLower).toBeDefined();
    expect(detail?.nextLower?.grade).toBe('2');
  });

  it('calculates grade detail and margin distances for middle score', () => {
    // 24 / 30 = 80% -> Grade 2 (75% = 22.5 pts). Grade 1 (87.5% = 26.25 pts)
    const detail = calculateGradeDetail(24, 30, config);
    expect(detail).not.toBeNull();
    expect(detail?.grade).toBe('2');
    expect(detail?.label).toBe('Gut');

    // Points needed for Grade 1: 26.25 - 24 = 2.25
    expect(detail?.nextHigher?.grade).toBe('1');
    expect(detail?.nextHigher?.pointsNeeded).toBe(2.25);

    // Buffer above Grade 2 threshold (22.5 pts): 24 - 22.5 = 1.5
    expect(detail?.nextLower?.grade).toBe('3');
    expect(detail?.nextLower?.pointsBuffer).toBe(1.5);
  });

  it('calculates grade detail for lowest score', () => {
    // 5 / 30 = 16.67% -> Grade 6 (< 25%)
    const detail = calculateGradeDetail(5, 30, config);
    expect(detail).not.toBeNull();
    expect(detail?.grade).toBe('6');
  });
});
