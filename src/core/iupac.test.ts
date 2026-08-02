import { describe, it, expect } from 'vitest';
import {
  normalizeOligo, acceptedBases, basesMatch, reverseComplement, degeneracyProduct,
} from './iupac';

describe('normalizeOligo', () => {
  it('uppercases, strips whitespace and digits, and maps U to T', () => {
    expect(normalizeOligo(' acg u\n12 t ')).toBe('ACGTT');
  });
  it('preserves degenerate codes', () => {
    expect(normalizeOligo('acgryswkmbdhvn')).toBe('ACGRYSWKMBDHVN');
  });
  it('throws on a non-IUPAC character', () => {
    expect(() => normalizeOligo('ACGX')).toThrow(/X/);
  });
});

describe('acceptedBases', () => {
  it('expands unambiguous codes to themselves', () => {
    expect([...acceptedBases('A')]).toEqual(['A']);
  });
  it('expands Y to C and T', () => {
    expect([...acceptedBases('Y')].sort()).toEqual(['C', 'T']);
  });
  it('expands N to all four bases', () => {
    expect([...acceptedBases('N')].sort()).toEqual(['A', 'C', 'G', 'T']);
  });
});

describe('basesMatch', () => {
  it('matches identical unambiguous bases', () => {
    expect(basesMatch('A', 'A')).toBe(true);
  });
  it('does not match different unambiguous bases', () => {
    expect(basesMatch('A', 'C')).toBe(false);
  });
  it('matches when a degenerate code covers the other base', () => {
    expect(basesMatch('Y', 'C')).toBe(true);
    expect(basesMatch('Y', 'A')).toBe(false);
  });
  it('is symmetric', () => {
    expect(basesMatch('R', 'S')).toBe(basesMatch('S', 'R')); // R={A,G} S={C,G} share G
    expect(basesMatch('R', 'S')).toBe(true);
  });
  it('never matches a deletion character', () => {
    expect(basesMatch('N', '-')).toBe(false);
  });
});

describe('reverseComplement', () => {
  it('reverse-complements an unambiguous sequence', () => {
    expect(reverseComplement('GCATGCAT')).toBe('ATGCATGC');
  });
  it('complements degenerate codes correctly', () => {
    expect(reverseComplement('RYSWKM')).toBe('KMWSRY');
  });
  it('round-trips', () => {
    expect(reverseComplement(reverseComplement('ACGTRYKMBV'))).toBe('ACGTRYKMBV');
  });
});

describe('degeneracyProduct', () => {
  it('is 1 for a fully specified oligo', () => {
    expect(degeneracyProduct('ACGT')).toBe(1);
  });
  it('multiplies across degenerate positions', () => {
    expect(degeneracyProduct('AYRN')).toBe(2 * 2 * 4);
  });
});

import { complementBase } from './iupac';

describe('complementBase', () => {
  it('complements single bases including degenerate codes', () => {
    expect(complementBase('A')).toBe('T');
    expect(complementBase('Y')).toBe('R');
    expect(complementBase('N')).toBe('N');
  });
  it('throws on an unknown code', () => {
    expect(() => complementBase('-')).toThrow();
  });
});
