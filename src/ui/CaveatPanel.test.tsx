import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CaveatPanel, FIXED_CAVEATS } from './CaveatPanel';
import type { AnalysisResult } from '../core/analysis/run';

const result = (diagnostics: { id: string; severity: string; message: string }[]) =>
  ({ oligos: [{ diagnostics }, { diagnostics }], diagnostics: [] } as unknown as AnalysisResult);

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
      diagnostics: [],
    } as unknown as AnalysisResult;

    render(<CaveatPanel result={twoOligos} />);
    const shown = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const gaps = shown.filter((text) => text.includes('ambiguous base somewhere in'));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain('N1-F');
    expect(gaps[0]).not.toMatch(/\bthis binding site\b/);
  });

  /**
   * The response-size warning belongs to the scope, so it arrives on the
   * result rather than on an oligo. It has to be shown, and it has to be shown
   * once however many oligos the run carries.
   */
  it('shows run-level diagnostics alongside the per-oligo ones', () => {
    const withRunLevel = {
      oligos: [{ name: 'N1-F', diagnostics: [] }, { name: 'N1-R', diagnostics: [] }],
      diagnostics: [
        { id: 'large-response', severity: 'info', message: 'The mutation data is about 12.0 MB.' },
      ],
    } as unknown as AnalysisResult;

    render(<CaveatPanel result={withRunLevel} />);
    expect(screen.getAllByText(/about 12.0 MB/)).toHaveLength(1);
  });

  it('de-duplicates a run-level diagnostic against an oligo carrying the same id', () => {
    const both = {
      oligos: [
        { name: 'N1-F', diagnostics: [{ id: 'large-response', severity: 'info', message: 'oligo copy' }] },
      ],
      diagnostics: [{ id: 'large-response', severity: 'info', message: 'run copy' }],
    } as unknown as AnalysisResult;

    render(<CaveatPanel result={both} />);
    // Run level wins: it is the one that speaks for the scope.
    expect(screen.getByText(/run copy/)).toBeInTheDocument();
    expect(screen.queryByText(/oligo copy/)).toBeNull();
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
