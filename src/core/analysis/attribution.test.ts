import { describe, it, expect } from 'vitest';
import { buildAttribution } from './attribution';
import type { AggregatedRow } from '../lapis/endpoints';

const rows = (pairs: [string | null, number][]): AggregatedRow[] =>
  pairs.map(([value, count]) => ({ count, pangoLineage: value }));

describe('buildAttribution', () => {
  it('sorts descending and computes shares of the total', () => {
    const a = buildAttribution(rows([['B.1.1.7', 900], ['B.1.177', 100]]), 'pangoLineage');
    expect(a.rows.map((r) => r.value)).toEqual(['B.1.1.7', 'B.1.177']);
    expect(a.rows[0]!.share).toBeCloseTo(0.9, 6);
    expect(a.total).toBe(1000);
    expect(a.topShare).toBeCloseTo(0.9, 6);
  });

  it('collapses the tail into otherCount', () => {
    const many: [string | null, number][] = Array.from(
      { length: 15 }, (_, i) => [`L${i}`, 15 - i],
    );
    const a = buildAttribution(rows(many), 'pangoLineage', { limit: 3 });
    expect(a.rows).toHaveLength(3);
    expect(a.otherCount).toBe(a.total - a.rows.reduce((s, r) => s + r.count, 0));
    expect(a.otherCount).toBeGreaterThan(0);
  });

  it('counts null values as unassigned rather than as a lineage', () => {
    const a = buildAttribution(rows([[null, 40], ['B.1.1.7', 60]]), 'pangoLineage');
    expect(a.unassignedCount).toBe(40);
    expect(a.rows).toHaveLength(1);
    expect(a.total).toBe(100);
  });

  it('handles an empty result', () => {
    const a = buildAttribution([], 'pangoLineage');
    expect(a.rows).toEqual([]);
    expect(a.total).toBe(0);
    expect(a.topShare).toBe(0);
  });
});
