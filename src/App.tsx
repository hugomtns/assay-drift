import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { runAnalysis, type AnalysisOligo } from './core/analysis/run';
import { findBindingSites, type BindingSite } from './core/binding';
import { withCache } from './core/lapis/caching-transport';
import { createFetchTransport } from './core/lapis/fetch-transport';
import { createProxyTransport, shouldUseProxy } from './core/lapis/proxy-transport';
import type { OligoInput } from './core/oligo-input';
import {
  decodePermalink,
  encodePermalink,
  PERMALINK_PREFIX,
  type PermalinkScope,
  type PermalinkState,
} from './core/permalink';
import { getPathogen, PATHOGENS, type PathogenId } from './core/registry';
import { resolveBindingSite } from './core/resolution';
import type { Scope } from './core/scope';
import libraryRaw from './data/assays/library.json';
import { parseLibrary, type LibraryAssay } from './data/assays/schema';
import { loadReference } from './data/references';
import { useAppStore } from './state/store';
import { AnalysisAnnouncer } from './ui/AnalysisAnnouncer';
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
  err instanceof Error ? err.message : `Unexpected error: ${String(err)}`;

/** Everything a decoded link has to become before the store will accept it. */
interface RestoredQuery {
  pathogenId: PathogenId;
  oligos: OligoInput[];
  /** Keyed by the store's oligo id, not by name. */
  sites: Record<string, BindingSite>;
  scope: PermalinkScope;
}

/**
 * A URL hash into a runnable query, or `null` if it is not one.
 *
 * `decodePermalink` refuses anything malformed, but it deliberately knows
 * nothing about reference genomes, so it cannot tell whether the site a link
 * names is a site that oligo actually has. That check belongs here, and it is
 * not a formality: a link is untrusted input, and `start()` would otherwise
 * happily build a window from a segment name and a coordinate a stranger chose.
 *
 * The site is re-derived rather than reconstructed arithmetically. A link
 * carries only segment, strand and start; `end`, `mismatches` and
 * `mismatchOligoIndexes` are functions of the oligo and the reference, and
 * every one of them feeds a printed number. Taking them from
 * `findBindingSites` means a restored analysis is the same object the app would
 * have produced itself, and a link that names a position the oligo does not
 * bind is rejected rather than analysed at a plausible-looking coordinate.
 */
function restoreFromHash(hash: string): RestoredQuery | null {
  const decoded = decodePermalink(hash);
  if (decoded === null) return null;
  try {
    const reference = loadReference(decoded.pathogenId);
    const oligos: OligoInput[] = [];
    const sites: Record<string, BindingSite> = {};
    for (const [index, oligo] of decoded.oligos.entries()) {
      const id = `oligo-${index}`;
      const wanted = decoded.sites[oligo.name];
      if (wanted === undefined) return null;
      const site = findBindingSites(oligo.sequence, reference).find(
        (candidate) =>
          candidate.segment === wanted.segment &&
          candidate.strand === wanted.strand &&
          candidate.start === wanted.start,
      );
      if (site === undefined) return null;
      oligos.push({ id, name: oligo.name, role: oligo.role, sequence: oligo.sequence });
      sites[id] = site;
    }
    return { pathogenId: decoded.pathogenId, oligos, sites, scope: decoded.scope };
  } catch {
    // A link does not get to crash the app on the way in.
    return null;
  }
}

/**
 * Replaces the URL hash with a link that reproduces the analysis just finished.
 *
 * `replaceState`, never `pushState`: a result the user did not navigate to
 * should not become a back-button stop, and re-running with a tweaked scope
 * would otherwise leave a trail of half-considered queries behind the one
 * on screen.
 *
 * Called only from the success path, so the address bar never advertises a
 * result that a failed or superseded run did not produce.
 */
function publishPermalink(scope: Scope, oligos: AnalysisOligo[]): void {
  const state: PermalinkState = {
    pathogenId: scope.pathogenId,
    oligos: oligos.map((o) => ({ name: o.name, role: o.role, sequence: o.sequence })),
    sites: Object.fromEntries(
      oligos.map((o) => [
        o.name,
        { segment: o.site.segment, strand: o.site.strand, start: o.site.start },
      ]),
    ),
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      countries: scope.countries,
      lineages: scope.lineages,
    },
  };
  try {
    window.history.replaceState(null, '', encodePermalink(state));
  } catch {
    // Too large for a usable link, or two oligos share a name. Clearing is the
    // honest outcome: a stale hash from an earlier run would claim to
    // reproduce the result now on screen. `CopyLinkButton` reads the hash back
    // at click time, so it says so rather than copying a URL that lies.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

type CopyState = 'idle' | 'copied' | 'unavailable' | 'failed';

const COPY_MESSAGES: Readonly<Record<CopyState, string>> = Object.freeze({
  idle: '',
  copied: 'Link copied.',
  unavailable:
    'This analysis is too large to put in a link, so there is nothing to copy. Narrow the scope or run fewer oligos at once.',
  failed: 'Could not reach the clipboard. The link is in the address bar and can be copied from there.',
});

/**
 * Copies the current URL, which is the permalink, and says what happened.
 *
 * The hash is read at click time rather than at render time on purpose: it is
 * written by `publishPermalink` outside React, so a value captured during
 * render could be a frame behind, and the one case that matters -- no link,
 * because the query would not fit -- is precisely the one where copying the
 * URL anyway would hand someone a link to the empty app.
 */
function CopyLinkButton() {
  const [state, setState] = useState<CopyState>('idle');

  const copy = (): void => {
    if (!window.location.hash.startsWith(PERMALINK_PREFIX)) {
      setState('unavailable');
      return;
    }
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      setState('failed');
      return;
    }
    clipboard.writeText(window.location.href).then(
      () => { setState('copied'); },
      () => { setState('failed'); },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded border border-slate-900 px-3 py-1 text-sm text-slate-900"
      >
        Copy link to this analysis
      </button>
      {/*
        Always mounted with its text swapped in: a live region inserted at the
        same instant as its text is frequently never announced.
      */}
      <span role="status" className="text-sm text-slate-600">
        {COPY_MESSAGES[state]}
      </span>
    </div>
  );
}

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
   *
   * Direct or proxied is decided once, here, by `shouldUseProxy`: the deployed
   * production build goes through the Vercel Function in `api/lapis.ts` and its
   * six-hour edge cache, and `npm run dev` -- which has no functions running --
   * keeps talking to LAPIS directly, so neither needs configuring.
   * `VITE_LAPIS_PROXY` overrides it in both directions; `npm run preview` wants
   * `VITE_LAPIS_PROXY=0`, because it serves a production build with no function
   * behind it. Whichever is chosen, this is still one object: the decision is
   * inside the `useMemo`, so the dependency array stays empty and
   * `ScopeControls` still sees a stable identity.
   */
  const transport = useMemo(
    () =>
      withCache(shouldUseProxy(import.meta.env) ? createProxyTransport() : createFetchTransport()),
    [],
  );
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
        // Only here. A superseded, failed or aborted run must not publish a
        // link claiming to reproduce a result it never produced. The `scope`
        // and `oligos` written are the ones this run used, not whatever the
        // store holds by the time it lands.
        publishPermalink(scope, oligos);
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

  /**
   * The link the page was opened with, read once and never again.
   *
   * Reading it in a `useState` initialiser rather than in the effect below is
   * what breaks the loop: `publishPermalink` writes the hash on every
   * successful run, and an effect that read `window.location.hash` live would
   * see its own write and restart the analysis it had just finished. This value
   * is captured before any run can exist, so the writer and the reader are
   * permanently out of each other's reach.
   *
   * It also keeps the decode out of the effect body. `restored` is a pure
   * function of a frozen string, so the effect's dependency list is genuinely
   * stable and the "shared link could not be read" notice is derived during
   * render -- not set from inside an effect, which `react-hooks/set-state-in-effect`
   * forbids and which would render one frame of the wrong screen anyway.
   */
  const [initialHash] = useState(() => window.location.hash);
  const restored = useMemo(() => restoreFromHash(initialHash), [initialHash]);
  const linkUnreadable = initialHash.startsWith(PERMALINK_PREFIX) && restored === null;

  useEffect(() => {
    if (restored === null) return;
    // Deliberately the same `start()` every other run goes through, so the
    // restored run gets the same abort discipline and the same single
    // in-flight controller. A second, parallel run path here would be a second
    // thing to keep abortable.
    const store = useAppStore.getState();
    // Resets oligos, sites, resolutions and scope first; everything below then
    // writes the link's own values over a known-clean state.
    store.setPathogen(restored.pathogenId);
    useAppStore.getState().setOligos(restored.oligos);
    useAppStore.getState().commitSites(restored.sites);
    useAppStore.getState().setScope(restored.scope);
    start();
  }, [restored, start]);

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
        {linkUnreadable && (
          <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            The shared link in this page's address could not be read, so nothing was restored. It
            may have been truncated in transit, or it may name a pathogen, a sequence or a binding
            site this version does not accept. Start below, or ask whoever sent it for the link
            again.
          </p>
        )}
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
    // A scope that matched nothing is still a finished, reproducible run, so it
    // gets a link too -- that is exactly the result someone needs to be able to
    // send to a colleague and ask "do you see this as well?".
    content = (
      <div className="flex flex-col gap-6">
        <CopyLinkButton />
        <EmptyState
          scope={result.scope}
          pathogenLabel={getPathogen(result.pathogenId).label}
          lineageLabel={getPathogen(result.pathogenId).lineageLabel}
          onChangeScope={() => {
            goTo('scope');
          }}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-6">
        <CopyLinkButton />
        {/*
          The same session transport the analysis ran on, so the opt-in
          exact-coverage fan-out shares its cache and its in-flight
          de-duplication rather than opening a second, uncached path to LAPIS.
        */}
        <ResultsPanel result={result} transport={transport} />
      </div>
    );
  }

  return (
    <AppShell step={step} pathogenSelector={<PathogenSelector value={pathogenId} onChange={setPathogen} />}>
      {/*
        A sibling of `content`, never inside it. `content` is replaced wholesale
        when `status` or `step` changes, and a live region that is unmounted and
        remounted with its text already in place is frequently never announced.
        Kept first so it holds the same DOM node across every step.
      */}
      <AnalysisAnnouncer status={status} result={result} />
      {content}
    </AppShell>
  );
}
