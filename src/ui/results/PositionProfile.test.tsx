import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PositionProfile } from './PositionProfile';
import type { OligoAnalysis } from '../../core/analysis/run';
import type { PositionStat } from '../../core/analysis/profile';

const stat = (over: Partial<PositionStat>): PositionStat => ({
  refPos: 21765, oligoIndex: 0, oligoBase: 'T', plusStrandBase: 'T', refBase: 'T',
  distanceFrom3Prime: 21, coverage: 70454, coverageIsInferred: false,
  effectiveDenominator: 70454, mismatchCount: 0, substitutionCount: 0, deletionCount: 0,
  mismatchFraction: 0, alleles: [], referenceIsAmbiguous: false, ...over,
});

const analysis = (profile: PositionStat[], role: 'forward' | 'probe' = 'forward') =>
  ({ name: 'N1-F', role, sequence: profile.map((p) => p.oligoBase).join(''), profile } as unknown as OligoAnalysis);

describe('PositionProfile', () => {
  // Task 6.2, requirement 3: the numbers left the per-column `role="img"`
  // labels and moved into a visually hidden table. The bars are now
  // `aria-hidden`, so this reads the table -- the only place a screen reader
  // can now reach the profile, and the one that gained column headers and the
  // ability to compare two positions.
  it('tabulates one row per position with the counts behind each rate', () => {
    render(<PositionProfile analysis={analysis([
      stat({ refPos: 21765, mismatchCount: 67469, deletionCount: 67469, mismatchFraction: 0.9576 }),
      stat({ refPos: 21766, oligoIndex: 1, distanceFrom3Prime: 20 }),
    ])} />);
    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('sr-only');
    expect(within(table).getAllByRole('row')).toHaveLength(3);

    const first = within(table).getByRole('row', { name: /21,765/ });
    expect(first).toHaveTextContent(/95\.8\s*%/);
    expect(first).toHaveTextContent(/67,469/);
    expect(first).toHaveTextContent(/70,454/);
    expect(within(table).getByRole('row', { name: /21,766/ })).toHaveTextContent(/0(\.0)?\s*%/);
  });

  it('hides the drawn columns from assistive technology so nothing is said twice', () => {
    const { container } = render(<PositionProfile analysis={analysis([stat({})])} />);
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('marks the 3prime terminal region for primers', () => {
    render(<PositionProfile analysis={analysis([stat({ distanceFrom3Prime: 0 })])} />);
    expect(screen.getByText(/3′ end/)).toBeInTheDocument();
  });

  it('omits 3prime shading for probes and says why', () => {
    render(<PositionProfile analysis={analysis([stat({ distanceFrom3Prime: 0 })], 'probe')} />);
    expect(screen.getByText(/probe.*3′ weighting|3′ weighting.*probe/i)).toBeInTheDocument();
  });

  it('flags bars whose per-position coverage was not reported', () => {
    render(<PositionProfile analysis={analysis([
      stat({ coverage: null, coverageIsInferred: true }),
    ])} />);
    expect(screen.getByTitle(/per-position coverage not reported/i)).toBeInTheDocument();
  });

  it('distinguishes deletions from substitutions in the legend', () => {
    render(<PositionProfile analysis={analysis([
      stat({ mismatchCount: 100, deletionCount: 60, substitutionCount: 40, mismatchFraction: 0.1 }),
    ])} />);
    expect(screen.getByText(/deletion/i)).toBeInTheDocument();
    expect(screen.getByText(/substitution/i)).toBeInTheDocument();
  });

  it('renders the oligo sequence 5prime to 3prime above the bars', () => {
    const { container } = render(<PositionProfile analysis={analysis([
      stat({ oligoBase: 'T', oligoIndex: 0 }), stat({ oligoBase: 'A', oligoIndex: 1, refPos: 21766 }),
    ])} />);
    expect(container.textContent).toContain('5′');
    expect(container.textContent).toContain('3′');
  });

  it('never reports a rate where the reference base is ambiguous', () => {
    render(<PositionProfile analysis={analysis([
      stat({ refPos: 21765, refBase: 'N', plusStrandBase: 'N', referenceIsAmbiguous: true }),
    ])} />);
    const row = within(screen.getByRole('table')).getByRole('row', { name: /21,765/ });
    expect(row).toHaveTextContent(/not assessable/i);
    // Not `0.0%`, not `0%`: the position was never queried, so any rate here
    // would state the site is conserved somewhere we cannot see at all.
    expect(row.textContent).not.toContain('%');
    expect(screen.getByTitle(/reference base is ambiguous/i)).toBeInTheDocument();
  });
});
