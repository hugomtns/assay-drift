import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { runAnalysis, type AnalysisOligo } from './core/analysis/run';
import type { BindingSite } from './core/binding';
import { withCache } from './core/lapis/caching-transport';
import { createFetchTransport } from './core/lapis/fetch-transport';
import { getPathogen, PATHOGENS, type PathogenId } from './core/registry';
import { resolveBindingSite } from './core/resolution';
import libraryRaw from './data/assays/library.json';
import { parseLibrary, type LibraryAssay } from './data/assays/schema';
import { loadReference } from './data/references';
import { useAppStore } from './state/store';
import { AppShell } from './ui/AppShell';
import { BindingResolution } from './ui/binding/BindingResolution';
import { EmptyState } from './ui/common/EmptyState';
import { ErrorState } from './ui/common/ErrorState';
import { Loading } from './ui/common/Loading';
import { AssayPicker } from './ui/input/AssayPicker';
import { OligoInputPanel } from './ui/input/OligoInputPanel';
import { ResultsPanel } from './ui/results/ResultsPanel';
import { ScopeControls } from './ui/scope/ScopeControls';

/** The label says "since 2020", so the scope the example loads starts there. */
const WORKED_EXAMPLE_DATE_FROM = '2020-01-01';

/**
 * The landing screen's one-click example: the CDC 2019-nCoV_N1 assay, taken
 * from the bundled library rather than spelled out here.
 *
 * No primer sequence appears anywhere in this file, and that is the point.
 * `src/data/assays/library.json` is the one place oligos live, every entry is
 * traced to an opened source in `docs/assay-sources.md`, and every entry is
 * re-resolved against the bundled reference by `npm run verify:assays` in CI.
 * A second copy here would be a second thing to keep true, checked by nothing:
 * one wrong base does not error, it resolves somewhere else and prints a
 * confident, wrong percentage.
 *
 * Looked up by id and thrown on if missing, because a landing button that
 * quietly does nothing is worse than a build that stops.
 */
function bundledAssay(id: string): LibraryAssay {
  const assay = parseLibrary(libraryRaw).assays.find((a) => a.id === id);
  if (assay === undefined) {
    throw new Error(`The bundled assay library has no assay with id "${id}".`);
  }
  return assay;
}

const WORKED_EXAMPLE = bundledAssay('cdc-2019-ncov-n1');

/**
 * The oligos the analysis can actually run on: those with both a role and a
 * site the user committed in step 2.
 *
 * Steps 1 and 2 already refuse to advance until every oligo has both, so this
 * never drops anything in practice; it exists because `AnalysisOligo` requires
 * a non-null role and a site, and silently coercing a missing one would be the
 * failure mode this whole flow is built to prevent.
 */
function analysisOligos(state: ReturnType<typeof useAppStore.getState>): AnalysisOligo[] {
  const out: AnalysisOligo[] = [];
  for (const oligo of state.oligos) {
    const role = state.roles[oligo.id] ?? oligo.role;
    const site = state.chosenSites[oligo.id];
    if (role === null || site === undefined) continue;
    out.push({ id: oligo.id, name: oligo.name, role, sequence: oligo.sequence, site });
  }
  return out;
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : `Unexpected failure: ${String(err)}`;

interface PathogenSelectorProps {
  value: PathogenId;
  onChange: (id: PathogenId) => void;
}

function PathogenSelector({ value, onChange }: PathogenSelectorProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="pathogen-select" className="text-sm font-medium text-slate-900">
        Pathogen
      </label>
      <select
        id="pathogen-select"
        value={value}
        aria-describedby="pathogen-select-hint"
        onChange={(e) => onChange(e.target.value as PathogenId)}
        className="w-64 rounded border border-slate-300 px-2 py-1"
      >
        {Object.values(PATHOGENS).map((cfg) => (
          <option key={cfg.id} value={cfg.id}>
            {cfg.label}
          </option>
        ))}
      </select>
      <p id="pathogen-select-hint" className="text-xs text-slate-600">
        Each pathogen has its own reference genome, so changing it clears the oligos and any
        analysis already run.
      </p>
    </div>
  );
}

/**
 * The assembled application.
 *
 * Step content is chosen by the store's `step`, but `status` outranks it:
 * while a query is in flight or has failed, the loading or error state
 * replaces the step entirely rather than sitting beside it. That is what makes
 * the two states unambiguous -- a spinner next to a still-interactive "Run
 * analysis" invites a second run over the first, and an error banner under a
 * results panel leaves the user reading numbers from a run that did not
 * finish.
 *
 * `status` also has to drive them because it is the only thing that can. It is
 * set by the store, and a run started from anywhere (the scope step, the
 * worked example, "Try again") has to light the same indicator; tracking an
 * in-flight promise here instead would give three sources of truth for one
 * fact.
 *
 * Every run is abortable and supersedes the last (Global Constraint 10). One
 * controller is held in a ref: starting a run aborts whatever was in flight,
 * unmounting aborts as well, and both settle paths check `aborted` before
 * writing, so a superseded run can never overwrite the run that replaced it
 * with an older answer.
 */
export default function App() {
  const step = useAppStore((s) => s.step);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const result = useAppStore((s) => s.result);
  const pathogenId = useAppStore((s) => s.pathogenId);
  const setPathogen = useAppStore((s) => s.setPathogen);
  const goTo = useAppStore((s) => s.goTo);

  /**
   * One transport for the whole session, and it must stay one *object*.
   *
   * `ScopeControls` uses `transport` as an effect dependency, so a transport
   * built in this render body would be a new identity on every render: the
   * option-list effect would tear down and re-issue both `aggregated` queries
   * every time anything re-rendered App -- an unbounded query loop against a
   * live API that changes nothing on screen while it runs.
   *
   * `withCache` is not optional either. One analysis is 3 + 4N queries and the
   * option lists overlap with them, so without per-key memoisation, in-flight
   * de-duplication and the sessionStorage entry underneath, re-running a scope
   * the user has already looked at pays for all of it again.
   */
  const transport = useMemo(() => withCache(createFetchTransport()), []);
  const runRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    runRef.current?.abort();
    const controller = new AbortController();
    runRef.current = controller;

    const state = useAppStore.getState();
    const { scope } = state;
    const oligos = analysisOligos(state);
    // Synchronous: the references are bundled JSON, not a fetch.
    const reference = loadReference(scope.pathogenId);

    state.startAnalysis();
    runAnalysis({ transport, scope, oligos, reference, signal: controller.signal })
      .then((analysis) => {
        if (controller.signal.aborted) return;
        useAppStore.getState().analysisSucceeded(analysis);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        useAppStore.getState().analysisFailed(messageOf(err));
      });
  }, [transport]);

  useEffect(
    () => () => {
      runRef.current?.abort();
    },
    [],
  );

  const runWorkedExample = () => {
    const store = useAppStore.getState();
    // Resets everything, including a pathogen the user had picked: the bundled
    // assay is meaningless against any other reference.
    store.setPathogen(WORKED_EXAMPLE.pathogenId);
    const oligos = WORKED_EXAMPLE.oligos.map((oligo, index) => ({
      id: `oligo-${index}`,
      name: oligo.name,
      role: oligo.role,
      sequence: oligo.sequence,
    }));
    useAppStore.getState().setOligos(oligos);

    const reference = loadReference(WORKED_EXAMPLE.pathogenId);
    const sites: Record<string, BindingSite> = {};
    for (const oligo of oligos) {
      const resolution = resolveBindingSite(oligo.sequence, reference);
      useAppStore.getState().setResolution(oligo.id, resolution);
      if (resolution.chosen === null) {
        // Should be unreachable: the verification gate re-resolves every
        // library oligo in CI. Showing step 2 is the honest fallback -- it
        // says exactly which oligo could not be placed, rather than running an
        // analysis over a partial assay.
        useAppStore.getState().goTo('binding');
        return;
      }
      sites[oligo.id] = resolution.chosen;
    }
    useAppStore.getState().commitSites(sites);
    useAppStore.getState().setScope({ dateFrom: WORKED_EXAMPLE_DATE_FROM });
    start();
  };

  const cfg = getPathogen(pathogenId);

  let content: ReactNode;
  if (status === 'loading') {
    content = (
      <Loading
        what={`${cfg.label} sequences`}
        detail="Counting matching sequences, then one coverage and one mismatch query per oligo."
      />
    );
  } else if (status === 'error') {
    content = <ErrorState message={error ?? 'The analysis failed.'} onRetry={start} />;
  } else if (step === 'input') {
    content = (
      <div className="flex flex-col gap-8">
        <OligoInputPanel />
        <section aria-labelledby="worked-example-heading" className="flex flex-col items-start gap-2">
          <h2 id="worked-example-heading" className="text-base font-semibold">
            Or start from a worked example
          </h2>
          <button
            type="button"
            onClick={runWorkedExample}
            className="rounded border border-slate-900 px-4 py-2 text-slate-900"
          >
            See how the CDC N1 assay has drifted since 2020
          </button>
        </section>
        <AssayPicker />
      </div>
    );
  } else if (step === 'binding') {
    content = <BindingResolution />;
  } else if (step === 'scope') {
    content = <ScopeControls onRun={start} transport={transport} />;
  } else if (result === null) {
    content = <p className="text-sm text-slate-700">No analysis has been run yet.</p>;
  } else if (result.nScope === 0) {
    content = (
      <EmptyState
        scope={result.scope}
        pathogenLabel={getPathogen(result.pathogenId).label}
        lineageLabel={getPathogen(result.pathogenId).lineageLabel}
        onChangeScope={() => {
          goTo('scope');
        }}
      />
    );
  } else {
    content = <ResultsPanel result={result} />;
  }

  return (
    <AppShell step={step} pathogenSelector={<PathogenSelector value={pathogenId} onChange={setPathogen} />}>
      {content}
    </AppShell>
  );
}
