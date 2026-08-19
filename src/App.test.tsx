import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect } from 'vitest';
import App from './App';
import { useAppStore } from './state/store';

beforeEach(() => { useAppStore.getState().reset(); });

describe('App', () => {
  it('renders the product name and the regulatory notice', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /assay drift watch/i })).toBeInTheDocument();
    expect(
      screen.getAllByText(/research and educational tool, not a diagnostic device/i).length,
    ).toBeGreaterThan(0);
  });

  it('only explains pathogen reset after a destructive change is attempted', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByText(/changing it clears the oligos/i)).not.toBeInTheDocument();
    useAppStore.getState().setOligos([
      { id: 'oligo-0', name: 'Existing oligo', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' },
    ]);

    await user.selectOptions(screen.getByLabelText('Pathogen'), 'h5n1');

    expect(useAppStore.getState().pathogenId).toBe('sars-cov-2');
    expect(screen.getByRole('alert')).toHaveTextContent(/changing it clears the oligos/i);

    await user.click(screen.getByRole('button', { name: /change pathogen/i }));
    expect(useAppStore.getState().pathogenId).toBe('h5n1');
    expect(useAppStore.getState().oligos).toEqual([]);
  });
});
