import { describe, it, expect } from 'vitest';
import { checkAssayGeometry } from './assay-geometry';
import type { BindingSite } from './binding';

const site = (over: Partial<BindingSite>): BindingSite => ({
  segment: 'main', strand: 'plus', start: 100, end: 120, mismatches: 0, mismatchOligoIndexes: [], ...over,
});

describe('checkAssayGeometry', () => {
  it('accepts a well-formed qPCR assay', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 200, end: 222, strand: 'minus' }),
      probe: site({ start: 140, end: 162, strand: 'plus' }),
    });
    expect(r.ok).toBe(true);
    expect(r.ampliconLength).toBe(123);
    expect(r.problems).toEqual([]);
  });

  it('rejects primers on the same strand', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 200, end: 222, strand: 'plus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/minus strand/i);
  });

  it('rejects primers on different segments', () => {
    const r = checkAssayGeometry({
      forward: site({ segment: 'seg4', strand: 'plus' }),
      reverse: site({ segment: 'seg6', strand: 'minus', start: 200, end: 222 }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/same segment/i);
  });

  it('rejects an implausibly long amplicon', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 900, end: 922, strand: 'minus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.ampliconLength).toBe(823);
    expect(r.problems.join(' ')).toMatch(/300/);
  });

  it('rejects an inverted primer pair', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 400, end: 420, strand: 'plus' }),
      reverse: site({ start: 100, end: 122, strand: 'minus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/downstream/i);
  });

  it('rejects a probe that overlaps a primer', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 200, end: 222, strand: 'minus' }),
      probe: site({ start: 118, end: 140, strand: 'plus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/overlap/i);
  });
});
