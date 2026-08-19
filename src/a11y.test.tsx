import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import {
  ALPHA_OLIGO,
  sampleAnalysis,
  sampleResult,
  unassessableAnalysis,
} from './core/analysis/test-fixtures';
import type { Diagnostic } from './core/analysis/diagnostics';
import type { AnalysisResult } from './core/analysis/run';
import type { SeverityLevel } from './core/analysis/severity';
import { useAppStore } from './state/store';
import { CaveatPanel } from './ui/CaveatPanel';
import { PositionProfile } from './ui/results/PositionProfile';
import { SEVERITY_LABELS } from './ui/results/severity-labels';
import { SeverityBadge } from './ui/results/SeverityBadge';
import { TrendChart } from './ui/results/TrendChart';

/**
 * Task 6.2. Seven requirements, seven groups.
 *
 * **What axe can and cannot do here, stated once so no result from this file
 * is over-read.** jsdom performs no layout and resolves nothing from the
 * Tailwind build, so every axe rule that needs geometry or a computed colour
 * disables itself: `color-contrast` above all, but also target size and
 * overlap. Those rules do not pass in this environment — they never run. What
 * the pass below genuinely covers is structural: roles, accessible names,
 * label association, landmark and heading structure, duplicate ids, ARIA
 * attribute validity, list and table shape. Colour contrast is checked
 * instead, by computation, in `tests/a11y/contrast.test.ts`, and the rule
 * inventory below is asserted rather than assumed so that nobody reads "zero
 * violations" as "checked everything".
 */

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** Both oligos, so the null-rate branches render alongside the populated ones. */
const bothOligos: AnalysisResult = {
  ...sampleResult,
  oligos: [sampleAnalysis, unassessableAnalysis],
};

const seedResults = (): void => {
  useAppStore.getState().reset();
  useAppStore.getState().analysisSucceeded(bothOligos);
};

const seedBinding = (): void => {
  useAppStore.getState().reset();
  // The oligo is sliced out of the bundled reference by `test-fixtures`; no
  // sequence is written here (Global Constraint 2).
  useAppStore
    .getState()
    .setOligos([{ id: 'oligo-0', name: 'Alpha S-gene window', role: 'forward', sequence: ALPHA_OLIGO }]);
  useAppStore.getState().goTo('binding');
};

const seedScope = (): void => {
  seedBinding();
  useAppStore.getState().goTo('scope');
};

beforeAll(() => {
  // axe's colour-contrast check reaches for a canvas before it works out that
  // jsdom cannot give it one. jsdom's own stub returns null but logs "Not
  // implemented: HTMLCanvasElement's getContext()" to stderr every run, which
  // is four lines of noise per suite for a rule that is about to disable
  // itself anyway. Same return value, no console.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

beforeEach(() => {
  useAppStore.getState().reset();
});

/**
 * axe over a full results view walks a few thousand nodes and takes seconds on
 * a loaded machine, well past Vitest's 5 s default when the whole suite is
 * running in parallel. Generous rather than clever: a slow a11y check is not a
 * failing one.
 */
const AXE_TIMEOUT_MS = 60_000;

/**
 * `OligoInputPanel` commits its parse on a 200 ms debounce, so a landing-state
 * render that is merely awaited (as `axe.run` awaits) settles a React update
 * outside `act`. Letting the timer run inside `act` first keeps the warning
 * out of the log without pretending the debounce is not there.
 */
async function settleDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

async function axeRun(container: Element): Promise<axe.AxeResults> {
  return await axe.run(container, {
    // The defaults plus best-practice checks. `reporter: 'v2'` keeps the node
    // list on every violation so a failure names the element, not just a rule.
    reporter: 'v2',
  });
}

const describeViolations = (results: axe.AxeResults): string =>
  results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'no impact'}): ${v.help}\n  ` +
        v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 160)}`).join('\n  '),
    )
    .join('\n');

// ---------------------------------------------------------------------------
// Requirement 1: axe over three states
// ---------------------------------------------------------------------------

describe('1. axe-core finds no structural violation', () => {
  it('on the landing state', async () => {
    const { container } = render(<App />);
    await settleDebounce();
    const results = await axeRun(container);
    expect(describeViolations(results)).toBe('');
  }, AXE_TIMEOUT_MS);

  it('on the binding step', async () => {
    seedBinding();
    const { container } = render(<App />);
    // Resolution runs in an effect; wait for the located coordinates.
    await screen.findByText(/21,?765/);
    const results = await axeRun(container);
    expect(describeViolations(results)).toBe('');
  }, AXE_TIMEOUT_MS);

  it('on a full results view', async () => {
    seedResults();
    const { container } = render(<App />);
    const results = await axeRun(container);
    expect(describeViolations(results)).toBe('');
  }, AXE_TIMEOUT_MS);

  /**
   * The honesty test. It fails if `color-contrast` ever starts *running* here
   * (in which case this file's disclaimer is out of date and the separate
   * contrast test may be redundant), and it prints the inventory so a reviewer
   * can see the size of the blind spot rather than taking it on trust.
   */
  it('does not, and cannot, check colour contrast in jsdom', async () => {
    seedResults();
    const { container } = render(<App />);
    const results = await axeRun(container);

    const ran = [...results.passes, ...results.violations].map((r) => r.id);
    const inapplicable = results.inapplicable.map((r) => r.id);
    const incomplete = results.incomplete.map((r) => r.id);

    console.log(
      `axe ${axe.version}: ${String(ran.length)} rules produced a result, ` +
        `${String(incomplete.length)} incomplete, ${String(inapplicable.length)} inapplicable.\n` +
        `  ran: ${ran.sort().join(', ')}\n` +
        `  incomplete: ${incomplete.sort().join(', ') || '(none)'}\n` +
        `  inapplicable: ${inapplicable.sort().join(', ') || '(none)'}`,
    );

    // Not a passing rule and not a violated one: it never executed.
    expect(ran).not.toContain('color-contrast');
  }, AXE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Requirement 2: keyboard reachability and DOM order
// ---------------------------------------------------------------------------

/**
 * Everything a sequential-focus walk should stop on, in document order.
 * `disabled` controls are excluded because the browser excludes them — which
 * is exactly the problem the `aria-disabled` swap below exists to fix.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const focusableInDomOrder = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0);

const nameOf = (el: Element): string =>
  `${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}`;

/** Tab through `expected.length` stops and report where focus actually went. */
async function tabThrough(user: ReturnType<typeof userEvent.setup>, count: number): Promise<string[]> {
  const visited: string[] = [];
  for (let i = 0; i < count; i++) {
    await user.tab();
    visited.push(document.activeElement === null ? 'null' : nameOf(document.activeElement));
  }
  return visited;
}

describe('2. every interactive control is reachable and operable by keyboard', () => {
  it('walks the landing state in DOM order', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const expected = focusableInDomOrder(container);
    expect(expected.length).toBeGreaterThan(3);

    const visited = await tabThrough(user, expected.length);
    expect(visited).toEqual(expected.map(nameOf));
  });

  it('walks the results view in DOM order', async () => {
    seedResults();
    const user = userEvent.setup();
    const { container } = render(<App />);
    const expected = focusableInDomOrder(container);
    expect(expected.length).toBeGreaterThan(3);

    const visited = await tabThrough(user, expected.length);
    expect(visited).toEqual(expected.map(nameOf));
  });

  it('keeps a blocked "Run analysis" in the tab order and says why', async () => {
    seedScope();
    const user = userEvent.setup();
    // Rendered through App so the real wizard wiring is what is exercised: a
    // click that got through would reach `start()` and hit the network.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<App />);
    const from = screen.getByLabelText(/collected from/i);
    await user.clear(from);

    const run = screen.getByRole('button', { name: /run analysis/i });
    expect(run).toHaveAttribute('aria-disabled', 'true');
    expect(run).not.toHaveAttribute('disabled');
    expect(run).toHaveAccessibleDescription(/enter both a start and an end/i);

    run.focus();
    expect(run).toHaveFocus();

    // The step's own option-list load has already issued its two `aggregated`
    // queries by now, so the baseline is taken here rather than at zero.
    const before = fetchSpy.mock.calls.length;
    await user.click(run);
    await user.keyboard('{Enter}');
    // Reachable and announced as disabled is only half of it: it must also
    // refuse to act.
    expect(useAppStore.getState().status).toBe('idle');
    expect(fetchSpy.mock.calls.length).toBe(before);
    fetchSpy.mockRestore();
  });

  it('keeps a blocked step-1 "Continue" in the tab order and says why', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /paste my own oligos/i }));
    const textarea = screen.getByLabelText(/paste your oligos/i);
    // A valid oligo with no role: Continue must be inert but reachable.
    await user.click(textarea);
    await user.paste(ALPHA_OLIGO);
    // The role select appears once the paste has parsed. `/choose a role/i`
    // would now match two nodes -- the per-oligo hint and the button's own
    // blocked-reason region.
    await screen.findByLabelText(/role for/i);

    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveAccessibleDescription(/role/i);

    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useAppStore.getState().step).toBe('input');
  });

  it('keeps a blocked step-2 "Continue" in the tab order and says why', async () => {
    useAppStore.getState().reset();
    // A poly-T 20-mer binds in many places, so the resolver refuses to pick
    // and nothing is committed -- Continue is blocked.
    useAppStore
      .getState()
      .setOligos([{ id: 'oligo-0', name: 'Ambiguous', role: 'forward', sequence: 'T'.repeat(20) }]);
    useAppStore.getState().goTo('binding');
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByRole('radio');

    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(button).toHaveAccessibleDescription(/site/i);

    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useAppStore.getState().step).toBe('binding');
  });
});

// ---------------------------------------------------------------------------
// Requirement 3: an equivalent data table for each chart
// ---------------------------------------------------------------------------

describe('3. the charts expose an equivalent data table', () => {
  it('the trend chart tabulates every bucket with both counts', () => {
    render(<TrendChart trend={sampleAnalysis.trend} />);
    const table = screen.getByRole('table');
    expect(table).toHaveAccessibleName(/mismatch rate by (week|month)/i);
    const rows = within(table).getAllByRole('row');
    // One header row plus one per bucket.
    expect(rows).toHaveLength(sampleAnalysis.trend.points.length + 1);
    for (const point of sampleAnalysis.trend.points) {
      const row = within(table).getByRole('row', { name: new RegExp(point.bucket) });
      expect(row).toHaveTextContent(String(point.nFullCoverage).replace(/\B(?=(\d{3})+$)/g, ','));
    }
  });

  it('the position profile tabulates every position with its counts', () => {
    render(<PositionProfile analysis={sampleAnalysis} />);
    const table = screen.getByRole('table');
    expect(table).toHaveAccessibleName(/per-position mismatch/i);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(sampleAnalysis.profile.length + 1);

    const first = sampleAnalysis.profile[0];
    if (first === undefined) throw new Error('the sample profile is empty');
    const row = within(table).getByRole('row', {
      name: new RegExp(String(first.refPos).replace(/\B(?=(\d{3})+$)/g, ',')),
    });
    expect(row).toHaveTextContent(String(first.mismatchCount).replace(/\B(?=(\d{3})+$)/g, ','));
  });

  it('does not announce the same position twice', () => {
    // The per-column <svg role="img"> labels and the table say the same thing.
    // Only one of them may be in the accessibility tree.
    const { container } = render(<PositionProfile analysis={sampleAnalysis} />);
    const labelled = container.querySelectorAll('svg[role="img"]');
    for (const svg of labelled) {
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('the position table survives a profile with nothing assessable', () => {
    render(<PositionProfile analysis={unassessableAnalysis} />);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(unassessableAnalysis.profile.length + 1);
  });
});

// ---------------------------------------------------------------------------
// Requirement 4: severity is never colour alone
// ---------------------------------------------------------------------------

const LEVELS: readonly SeverityLevel[] = ['green', 'amber', 'red', 'unknown'];

describe('4. severity is never communicated by colour alone', () => {
  it.each(LEVELS)('%s renders its word', (level) => {
    render(<SeverityBadge severity={{ level, score: 0, reasons: [] }} role="forward" />);
    expect(screen.getByText(SEVERITY_LABELS[level])).toBeInTheDocument();
  });

  it('gives each level a different shape', () => {
    const shapes = LEVELS.map((level) => {
      const { container, unmount } = render(
        <SeverityBadge severity={{ level, score: 0, reasons: [] }} role="forward" />,
      );
      const svg = container.querySelector('svg');
      if (svg === null) throw new Error(`no icon rendered for ${level}`);
      const markup = svg.innerHTML;
      unmount();
      return markup;
    });
    expect(new Set(shapes).size).toBe(LEVELS.length);
  });

  it('distinguishes a warning diagnostic from an informational one without colour', () => {
    const diagnostics: Diagnostic[] = [
      { id: 'coverage-gap', severity: 'warn', message: 'The coverage gap is large here.' },
      { id: 'deposition-lag', severity: 'info', message: 'Something merely worth knowing.' },
    ];
    render(
      <CaveatPanel
        result={{
          ...sampleResult,
          oligos: [{ ...sampleAnalysis, diagnostics }],
        }}
      />,
    );
    const warn = screen.getByText(/The coverage gap is large here/).closest('li');
    const info = screen.getByText(/Something merely worth knowing/).closest('li');
    if (warn === null || info === null) throw new Error('diagnostics did not render as list items');

    // Greyscale test: strip every class and the two must still read
    // differently. A colour class is not a distinction.
    expect(warn.textContent).toMatch(/warning/i);
    expect(info.textContent).not.toMatch(/warning/i);
  });
});

// ---------------------------------------------------------------------------
// Requirement 6 lives in tests/a11y/reduced-motion.test.ts
//
// It has to read `src/index.css` off disk: a Vite `?raw` import of a .css file
// resolves to the empty string under Vitest, because the CSS pipeline claims
// the module before `?raw` is honoured. `src/` has no Node types, so the test
// sits under `tests/` with the contrast one.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Requirement 7: the completion announcement is polite
// ---------------------------------------------------------------------------

/** `role="status"` implies `aria-live="polite"`; an explicit attribute also counts. */
function isPolite(el: Element): boolean {
  const live = el.getAttribute('aria-live');
  if (live !== null) return live === 'polite';
  return el.getAttribute('role') === 'status';
}

describe('7. finishing an analysis is announced politely', () => {
  it('mounts the announcement region before there is anything to announce', () => {
    render(<App />);
    const region = screen.getByRole('status', { name: 'Analysis outcome' });
    expect(isPolite(region)).toBe(true);
    expect(region).toHaveTextContent('');
  });

  it('swaps the outcome into the same region rather than mounting a new one', async () => {
    const { rerender } = render(<App />);
    const before = screen.getByRole('status', { name: 'Analysis outcome' });

    act(() => {
      useAppStore.getState().analysisSucceeded(bothOligos);
    });
    rerender(<App />);

    const after = await screen.findByRole('status', { name: 'Analysis outcome' });
    // Same DOM node: a live region inserted at the same instant as its text is
    // frequently never announced at all.
    expect(after).toBe(before);
    expect(after).toHaveTextContent(/analysis complete/i);
    expect(after).toHaveTextContent(sampleAnalysis.name);
    expect(isPolite(after)).toBe(true);
  });

  it('never uses an assertive region for something merely informational', () => {
    seedResults();
    render(<App />);
    for (const alert of screen.queryAllByRole('alert')) {
      // An alert interrupts. Nothing on a finished, successful run may.
      expect(alert).toHaveTextContent('');
    }
  });

  it('says what the run found in outline', () => {
    seedResults();
    render(<App />);
    const region = screen.getByRole('status', { name: 'Analysis outcome' });
    expect(region).toHaveTextContent(/analysis complete/i);
    expect(region).toHaveTextContent(/71,142/);
    expect(region).toHaveTextContent(SEVERITY_LABELS[sampleAnalysis.severity.level]);
    expect(region).toHaveTextContent(unassessableAnalysis.name);
  });
});
