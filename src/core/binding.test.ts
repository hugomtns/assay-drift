import { describe, it, expect } from 'vitest';
import { findBindingSites, oligoIndexToRefPos, type ReferenceGenome } from './binding';
import { baseAt } from './reference';

// 1-based positions:  1234567890123456
const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};

describe('baseAt', () => {
  it('is 1-based', () => {
    expect(baseAt(REF, 'main', 1)).toBe('G');
    expect(baseAt(REF, 'main', 5)).toBe('A');
    expect(baseAt(REF, 'main', 16)).toBe('A');
  });
  it('throws outside the segment', () => {
    expect(() => baseAt(REF, 'main', 17)).toThrow(/out of range/i);
  });
  it('throws for an unknown segment', () => {
    expect(() => baseAt(REF, 'seg9', 1)).toThrow(/seg9/);
  });
});

const EXACT = { maxMismatches: 0 } as const;

describe('findBindingSites — plus strand', () => {
  it('finds an exact match and reports 1-based inclusive coordinates', () => {
    const sites = findBindingSites('ATGCATGC', REF, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      segment: 'main', strand: 'plus', start: 5, end: 12, mismatches: 0,
    });
  });

  it("maps the oligo's 5' end to start and its 3' end to end", () => {
    const site = findBindingSites('ATGCATGC', REF, EXACT)[0]!;
    expect(oligoIndexToRefPos(site, 0)).toBe(5);
    expect(oligoIndexToRefPos(site, 7)).toBe(12);
  });

  it('accepts a degenerate base that covers the reference base', () => {
    const sites = findBindingSites('ATGYATGC', REF, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.mismatches).toBe(0);
  });

  it('reports mismatch offsets in oligo coordinates', () => {
    const sites = findBindingSites('ATGCATGA', REF, { maxMismatches: 1 });
    expect(sites).toHaveLength(1);
    expect(sites[0]!.mismatches).toBe(1);
    expect(sites[0]!.mismatchOligoIndexes).toEqual([7]);
  });

  it('rejects a site above the mismatch tolerance', () => {
    expect(findBindingSites('ATGCATAA', REF, EXACT)).toHaveLength(0);
  });

  it('returns near matches when the tolerance allows them', () => {
    // At the default tolerance of 3, offset 0 ("GGGGATGC") is also within tolerance.
    const sites = findBindingSites('ATGCATGC', REF);
    expect(sites.length).toBeGreaterThan(1);
    expect(sites[0]!.mismatches).toBe(0);
  });
});

describe('findBindingSites — minus strand', () => {
  it('detects a reverse-complement oligo without the user flipping it', () => {
    const sites = findBindingSites('GCATGCAT', REF, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      segment: 'main', strand: 'minus', start: 5, end: 12, mismatches: 0,
    });
  });

  it("maps the oligo's 3' end to the LOWER reference coordinate", () => {
    const site = findBindingSites('GCATGCAT', REF, EXACT)[0]!;
    expect(oligoIndexToRefPos(site, 0)).toBe(12); // 5' end
    expect(oligoIndexToRefPos(site, 7)).toBe(5);  // 3' end
  });
});

describe('findBindingSites — segments', () => {
  const SEGMENTED: ReferenceGenome = {
    pathogenId: 'test-flu',
    segments: [
      { name: 'seg1', sequence: 'TTTTTTTTTTTT' },
      { name: 'seg4', sequence: 'CCCCATGCATGCGGGG' },
    ],
  };
  it('reports which segment the site is on', () => {
    const sites = findBindingSites('ATGCATGC', SEGMENTED, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.segment).toBe('seg4');
    expect(sites[0]!.start).toBe(5);
  });
});

describe('findBindingSites — ranking', () => {
  // NOTE: the brief's original spacer 'TTTT' (sequence 'ATGCATGCTTTTATGCATGA')
  // incidentally also produces a 1-mismatch MINUS-strand hit at start=3
  // ('GCATGCTT' vs the oligo's reverse complement 'GCATGCAT'), which breaks
  // this test's "exactly 2 sites" expectation. Swapped the spacer/suffix to
  // remove that coincidental match while preserving the intended plus-strand
  // structure: exact match at start=1, 1-mismatch match at start=13.
  const REPEAT: ReferenceGenome = {
    pathogenId: 'test',
    segments: [{ name: 'main', sequence: 'ATGCATGCCAAACTGCATGC' }],
  };
  it('returns best matches first', () => {
    const sites = findBindingSites('ATGCATGC', REPEAT, { maxMismatches: 1 });
    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({ mismatches: 0, start: 1 });
    expect(sites[1]).toMatchObject({ mismatches: 1, start: 13 });
  });
});
