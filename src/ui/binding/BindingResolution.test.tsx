import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { BindingResolution } from './BindingResolution';
import { useAppStore } from '../../state/store';

const seed = (sequence: string, name = 'Test-F') => {
  useAppStore.getState().reset();
  useAppStore.getState().setOligos([{ id: 'oligo-0', name, role: 'forward', sequence }]);
};

beforeEach(() => { useAppStore.getState().reset(); });

describe('BindingResolution', () => {
  it('shows the located coordinates and strand for a unique hit', async () => {
    // 22-mer taken from the SARS-CoV-2 reference at 21765-21786
    seed('TACATGTCTCTGGGACCAATGG');
    render(<BindingResolution />);
    expect(await screen.findByText(/21,?765/)).toBeInTheDocument();
    expect(screen.getByText(/21,?786/)).toBeInTheDocument();
    expect(screen.getByText(/plus strand/i)).toBeInTheDocument();
  });

  it('auto-detects a reverse-complemented oligo without the user flipping it', async () => {
    seed('CCATTGGTCCCAGAGACATGTA'); // reverse complement of the window above
    render(<BindingResolution />);
    expect(await screen.findByText(/minus strand/i)).toBeInTheDocument();
    expect(screen.getByText(/21,?765/)).toBeInTheDocument();
  });

  it('refuses to guess when the site is ambiguous and offers the candidates', async () => {
    seed('TTTTTTTTTTTTTTTTTTTT');
    render(<BindingResolution />);
    const radios = await screen.findAllByRole('radio');
    expect(radios.length).toBeGreaterThan(1);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('reports no hit rather than showing a wrong location', async () => {
    seed('GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG');
    render(<BindingResolution />);
    expect(await screen.findByText(/no binding site found/i)).toBeInTheDocument();
  });

  it('requires explicit confirmation for a heavily degenerate oligo', async () => {
    // The Alpha window with its last four bases wildcarded: degeneracy 4^4 = 256 (> 64),
    // but the first 18 bases still pin it to a single site.
    seed('TACATGTCTCTGGGACCANNNN');
    render(<BindingResolution />);
    const confirm = await screen.findByRole('checkbox', { name: /confirm this site/i });
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    await userEvent.click(confirm);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});
