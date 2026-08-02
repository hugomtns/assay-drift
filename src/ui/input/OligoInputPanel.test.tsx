import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { OligoInputPanel } from './OligoInputPanel';
import { useAppStore } from '../../state/store';

beforeEach(() => { useAppStore.getState().reset(); });

const type = async (text: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(/paste your oligos/i));
  await user.paste(text);
};

describe('OligoInputPanel', () => {
  it('lists parsed oligos with their lengths', async () => {
    render(<OligoInputPanel />);
    await type('>N1-F\nGACCCCAAAATCAGCGAAAT');
    expect(await screen.findByText('N1-F')).toBeInTheDocument();
    expect(screen.getByText(/20 nt/)).toBeInTheDocument();
  });

  it('preselects a guessed role but leaves it changeable', async () => {
    render(<OligoInputPanel />);
    await type('>N1-F\nGACCCCAAAATCAGCGAAAT');
    const select = await screen.findByLabelText(/role for N1-F/i);
    expect(select).toHaveValue('forward');
    await userEvent.selectOptions(select, 'probe');
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
  });

  it('marks an oligo whose role could not be guessed', async () => {
    render(<OligoInputPanel />);
    await type('ACGTACGTACGTACGTACGT');
    expect(await screen.findByText(/choose a role/i)).toBeInTheDocument();
  });

  it('shows parse errors without discarding the valid oligos', async () => {
    render(<OligoInputPanel />);
    await type('>bad\nACGTXACGTACGTACGT\n>good\nACGTACGTACGTACGTACGT');
    expect(await screen.findByText(/bad/)).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
  });

  it('disables continue until every role is set', async () => {
    render(<OligoInputPanel />);
    await type('ACGTACGTACGTACGTACGT');
    const button = await screen.findByRole('button', { name: /continue/i });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/role for Oligo 1/i), 'forward');
    expect(button).toBeEnabled();
  });
});
