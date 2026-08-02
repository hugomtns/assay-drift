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

  // Regression test (added post-review, invariant 2): a manual role must
  // never bleed onto a *different* oligo that happens to reuse the same
  // positional id (`oligo-0`) after the textarea content is fully replaced.
  it('does not carry a manual role over to a different oligo at the same position', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste('ACGTACGTACGTACGTACGT');
    const select = await screen.findByLabelText(/role for Oligo 1/i);
    await userEvent.selectOptions(select, 'probe');
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');

    // Let the first oligo's debounced commit land.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');

    // Replace the entire textarea content with a different, also-unguessable
    // oligo -- it lands at the same position (and so the same `oligo-0` id)
    // as the one the manual role was chosen for.
    await user.clear(textarea);
    await user.paste('TTTTTTTTTTTTTTTTTTTT');
    await screen.findByText(/20 nt/);

    // Let the replacement's debounced commit fire.
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(useAppStore.getState().roles['oligo-0']).toBeUndefined();
    expect(screen.getByText(/choose a role/i)).toBeInTheDocument();
  });

  // Regression test (added post-review, invariant 3): two distinct oligo
  // entries that happen to share an identical sequence -- distinguishable to
  // the user only by their default names "Oligo 1"/"Oligo 2" -- must not
  // collide in the manual-role cache. A role chosen for the first must not
  // bleed onto the second, including across a re-parse triggered by an
  // unrelated edit elsewhere in the text.
  it('does not bleed a manual role onto a different entry with the same sequence', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste('ACGTACGTACGTACGTACGT\nACGTACGTACGTACGTACGT');

    const selectOne = await screen.findByLabelText(/role for Oligo 1/i);
    await userEvent.selectOptions(selectOne, 'probe');
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
    expect(useAppStore.getState().roles['oligo-1']).toBeUndefined();

    // Let the debounced commit for the paste land.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
    expect(useAppStore.getState().roles['oligo-1']).toBeUndefined();

    // Trigger a re-parse via an unrelated edit: append a third, distinct oligo.
    await user.type(textarea, '\n>N3-F\nGACCCCAAAATCAGCGAAAT');
    await screen.findByText('N3-F');
    await new Promise((resolve) => setTimeout(resolve, 250));

    // The first oligo keeps its manual role; the second -- same sequence,
    // never touched -- must still have none.
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
    expect(useAppStore.getState().roles['oligo-1']).toBeUndefined();
    expect(screen.getByLabelText(/role for Oligo 2/i)).toHaveValue('');
    expect(screen.getByText(/choose a role/i)).toBeInTheDocument();
  });
});
