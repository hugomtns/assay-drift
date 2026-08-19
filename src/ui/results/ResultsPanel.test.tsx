import { render, screen, waitFor, within } from '@testing-library/react';
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
  it('renders an independently operable evidence disclosure per oligo', () => {
    const { container } = render(<ResultsPanel result={result()} />);
    for (const name of ['N1-F', 'N1-R', 'N1-P']) {
      expect(screen.getByText(`${name} detailed evidence`).closest('details')).toBeInTheDocument();
    }
    expect(screen.getByText('N1-F detailed evidence').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('N1-R detailed evidence').closest('details')).not.toHaveAttribute('open');
    expect(container.querySelector('article')).toBeNull();
  });

  it('opens the first red or unknown result, ahead of routine results', () => {
    const withPriority = result();
    withPriority.oligos[1]!.severity = { level: 'unknown', score: 0, reasons: ['Too little data.'] };
    withPriority.oligos[2]!.severity = { level: 'red', score: 1, reasons: ['High mismatch rate.'] };
    render(<ResultsPanel result={withPriority} />);

    expect(screen.getByText('N1-F detailed evidence').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('N1-R detailed evidence').closest('details')).toHaveAttribute('open');
    expect(screen.getByText('N1-P detailed evidence').closest('details')).not.toHaveAttribute('open');
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

  it('puts a count-backed assay summary immediately below the result heading', () => {
    render(<ResultsPanel result={result()} />);
    const summary = screen.getByRole('table', { name: 'Assay summary' });
    expect(within(summary).getAllByRole('row')).toHaveLength(4);
    expect(within(summary).getAllByText('95.9% (67,520 of 70,387)')).toHaveLength(3);
    expect(within(summary).getAllByText('Coverage gap: 755 of 71,142 (1.1%)')).toHaveLength(3);
    expect(within(summary).getAllByRole('cell')).toHaveLength(15);
  });

  it('shows the three interpretation facts before the limitations disclosure', () => {
    const { container } = render(<ResultsPanel result={result()} />);
    const interpretation = screen.getByText(/sampled sequences are not infections/i);
    expect(interpretation).toHaveTextContent(/ambiguous bases.*excluded/i);
    expect(interpretation).toHaveTextContent(/mismatch is not assay failure/i);
    const limitations = screen.getByText('Limitations and data-quality notes');
    expect(interpretation.compareDocumentPosition(limitations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
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

  it('keeps one oligo’s exact-coverage state when another disclosure opens', async () => {
    const user = userEvent.setup();
    const first = sampleResult.oligos[0]!;
    const second = { ...first, oligoId: 'second-oligo', name: 'Second oligo' };
    const multiOligoResult = { ...sampleResult, oligos: [first, second] };
    const transport: LapisTransport = {
      async query() {
        return { data: [{ count: 70387 }], dataVersion: 'v', requestId: 'r' } as never;
      },
    };
    render(<ResultsPanel result={multiOligoResult} transport={transport} />);

    await user.click(screen.getAllByRole('button', { name: /extra queries/ })[0]!);
    await screen.findByText(/Exact per-base coverage loaded for Alpha S-gene window/i);

    await user.click(screen.getByText('Second oligo detailed evidence'));
    expect(screen.getByText('Second oligo detailed evidence').closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/Exact per-base coverage loaded for Alpha S-gene window/i)).toBeInTheDocument();
  });
});

/**
 * Three checks that exist because walking the deployed site found what the
 * suite could not. jsdom does no layout, so it cannot tell you that a panel is
 * 6,000 pixels down or that a region scrolls -- but it can tell you the two
 * structural facts those failures reduce to, and those are what is pinned here.
 */
describe('ResultsPanel — what the browser found and jsdom could not', () => {
  it('puts the caveats above the figures they qualify, not after them', () => {
    // On the deployed site the panel sat at 6,058px of a 6,877px page, so the
    // app's own three-oligo worked example put every caveat below every number.
    // Global Constraint 7 held in the markup and failed in the reading.
    const { container } = render(<ResultsPanel result={sampleResult} />);
    const caveats = container.querySelector('#caveat-panel-heading');
    const firstEvidence = screen.getByText(/detailed evidence/i).closest('details');
    expect(caveats).not.toBeNull();
    expect(firstEvidence).not.toBeNull();

    const order = caveats!.compareDocumentPosition(firstEvidence!);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not number the limitations disclosure as a fifth step', () => {
    // The step navigation has four steps, and this panel now precedes step 4's
    // own figures. A "Step 5" heading would be wrong twice over.
    render(<ResultsPanel result={sampleResult} />);
    const disclosure = screen.getByText('Limitations and data-quality notes');
    expect(disclosure.textContent).not.toMatch(/step\s*5/i);
  });

  it('gives every horizontally scrolling region keyboard access', () => {
    // axe's scrollable-region-focusable, which reports 3 serious violations in
    // a real browser and is *inapplicable* under jsdom — it needs layout to see
    // that a region scrolls at all. The structural fix is assertable here.
    const { container } = render(<ResultsPanel result={sampleResult} />);
    const scrollers = [...container.querySelectorAll('.overflow-x-auto')];
    expect(scrollers.length).toBeGreaterThan(0);
    for (const el of scrollers) {
      expect(el.getAttribute('tabindex')).toBe('0');
      expect(el.getAttribute('aria-label')).toMatch(/\S/);
    }
  });
});
