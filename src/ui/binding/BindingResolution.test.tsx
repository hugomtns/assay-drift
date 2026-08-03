import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { BindingResolution } from './BindingResolution';
import { useAppStore } from '../../state/store';
import { loadReference } from '../../data/references';
import { reverseComplement } from '../../core/iupac';
import type { OligoInput } from '../../core/oligo-input';

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
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();

    await userEvent.click(confirm);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByText(/map appears once a site has been chosen/i)).toBeInTheDocument();
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
