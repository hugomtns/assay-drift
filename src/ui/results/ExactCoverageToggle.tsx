import { useEffect, useId, useRef, useState } from 'react';
import { applyExactCoverage, type PositionStat } from '../../core/analysis/profile';
import type { OligoAnalysis } from '../../core/analysis/run';
import {
  ExactCoverageError,
  fetchExactCoverage,
  MAX_EXACT_COVERAGE_POSITIONS,
} from '../../core/lapis/endpoints';
import type { LapisTransport } from '../../core/lapis/transport';
import type { PathogenConfig } from '../../core/registry';
import { formatCount } from '../format';

interface ExactCoverageToggleProps {
  analysis: OligoAnalysis;
  transport: LapisTransport;
  cfg: PathogenConfig;
  filters: Record<string, unknown>;
  /** Called once, with a profile whose denominators are all measured. */
  onCoverage: (profile: PositionStat[]) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; queries: number }
  | { kind: 'failed'; message: string };

const messageOf = (err: unknown): string => {
  if (err instanceof ExactCoverageError) return err.message;
  if (err instanceof Error) return err.message;
  return `Unexpected error: ${String(err)}`;
};

/**
 * The opt-in control that replaces every inferred bar in one oligo's profile
 * with a measured one.
 *
 * **Opt-in, and it states its price.** The analysis itself is 3 + 4N queries
 * however long the oligos are; this is one more query per position, so a 22 nt
 * primer is 22 further round trips to a public instance nobody is paying for.
 * The button says how many before it is pressed, because the number is the
 * whole decision.
 *
 * **Above the cap it is unavailable, not silently inert.** Task 6.2's idiom:
 * `aria-disabled` rather than `disabled`, so the control stays in the tab
 * order and can be reached and read, with the reason in an always-mounted
 * `role="status"` region that `aria-describedby` points at. The click handler
 * re-checks the same guard, so the control is genuinely inert and not merely
 * styled that way.
 *
 * **Abortable, and a superseded fan-out never writes** (Global Constraint 10).
 * One `AbortController` per component: pressing again aborts the previous
 * fan-out, and unmounting -- which is what a re-run or an oligo change causes,
 * because the caller keys this component on the analysis -- aborts it too.
 * `Promise.allSettled` inside `fetchExactCoverage` resolves whatever happens,
 * so both settle paths check `signal.aborted` before touching state. This is
 * the one place in the app where a stale write would be invisible: the numbers
 * would still look plausible, they would just belong to the previous oligo.
 *
 * **Partial failure never becomes a number.** `fetchExactCoverage` is
 * all-or-nothing; if any position fails, nothing is applied and this says which
 * ones and how many. The alternative -- filling the gaps from the window
 * denominator and calling the result exact -- would produce a chart that is
 * measured in some columns and borrowed in others with nothing on screen
 * distinguishing them, which is the exact failure the hatching exists to
 * prevent.
 */
export function ExactCoverageToggle({
  analysis,
  transport,
  cfg,
  filters,
  onCoverage,
}: ExactCoverageToggleProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const runRef = useRef<AbortController | null>(null);
  const statusId = `exact-coverage-status-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  useEffect(
    () => () => {
      runRef.current?.abort();
    },
    [],
  );

  const positions = analysis.window.positions.length;
  const overCap = positions > MAX_EXACT_COVERAGE_POSITIONS;

  const load = (): void => {
    // The guard, again, at the moment of action. `aria-disabled` is an
    // announcement, not an enforcement.
    if (overCap || state.kind === 'loading' || state.kind === 'loaded') return;

    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;
    setState({ kind: 'loading' });

    fetchExactCoverage(transport, cfg, filters, analysis.window, { signal: controller.signal })
      .then((coverage) => {
        if (controller.signal.aborted) return;
        onCoverage(
          applyExactCoverage(
            analysis.profile,
            analysis.window,
            coverage,
            analysis.metrics.nFullCoverage,
          ),
        );
        setState({ kind: 'loaded', queries: positions });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'failed', message: messageOf(err) });
      });
  };

  const capReason =
    `This binding site has ${formatCount(positions)} positions, and exact per-base coverage costs ` +
    `one query per position. The limit is ${formatCount(MAX_EXACT_COVERAGE_POSITIONS)} positions, ` +
    `so it is not available for this oligo.`;

  // State first, cap reason last. The cap reason is what an over-cap control
  // says while it is idle, which is the only state it can legitimately reach --
  // but if a fan-out ever did start and fail, the failure is the more useful
  // thing to print, and printing the cap reason over the top of it would hide
  // that the guard had been bypassed.
  let status = '';
  if (state.kind === 'loading') {
    status = `Measuring per-base coverage for ${analysis.name}: ${formatCount(positions)} queries in flight.`;
  } else if (state.kind === 'loaded') {
    status =
      `Exact per-base coverage loaded for ${analysis.name} in ${formatCount(state.queries)} queries. ` +
      `Every bar below is now drawn against a measured denominator, so none of them borrows the window's.`;
  } else if (state.kind === 'failed') {
    status = `${state.message} The bars below are unchanged.`;
  } else if (overCap) {
    status = capReason;
  }

  const showButton = state.kind !== 'loaded';

  return (
    <div className="flex flex-col gap-1">
      {showButton && (
        <button
          type="button"
          onClick={load}
          aria-disabled={overCap ? 'true' : undefined}
          aria-describedby={statusId}
          className={
            overCap
              ? 'self-start rounded bg-slate-200 px-3 py-1 text-sm text-slate-700'
              : 'self-start rounded border border-slate-900 px-3 py-1 text-sm text-slate-900'
          }
        >
          {state.kind === 'loading'
            ? `Loading exact per-base coverage (${formatCount(positions)} extra queries)…`
            : `Load exact per-base coverage (${formatCount(positions)} extra queries)`}
        </button>
      )}
      {/*
        Always mounted, text swapped in. A live region inserted at the same
        instant as its text is frequently never announced, and this one is also
        the button's accessible description, which has to exist before the
        button is first reached.
      */}
      <p id={statusId} role="status" className="text-sm text-slate-700">
        {status}
      </p>
      {state.kind === 'idle' && !overCap && (
        <p className="text-xs text-slate-600">
          Positions where nothing was mutated have no reported coverage, so their bars borrow the
          window denominator. Measuring them takes one extra query each.
        </p>
      )}
    </div>
  );
}
