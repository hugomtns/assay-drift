import { describe, it, expect } from 'vitest';
import { insertionsInWindow } from './insertions';
import { buildWindowSpec } from '../query';
import { findBindingSites, type ReferenceGenome } from '../binding';
import type { InsertionRow } from '../lapis/endpoints';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};
const w = () =>
  buildWindowSpec(findBindingSites('ATGCATGC', REF)[0]!, 'ATGCATGC', REF, 'forward', { segmented: false });

const ins = (over: Partial<InsertionRow>): InsertionRow => ({
  insertion: 'ins_7:AA', count: 5, insertedSymbols: 'AA', position: 7, sequenceName: null, ...over,
});

describe('insertionsInWindow', () => {
  it('keeps insertions inside the window and reports the fraction', () => {
    const out = insertionsInWindow(w(), [ins({ position: 7, count: 25 })], 500);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ refPos: 7, insertedSymbols: 'AA', count: 25 });
    expect(out[0]!.fractionOfDenominator).toBeCloseTo(0.05, 6);
  });

  it('drops insertions outside the window', () => {
    expect(insertionsInWindow(w(), [ins({ position: 3 }), ins({ position: 15 })], 500)).toHaveLength(0);
  });

  it('filters by segment', () => {
    const SEG: ReferenceGenome = {
      pathogenId: 'flu',
      segments: [
        { name: 'seg1', sequence: 'TTTTTTTTTTTTTTTT' },
        { name: 'seg4', sequence: 'CCCCATGCATGCGGGG' },
      ],
    };
    const spec = buildWindowSpec(
      findBindingSites('ATGCATGC', SEG)[0]!, 'ATGCATGC', SEG, 'forward', { segmented: true },
    );
    const out = insertionsInWindow(
      spec, [ins({ position: 7, sequenceName: 'seg1' }), ins({ position: 7, sequenceName: 'seg4' })], 500,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.refPos).toBe(7);
  });

  it('returns a zero fraction rather than dividing by zero', () => {
    expect(insertionsInWindow(w(), [ins({ position: 7 })], 0)[0]!.fractionOfDenominator).toBe(0);
  });

  it('sorts by count descending', () => {
    const out = insertionsInWindow(
      w(), [ins({ position: 7, count: 2 }), ins({ position: 9, count: 30, insertedSymbols: 'T' })], 500,
    );
    expect(out.map((o) => o.count)).toEqual([30, 2]);
  });
});
