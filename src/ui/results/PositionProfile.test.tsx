import { render, screen } from '@testing-library/react';
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
  it('renders one bar per position with an accessible description', () => {
    render(<PositionProfile analysis={analysis([
      stat({ refPos: 21765, mismatchCount: 67469, deletionCount: 67469, mismatchFraction: 0.9576 }),
      stat({ refPos: 21766, oligoIndex: 1, distanceFrom3Prime: 20 }),
    ])} />);
    expect(screen.getByLabelText(/position 21,?765.*95\.8\s*%.*67,?469.*70,?454/)).toBeInTheDocument();
    expect(screen.getByLabelText(/position 21,?766.*0(\.0)?\s*%/)).toBeInTheDocument();
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
    const mark = screen.getByLabelText(/position 21,?765/);
    expect(mark).toHaveAccessibleName(/not assessable/i);
    expect(mark).toHaveAccessibleName(expect.not.stringContaining('%'));
    expect(screen.getByTitle(/reference base is ambiguous/i)).toBeInTheDocument();
  });
});
