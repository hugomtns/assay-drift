import { describe, it, expect } from 'vitest';
import { buildTrend, bucketOf, chooseGranularity } from './trend';
import type { AggregatedRow } from '../lapis/endpoints';

const rows = (pairs: [string | null, number][]): AggregatedRow[] =>
  pairs.map(([date, count]) => ({ count, date }));

describe('chooseGranularity', () => {
  it('uses weeks for short windows', () => {
    expect(chooseGranularity('2025-01-01', '2025-03-01')).toBe('week');
  });
  it('uses months beyond six months', () => {
    expect(chooseGranularity('2024-01-01', '2025-06-30')).toBe('month');
  });
});

describe('bucketOf', () => {
  it('buckets by calendar month', () => {
    expect(bucketOf('2025-03-17', 'month')).toBe('2025-03');
  });
  it('buckets by the ISO Monday of the week', () => {
    expect(bucketOf('2025-03-19', 'week')).toBe('2025-03-17'); // Wednesday -> Monday
    expect(bucketOf('2025-03-17', 'week')).toBe('2025-03-17'); // Monday -> itself
    expect(bucketOf('2025-03-23', 'week')).toBe('2025-03-17'); // Sunday -> that Monday
  });
});

describe('buildTrend', () => {
  it('joins coverage and mismatch rows by bucket', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-01-10', 100], ['2025-02-10', 200]]),
      mismatchRows: rows([['2025-01-10', 5], ['2025-02-10', 60]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.granularity).toBe('month');
    expect(series.points.map((p) => p.bucket)).toEqual(['2025-01', '2025-02']);
    expect(series.points[0]!.mismatchFraction).toBeCloseTo(0.05, 6);
    expect(series.points[1]!.mismatchFraction).toBeCloseTo(0.3, 6);
  });

  it('sums multiple dates falling in the same bucket', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-01-02', 40], ['2025-01-20', 60]]),
      mismatchRows: rows([['2025-01-02', 4], ['2025-01-20', 6]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points).toHaveLength(1);
    expect(series.points[0]!.nFullCoverage).toBe(100);
    expect(series.points[0]!.nMismatch).toBe(10);
  });

  it('emits buckets in chronological order', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-03-01', 100], ['2025-01-01', 100], ['2025-02-01', 100]]),
      mismatchRows: [], dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points.map((p) => p.bucket)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('reports undated rows separately instead of dropping them', () => {
    const series = buildTrend({
      coverageRows: rows([[null, 17], ['2025-01-01', 100]]),
      mismatchRows: rows([[null, 3]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.undatedFullCoverage).toBe(17);
    expect(series.undatedMismatch).toBe(3);
    expect(series.points).toHaveLength(1);
  });

  it('marks thin buckets as insufficient and nulls their fraction', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-01-01', 10]]),
      mismatchRows: rows([['2025-01-01', 5]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points[0]!.sufficientData).toBe(false);
    expect(series.points[0]!.mismatchFraction).toBeNull();
  });

  it('honours a non-default date field name', () => {
    const series = buildTrend({
      coverageRows: [{ count: 80, sampleCollectionDateRangeLower: '2025-05-05' }],
      mismatchRows: [{ count: 40, sampleCollectionDateRangeLower: '2025-05-05' }],
      dateField: 'sampleCollectionDateRangeLower', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points[0]!.nFullCoverage).toBe(80);
  });
});
