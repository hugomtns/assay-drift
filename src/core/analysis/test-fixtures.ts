import type { AggregatedRow, InsertionRow, MutationRow } from '../lapis/endpoints';
import type { FixtureRecord } from '../lapis/fixture-transport';
import type { Scope } from '../scope';
import { findBindingSites } from '../binding';
import { buildWindowSpec } from '../query';
import { loadReference } from '../../data/references';
import { buildAttribution } from './attribution';
import { MIN_DENOMINATOR } from './constants';
import { computeDiagnostics } from './diagnostics';
import { insertionsInWindow } from './insertions';
import { computeWindowMetrics } from './metrics';
import { buildPositionProfile } from './profile';
import type { AnalysisResult, OligoAnalysis } from './run';
import { scoreSeverity } from './severity';
import { buildTrend } from './trend';
// `?raw` rather than a plain JSON import: this fixture is 400 KB, and importing
// it as a module would make `tsc` infer a literal type for every one of its
// recorded rows. Node's `fs` is not an option either -- `src/` is typechecked
// with `types: ["vite/client"]` and has no Node globals.
import fixtureRaw from '../../../tests/fixtures/g1-alpha-2021-02.json?raw';

/**
 * One shared, realistic `AnalysisResult` for tests that need a result but are
 * not testing the analysis.
 *
 * Nothing in here is a transcribed *output*. The only hand-written numbers are
 * the three raw LAPIS counts below; every derived field -- the metrics, the
 * binding site, the per-position profile, the trend, the attribution, the
 * severity and the diagnostics -- is produced by calling the same production
 * function the app calls, at module load. A fixture assembled that way cannot
 * drift from the code it is used to test: if `computeWindowMetrics` changes,
 * this changes with it.
 *
 * No genomic sequence is written here (Global Constraint 2). The oligo is
 * *cut out of the bundled reference* at the G1 window -- 21765..21786, 1-based
 * inclusive, the Alpha S-gene window used throughout the plan and asserted
 * base-for-base in `tests/golden/golden.test.ts` -- so it is a real sequence
 * that cannot have been mistyped.
 *
 * This module is imported only by tests. It is never reachable from
 * `src/main.tsx`, so it is not in the production module graph and contributes
 * nothing to the bundle.
 */
const reference = loadReference('sars-cov-2');

/** 1-based inclusive; `slice` is 0-based half-open, hence the -1 on the start. */
const G1_START = 21765;
const G1_END = 21786;
export const ALPHA_OLIGO: string = (reference.segments[0] as { sequence: string }).sequence.slice(
  G1_START - 1,
  G1_END,
);

const site = findBindingSites(ALPHA_OLIGO, reference)[0];
if (!site) throw new Error('The G1 window does not resolve against the bundled reference');
const windowSpec = buildWindowSpec(site, ALPHA_OLIGO, reference, 'forward', { segmented: false });

/** The real recorded LAPIS responses for this exact query (Task 3.6 fixtures). */
const fixture = JSON.parse(fixtureRaw) as FixtureRecord[];
const recorded = (endpoint: string): unknown[] => {
  const hit = fixture.find((r) => r.request.endpoint === endpoint);
  if (!hit) throw new Error(`No recorded ${endpoint} response in the G1 fixture`);
  return hit.response.data;
};
const mutationRows = recorded('nucleotideMutations') as MutationRow[];
const insertionRows = recorded('nucleotideInsertions') as InsertionRow[];

const DATE_FROM = '2021-02-01';
const DATE_TO = '2021-03-01';

export const sampleScope: Scope = {
  pathogenId: 'sars-cov-2',
  dateFrom: DATE_FROM,
  dateTo: DATE_TO,
  countries: ['United Kingdom'],
  lineages: [],
};

/**
 * The three verified G1 Alpha figures (implementation.md Part I), re-measured
 * against the live instance at both the Phase 4 and the Phase 5 gate and
 * matching to the digit. These are the only hand-written numbers in this file.
 */
const RAW_COUNTS = { nScope: 71142, nFullCoverage: 70387, nMismatch: 67520 };

const metrics = computeWindowMetrics(RAW_COUNTS);
const profile = buildPositionProfile(windowSpec, mutationRows, metrics.nFullCoverage);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 4;
/** One bucket below MIN_DENOMINATOR, so the series carries a real null rate. */
const THIN_COVERAGE = MIN_DENOMINATOR - 1;

/** Monday of week `i` of the scope, computed rather than typed. */
const weekStart = (i: number): string =>
  new Date(Date.parse(`${DATE_FROM}T00:00:00Z`) + i * 7 * DAY_MS).toISOString().slice(0, 10);

/**
 * A total split across the scope's weeks, with a deliberately thin final week.
 * The parts sum to the total by construction, so the trend can never contradict
 * the headline it sits under.
 */
function weekly(total: number, tail: number): AggregatedRow[] {
  const head = total - tail;
  const even = Math.floor(head / (WEEKS - 1));
  return Array.from({ length: WEEKS }, (_, i) => ({
    count: i === WEEKS - 1 ? tail : i === 0 ? head - even * (WEEKS - 2) : even,
    date: weekStart(i),
  }));
}

const thinMismatch = Math.round(THIN_COVERAGE * (metrics.mismatchFraction ?? 0));
const trend = buildTrend({
  coverageRows: weekly(metrics.nFullCoverage, THIN_COVERAGE),
  mismatchRows: weekly(metrics.nMismatch, thinMismatch),
  dateField: 'date',
  dateFrom: DATE_FROM,
  dateTo: DATE_TO,
});

const tenth = Math.round(metrics.nMismatch / 10);
const lineage = buildAttribution(
  [
    { count: metrics.nMismatch - 2 * tenth, pangoLineage: 'B.1.1.7' },
    { count: tenth, pangoLineage: 'B.1.177' },
    { count: tenth, pangoLineage: null },
  ],
  'pangoLineage',
);
const country = buildAttribution(
  sampleScope.countries.map((value) => ({ count: metrics.nMismatch, country: value })),
  'country',
);

const SAMPLE_OLIGO_NAME = 'Alpha S-gene window';

export const sampleAnalysis: OligoAnalysis = {
  oligoId: 'oligo-0',
  name: SAMPLE_OLIGO_NAME,
  role: 'forward',
  sequence: ALPHA_OLIGO,
  site,
  window: windowSpec,
  metrics,
  profile,
  insertions: insertionsInWindow(windowSpec, insertionRows, metrics.nFullCoverage),
  trend,
  lineage,
  country,
  severity: scoreSeverity({ role: 'forward', metrics, profile }),
  diagnostics: computeDiagnostics({ oligoName: SAMPLE_OLIGO_NAME, metrics, trend, country }),
};

/**
 * The same site with nothing assessable. Every rate on it is `null`, which is
 * the branch that must never render as `0%` and never as a bare em dash.
 */
const UNASSESSABLE_OLIGO_NAME = 'Unassessable window';
const emptyMetrics = computeWindowMetrics({
  nScope: RAW_COUNTS.nScope,
  nFullCoverage: 0,
  nMismatch: 0,
});
const emptyProfile = buildPositionProfile(windowSpec, [], 0);
const emptyTrend = buildTrend({
  coverageRows: [],
  mismatchRows: [],
  dateField: 'date',
  dateFrom: DATE_FROM,
  dateTo: DATE_TO,
});
const emptyAttribution = buildAttribution([], 'country');

export const unassessableAnalysis: OligoAnalysis = {
  oligoId: 'oligo-1',
  name: UNASSESSABLE_OLIGO_NAME,
  role: 'probe',
  sequence: ALPHA_OLIGO,
  site,
  window: windowSpec,
  metrics: emptyMetrics,
  profile: emptyProfile,
  insertions: [],
  trend: emptyTrend,
  lineage: buildAttribution([], 'pangoLineage'),
  country: emptyAttribution,
  severity: scoreSeverity({ role: 'probe', metrics: emptyMetrics, profile: emptyProfile }),
  diagnostics: computeDiagnostics({
    oligoName: UNASSESSABLE_OLIGO_NAME,
    metrics: emptyMetrics,
    trend: emptyTrend,
    country: emptyAttribution,
  }),
};

export const sampleResult: AnalysisResult = {
  scope: sampleScope,
  pathogenId: 'sars-cov-2',
  generatedAt: '2026-08-01T12:00:00.000Z',
  dataVersion: '1785342597',
  nScope: metrics.nScope,
  oligos: [sampleAnalysis],
  queryCount: 7,
};
