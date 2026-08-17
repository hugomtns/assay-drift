import { render, screen, waitFor } from '@testing-library/react';
// Imports below this line support the suites added at the foot of the file;
// the suite above is transcribed from the task brief.
import { act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import App from './App';
import { useAppStore } from './state/store';
import { decodePermalink, encodePermalink, type PermalinkState } from './core/permalink';
import libraryRaw from './data/assays/library.json';
import { parseLibrary, verifyAssay } from './data/assays/schema';

beforeEach(() => { useAppStore.getState().reset(); });
// `withCache` persists to sessionStorage, which jsdom keeps for the whole file.
// Without this, a test that stubs an *empty* dataset is served the previous
// test's counts from the cache and silently asserts nothing. The fix is to
// clear the store between tests, never to disable the cache -- the cache is
// what keeps the analysis to 3 + 4N queries.
beforeEach(() => { sessionStorage.clear(); });
// Task 5.3 put a permalink in the URL hash, and jsdom keeps one URL for the
// whole file. A hash left behind by one test would make the next one restore a
// query and auto-run an analysis before its own arrangement had happened, so
// every test starts from a bare URL.
beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('App', () => {
  it('walks from pasted oligos to results', async () => {
    // Endpoint-aware stub: aggregated returns counts, the mutation and insertion
    // endpoints return empty sets so the profile renders with inferred coverage.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.endsWith('/aggregated')
        ? { data: [{ count: 1000, date: '2025-01-01' }] }
        : { data: [] };
      return new Response(
        JSON.stringify({ ...body, info: { dataVersion: 'dv', requestId: 'rid' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText(/paste your oligos/i));
    await user.paste('>N1-F\nTACATGTCTCTGGGACCAATGG');
    await user.click(await screen.findByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/21,?765/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /run analysis/i }));

    // The brief has `getByText(/assessable sequences/i)` here. The finished
    // results panel carries that phrase in four separate elements -- the
    // headline's counts, the position-profile caption, the trend caption and
    // the trend table's column header -- so the single-match query throws
    // "Found multiple elements" and can never pass. The plural form is the
    // literal fix; the assertion under it is the one the original was aiming
    // at, pinned to the element and the numbers, so nothing is weakened.
    await waitFor(() => {
      expect(screen.getAllByText(/assessable sequences/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByLabelText('Headline mismatch rate')).toHaveTextContent(
      'n = 1,000 of 1,000 assessable sequences',
    );
  });

  it('shows a loading state while a query is in flight', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    );
    render(<App />);
    useAppStore.getState().startAnalysis();
    expect(await screen.findByRole('status')).toHaveTextContent(/querying/i);
  });

  it('surfaces a LAPIS error with its detail and offers a retry', async () => {
    render(<App />);
    useAppStore.getState().analysisFailed('LAPIS 400: Unknown field');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unknown field/);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('offers the worked example on the landing screen', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /CDC N1 assay/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Added beyond the brief's four. Everything below covers a forward-pointer
// carried into this task, or a state the four above walk straight past.
// ---------------------------------------------------------------------------

// Forward-pointer C (Task 4.4 -> 4.7). `ScopeControls` takes `transport` as an
// effect dependency, so a transport built in App's render body is a new object
// on every render: the effect tears down and re-issues both option-list
// queries every time anything re-renders App, forever, against a live API.
// Nothing on screen changes while it happens, which is why it needs a test
// that counts calls rather than looks at the DOM.
describe('App transport identity', () => {
  it('does not re-query the option lists as App re-renders', async () => {
    // Never settles, so `withCache` can never fill from the network and mask a
    // rebuilt transport behind a cache hit: every fetch counted here is a
    // genuinely new request.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => { /* never resolves */ }));
    // `vi.spyOn` on an already-spied `fetch` hands back the existing spy with
    // its history intact, and the tests above made real calls through it.
    fetchSpy.mockClear();

    useAppStore.getState().goTo('scope');
    const { rerender } = render(<App />);
    // One aggregated call per option list: countries and lineages.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 5; i += 1) rerender(<App />);
    const to = screen.getByLabelText(/collected to/i);
    await userEvent.clear(to);
    await userEvent.type(to, '2025-06-30');

    expect(useAppStore.getState().scope.dateTo).toBe('2025-06-30');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// The plan says the worked example "loads a bundled assay, resolves its sites
// and runs an analysis in one click", and its own test only asserts the button
// exists. These two walk it.
describe('App worked example', () => {
  it('resolves the bundled assay and runs an analysis in one click', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const body = String(input).endsWith('/aggregated')
        ? { data: [{ count: 4000, date: '2025-01-01' }] }
        : { data: [] };
      return new Response(
        JSON.stringify({ ...body, info: { dataVersion: 'dv', requestId: 'rid' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));

    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('ready');
    });
    const state = useAppStore.getState();
    expect(state.step).toBe('results');
    // All three CDC N1 oligos resolved without the user ever seeing step 2, at
    // the coordinates docs/assay-sources.md records for the bundled assay.
    expect(state.chosenSites['oligo-0']).toMatchObject({
      segment: 'main', strand: 'plus', start: 28287, end: 28306, mismatches: 0,
    });
    expect(state.chosenSites['oligo-1']).toMatchObject({
      segment: 'main', strand: 'minus', start: 28335, end: 28358, mismatches: 0,
    });
    expect(state.chosenSites['oligo-2']).toMatchObject({
      segment: 'main', strand: 'plus', start: 28309, end: 28332, mismatches: 0,
    });
    // The label promises "since 2020", so the scope it loads has to start there.
    expect(state.scope.dateFrom).toBe('2020-01-01');
    // A three-oligo assay renders a headline per oligo, so the single-match
    // query this used to be throws "Found multiple elements". Asserting the
    // denominator on every one of them is the stronger reading of the same
    // intent, not a relaxed one: it would catch a headline that went missing
    // as well as one that printed the wrong n.
    const headlines = screen.getAllByLabelText('Headline mismatch rate');
    expect(headlines).toHaveLength(3);
    for (const headline of headlines) {
      expect(headline).toHaveTextContent('n = 4,000 of 4,000 assessable sequences');
    }
  });

  it('loads the assay its label names, with all three roles already assigned', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => { /* never resolves; this test reads the store, not the results */ }),
    );
    render(<App />);
    const button = screen.getByRole('button', { name: /CDC N1 assay/i });
    expect(button).toHaveAccessibleName('See how the CDC N1 assay has drifted since 2020');
    // The note that used to sit here said the button loaded something else.
    // Now it loads what it says, so nothing on screen may claim otherwise.
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();

    await userEvent.click(button);

    // A library assay is a primer pair plus a probe, and the roles come with
    // it -- that is what makes this one click rather than a trip through
    // step 1's role guessing.
    expect(useAppStore.getState().oligos).toEqual([
      { id: 'oligo-0', name: '2019-nCoV_N1-F', role: 'forward', sequence: 'GACCCCAAAATCAGCGAAAT' },
      {
        id: 'oligo-1',
        name: '2019-nCoV_N1-R',
        role: 'reverse',
        sequence: 'TCTGGTTACTGCCAGTTGAATCTG',
      },
      {
        id: 'oligo-2',
        name: '2019-nCoV_N1-P',
        role: 'probe',
        sequence: 'ACCCCGCATTACGTTTGGTGGACC',
      },
    ]);
    expect(useAppStore.getState().roles).toEqual({
      'oligo-0': 'forward',
      'oligo-1': 'reverse',
      'oligo-2': 'probe',
    });
  });
});

// A scope that matched nothing is not an error and not a result. Rendering the
// results panel over a zero denominator would print "No assessable sequences"
// beside a severity badge and a trend, which reads as an answer.
describe('App empty scope', () => {
  it('reports a scope that matched no sequences instead of an empty results panel', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [], info: { dataVersion: 'dv', requestId: 'rid' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));

    expect(await screen.findByText(/no sars-cov-2 sequences match these filters/i))
      .toBeInTheDocument();
    expect(useAppStore.getState().result?.nScope).toBe(0);
    expect(screen.queryByLabelText('Headline mismatch rate')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Filters that matched nothing')).getByText(
      /collected 2020-01-01 to .* inclusive/i,
    )).toBeInTheDocument();
  });
});

// Global Constraint 10: every network call is abortable. Nothing else in the
// suite exercises the analysis run's own signal -- `ScopeControls` owns the
// option-list one, and this is the only place the analysis is started.
describe('App analysis abort', () => {
  /**
   * Hangs until its signal aborts, then rejects the way a real `fetch` does.
   * Rejecting matters: `withCache` de-duplicates in-flight requests by key and
   * only drops them once they settle, so a stub that merely never resolves
   * would leave every key permanently in flight and a retry would silently
   * reuse the abandoned promises.
   */
  const pendingFetch = (signals: AbortSignal[]) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const signal = init?.signal;
      if (signal) signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

  it('aborts the analysis in flight when App unmounts', async () => {
    const signals: AbortSignal[] = [];
    pendingFetch(signals);
    const { unmount } = render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((s) => s.aborted)).toBe(false);

    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('supersedes a previous run rather than racing it', async () => {
    const signals: AbortSignal[] = [];
    pendingFetch(signals);
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));
    const firstRun = [...signals];
    expect(firstRun.length).toBeGreaterThan(0);
    expect(firstRun.some((s) => s.aborted)).toBe(false);

    // While a run is in flight the loading state replaces the step, so the UI
    // cannot start a second one; the reachable way back to a run is a failure
    // and a retry, with the scope narrowed in between. Drive that.
    await act(async () => {
      useAppStore.getState().setScope({ dateFrom: '2021-01-01' });
      useAppStore.getState().analysisFailed('LAPIS 503: upstream unavailable');
    });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(firstRun.every((s) => s.aborted)).toBe(true);
    expect(signals.length).toBeGreaterThan(firstRun.length);
    expect(signals.slice(firstRun.length).some((s) => s.aborted)).toBe(false);

    // The superseded run rejects with an AbortError once the aborts propagate.
    // It must not write that over the run that replaced it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(useAppStore.getState().status).toBe('loading');
    expect(useAppStore.getState().error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 5.3 — permalinks.
// ---------------------------------------------------------------------------

/** Every endpoint answers; `aggregated` carries the count. */
const stubLapis = (count: number) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const body = String(input).endsWith('/aggregated')
      ? { data: [{ count, date: '2021-02-01' }] }
      : { data: [] };
    return new Response(JSON.stringify({ ...body, info: { dataVersion: 'dv', requestId: 'rid' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

/**
 * The bundled CDC N1 assay as a permalink, built from the library and its own
 * verification pass rather than transcribed -- no oligo sequence and no
 * coordinate is written out here (Global Constraint 2).
 */
const CDC_N1 = parseLibrary(libraryRaw).assays.find((a) => a.id === 'cdc-2019-ncov-n1')!;
const CDC_N1_LINK: PermalinkState = {
  pathogenId: CDC_N1.pathogenId,
  oligos: CDC_N1.oligos.map((o) => ({ name: o.name, role: o.role, sequence: o.sequence })),
  sites: Object.fromEntries(
    verifyAssay(CDC_N1).resolved.map((r) => [
      r.name,
      { segment: r.segment, strand: r.strand, start: r.start },
    ]),
  ),
  scope: { dateFrom: '2021-02-01', dateTo: '2021-03-01', countries: [], lineages: [] },
};

/**
 * Counts analyses exactly, by standing in for the store action every run has to
 * go through.
 *
 * Counting fetches cannot do this job here: `withCache` de-duplicates by
 * request key, so a second, identical analysis issues no new request at all and
 * an effect that fired twice would look identical to one that fired once.
 */
const REAL_START_ANALYSIS = useAppStore.getState().startAnalysis;
const countAnalyses = () => {
  const spy = vi.fn(() => { REAL_START_ANALYSIS(); });
  useAppStore.setState({ startAnalysis: spy });
  return spy;
};

describe('App permalink on load', () => {
  afterEach(() => { useAppStore.setState({ startAnalysis: REAL_START_ANALYSIS }); });

  it('restores a decodable hash and runs exactly one analysis', async () => {
    stubLapis(1000);
    const analyses = countAnalyses();
    window.location.hash = encodePermalink(CDC_N1_LINK);

    render(<App />);
    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('ready');
    });

    expect(analyses).toHaveBeenCalledTimes(1);
    const state = useAppStore.getState();
    expect(state.step).toBe('results');
    expect(state.oligos.map((o) => o.name)).toEqual(CDC_N1.oligos.map((o) => o.name));
    expect(state.roles).toEqual({ 'oligo-0': 'forward', 'oligo-1': 'reverse', 'oligo-2': 'probe' });
    expect(state.scope).toMatchObject(CDC_N1_LINK.scope);
    // The chosen site travelled in the link and was rebuilt against the bundled
    // reference, so the derived fields the link does not carry are present too.
    expect(state.chosenSites['oligo-0']).toMatchObject({
      segment: 'main', strand: 'plus', start: 28287, end: 28306, mismatches: 0,
    });
  });

  it('aborts the restored run when App unmounts, like any other run', async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    window.location.hash = encodePermalink(CDC_N1_LINK);

    const { unmount } = render(<App />);
    expect(signals.length).toBeGreaterThan(0);
    // A second start() would have aborted the first one's controller, so this
    // also fails if the load path runs the analysis twice.
    expect(signals.some((s) => s.aborted)).toBe(false);

    unmount();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('falls back to the empty first screen, and says so, when the link cannot be read', () => {
    const fetchSpy = stubLapis(1000);
    fetchSpy.mockClear();
    window.location.hash = '#q=' + encodeURIComponent('{"pathogenId":"ebola"}');

    render(<App />);

    expect(screen.getByRole('button', { name: /CDC N1 assay/i })).toBeInTheDocument();
    expect(screen.getByText(/link .*could not be read/i)).toBeInTheDocument();
    expect(useAppStore.getState().status).toBe('idle');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says nothing about a link when there is no link', () => {
    stubLapis(1000);
    render(<App />);
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
  });

  /**
   * A link carries only segment, strand and start, and the app re-derives the
   * rest of the site from the reference. This is what makes that re-derivation
   * load-bearing rather than decorative: `decodePermalink` validates shape and
   * knows nothing about reference genomes, so a coordinate that is perfectly
   * well-formed and simply untrue has to be caught here or not at all. Without
   * it a stranger's link would be analysed at a plausible-looking position,
   * and every number on the page would be about a window the oligo does not
   * bind.
   */
  it('refuses a link naming a site its oligo does not actually bind', () => {
    const fetchSpy = stubLapis(1000);
    fetchSpy.mockClear();
    const name = CDC_N1.oligos[0]!.name;
    const real = CDC_N1_LINK.sites[name]!;
    window.location.hash = encodePermalink({
      ...CDC_N1_LINK,
      // One base off. The shape is flawless; the coordinate is a lie.
      sites: { ...CDC_N1_LINK.sites, [name]: { ...real, start: real.start + 1 } },
    });

    render(<App />);

    expect(screen.getByText(/link .*could not be read/i)).toBeInTheDocument();
    expect(useAppStore.getState().status).toBe('idle');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('App permalink on success', () => {
  afterEach(() => { useAppStore.setState({ startAnalysis: REAL_START_ANALYSIS }); });

  it('publishes the query as a hash once the analysis succeeds', async () => {
    stubLapis(4000);
    const analyses = countAnalyses();
    expect(window.location.hash).toBe('');

    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));
    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('ready');
    });

    const decoded = decodePermalink(window.location.hash);
    expect(decoded).not.toBeNull();
    expect(decoded?.pathogenId).toBe('sars-cov-2');
    expect(decoded?.oligos.map((o) => o.name)).toEqual(CDC_N1.oligos.map((o) => o.name));
    expect(decoded?.scope.dateFrom).toBe('2020-01-01');
    expect(decoded?.sites[CDC_N1.oligos[0]!.name]).toEqual({
      segment: 'main', strand: 'plus', start: 28287,
    });
    // Writing the hash must not feed the reader that runs on load: one click,
    // one analysis, however many renders the write causes.
    expect(analyses).toHaveBeenCalledTimes(1);
  });

  it('leaves the back button alone by replacing rather than pushing', async () => {
    stubLapis(4000);
    const pushState = vi.spyOn(window.history, 'pushState');
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));
    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('ready');
    });

    expect(window.location.hash).not.toBe('');
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it('publishes no link for a run that failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { status: 400, title: 'Bad', detail: 'Unknown field' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));
    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('error');
    });

    // A link that claims to reproduce a result there is no result for.
    expect(window.location.hash).toBe('');
  });

  it('offers a copy-link button beside the result, and copies the whole URL', async () => {
    stubLapis(4000);
    const written: string[] = [];
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { written.push(text); } },
    });
    render(<App />);

    await userEvent.click(screen.getByRole('button', { name: /CDC N1 assay/i }));
    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('ready');
    });

    const button = screen.getByRole('button', { name: /copy link/i });
    // `fireEvent`, not `userEvent`: user-event installs its own clipboard stub
    // on setup, which would replace the one this test is watching.
    await act(async () => { fireEvent.click(button); });

    expect(written).toEqual([window.location.href]);
    expect(written[0]).toContain('#q=');
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });

  it('shows no copy-link button before there is a result to link to', () => {
    stubLapis(4000);
    render(<App />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });
});
