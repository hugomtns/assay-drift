import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { AssayPicker } from './AssayPicker';
import { useAppStore } from '../../state/store';

beforeEach(() => {
  useAppStore.getState().reset();
});

describe('AssayPicker', () => {
  it('keeps the full library behind a compact disclosure', () => {
    render(<AssayPicker />);

    expect(screen.getByText(/browse published assays/i).closest('details')).not.toHaveAttribute('open');
  });

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

  it('updates the visible library when the selected pathogen changes', () => {
    render(<AssayPicker />);

    expect(screen.getByText('SARS-CoV-2')).toBeInTheDocument();
    expect(screen.queryByText('Influenza A/H5N1')).not.toBeInTheDocument();

    act(() => { useAppStore.getState().setPathogen('h5n1'); });

    expect(screen.getByText('Influenza A/H5N1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CDC 2019-nCoV_N1' })).not.toBeInTheDocument();
  });

  it('does not offer the SARS-CoV-2 example for a different reference', () => {
    useAppStore.getState().setPathogen('h5n1');
    render(<AssayPicker onRunExample={() => undefined} />);

    expect(screen.queryByText(/recommended example/i)).not.toBeInTheDocument();
  });

  it('only selects an assay that belongs to the active reference', async () => {
    useAppStore.getState().setPathogen('h5n1');
    render(<AssayPicker />);

    await userEvent.click(screen.getByRole('button', { name: 'WHO A(H5Nx) HA (H5-1201/H5-1387)' }));

    expect(useAppStore.getState().pathogenId).toBe('h5n1');
    expect(useAppStore.getState().oligos.map((o) => o.role)).toEqual([
      'forward',
      'reverse',
      'probe',
    ]);
  });

  it('renders one scoped assay list', () => {
    render(<AssayPicker />);

    const sarsList = screen.getByRole('list', { name: 'SARS-CoV-2' });
    expect(within(sarsList).getByRole('button', { name: 'CDC 2019-nCoV_N1' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Influenza A/H3N2' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/search assays/i)).not.toBeInTheDocument();
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

  /**
   * The WHO titles in the library are a paragraph long. As link text they made
   * an unreadable link and a worse screen-reader announcement, so the visible
   * name is the publishing body and the full title moved to the anchor's
   * `title`, which assistive technology exposes as a description rather than
   * as the name.
   */
  it('keeps the citation link short without losing the full title', () => {
    useAppStore.getState().setPathogen('h3n2');
    render(<AssayPicker />);

    for (const link of screen.getAllByRole('link')) {
      const name = link.textContent ?? '';
      expect(name.length).toBeLessThan(60);
      // The full title is still reachable, and is longer than the label.
      const full = link.getAttribute('title') ?? '';
      expect(full.length).toBeGreaterThan(0);
      expect(full.length).toBeGreaterThan(name.length);
    }

    const who = screen
      .getByRole('button', { name: 'WHO A(H3) HA (H3-266/H3-373)' })
      .closest('li') as HTMLElement;
    const link = within(who).getByRole('link');
    expect(link).toHaveTextContent('Source: World Health Organization');
    expect(link.getAttribute('title')).toContain('Annex 2 Protocol 2');
  });
});
