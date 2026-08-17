import { describe, it, expect } from 'vitest';
import raw from './library.json';
import { parseLibrary, verifyAssay } from './schema';

const library = parseLibrary(raw);

describe('bundled assay library', () => {
  it('contains at least one assay per v1 pathogen', () => {
    for (const id of ['sars-cov-2', 'h5n1', 'h3n2'] as const) {
      expect(library.assays.some((a) => a.pathogenId === id)).toBe(true);
    }
  });

  it('every assay carries a resolvable citation with an access date', () => {
    for (const assay of library.assays) {
      expect(assay.citation.url).toMatch(/^https?:\/\//);
      expect(assay.citation.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every assay verifies against the bundled reference', () => {
    for (const assay of library.assays) {
      const result = verifyAssay(assay);
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('assay ids are unique', () => {
    const ids = library.assays.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
