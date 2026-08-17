import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ResultsPanel } from './ResultsPanel';
import { FIXED_CAVEATS } from '../CaveatPanel';
import { SEVERITY_DISCLAIMER } from '../../core/analysis/constants';
import { computeWindowMetrics } from '../../core/analysis/metrics';
import type { PositionStat } from '../../core/analysis/profile';
import type { AnalysisResult, OligoAnalysis } from '../../core/analysis/run';
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
});
