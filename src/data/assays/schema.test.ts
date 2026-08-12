import { describe, it, expect } from 'vitest';
import { parseLibrary, verifyAssay, type LibraryAssay } from './schema';

/**
 * Schema-valid, and both oligos really do bind the bundled SARS-CoV-2 reference —
 * the forward at 15784-15805 (plus) and the reverse at 21765-21786 (minus).
 * They are ~6 kb apart, so this fixture passes parseLibrary and deliberately
 * FAILS verifyAssay's amplicon rule. That is what the last test exercises.
 */
const wellFormed: LibraryAssay = {
  id: 'test-assay', name: 'Test assay', pathogenId: 'sars-cov-2', target: 'ORF1ab',
  oligos: [
    { name: 'Test-F', role: 'forward', sequence: 'TTTAAGTCAGTTCTTTATTATC' },
    { name: 'Test-R', role: 'reverse', sequence: 'CCATTGGTCCCAGAGACATGTA' },
  ],
  citation: { title: 'T', source: 'S', url: 'https://example.org/x', accessed: '2026-08-01' },
};

describe('parseLibrary', () => {
  it('accepts a well-formed library', () => {
    expect(parseLibrary({ version: '1', assays: [wellFormed] }).assays).toHaveLength(1);
  });
  it('names the offending path on malformed input', () => {
    expect(() => parseLibrary({ version: '1', assays: [{ ...wellFormed, oligos: [{ name: 'x' }] }] }))
      .toThrow(/assays\[0\]\.oligos\[0\]/);
  });
  it('rejects an unknown role', () => {
    expect(() => parseLibrary({
      version: '1',
      assays: [{ ...wellFormed, oligos: [{ name: 'x', role: 'primer', sequence: 'ACGTACGTACGTACGT' }] }],
    })).toThrow(/role/);
  });
});

describe('verifyAssay', () => {
  it('rejects an assay whose citation has no url', () => {
    const r = verifyAssay({ ...wellFormed, citation: { ...wellFormed.citation, url: '' } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/citation/i);
  });

  it('rejects an oligo that does not bind the reference', () => {
    const r = verifyAssay({
      ...wellFormed,
      oligos: [
        { name: 'Bad-F', role: 'forward', sequence: 'GGGGGGGGGGGGGGGGGGGGGG' },
        wellFormed.oligos[1]!,
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Bad-F/);
  });

  it('rejects an implausible amplicon', () => {
    const r = verifyAssay(wellFormed);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/amplicon/i);
  });
});
