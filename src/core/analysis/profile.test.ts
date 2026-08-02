import { describe, it, expect } from 'vitest';
import { buildPositionProfile, rowBelongsToWindow } from './profile';
import { buildWindowSpec } from '../query';
import { findBindingSites, type ReferenceGenome } from '../binding';
import type { MutationRow } from '../lapis/endpoints';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};
const SEG: ReferenceGenome = {
  pathogenId: 'flu',
  segments: [
    { name: 'seg1', sequence: 'TTTTTTTTTTTTTTTT' },
    { name: 'seg4', sequence: 'CCCCATGCATGCGGGG' },
  ],
};

const row = (over: Partial<MutationRow>): MutationRow => ({
  mutation: 'x', count: 0, coverage: 1000, proportion: 0,
  sequenceName: null, mutationFrom: 'A', mutationTo: 'C', position: 5, ...over,
});

const plusWindow = () =>
  buildWindowSpec(findBindingSites('ATGCATGC', REF)[0]!, 'ATGCATGC', REF, 'forward', { segmented: false });

describe('rowBelongsToWindow', () => {
  it('accepts a null sequenceName on an unsegmented genome', () => {
    expect(rowBelongsToWindow(row({ sequenceName: null }), plusWindow())).toBe(true);
  });
  it('accepts a sequenceName equal to the segment name on an unsegmented genome', () => {
    expect(rowBelongsToWindow(row({ sequenceName: 'main' }), plusWindow())).toBe(true);
  });
  it('rejects rows from another segment', () => {
    const w = buildWindowSpec(
      findBindingSites('ATGCATGC', SEG)[0]!, 'ATGCATGC', SEG, 'forward', { segmented: true },
    );
    expect(rowBelongsToWindow(row({ sequenceName: 'seg1' }), w)).toBe(false);
    expect(rowBelongsToWindow(row({ sequenceName: 'seg4' }), w)).toBe(true);
  });
});

describe('buildPositionProfile', () => {
  it('produces one entry per oligo position, in 5prime to 3prime order', () => {
    const profile = buildPositionProfile(plusWindow(), [], 1000);
    expect(profile).toHaveLength(8);
    expect(profile.map((p) => p.refPos)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(profile[0]!.oligoIndex).toBe(0);
  });

  it('marks positions with no row as inferred and zero mismatch', () => {
    const p = buildPositionProfile(plusWindow(), [], 1000)[0]!;
    expect(p.coverage).toBeNull();
    expect(p.coverageIsInferred).toBe(true);
    expect(p.effectiveDenominator).toBe(1000);
    expect(p.mismatchCount).toBe(0);
    expect(p.mismatchFraction).toBe(0);
  });

  it('uses the reported per-position coverage when a row exists', () => {
    const rows = [row({ position: 5, mutationFrom: 'A', mutationTo: 'G', count: 30, coverage: 900 })];
    const p = buildPositionProfile(plusWindow(), rows, 1000)[0]!;
    expect(p.coverage).toBe(900);
    expect(p.coverageIsInferred).toBe(false);
    expect(p.effectiveDenominator).toBe(900);
    expect(p.mismatchFraction).toBeCloseTo(30 / 900, 6);
  });

  it('separates deletions from substitutions', () => {
    const rows = [
      row({ position: 5, mutationTo: 'G', count: 10, coverage: 1000 }),
      row({ position: 5, mutationTo: '-', count: 40, coverage: 1000 }),
    ];
    const p = buildPositionProfile(plusWindow(), rows, 1000)[0]!;
    expect(p.substitutionCount).toBe(10);
    expect(p.deletionCount).toBe(40);
    expect(p.mismatchCount).toBe(50);
  });

  it('does not count an allele that a degenerate oligo base accepts', () => {
    // oligo base Y at reference position 8 (ref C) accepts C and T
    const site = findBindingSites('ATGYATGC', REF)[0]!;
    const w = buildWindowSpec(site, 'ATGYATGC', REF, 'forward', { segmented: false });
    const rows = [
      row({ position: 8, mutationFrom: 'C', mutationTo: 'T', count: 500, coverage: 1000 }),
      row({ position: 8, mutationFrom: 'C', mutationTo: 'A', count: 20, coverage: 1000 }),
    ];
    const p = buildPositionProfile(w, rows, 1000)[3]!;
    expect(p.mismatchCount).toBe(20);
    expect(p.alleles.find((a) => a.allele === 'T')!.isMismatch).toBe(false);
    expect(p.alleles.find((a) => a.allele === 'A')!.isMismatch).toBe(true);
  });

  it('counts the reference allele as a mismatch when the oligo diverges there', () => {
    // oligo base A at reference position 8 (ref C): 940 of 1000 carry C, which the oligo cannot bind
    const site = findBindingSites('ATGAATGC', REF, { maxMismatches: 1 })[0]!;
    const w = buildWindowSpec(site, 'ATGAATGC', REF, 'forward', { segmented: false });
    const rows = [row({ position: 8, mutationFrom: 'C', mutationTo: 'A', count: 60, coverage: 1000 })];
    const p = buildPositionProfile(w, rows, 1000)[3]!;
    expect(p.mismatchCount).toBe(940);
    expect(p.mismatchFraction).toBeCloseTo(0.94, 6);
  });

  it('maps minus-strand positions to the correct oligo index', () => {
    const site = findBindingSites('GCATGCAT', REF)[0]!;
    const w = buildWindowSpec(site, 'GCATGCAT', REF, 'reverse', { segmented: false });
    const rows = [row({ position: 5, mutationFrom: 'A', mutationTo: 'G', count: 100, coverage: 1000 })];
    const profile = buildPositionProfile(w, rows, 1000);
    const hit = profile.find((p) => p.mismatchCount > 0)!;
    expect(hit.refPos).toBe(5);
    expect(hit.oligoIndex).toBe(7);
    expect(hit.distanceFrom3Prime).toBe(0);
  });

  it('ignores rows outside the window', () => {
    const rows = [row({ position: 400, mutationTo: 'G', count: 999, coverage: 1000 })];
    const profile = buildPositionProfile(plusWindow(), rows, 1000);
    expect(profile.every((p) => p.mismatchCount === 0)).toBe(true);
  });

  it('never reports a mismatch fraction above 1', () => {
    const rows = [
      row({ position: 5, mutationTo: 'C', count: 400, coverage: 1000 }),
      row({ position: 5, mutationTo: 'G', count: 700, coverage: 1000 }),
    ];
    const p = buildPositionProfile(plusWindow(), rows, 1000)[0]!;
    expect(p.mismatchFraction).toBeLessThanOrEqual(1);
  });
});

describe('buildPositionProfile — ambiguous reference base', () => {
  const AMBIG: ReferenceGenome = {
    pathogenId: 'test',
    segments: [{ name: 'main', sequence: 'GGGGATGNATGCAAAA' }],
  };
  const ambigWindow = () =>
    buildWindowSpec(findBindingSites('ATGCATGC', AMBIG)[0]!, 'ATGCATGC', AMBIG, 'forward', { segmented: false });

  it('does not fabricate a mismatch count when there is no data', () => {
    const p = buildPositionProfile(ambigWindow(), [], 1000)[3]!; // refPos 8, ref base N
    expect(p.referenceIsAmbiguous).toBe(true);
    expect(p.mismatchCount).toBe(0);
    expect(p.mismatchFraction).toBe(0);
    expect(p.alleles).toEqual([]);
  });

  it('does not fabricate a mismatch count from real rows either', () => {
    const rows = [row({ position: 8, mutationFrom: 'N', mutationTo: 'A', count: 60, coverage: 1000 })];
    const p = buildPositionProfile(ambigWindow(), rows, 1000)[3]!;
    expect(p.referenceIsAmbiguous).toBe(true);
    expect(p.mismatchCount).toBe(0);
    expect(p.alleles).toEqual([]);
  });
});
