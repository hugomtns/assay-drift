import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { ResultsPanel } from './ResultsPanel';
import { FIXED_CAVEATS } from '../CaveatPanel';
import { SEVERITY_DISCLAIMER } from '../../core/analysis/constants';
import { computeWindowMetrics } from '../../core/analysis/metrics';
import type { PositionStat } from '../../core/analysis/profile';
import type { AnalysisResult, OligoAnalysis } from '../../core/analysis/run';
import { sampleResult } from '../../core/analysis/test-fixtures';
import type { LapisTransport } from '../../core/lapis/transport';
import type { OligoRole } from '../../core/oligo-input';

const stat = (refPos: number, oligoIndex: number, oligoBase: string): PositionStat => ({
  refPos,
  oligoIndex,
  oligoBase,
  plusStrandBase: oligoBase,
  refBase: oligoBase,
  distanceFrom3Prime: 3 - oligoIndex,
  coverage: 70387,
  coverageIsInferred: false,
  effectiveDenominator: 70387,
  mismatchCount: 0,
  substitutionCount: 0,
  deletionCount: 0,
  mismatchFraction: 0,
  alleles: [],
  referenceIsAmbiguous: false,
});

const oligo = (name: string, role: OligoRole) =>
  ({
    oligoId: `id-${name}`,
    name,
    role,
    sequence: 'ACGT',
    metrics: computeWindowMetrics({ nScope: 71142, nFullCoverage: 70387, nMismatch: 67520 }),
    profile: ['A', 'C', 'G', 'T'].map((base, i) => stat(21765 + i, i, base)),
    insertions: [],
    trend: {
      granularity: 'month',
      points: [
        {
          bucket: '2024-01',
          nFullCoverage: 1000,
          nMismatch: 100,
          mismatchFraction: 0.1,
          sufficientData: true,
        },
        {
          bucket: '2024-02',
          nFullCoverage: 1200,
          nMismatch: 150,
          mismatchFraction: 0.125,
          sufficientData: true,
        },
      ],
      undatedFullCoverage: 0,
      undatedMismatch: 0,
    },
    lineage: {
      field: 'pangoLineage',
      rows: [{ value: 'JN.1', count: 40000, share: 40000 / 67520 }],
      otherCount: 0,
      unassignedCount: 0,
      total: 67520,
      topShare: 40000 / 67520,
    },
    country: {
      field: 'country',
      rows: [{ value: 'Germany', count: 20000, share: 20000 / 67520 }],
      otherCount: 0,
      unassignedCount: 0,
      total: 67520,
      topShare: 20000 / 67520,
    },
    severity: { level: 'amber', score: 0.05, reasons: [`${name} reason.`] },
    diagnostics: [],
  }) as unknown as OligoAnalysis;

const result = () =>
  ({
    scope: {
      pathogenId: 'sars-cov-2',
      dateFrom: '2024-01-01',
      dateTo: '2024-06-30',
      countries: [],
      lineages: [],
    },
    pathogenId: 'sars-cov-2',
    generatedAt: '2024-07-01T00:00:00.000Z',
    dataVersion: '1719792000',
    nScope: 71142,
    oligos: [oligo('N1-F', 'forward'), oligo('N1-R', 'reverse'), oligo('N1-P', 'probe')],
    queryCount: 15,
    diagnostics: [],
  }) as unknown as AnalysisResult;

describe('ResultsPanel', () => {
  it('renders one headline card per oligo, named after it', () => {
    render(<ResultsPanel result={result()} />);
    for (const name of ['N1-F', 'N1-R', 'N1-P']) {
      expect(screen.getByRole('article', { name })).toBeInTheDocument();
    }
  });

  it('renders one severity badge per oligo', () => {
    render(<ResultsPanel result={result()} />);
    expect(screen.getAllByText(SEVERITY_DISCLAIMER)).toHaveLength(3);
    expect(screen.getByText('N1-F reason.')).toBeInTheDocument();
    expect(screen.getByText('N1-R reason.')).toBeInTheDocument();
    expect(screen.getByText('N1-P reason.')).toBeInTheDocument();
  });

  it('renders the caveat panel exactly once', () => {
    render(<ResultsPanel result={result()} />);
    expect(screen.getAllByText(FIXED_CAVEATS[0]!)).toHaveLength(1);
  });

  it('offers the exports and the methods paragraph, once for the whole result', () => {
    render(<ResultsPanel result={result()} />);
    expect(
      screen.getAllByRole('button', { name: /^Download CSV/ }).map((b) => b.textContent),
    ).toEqual(['Download CSV — one row per oligo', 'Download CSV — one row per position']);
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy methods paragraph' })).toBeInTheDocument();
  });

  it('states which snapshot of the data the numbers came from', () => {
    render(<ResultsPanel result={result()} />);
    expect(screen.getByText(/1719792000/)).toBeInTheDocument();
  });

  it('offers no exact-coverage control when there is no transport to run it on', () => {
    render(<ResultsPanel result={sampleResult} />);
    expect(screen.queryByRole('button', { name: /extra queries/ })).toBeNull();
  });

  /**
   * The whole point of the opt-in path: it must change the *labels* as well as
   * the bars. A chart redrawn from measured coverage while the table below it
   * still says the denominator was borrowed is worse than the inferred chart
   * it replaced.
   */
  it('drops every borrowed-denominator label once exact coverage is loaded', async () => {
    const user = userEvent.setup();
    const transport: LapisTransport = {
      async query() {
        return { data: [{ count: 70387 }], dataVersion: 'v', requestId: 'r' } as never;
      },
    };
    const { container } = render(<ResultsPanel result={sampleResult} transport={transport} />);

    expect(screen.getAllByText(/Per-position coverage not reported/).length).toBeGreaterThan(0);
    expect(container.querySelectorAll('title')).not.toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /extra queries/ }));

    await waitFor(() => {
      expect(screen.queryByText(/Per-position coverage not reported/)).toBeNull();
    });
    // Including the SVG tooltips, which are the only place a sighted user
    // learns a bar's denominator was borrowed.
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent ?? '');
    expect(titles.filter((t) => t.includes('per-position coverage not reported'))).toEqual([]);
  });
});
