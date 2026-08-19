import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
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

  it('starts with published assays and mounts pasted input only after it is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    const published = screen.getByRole('tab', { name: /choose a published assay/i });
    const paste = screen.getByRole('tab', { name: /paste my own oligos/i });
    expect(published).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /see how the cdc n1 assay has drifted/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/paste your oligos/i)).not.toBeInTheDocument();

    await user.click(paste);

    expect(paste).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/paste your oligos/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see how the cdc n1 assay has drifted/i })).not.toBeInTheDocument();
  });

  it('moves between entry paths with the expected tab keys', async () => {
    const user = userEvent.setup();
    render(<App />);

    const published = screen.getByRole('tab', { name: /choose a published assay/i });
    const paste = screen.getByRole('tab', { name: /paste my own oligos/i });
    published.focus();
    await user.keyboard('{ArrowRight}');

    expect(paste).toHaveFocus();
    expect(paste).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(/paste your oligos/i)).toBeInTheDocument();
  });

  it('runs the recommended example in one click', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /see how the cdc n1 assay has drifted/i }));

    expect(useAppStore.getState().status).toBe('loading');
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
