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

  // Regression test (added post-review, not part of the brief's verbatim five):
  // a manually-chosen role for one oligo must survive a later, unrelated edit
  // to the textarea -- it must not be silently reverted by the next debounced
  // store commit, which reseeds `roles` from fresh guesses only.
  it('keeps a manually-chosen role after an unrelated later edit', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();
    await user.click(textarea);
    await user.paste('ACGTACGTACGTACGTACGT');

    const select = await screen.findByLabelText(/role for Oligo 1/i);
    await userEvent.selectOptions(select, 'probe');
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');

    // Let the debounced store commit for the paste fire.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');

    // Edit the textarea elsewhere: append a second, unrelated oligo.
    await user.type(textarea, '\n>N2-F\nGACCCCAAAATCAGCGAAAT');
    await screen.findByText('N2-F');

    // Let that debounced commit fire too, and confirm it did not wipe the
    // manual choice for the untouched first oligo.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
  });
});
