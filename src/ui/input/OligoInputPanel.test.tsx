import { fireEvent, render, screen } from '@testing-library/react';
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

  // Regression test (added post-review, invariant 4 -- shrink): deleting one
  // of two identical bare lines leaves text that is byte-identical whichever
  // line was removed, so nothing derived from the resulting text can say
  // which entry survived. The survivor must therefore start with no role at
  // all rather than silently inherit the one chosen for the entry that is
  // now gone.
  it('drops a manual role when a duplicate sequence loses an occurrence', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste('ACGTACGTACGTACGTACGT\nACGTACGTACGTACGTACGT');

    const selectOne = await screen.findByLabelText(/role for Oligo 1/i);
    await userEvent.selectOptions(selectOne, 'probe');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');

    // Delete the *first* of the two identical lines in a single edit.
    fireEvent.change(textarea, { target: { value: 'ACGTACGTACGTACGTACGT' } });
    expect(screen.queryByLabelText(/role for Oligo 2/i)).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 250));

    // The survivor is not the entry the role was chosen for -- and cannot be
    // proven to be either -- so it must have no role, and Continue must stay
    // disabled until the user picks one.
    expect(useAppStore.getState().roles['oligo-0']).toBeUndefined();
    expect(screen.getByLabelText(/role for Oligo 1/i)).toHaveValue('');
    expect(screen.getByText(/choose a role/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  // Regression test (added post-review, invariant 4 -- growth): inserting a
  // new line whose sequence duplicates an existing one shifts every
  // same-sequence occurrence rank after it, so cached roles would land on
  // entries the user never chose them for. All roles cached for that
  // sequence must be dropped; roles for sequences whose multiplicity did not
  // change must survive, at whatever position they now occupy.
  it('drops manual roles when a duplicate sequence gains an occurrence', async () => {
    const dup = 'ACGTACGTACGTACGTACGT';
    const other = 'TTTTTTTTTTTTTTTTTTTT';
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste(`${dup}\n${other}\n${dup}`);

    await userEvent.selectOptions(await screen.findByLabelText(/role for Oligo 1/i), 'forward');
    await userEvent.selectOptions(screen.getByLabelText(/role for Oligo 2/i), 'probe');
    await userEvent.selectOptions(screen.getByLabelText(/role for Oligo 3/i), 'reverse');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles).toEqual({
      'oligo-0': 'forward',
      'oligo-1': 'probe',
      'oligo-2': 'reverse',
    });

    // Insert a *new* duplicate-sequence line at the top: the ranks of both
    // entries the user chose roles for shift by one.
    fireEvent.change(textarea, { target: { value: `${dup}\n${dup}\n${other}\n${dup}` } });
    await screen.findByLabelText(/role for Oligo 4/i);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Every entry sharing the duplicated sequence -- the newcomer at the top
    // included -- must have no role.
    expect(useAppStore.getState().roles['oligo-0']).toBeUndefined();
    expect(useAppStore.getState().roles['oligo-1']).toBeUndefined();
    expect(useAppStore.getState().roles['oligo-3']).toBeUndefined();
    // The untouched sequence kept its multiplicity, so its manual role
    // survives -- reapplied at its new position.
    expect(useAppStore.getState().roles['oligo-2']).toBe('probe');
    expect(screen.getAllByText(/choose a role/i)).toHaveLength(3);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  // Forward-pointer A (Task 4.2 -> 4.7). The store commit is debounced, so for
  // ~200 ms after the last keystroke `oligos` and `roles` describe the
  // *previous* parse. That was harmless while Continue had no `onClick`; the
  // moment it navigates, a user who types and immediately clicks would advance
  // step 2 with the previous parse's oligos and roles -- a wrong answer that
  // looks entirely plausible. The handler must flush the pending commit before
  // it navigates, not merely shorten the window.
  it('advances with the oligos on screen when Continue is clicked before the debounce elapses', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    // A first parse that is allowed to land, so "the previous parse" is a real
    // state and not just the empty initial one. Its guessed role is `probe`,
    // which the second parse's `forward` has to overwrite.
    await user.click(textarea);
    await user.paste('>Old-P\nGACCCCAAAATCAGCGAAAT');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().oligos.map((o) => o.name)).toEqual(['Old-P']);
    expect(useAppStore.getState().roles).toEqual({ 'oligo-0': 'probe' });

    // Replace it and click Continue *without* waiting for the debounce.
    await user.clear(textarea);
    await user.paste('>N1-F\nTACATGTCTCTGGGACCAATGG');
    expect(await screen.findByText('N1-F')).toBeInTheDocument();
    // Guards the test against passing vacuously: if the debounce had already
    // fired, there would be no stale window left to fall into.
    expect(useAppStore.getState().oligos.map((o) => o.name)).toEqual(['Old-P']);

    await user.click(screen.getByRole('button', { name: /continue/i }));

    const state = useAppStore.getState();
    expect(state.step).toBe('binding');
    expect(state.oligos.map((o) => o.name)).toEqual(['N1-F']);
    expect(state.oligos[0]?.sequence).toBe('TACATGTCTCTGGGACCAATGG');
    expect(state.roles).toEqual({ 'oligo-0': 'forward' });
  });

  // The flush must carry a *manually* chosen role too, not just the guesses
  // `setOligos` reseeds: a role the user picked for an unguessable oligo lives
  // only in the component's ref until a commit reapplies it.
  it('carries a manually chosen role through a Continue clicked before the debounce', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste('ACGTACGTACGTACGTACGT');
    await userEvent.selectOptions(await screen.findByLabelText(/role for Oligo 1/i), 'reverse');

    await user.click(screen.getByRole('button', { name: /continue/i }));

    const state = useAppStore.getState();
    expect(state.step).toBe('binding');
    expect(state.oligos.map((o) => o.sequence)).toEqual(['ACGTACGTACGTACGTACGT']);
    expect(state.roles['oligo-0']).toBe('reverse');
  });

  // Regression test (added post-review, invariant 4's boundary): a sequence
  // that never has more than one occurrence carries no occurrence-rank
  // ambiguity at all, so a *transient* disappearance -- a stray character
  // making it fail IUPAC validation mid-typing, a cut-and-repaste -- must not
  // cost the user the role they picked. Only multiplicities above one are
  // ambiguous.
  it('keeps a manual role when its sole occurrence goes briefly invalid', async () => {
    render(<OligoInputPanel />);
    const textarea = screen.getByLabelText(/paste your oligos/i);
    const user = userEvent.setup();

    await user.click(textarea);
    await user.paste('ACGTACGTACGTACGTACGT');
    await userEvent.selectOptions(await screen.findByLabelText(/role for Oligo 1/i), 'probe');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');

    // A stray character makes the sequence invalid: the entry leaves
    // `oligos` entirely and is reported as a parse error instead.
    fireEvent.change(textarea, { target: { value: 'ACGTACGTACGTACGTACGTX' } });
    expect(screen.getByText(/not a valid iupac/i)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(useAppStore.getState().oligos).toHaveLength(0);

    // Deleting the stray character restores the identical, still-unique
    // sequence -- there was never a second occurrence to confuse it with.
    fireEvent.change(textarea, { target: { value: 'ACGTACGTACGTACGTACGT' } });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
    expect(screen.getByLabelText(/role for Oligo 1/i)).toHaveValue('probe');
    expect(screen.queryByText(/choose a role/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});
