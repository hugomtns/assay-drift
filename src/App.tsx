import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { withCache } from './core/lapis/caching-transport';
import { createFetchTransport } from './core/lapis/fetch-transport';
import { createProxyTransport, shouldUseProxy } from './core/lapis/proxy-transport';
import { PERMALINK_PREFIX } from './core/permalink';
import { getPathogen } from './core/registry';
import { useAppStore } from './state/store';
import { PathogenSelector } from './app/PathogenSelector';
import { restoreFromHash } from './app/permalink';
import { useAnalysisRunner } from './app/use-analysis-runner';
import { prepareWorkedExample } from './app/worked-example';
import { AnalysisAnnouncer } from './ui/AnalysisAnnouncer';
import { AppShell } from './ui/AppShell';
import { BindingResolution } from './ui/binding/BindingResolution';
import { EmptyState } from './ui/common/EmptyState';
import { ErrorState } from './ui/common/ErrorState';
import { Loading } from './ui/common/Loading';
import { AssayPicker } from './ui/input/AssayPicker';
import { OligoInputPanel } from './ui/input/OligoInputPanel';
import { CopyLinkButton } from './ui/results/ExportButtons';
import { ResultsPanel } from './ui/results/ResultsPanel';
import { ScopeControls } from './ui/scope/ScopeControls';

export default function App() {
  const [entryPath, setEntryPath] = useState<'published' | 'paste'>('published');
  const step = useAppStore((s) => s.step);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const result = useAppStore((s) => s.result);
  const pathogenId = useAppStore((s) => s.pathogenId);
  const oligos = useAppStore((s) => s.oligos);
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
  const start = useAnalysisRunner(transport);

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

  const runWorkedExample = () => { if (prepareWorkedExample()) start(); };

  const cfg = getPathogen(pathogenId);

  const handleEntryTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = tabs[nextIndex];
    if (next === undefined) return;
    setEntryPath(next.id === 'published-assay-tab' ? 'published' : 'paste');
    next.focus();
  };

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
        <section aria-labelledby="entry-path-heading" className="flex flex-col gap-4">
          <h2 id="entry-path-heading" className="text-xl font-semibold">
            Start an assay check
          </h2>
          <div role="tablist" aria-label="Choose how to start" className="flex flex-wrap gap-2 border-b border-slate-200">
            <button
              id="published-assay-tab"
              type="button"
              role="tab"
              aria-selected={entryPath === 'published'}
              aria-controls="published-assay-panel"
              onClick={() => { setEntryPath('published'); }}
              onKeyDown={handleEntryTabKeyDown}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                entryPath === 'published' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-600'
              }`}
            >
              Choose a published assay
            </button>
            <button
              id="paste-oligos-tab"
              type="button"
              role="tab"
              aria-selected={entryPath === 'paste'}
              aria-controls="paste-oligos-panel"
              onClick={() => { setEntryPath('paste'); }}
              onKeyDown={handleEntryTabKeyDown}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                entryPath === 'paste' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-600'
              }`}
            >
              Paste my own oligos
            </button>
          </div>
          {entryPath === 'published' ? (
            <div id="published-assay-panel" role="tabpanel" aria-labelledby="published-assay-tab">
              <AssayPicker onRunExample={runWorkedExample} />
            </div>
          ) : (
            <div id="paste-oligos-panel" role="tabpanel" aria-labelledby="paste-oligos-tab">
              <OligoInputPanel />
            </div>
          )}
        </section>
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
    <AppShell
      step={step}
      onStepChange={goTo}
      pathogenSelector={
        <PathogenSelector
          value={pathogenId}
          hasAnalysisInputs={oligos.length > 0 || result !== null}
          onChange={setPathogen}
        />
      }
    >
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
