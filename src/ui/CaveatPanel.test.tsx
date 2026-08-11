import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CaveatPanel, FIXED_CAVEATS } from './CaveatPanel';
import type { AnalysisResult } from '../core/analysis/run';

const result = (diagnostics: { id: string; severity: string; message: string }[]) =>
  ({ oligos: [{ diagnostics }, { diagnostics }] } as unknown as AnalysisResult);

describe('CaveatPanel', () => {
  it('renders every fixed caveat', () => {
    render(<CaveatPanel result={result([])} />);
    for (const caveat of FIXED_CAVEATS) {
      expect(screen.getByText(caveat)).toBeInTheDocument();
    }
  });

  it('is not collapsible', () => {
    const { container } = render(<CaveatPanel result={result([])} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[hidden]')).toBeNull();
  });

  it('renders live diagnostics once even when several oligos report the same one', () => {
    render(<CaveatPanel result={result([
      { id: 'deposition-lag', severity: 'warn', message: 'Recent months are thin.' },
    ])} />);
    expect(screen.getAllByText('Recent months are thin.')).toHaveLength(1);
  });

  it('covers the four caveats the brief requires', () => {
    render(<CaveatPanel result={result([])} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/sampling|not a random sample/i);
    expect(text).toMatch(/N-mask|ambiguous|coverage gap/i);
    expect(text).toMatch(/deposit|lag/i);
    expect(text).toMatch(/not the same as assay failure/i);
  });
});
