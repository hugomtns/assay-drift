import { describe, it, expect } from 'vitest';
import { methodsParagraph } from './methods';
import { UNIT_OF_ANALYSIS, REGULATORY_STATEMENT } from '../analysis/constants';
import type { AnalysisResult } from '../analysis/run';

const result = {
  pathogenId: 'sars-cov-2',
  generatedAt: '2026-08-01T12:00:00.000Z',
  dataVersion: '1785342597',
  nScope: 71142,
  scope: {
    pathogenId: 'sars-cov-2', dateFrom: '2021-02-01', dateTo: '2021-03-01',
    countries: ['United Kingdom'], lineages: [],
  },
  oligos: [],
} as unknown as AnalysisResult;

describe('methodsParagraph', () => {
  const text = methodsParagraph(result);

  it('names the data source and its version', () => {
    expect(text).toMatch(/lapis\.cov-spectrum\.org/);
    expect(text).toContain('1785342597');
  });
  it('states the scope in full', () => {
    expect(text).toContain('2021-02-01');
    expect(text).toContain('2021-03-01');
    expect(text).toContain('United Kingdom');
  });
  it('says "all" where a filter was left empty', () => {
    expect(text).toMatch(/all lineages/i);
  });
  it('states the unit of analysis verbatim', () => {
    expect(text).toContain(UNIT_OF_ANALYSIS);
  });
  it('states the reference genome and when it was fetched', () => {
    expect(text).toMatch(/reference genome/i);
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it('is dated', () => {
    expect(text).toContain('2026-08-01');
  });
  it('ends with the regulatory statement', () => {
    expect(text.trimEnd().endsWith(REGULATORY_STATEMENT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Everything below is additional to the plan's block above.
// ---------------------------------------------------------------------------

const asResult = (over: Partial<AnalysisResult>): AnalysisResult =>
  ({ ...(result as unknown as Record<string, unknown>), ...over }) as unknown as AnalysisResult;

describe('methodsParagraph — the empty-filter noun comes from the pathogen config', () => {
  /**
   * The plan's own test asserts /all lineages/i, and it would pass just as
   * happily against a hardcoded "lineages" — which would then print "all
   * lineages" for an H5N1 analysis, where the field is `clade` and nobody
   * calls them lineages. The word has to be derived from
   * `PathogenConfig.lineageLabel`, so it is checked on all three pathogens.
   */
  it('says "all lineages" for SARS-CoV-2, whose label is "Pango lineage"', () => {
    expect(methodsParagraph(result)).toContain('all lineages');
  });

  it('says "all clades" for H5N1, never "all lineages"', () => {
    const text = methodsParagraph(
      asResult({
        pathogenId: 'h5n1',
        scope: {
          pathogenId: 'h5n1', dateFrom: '2024-01-01', dateTo: '2024-12-31',
          countries: [], lineages: [],
        },
      }),
    );
    expect(text).toContain('all clades');
    expect(text).not.toMatch(/lineage/i);
  });

  it('keeps the segment qualifier for H3N2, whose label is "HA clade"', () => {
    const text = methodsParagraph(
      asResult({
        pathogenId: 'h3n2',
        scope: {
          pathogenId: 'h3n2', dateFrom: '2025-01-01', dateTo: '2025-12-31',
          countries: [], lineages: [],
        },
      }),
    );
    expect(text).toContain('all HA clades');
  });

  it('says "all countries" when no country filter was applied', () => {
    const text = methodsParagraph(
      asResult({
        scope: {
          pathogenId: 'sars-cov-2', dateFrom: '2021-02-01', dateTo: '2021-03-01',
          countries: [], lineages: [],
        },
      }),
    );
    expect(text).toContain('all countries');
  });

  it('lists the values themselves when filters were applied', () => {
    const text = methodsParagraph(
      asResult({
        scope: {
          pathogenId: 'sars-cov-2', dateFrom: '2021-02-01', dateTo: '2021-03-01',
          countries: ['United Kingdom', 'Denmark'], lineages: ['B.1.1.7'],
        },
      }),
    );
    expect(text).toContain('United Kingdom and Denmark');
    expect(text).toContain('lineages B.1.1.7');
    expect(text).not.toContain('all lineages');
    expect(text).not.toContain('all countries');
  });
});

describe('methodsParagraph — the rest of the citable snapshot', () => {
  it('names the tool and a version', () => {
    expect(methodsParagraph(result)).toMatch(/Assay Drift Watch \d+\.\d+\.\d+/);
  });

  it('credits the dataset behind the instance', () => {
    expect(methodsParagraph(result)).toContain(
      'GenSpectrum LAPIS over the Nextstrain open SARS-CoV-2 dataset (GenBank-derived).',
    );
  });

  it('gives the date the reference genome was retrieved, not today', () => {
    expect(methodsParagraph(result)).toContain('retrieved 2026-08-02');
  });

  it('names the oligos when there are any', () => {
    const text = methodsParagraph(
      asResult({ oligos: [{ name: 'N1-F' }, { name: 'N1-R' }] as never }),
    );
    expect(text).toContain('Assay drift for N1-F and N1-R was assessed');
  });

  it('describes the query, not the findings, when the oligo list is empty', () => {
    expect(() => methodsParagraph(result)).not.toThrow();
    expect(methodsParagraph(result)).toMatch(/^Assay drift was assessed with/);
  });

  it('is one paragraph, so it survives being pasted into a document', () => {
    expect(methodsParagraph(result)).not.toContain('\n');
  });

  it('states no rate anywhere, because a rate without its N is a bug', () => {
    expect(methodsParagraph(result)).not.toContain('%');
  });
});
