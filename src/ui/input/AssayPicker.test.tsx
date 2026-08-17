import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { AssayPicker } from './AssayPicker';
import { useAppStore } from '../../state/store';

beforeEach(() => {
  useAppStore.getState().reset();
});

describe('AssayPicker', () => {
  it('loads a chosen assay into the store with every role already assigned', async () => {
    render(<AssayPicker />);

    await userEvent.click(screen.getByRole('button', { name: 'CDC 2019-nCoV_N1' }));

    const state = useAppStore.getState();
    expect(state.pathogenId).toBe('sars-cov-2');
    // The point of picking from the library rather than pasting: no oligo
    // arrives without a role, so step 1's role guessing is skipped entirely.
    expect(state.oligos).toEqual([
      { id: 'oligo-0', name: '2019-nCoV_N1-F', role: 'forward', sequence: 'GACCCCAAAATCAGCGAAAT' },
      {
        id: 'oligo-1',
        name: '2019-nCoV_N1-R',
        role: 'reverse',
        sequence: 'TCTGGTTACTGCCAGTTGAATCTG',
      },
      {
        id: 'oligo-2',
        name: '2019-nCoV_N1-P',
        role: 'probe',
        sequence: 'ACCCCGCATTACGTTTGGTGGACC',
      },
    ]);
    expect(state.roles).toEqual({
      'oligo-0': 'forward',
      'oligo-1': 'reverse',
      'oligo-2': 'probe',
    });
  });

  it('switches the pathogen with the assay, because the reference genome changes with it', async () => {
    render(<AssayPicker />);

    await userEvent.click(
      screen.getByRole('button', { name: 'WHO A(H5Nx) HA (H5-1201/H5-1387)' }),
    );

    expect(useAppStore.getState().pathogenId).toBe('h5n1');
    expect(useAppStore.getState().oligos.map((o) => o.role)).toEqual([
      'forward',
      'reverse',
      'probe',
    ]);
  });

  it('groups the assays under their pathogen', () => {
    render(<AssayPicker />);

    const sarsList = screen.getByRole('list', { name: 'SARS-CoV-2' });
    expect(within(sarsList).getByRole('button', { name: 'CDC 2019-nCoV_N1' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Influenza A/H3N2' })).getByRole('button', {
        name: 'WHO A(H3) HA (H3-266/H3-373)',
      }),
    ).toBeInTheDocument();
  });

  it('gives every assay a citation link that cannot leak the referrer', () => {
    render(<AssayPicker />);

    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('rel', 'noreferrer');
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    }

    const n1Entry = screen.getByRole('button', { name: 'CDC 2019-nCoV_N1' }).closest('li');
    expect(n1Entry).not.toBeNull();
    const citation = within(n1Entry as HTMLElement).getByRole('link');
    expect(citation).toHaveAttribute('href', 'https://stacks.cdc.gov/view/cdc/84525');
    expect(citation).toHaveAttribute('rel', 'noreferrer');
  });
});
