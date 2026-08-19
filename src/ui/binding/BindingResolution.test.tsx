import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { BindingResolution } from './BindingResolution';
import { useAppStore } from '../../state/store';
import { loadReference } from '../../data/references';
import { reverseComplement } from '../../core/iupac';
import type { OligoInput } from '../../core/oligo-input';

/**
 * The wizard's advance buttons are `aria-disabled`, not `disabled` (Task 6.2,
 * requirement 2). `disabled` removed them from the tab order, so a keyboard
 * user never met the control and was never told why the step would not
 * advance; `aria-disabled` keeps them focusable and announced as disabled,
 * and the click handler refuses to act.
 *
 * jest-dom's `toBeDisabled()` ignores `aria-disabled` entirely, so leaving it
 * here would not fail -- it would quietly report every blocked button as
 * enabled and stop testing anything. These two helpers replace it, and they
 * assert more than it did: still reachable, and carrying a reason.
 */
const expectBlocked = (el: HTMLElement): void => {
  expect(el).toHaveAttribute('aria-disabled', 'true');
  expect(el).not.toBeDisabled();
  expect(el).toHaveAccessibleDescription(/\S/);
};

const expectActionable = (el: HTMLElement): void => {
  expect(el).not.toHaveAttribute('aria-disabled', 'true');
  expect(el).not.toBeDisabled();
};

const seed = (sequence: string, name = 'Test-F') => {
  useAppStore.getState().reset();
  useAppStore.getState().setOligos([{ id: 'oligo-0', name, role: 'forward', sequence }]);
};

// Post-review helpers. Every sequence below is either one of the brief's own
// literals or sliced out of the bundled reference at runtime (Global
// Constraint 2: sequences are sourced, never recalled).
const genome = loadReference('sars-cov-2').segments[0]!.sequence;
/** 1-based inclusive window of the reference, matching the app's coordinates. */
const window1Based = (start: number, end: number) => genome.slice(start - 1, end);
const seedAll = (oligos: OligoInput[]) => {
  useAppStore.getState().reset();
  useAppStore.getState().setOligos(oligos);
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
    expectBlocked(screen.getByRole('button', { name: /continue/i }));
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
    expectBlocked(screen.getByRole('button', { name: /continue/i }));
    await userEvent.click(confirm);
    expectActionable(screen.getByRole('button', { name: /continue/i }));
  });
});

// Regression tests (added post-review, finding 4): the brief's five tests seed
// a single forward-role oligo and never read the store, so three requirements
// stated in prose had nothing holding them up. Each test below fails against a
// specific one-line regression that the brief's tests all survive.
describe('BindingResolution: contract with the rest of the app', () => {
  it('shows geometry problems as warnings without ever blocking Continue', async () => {
    // Catches `canContinue && geometry.ok`. The primers are swapped -- the
    // reverse sits upstream of the forward -- which is a real problem worth
    // warning about and an entirely legitimate thing to want analysed.
    seedAll([
      { id: 'oligo-0', name: 'F', role: 'forward', sequence: window1Based(21860, 21881) },
      {
        id: 'oligo-1',
        name: 'R',
        role: 'reverse',
        sequence: reverseComplement(window1Based(21765, 21786)),
      },
    ]);
    render(<BindingResolution />);
    const warnings = await screen.findByLabelText('Geometry warnings');
    expect(warnings.textContent).toMatch(/downstream/i);
    expectActionable(screen.getByRole('button', { name: /continue/i }));
  });

  it('writes the resolution and the auto-chosen site into the store', async () => {
    // Catches dropping either store write from the effect: steps 3-5 read
    // `resolutions` and `chosenSites`, and nothing on screen would change.
    seed(window1Based(21765, 21786));
    render(<BindingResolution />);
    await screen.findByText(/21,765/);
    expect(useAppStore.getState().resolutions['oligo-0']?.status).toBe('resolved');
    expect(useAppStore.getState().chosenSites['oligo-0']).toMatchObject({
      segment: 'main',
      strand: 'plus',
      start: 21765,
      end: 21786,
      mismatches: 0,
    });
  });

  it('commits an ambiguous choice to the store and releases Continue', async () => {
    // Catches an `onChange` that only paints the radio: the brief asserts the
    // radios start unchecked, never that choosing one resolves anything.
    seed('TTTTTTTTTTTTTTTTTTTT');
    render(<BindingResolution />);
    const radios = await screen.findAllByRole('radio');
    expect(useAppStore.getState().chosenSites['oligo-0']).toBeUndefined();

    await userEvent.click(radios[3]!);
    expect(useAppStore.getState().chosenSites['oligo-0']).toBeDefined();
    expect((radios[3] as HTMLInputElement).checked).toBe(true);
    expectActionable(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});

// Regression tests (added post-review, finding 2): the store's `chooseSite` is
// a plain merge with no removal action, so unticking "confirm this site" cannot
// take the site back out of `chosenSites`. The first version read `chosenSites`
// directly for the genome map and the geometry check, so a tick-then-untick
// left the map drawing a tick -- and the geometry check counting a probe -- for
// a site the user had just retracted, while the checkbox showed unticked and
// Continue showed disabled. Two different renderings of the same checkbox
// state, differing only by history. Everything downstream of "the user agreed
// to this site" must read one derived view, not the raw store.
describe('BindingResolution: retracted confirmations', () => {
  it('drops a retracted degenerate site from the genome map', async () => {
    seed('TACATGTCTCTGGGACCANNNN');
    render(<BindingResolution />);
    const confirm = await screen.findByRole('checkbox', { name: /confirm this site/i });

    await userEvent.click(confirm);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expectActionable(screen.getByRole('button', { name: /continue/i }));

    await userEvent.click(confirm);
    expectBlocked(screen.getByRole('button', { name: /continue/i }));
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: /genome map/i })).not.toBeInTheDocument();
  });

  it('stops counting a retracted probe in the geometry check', async () => {
    // The degenerate probe deliberately sits on the forward primer's own
    // window, so while it counts it must raise the overlap warning -- and once
    // retracted, that warning must go away with it.
    seedAll([
      { id: 'oligo-0', name: 'F', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' },
      { id: 'oligo-1', name: 'P', role: 'probe', sequence: 'TACATGTCTCTGGGACCANNNN' },
      {
        id: 'oligo-2',
        name: 'R',
        role: 'reverse',
        sequence: reverseComplement(window1Based(21860, 21881)),
      },
    ]);
    render(<BindingResolution />);
    const confirm = await screen.findByRole('checkbox', { name: /confirm this site/i });

    await userEvent.click(confirm);
    expect(screen.getByLabelText('Geometry warnings').textContent).toMatch(
      /probe must lie between/i,
    );

    await userEvent.click(confirm);
    expect(screen.queryByLabelText('Geometry warnings')).not.toBeInTheDocument();
    // The primers are untouched, so the amplicon they define is still reported.
    expect(screen.getByText(/Amplicon: 117 nt/)).toBeInTheDocument();
  });
});

// Forward-pointer B (Task 4.3 -> 4.7). Everything on screen reads the derived
// `committed` view, but Task 4.7 is the first consumer to read `chosenSites`
// itself -- and `chooseSite` is a merge with no removal, so the store is a
// superset of what the user actually confirmed. Leaving this step must write
// exactly the committed set, so the analysis assembly downstream cannot pick
// up a site the user retracted or one left behind by an oligo that is no
// longer in the list.
describe('BindingResolution: what leaving the step writes to the store', () => {
  it('replaces chosenSites with exactly the committed set when Continue is clicked', async () => {
    seedAll([
      { id: 'oligo-0', name: 'F', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' },
      { id: 'oligo-1', name: 'P', role: 'probe', sequence: 'TACATGTCTCTGGGACCANNNN' },
    ]);
    // A site for an oligo that is not in the list at all. `chooseSite` is the
    // only way in and there is no way out, so this is a shape the store can
    // genuinely hold; it is seeded rather than clicked because the UI has no
    // path to it (see the disabled-Continue test below).
    useAppStore.getState().chooseSite('oligo-9', {
      segment: 'main', strand: 'plus', start: 1, end: 22, mismatches: 0, mismatchOligoIndexes: [],
    });

    render(<BindingResolution />);
    const confirm = await screen.findByRole('checkbox', { name: /confirm this site/i });

    await userEvent.click(confirm);
    await userEvent.click(confirm);
    // The retraction the store cannot express on its own: unticking leaves the
    // site behind, which is precisely why Continue has to write the whole map.
    expect(useAppStore.getState().chosenSites['oligo-1']).toBeDefined();
    await userEvent.click(confirm);

    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(Object.keys(useAppStore.getState().chosenSites).sort()).toEqual([
      'oligo-0',
      'oligo-1',
    ]);
    expect(useAppStore.getState().chosenSites['oligo-9']).toBeUndefined();
    expect(useAppStore.getState().step).toBe('scope');
  });

  it('will not let a retracted confirmation reach Continue at all', async () => {
    // The other half of the guarantee, and the reason the brief's "untick one,
    // then click Continue" cannot be driven literally: `canContinue` requires
    // *every* row to be committed, so a retracted confirmation disables the
    // button rather than being carried past it. Both defences are needed --
    // this one stops the user walking forward, `commitSites` stops the store
    // remembering something the user took back.
    seedAll([
      { id: 'oligo-0', name: 'F', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' },
      { id: 'oligo-1', name: 'P', role: 'probe', sequence: 'TACATGTCTCTGGGACCANNNN' },
    ]);
    render(<BindingResolution />);
    const confirm = await screen.findByRole('checkbox', { name: /confirm this site/i });

    await userEvent.click(confirm);
    expectActionable(screen.getByRole('button', { name: /continue/i }));

    await userEvent.click(confirm);
    expectBlocked(screen.getByRole('button', { name: /continue/i }));
    // The store still holds the retracted site; nothing on screen counts it.
    expect(useAppStore.getState().chosenSites['oligo-1']).toBeDefined();
    expect(useAppStore.getState().step).toBe('input');
  });
});

// Regression test (added post-review, finding 3): a confirmation is a
// statement about a *site*, so it is keyed by the site and not just by the
// oligo. The reviewed failure was cross-pathogen -- local state survives
// `setPathogen`, which resets the store, so an id+sequence key left the box
// ticked for a site resolved against a different genome. That exact path
// cannot be tested with the sequences available here (the brief's degenerate
// literal is a no-hit under both influenza references, so no checkbox renders
// at all, and inventing one that lands in both genomes is exactly what Global
// Constraint 2 forbids). The same key is exercised through the one
// same-pathogen state where a single oligo can confirm two different sites:
// degenerate *and* tied.
describe('BindingResolution: confirmation identity', () => {
  it('does not carry a confirmation over to a different candidate site', async () => {
    // Composed at runtime from two of the brief's own literals -- a poly-T
    // 16-mer and the wildcard tail of the degenerate fixture. Degeneracy 256
    // with 18 equally good sites, so the resolver offers candidates *and*
    // demands confirmation.
    const composed = 'TTTTTTTTTTTTTTTTTTTT'.slice(0, 16) + 'TACATGTCTCTGGGACCANNNN'.slice(-4);
    seed(composed);
    render(<BindingResolution />);
    const radios = await screen.findAllByRole('radio');

    await userEvent.click(radios[0]!);
    const confirm = screen.getByRole('checkbox', { name: /confirm this site/i });
    await userEvent.click(confirm);
    expect(confirm).toBeChecked();
    expectActionable(screen.getByRole('button', { name: /continue/i }));

    await userEvent.click(radios[1]!);
    expect(screen.getByRole('checkbox', { name: /confirm this site/i })).not.toBeChecked();
    expectBlocked(screen.getByRole('button', { name: /continue/i }));
  });
});

// Regression test (added post-review, finding 1): the first version of these
// components used a literal 0x00 byte as a template-literal key delimiter.
// Runtime was unaffected, which is why nothing caught it -- but git sniffs the
// first 8000 bytes of a file for NUL and, finding one, treats the file as
// binary: `git diff` shows `Bin 0 -> 3588 bytes`, and every future diff, blame,
// merge and review of that file is degraded. `\0` inside the template literal
// is the identical delimiter at runtime and leaves the source ASCII.
//
// Scoped to this directory on purpose. A repo-wide source-hygiene check
// belongs with the lint work in task 6.1, not here.
// Sources are read through Vite's raw glob rather than node:fs because this
// project's app tsconfig exposes only `vite/client` types to `src`, and pulling
// node types in for one assertion is a change outside this directory.
describe('source hygiene', () => {
  it('has no raw NUL byte in any source file in this directory', () => {
    const sources = import.meta.glob<string>('./*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const offenders = Object.keys(sources).filter((path) => sources[path]?.includes('\0'));
    expect(offenders).toEqual([]);
  });
});
