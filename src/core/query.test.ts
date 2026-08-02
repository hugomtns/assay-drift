import { describe, it, expect } from 'vitest';
import {
  buildWindowSpec, mismatchTerm, ambiguityTerm,
  fullCoverageQuery, mismatchWithCoverageQuery, isMismatchAllele,
} from './query';
import { findBindingSites, type ReferenceGenome } from './binding';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};
const SEGMENTED: ReferenceGenome = {
  pathogenId: 'test-flu',
  segments: [{ name: 'seg4', sequence: 'CCCCATGCATGCGGGG' }],
};

const plusSite = () => findBindingSites('ATGCATGC', REF)[0]!;
const minusSite = () => findBindingSites('GCATGCAT', REF)[0]!;

describe('buildWindowSpec — plus strand', () => {
  const w = () => buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });

  it('orders positions 5prime to 3prime with ascending refPos', () => {
    expect(w().positions.map((p) => p.refPos)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('computes distance from the 3prime end', () => {
    expect(w().positions.map((p) => p.distanceFrom3Prime)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });
  it('leaves the qualifier null for an unsegmented genome', () => {
    expect(w().qualifier).toBeNull();
  });
  it('records the plus-strand base identical to the oligo base', () => {
    expect(w().positions[0]).toMatchObject({ oligoBase: 'A', plusStrandBase: 'A', refBase: 'A' });
  });
});

describe('buildWindowSpec — minus strand', () => {
  const w = () => buildWindowSpec(minusSite(), 'GCATGCAT', REF, 'reverse', { segmented: false });

  it('orders positions 5prime to 3prime with descending refPos', () => {
    expect(w().positions.map((p) => p.refPos)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
  });
  it("puts the oligo's 3prime end at the lowest reference position", () => {
    const last = w().positions.at(-1)!;
    expect(last.refPos).toBe(5);
    expect(last.distanceFrom3Prime).toBe(0);
  });
  it('records the complement of the oligo base as the plus-strand base', () => {
    // oligo 5' base is G; on the plus strand that position reads C
    expect(w().positions[0]).toMatchObject({ oligoBase: 'G', plusStrandBase: 'C', refBase: 'C' });
  });
});

describe('buildWindowSpec — segmented', () => {
  it('sets the qualifier to the segment name', () => {
    const site = findBindingSites('ATGCATGC', SEGMENTED)[0]!;
    const w = buildWindowSpec(site, 'ATGCATGC', SEGMENTED, 'forward', { segmented: true });
    expect(w.qualifier).toBe('seg4');
    expect(w.segment).toBe('seg4');
  });
});

describe('isMismatchAllele', () => {
  it('treats a deletion as a mismatch under any oligo base', () => {
    expect(isMismatchAllele('-', 'N')).toBe(true);
  });
  it('accepts an allele covered by a degenerate oligo base', () => {
    expect(isMismatchAllele('C', 'Y')).toBe(false);
    expect(isMismatchAllele('A', 'Y')).toBe(true);
  });
});

describe('mismatchTerm', () => {
  it('case A: emits a bare position term when the oligo matches the reference exactly', () => {
    const w = buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[0]!)).toBe('5');
  });

  it('case A with a segment qualifier', () => {
    const site = findBindingSites('ATGCATGC', SEGMENTED)[0]!;
    const w = buildWindowSpec(site, 'ATGCATGC', SEGMENTED, 'forward', { segmented: true });
    expect(mismatchTerm(w, w.positions[0]!)).toBe('seg4:5');
  });

  it('case B: enumerates disallowed alleles for a degenerate oligo base', () => {
    // ref position 8 is C; oligo base Y accepts C and T, so mismatches are A, G and deletion
    const site = findBindingSites('ATGYATGC', REF)[0]!;
    const w = buildWindowSpec(site, 'ATGYATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[3]!)).toBe('(C8A | C8G | C8-)');
  });

  it('case B: an N oligo base leaves only the deletion as a mismatch', () => {
    const site = findBindingSites('ATGNATGC', REF)[0]!;
    const w = buildWindowSpec(site, 'ATGNATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[3]!)).toBe('(C8-)');
  });

  it('case C: inverts when the oligo does not match the reference at that position', () => {
    // ref position 8 is C; oligo base A matches nothing there, so any allele other than A is a mismatch
    const site = findBindingSites('ATGAATGC', REF, { maxMismatches: 1 })[0]!;
    const w = buildWindowSpec(site, 'ATGAATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[3]!)).toBe('!(C8A)');
  });
});

describe('ambiguityTerm', () => {
  it('emits the N term, qualified when segmented', () => {
    const w = buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });
    expect(ambiguityTerm(w, w.positions[0]!)).toBe('5N');
    const site = findBindingSites('ATGCATGC', SEGMENTED)[0]!;
    const ws = buildWindowSpec(site, 'ATGCATGC', SEGMENTED, 'forward', { segmented: true });
    expect(ambiguityTerm(ws, ws.positions[0]!)).toBe('seg4:5N');
  });
});

describe('window queries', () => {
  const w = () => buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });

  it('builds the full-coverage clause', () => {
    expect(fullCoverageQuery(w())).toBe('!(5N | 6N | 7N | 8N | 9N | 10N | 11N | 12N)');
  });

  it('builds the mismatch clause anded with full coverage', () => {
    expect(mismatchWithCoverageQuery(w())).toBe(
      '(5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) & !(5N | 6N | 7N | 8N | 9N | 10N | 11N | 12N)',
    );
  });

  it('matches the exact shape verified against the live API for the Alpha window', () => {
    // Filler is poly-G, not poly-N: an N in the reference matches every oligo base,
    // so an N-filled prefix would produce a zero-mismatch hit at every offset.
    const alpha: ReferenceGenome = {
      pathogenId: 'sars-cov-2',
      segments: [{ name: 'main', sequence: 'G'.repeat(21764) + 'TACATGTCTCTGGGACCAATGG' }],
    };
    const site = findBindingSites('TACATGTCTCTGGGACCAATGG', alpha)[0]!;
    const spec = buildWindowSpec(site, 'TACATGTCTCTGGGACCAATGG', alpha, 'forward', { segmented: false });
    expect(spec.positions[0]!.refPos).toBe(21765);
    expect(spec.positions.at(-1)!.refPos).toBe(21786);
    expect(mismatchWithCoverageQuery(spec)).toContain('(21765 | 21766 | 21767');
    expect(mismatchWithCoverageQuery(spec)).toContain('& !(21765N | 21766N');
  });
});

describe('ambiguous reference bases', () => {
  const AMBIG: ReferenceGenome = {
    pathogenId: 'test',
    segments: [{ name: 'main', sequence: 'GGGGATGNATGCAAAA' }],
  };
  it('excludes a position whose reference base is ambiguous from both clauses', () => {
    const site = findBindingSites('ATGCATGC', AMBIG)[0]!;
    const w = buildWindowSpec(site, 'ATGCATGC', AMBIG, 'forward', { segmented: false });
    expect(w.positions[3]!.referenceIsAmbiguous).toBe(true);
    expect(fullCoverageQuery(w)).not.toContain('8N');
    expect(mismatchWithCoverageQuery(w)).not.toContain(' 8 ');
  });

  it('throws if every position is unusable', () => {
    const allAmbig: ReferenceGenome = {
      pathogenId: 'test',
      segments: [{ name: 'main', sequence: 'NNNNNNNNNNNN' }],
    };
    const site = findBindingSites('NNNNNNNN', allAmbig)[0]!;
    const w = buildWindowSpec(site, 'NNNNNNNN', allAmbig, 'forward', { segmented: false });
    expect(() => fullCoverageQuery(w)).toThrow(/no usable positions/i);
  });
});
