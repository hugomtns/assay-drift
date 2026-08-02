import { describe, it, expect } from 'vitest';
import { resolveBindingSite } from './resolution';
import type { ReferenceGenome } from './binding';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};

const DUPLICATED: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'ATGCATGCTTTTATGCATGC' }],
};

describe('resolveBindingSite', () => {
  it('resolves a unique best hit', () => {
    const r = resolveBindingSite('ATGCATGC', REF);
    expect(r.status).toBe('resolved');
    expect(r.chosen).toMatchObject({ start: 5, end: 12, strand: 'plus' });
  });

  it('reports no-hit rather than inventing a location', () => {
    const r = resolveBindingSite('TTTTTTTTTTTTTTTT', REF, { maxMismatches: 1 });
    expect(r.status).toBe('no-hit');
    expect(r.chosen).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it('reports ambiguity and refuses to choose when two sites tie', () => {
    const r = resolveBindingSite('ATGCATGC', DUPLICATED);
    expect(r.status).toBe('ambiguous');
    expect(r.chosen).toBeNull();
    expect(r.candidates.map((c) => c.start)).toEqual([1, 13]);
  });

  it('flags a heavily degenerate oligo even when the hit is unique', () => {
    const r = resolveBindingSite('NNNNNNNNNNNN', REF);
    expect(r.status).toBe('highly-degenerate');
    expect(r.notes.join(' ')).toMatch(/degenerate/i);
  });

  it('prefers the site with fewer mismatches over a tie at a worse score', () => {
    const ref: ReferenceGenome = {
      pathogenId: 'test',
      segments: [{ name: 'main', sequence: 'ATGCATGCTTTTATGCATGA' }],
    };
    const r = resolveBindingSite('ATGCATGC', ref, { maxMismatches: 2 });
    expect(r.status).toBe('resolved');
    expect(r.chosen!.start).toBe(1);
  });

  it('caps the number of returned candidates', () => {
    const many: ReferenceGenome = {
      pathogenId: 'test',
      segments: [{ name: 'main', sequence: 'AT'.repeat(200) }],
    };
    const r = resolveBindingSite('ATAT', many, { maxCandidates: 5 });
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    expect(r.notes.join(' ')).toMatch(/showing 5 of/i);
  });
});
