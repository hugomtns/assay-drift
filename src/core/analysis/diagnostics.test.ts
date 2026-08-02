import { describe, it, expect } from 'vitest';
import { computeDiagnostics } from './diagnostics';
import { computeWindowMetrics } from './metrics';
import type { TrendSeries } from './trend';
import type { Attribution } from './attribution';

const trend = (counts: number[], over: Partial<TrendSeries> = {}): TrendSeries => ({
  granularity: 'month',
  points: counts.map((n, i) => ({
    bucket: `2025-${String(i + 1).padStart(2, '0')}`,
    nFullCoverage: n, nMismatch: 0,
    mismatchFraction: n > 0 ? 0 : null, sufficientData: n >= 50,
  })),
  undatedFullCoverage: 0, undatedMismatch: 0, ...over,
});

const country = (topShare: number): Attribution => ({
  field: 'country',
  rows: [{ value: 'United Kingdom', count: Math.round(topShare * 1000), share: topShare }],
  otherCount: 1000 - Math.round(topShare * 1000), unassignedCount: 0, total: 1000, topShare,
});

const ids = (list: { id: string }[]) => list.map((d) => d.id);

describe('computeDiagnostics', () => {
  it('reports no-data when nothing is in scope', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 0, nFullCoverage: 0, nMismatch: 0 }),
      trend: trend([]), country: country(0),
    });
    expect(ids(out)).toContain('no-data');
  });

  it('reports a small denominator', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 45, nFullCoverage: 40, nMismatch: 1 }),
      trend: trend([40]), country: country(0.4),
    });
    expect(ids(out)).toContain('small-n');
  });

  it('reports a large coverage gap', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 1000, nFullCoverage: 700, nMismatch: 10 }),
      trend: trend([700]), country: country(0.4),
    });
    const gap = out.find((d) => d.id === 'coverage-gap')!;
    expect(gap.message).toMatch(/300/);
    expect(gap.severity).toBe('warn');
  });

  it('reports deposition lag when the trailing buckets collapse', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 5000, nFullCoverage: 5000, nMismatch: 5 }),
      trend: trend([1000, 1000, 1000, 1000, 1000, 1000, 100, 40, 10, 2]),
      country: country(0.3),
    });
    expect(ids(out)).toContain('deposition-lag');
  });

  it('does not report deposition lag on a stable series', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 5000, nFullCoverage: 5000, nMismatch: 5 }),
      trend: trend([1000, 900, 1100, 950, 1000, 1050, 980, 1020]),
      country: country(0.3),
    });
    expect(ids(out)).not.toContain('deposition-lag');
  });

  it('reports geographic concentration', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 5000, nFullCoverage: 5000, nMismatch: 500 }),
      trend: trend([1000, 1000, 1000, 1000, 1000]), country: country(0.85),
    });
    const geo = out.find((d) => d.id === 'geographic-concentration')!;
    expect(geo.message).toMatch(/United Kingdom/);
    expect(geo.message).toMatch(/85/);
  });

  it('reports undated records', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 1000, nFullCoverage: 1000, nMismatch: 5 }),
      trend: trend([1000], { undatedFullCoverage: 120 }), country: country(0.3),
    });
    expect(ids(out)).toContain('undated-records');
  });

  it('returns nothing for a clean, well-sampled query', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 10000, nFullCoverage: 9900, nMismatch: 5 }),
      trend: trend([1000, 1000, 1000, 1000, 1000, 1000]), country: country(0.25),
    });
    expect(out).toEqual([]);
  });
});
