import { describe, it, expect } from 'vitest';
import { computeWindowMetrics, sumCounts } from './metrics';

describe('sumCounts', () => {
  it('adds the count column across grouped rows', () => {
    expect(sumCounts([{ count: 3, date: 'a' }, { count: 4, date: 'b' }])).toBe(7);
  });
  it('is zero for no rows', () => {
    expect(sumCounts([])).toBe(0);
  });
});

describe('computeWindowMetrics', () => {
  it('reproduces the Alpha February 2021 figures', () => {
    const m = computeWindowMetrics({ nScope: 71142, nFullCoverage: 70387, nMismatch: 67520 });
    expect(m.mismatchFraction).toBeCloseTo(0.9593, 4);
    expect(m.coverageGap).toBe(755);
    expect(m.coverageGapFraction).toBeCloseTo(0.0106, 4);
    expect(m.sufficientData).toBe(true);
  });

  it('reproduces the conserved control figures', () => {
    const m = computeWindowMetrics({ nScope: 46667, nFullCoverage: 44669, nMismatch: 3 });
    expect(m.mismatchFraction).toBeCloseTo(0.0000672, 7);
    expect(m.coverageGap).toBe(1998);
    expect(m.coverageGapFraction).toBeCloseTo(0.0428, 4);
  });

  it('returns null rather than zero when nothing is assessable', () => {
    const m = computeWindowMetrics({ nScope: 40, nFullCoverage: 0, nMismatch: 0 });
    expect(m.mismatchFraction).toBeNull();
    expect(m.sufficientData).toBe(false);
    expect(m.coverageGapFraction).toBe(1);
  });

  it('flags an insufficient denominator', () => {
    expect(computeWindowMetrics({ nScope: 60, nFullCoverage: 49, nMismatch: 1 }).sufficientData).toBe(false);
    expect(computeWindowMetrics({ nScope: 60, nFullCoverage: 50, nMismatch: 1 }).sufficientData).toBe(true);
  });

  it('reports a zero coverage gap fraction when the scope itself is empty', () => {
    const m = computeWindowMetrics({ nScope: 0, nFullCoverage: 0, nMismatch: 0 });
    expect(m.coverageGapFraction).toBe(0);
    expect(m.mismatchFraction).toBeNull();
  });

  it('throws when the numerator exceeds the denominator', () => {
    expect(() => computeWindowMetrics({ nScope: 100, nFullCoverage: 80, nMismatch: 81 }))
      .toThrow(/exceeds/i);
  });

  it('throws when full coverage exceeds the scope', () => {
    expect(() => computeWindowMetrics({ nScope: 10, nFullCoverage: 11, nMismatch: 0 }))
      .toThrow(/exceeds/i);
  });
});
