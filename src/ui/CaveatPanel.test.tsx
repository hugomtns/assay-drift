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

  /**
   * The de-duplication keeps the first oligo's copy of a per-site diagnostic,
   * so that copy has to say which oligo it came from. Under a heading that
   * speaks for the whole run, "this binding site" points at nothing.
   */
  it('shows which oligo a per-site diagnostic came from', () => {
    const twoOligos = {
      oligos: [
        {
          name: 'N1-F',
          diagnostics: [
            {
              id: 'coverage-gap',
              severity: 'warn',
              message:
                'A large share of the sequences in scope have an ambiguous base somewhere in the N1-F binding site, so they are excluded from its rate.',
            },
          ],
        },
        {
          name: 'N1-R',
          diagnostics: [
            {
              id: 'coverage-gap',
              severity: 'warn',
              message:
                'A large share of the sequences in scope have an ambiguous base somewhere in the N1-R binding site, so they are excluded from its rate.',
            },
          ],
        },
      ],
    } as unknown as AnalysisResult;

    render(<CaveatPanel result={twoOligos} />);
    const shown = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const gaps = shown.filter((text) => text.includes('ambiguous base somewhere in'));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('N1-F');
    expect(gaps[0]).not.toMatch(/\bthis binding site\b/);
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
