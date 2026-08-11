import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HeadlineCard } from './HeadlineCard';
import { computeWindowMetrics } from '../../core/analysis/metrics';
import { UNIT_OF_ANALYSIS } from '../../core/analysis/constants';
import type { OligoAnalysis } from '../../core/analysis/run';

const analysis = (nScope: number, nFullCoverage: number, nMismatch: number) =>
  ({
    name: 'N1-F', role: 'forward',
    metrics: computeWindowMetrics({ nScope, nFullCoverage, nMismatch }),
  } as unknown as OligoAnalysis);

describe('HeadlineCard', () => {
  it('shows the percentage with its absolute numbers in the same card', () => {
    render(<HeadlineCard analysis={analysis(71142, 70387, 67520)} />);
    expect(screen.getByText(/95\.9\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/67,520/)).toBeInTheDocument();
    expect(screen.getByText(/70,387/)).toBeInTheDocument();
  });

  it('always states the coverage gap', () => {
    render(<HeadlineCard analysis={analysis(46667, 44669, 3)} />);
    expect(screen.getByText(/1,998/)).toBeInTheDocument();
    expect(screen.getByText(/4\.3\s*%/)).toBeInTheDocument();
  });

  it('states the unit of analysis', () => {
    render(<HeadlineCard analysis={analysis(1000, 1000, 10)} />);
    expect(screen.getByText(UNIT_OF_ANALYSIS)).toBeInTheDocument();
  });

  it('shows no percentage when nothing is assessable', () => {
    render(<HeadlineCard analysis={analysis(40, 0, 0)} />);
    expect(screen.getByLabelText(/headline mismatch rate/i))
      .toHaveTextContent(/no assessable sequences/i);
  });

  it('suppresses the percentage below the minimum denominator', () => {
    render(<HeadlineCard analysis={analysis(60, 30, 15)} />);
    const headline = screen.getByLabelText(/headline mismatch rate/i);
    expect(headline).toHaveTextContent(/insufficient data/i);
    expect(headline).toHaveTextContent(/n = 30/);
    expect(headline).not.toHaveTextContent('%');
  });
});
