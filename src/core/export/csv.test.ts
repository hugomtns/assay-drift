import { describe, it, expect } from 'vitest';
import { toJsonExport, toPositionCsv, toSummaryCsv } from './csv';
import { methodsParagraph } from './methods';
import { REGULATORY_STATEMENT, UNIT_OF_ANALYSIS } from '../analysis/constants';
import { buildAttribution } from '../analysis/attribution';
import { computeDiagnostics } from '../analysis/diagnostics';
import { insertionsInWindow } from '../analysis/insertions';
import { computeWindowMetrics } from '../analysis/metrics';
import { buildPositionProfile } from '../analysis/profile';
import { scoreSeverity } from '../analysis/severity';
import { buildTrend } from '../analysis/trend';
import type { AnalysisResult, OligoAnalysis } from '../analysis/run';
import { findBindingSites } from '../binding';
import type { FixtureRecord } from '../lapis/fixture-transport';
import type { InsertionRow, MutationRow } from '../lapis/endpoints';
import type { OligoRole } from '../oligo-input';
import { buildWindowSpec } from '../query';
import { loadReference } from '../../data/references';
// `?raw` rather than a plain JSON import: this fixture is 400 KB, and importing
// it as a module would make `tsc` infer a literal type for every one of its
// 1,521 recorded rows. Node's `fs` is not an option either -- `src/` is
// typechecked with `types: ["vite/client"]` and has no Node globals.
import fixtureRaw from '../../../tests/fixtures/g1-alpha-2021-02.json?raw';

/**
 * The fixture is assembled by the real analysis functions over the real
 * bundled reference and the real recorded G1 responses, not by hand.
 *
 * No genomic sequence is written here (Global Constraint 2). The oligo is
 * *cut out of the bundled reference* at the G1 window — 21765..21786, 1-based
 * inclusive, the Alpha S-gene target-failure window used throughout the plan
 * and asserted base-for-base in tests/golden/golden.test.ts — so it is a real
 * sequence that cannot have been mistyped.
 */
const reference = loadReference('sars-cov-2');
const ALPHA_OLIGO = reference.segments[0]!.sequence.slice(21764, 21786);

const fixture = JSON.parse(fixtureRaw) as FixtureRecord[];
const recorded = (endpoint: string): unknown[] => {
  const hit = fixture.find((r) => r.request.endpoint === endpoint);
  if (!hit) throw new Error(`No recorded ${endpoint} response in the G1 fixture`);
  return hit.response.data;
};
const mutationRows = recorded('nucleotideMutations') as MutationRow[];
const insertionRows = recorded('nucleotideInsertions') as InsertionRow[];

const site = findBindingSites(ALPHA_OLIGO, reference)[0]!;
const windowSpec = buildWindowSpec(site, ALPHA_OLIGO, reference, 'forward', { segmented: false });

const DATE_FROM = '2021-02-01';
const DATE_TO = '2021-03-01';

function analysis(input: {
  id: string;
  name: string;
  role: OligoRole;
  counts: { nScope: number; nFullCoverage: number; nMismatch: number };
  rows: MutationRow[];
  countryRows: { count: number; country: string }[];
}): OligoAnalysis {
  const metrics = computeWindowMetrics(input.counts);
  const profile = buildPositionProfile(windowSpec, input.rows, metrics.nFullCoverage);
  const trend = buildTrend({
    coverageRows: [], mismatchRows: [], dateField: 'date',
    dateFrom: DATE_FROM, dateTo: DATE_TO,
  });
  const country = buildAttribution(input.countryRows, 'country');
  const lineage = buildAttribution(
    [{ count: metrics.nMismatch, pangoLineage: 'B.1.1.7' }], 'pangoLineage',
  );
  return {
    oligoId: input.id,
    name: input.name,
    role: input.role,
    sequence: ALPHA_OLIGO,
    site,
    window: windowSpec,
    metrics,
    profile,
    insertions: insertionsInWindow(windowSpec, insertionRows, metrics.nFullCoverage),
    trend,
    lineage,
    country,
    severity: scoreSeverity({ role: input.role, metrics, profile }),
    diagnostics: computeDiagnostics({ oligoName: input.name, metrics, trend, country }),
  };
}

/** The real G1 February-2021 numbers (implementation.md, Part I / golden tests). */
const REAL_COUNTS = { nScope: 71142, nFullCoverage: 70387, nMismatch: 67520 };

const plain = analysis({
  id: 'o1', name: 'Alpha S-gene window', role: 'forward',
  counts: REAL_COUNTS, rows: mutationRows,
  countryRows: [{ count: 67520, country: 'United Kingdom' }],
});

/**
 * Two things this oligo carries at once, both hostile and both realistic: a
 * name the user typed that a spreadsheet would execute, and a window where
 * nothing at all is assessable so the rate is `null` rather than a number.
 */
const hostile = analysis({
  id: 'o2', name: '=1+1', role: 'reverse',
  counts: { nScope: 71142, nFullCoverage: 0, nMismatch: 0 }, rows: [],
  countryRows: [{ count: 5, country: '=HYPERLINK("http://evil.example","click")' }],
});

/** A name from a pasted FASTA header: a comma, a quote and a line break. */
const awkward = analysis({
  id: 'o3', name: 'N1, "long" primer\nsecond line', role: 'probe',
  counts: REAL_COUNTS, rows: mutationRows,
  countryRows: [{ count: 67520, country: 'United Kingdom' }],
});

const result: AnalysisResult = {
  scope: {
    pathogenId: 'sars-cov-2', dateFrom: DATE_FROM, dateTo: DATE_TO,
    countries: ['United Kingdom'], lineages: [],
  },
  pathogenId: 'sars-cov-2',
  generatedAt: '2026-08-01T12:00:00.000Z',
  dataVersion: '1785342597',
  nScope: 71142,
  oligos: [plain, hostile, awkward],
  queryCount: 15,
  diagnostics: [],
};

const REQUIRED_SUMMARY_COLUMNS =
  'oligo,role,segment,start,end,strand,n_scope,n_full_coverage,n_mismatch,mismatch_fraction,coverage_gap,severity';

/** Everything before the first non-comment line. */
const commentBlock = (csv: string): string[] =>
  csv.split('\r\n').filter((line) => line.startsWith('#'));
const bodyLines = (csv: string): string[] =>
  csv.split('\r\n').filter((line) => line !== '' && !line.startsWith('#'));

const BOTH_CSVS = [
  ['summary', toSummaryCsv],
  ['position', toPositionCsv],
] as const;

describe.each(BOTH_CSVS)('%s CSV — the comment header', (_label, toCsv) => {
  const csv = toCsv(result);

  it('opens with a # comment carrying the unit of analysis', () => {
    expect(csv.split('\r\n')[0]).toBe(`# ${UNIT_OF_ANALYSIS}`);
  });

  it('puts every comment line before the column header, none after', () => {
    const lines = csv.split('\r\n').filter((line) => line !== '');
    const firstBody = lines.findIndex((line) => !line.startsWith('#'));
    expect(firstBody).toBeGreaterThan(0);
    expect(lines.slice(firstBody).some((line) => line.startsWith('#'))).toBe(false);
  });

  it('explains that an empty cell is not a zero', () => {
    expect(commentBlock(csv).join(' ')).toMatch(/never means zero/i);
  });

  it('explains the apostrophe this export adds to formula-looking values', () => {
    expect(commentBlock(csv).join(' ')).toMatch(/apostrophe/i);
  });

  it('names the instance, the data version and the reference retrieval date', () => {
    const header = commentBlock(csv).join(' ');
    expect(header).toContain('https://lapis.cov-spectrum.org/open/v2');
    expect(header).toContain('1785342597');
    expect(header).toContain('2026-08-02');
  });

  it('states the scope filters', () => {
    const header = commentBlock(csv).join(' ');
    expect(header).toContain('2021-02-01');
    expect(header).toContain('2021-03-01');
    expect(header).toContain('United Kingdom');
  });

  it('carries the regulatory statement (Global Constraint 8)', () => {
    expect(csv).toContain(REGULATORY_STATEMENT);
  });
});

describe('toSummaryCsv', () => {
  const csv = toSummaryCsv(result);
  const body = bodyLines(csv);

  it('starts its column header with the required columns, in order', () => {
    expect(body[0]!.startsWith(REQUIRED_SUMMARY_COLUMNS)).toBe(true);
  });

  it('keeps every rate beside its own N (Global Constraint 6)', () => {
    const columns = body[0]!.split(',');
    expect(columns).toContain('n_full_coverage');
    expect(columns).toContain('n_mismatch');
    expect(columns.indexOf('mismatch_fraction')).toBeGreaterThan(-1);
  });

  it('emits one row per oligo', () => {
    expect(body).toHaveLength(1 + result.oligos.length);
  });

  it('reports the real G1 window exactly', () => {
    // 67,520 / 70,387 = 0.959268…, the G1 February-2021 headline the golden
    // tests assert as ≈0.9593. The exported oligo sequence is the reference
    // slice itself, so it doubles as a check that the window did not move.
    expect(body[1]!).toBe(
      'Alpha S-gene window,forward,main,21765,21786,plus,71142,70387,67520,0.959268,755,red,' +
        `0.0106126,11.5107,true,B.1.1.7,67520,United Kingdom,67520,${ALPHA_OLIGO}`,
    );
  });

  it('leaves mismatch_fraction empty when nothing is assessable, never 0', () => {
    const cells = body[2]!.split(',');
    expect(cells.slice(0, 12)).toEqual([
      "'=1+1", 'reverse', 'main', '21765', '21786', 'plus', '71142', '0', '0', '', '71142',
      'unknown',
    ]);
  });

  it('quotes a value containing a comma or a double quote, doubling the quotes', () => {
    expect(body[3]!.startsWith('"N1, ""long"" primer\nsecond line",probe,')).toBe(true);
  });

  it('does not let an embedded newline turn one row into two', () => {
    expect(body).toHaveLength(4);
    expect(csv.split('\r\n').filter((l) => l !== '')).toHaveLength(
      commentBlock(csv).length + 4,
    );
  });

  it("defuses a formula-looking oligo name with a leading apostrophe", () => {
    expect(csv).toContain("\r\n'=1+1,reverse,");
  });

  it('defuses a formula-looking value that came back from LAPIS', () => {
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.example"",""click"")"');
  });

  it('leaves app-generated numbers untouched by the formula guard', () => {
    expect(csv).not.toContain("'71142");
    expect(csv).not.toContain("'0.959268");
  });
});

describe('toSummaryCsv — every character a spreadsheet would execute', () => {
  const rowFor = (name: string): string => {
    const one: AnalysisResult = { ...result, oligos: [{ ...plain, name }] };
    return bodyLines(toSummaryCsv(one))[1]!;
  };

  it.each([
    ['equals', '=1+1'],
    ['plus', '+1'],
    ['minus', '-1'],
    ['at', '@SUM(A1)'],
    ['a tab', '\tlead'],
    ['a carriage return', '\rlead'],
  ])('prefixes a value starting with %s', (_label, name) => {
    const row = rowFor(name);
    const first = row.startsWith('"') ? row.slice(1) : row;
    expect(first.startsWith("'")).toBe(true);
  });

  it('leaves an ordinary name alone', () => {
    expect(rowFor('N1-F').startsWith('N1-F,')).toBe(true);
  });
});

describe('toPositionCsv', () => {
  const csv = toPositionCsv(result);
  const body = bodyLines(csv);

  it('names the per-position columns the plan requires', () => {
    const columns = body[0]!.split(',');
    expect(columns).toContain('ref_pos');
    expect(columns).toContain('coverage');
    expect(columns).toContain('coverage_is_inferred');
    expect(columns).toContain('effective_denominator');
    expect(columns).toContain('mismatch_count');
    expect(columns).toContain('mismatch_fraction');
  });

  it('emits one row per oligo x position', () => {
    const positions = result.oligos.reduce((n, o) => n + o.profile.length, 0);
    expect(positions).toBe(3 * 22);
    expect(body).toHaveLength(1 + positions);
  });

  it('reports the recorded six-base deletion at 21765 with its real coverage', () => {
    const columns = body[0]!.split(',');
    const cells = body[1]!.split(',');
    const at = (column: string) => cells[columns.indexOf(column)];
    expect(at('oligo')).toBe('Alpha S-gene window');
    expect(at('ref_pos')).toBe('21765');
    expect(at('coverage')).toBe('70454');
    expect(at('coverage_is_inferred')).toBe('false');
    expect(at('deletion_count')).toBe('67469');
  });

  it('marks an inferred denominator and leaves the coverage cell empty', () => {
    const columns = body[0]!.split(',');
    // First row of the second oligo, which had no mutation rows at all.
    const cells = body[1 + 22]!.split(',');
    const at = (column: string) => cells[columns.indexOf(column)];
    expect(at('oligo')).toBe("'=1+1");
    expect(at('coverage')).toBe('');
    expect(at('coverage_is_inferred')).toBe('true');
    expect(at('effective_denominator')).toBe('0');
    expect(at('mismatch_fraction')).toBe('');
  });
});

describe('toJsonExport', () => {
  const parsed = JSON.parse(toJsonExport(result)) as Record<string, unknown>;

  it('carries the regulatory statement at a stable key (Global Constraint 8)', () => {
    expect(parsed['regulatoryStatement']).toBe(REGULATORY_STATEMENT);
  });

  it('carries the unit of analysis and the methods paragraph', () => {
    expect(parsed['unitOfAnalysis']).toBe(UNIT_OF_ANALYSIS);
    expect(parsed['methods']).toBe(methodsParagraph(result));
  });

  it('records the provenance the CSV comment header records', () => {
    expect(parsed['source']).toMatchObject({
      lapisBaseUrl: 'https://lapis.cov-spectrum.org/open/v2',
      dataVersion: '1785342597',
      referenceFetchedAt: '2026-08-02',
    });
  });

  it('round-trips the analysis itself, nulls intact', () => {
    const round = parsed['result'] as AnalysisResult;
    expect(round.oligos[1]!.metrics.mismatchFraction).toBeNull();
    expect(round.oligos[0]!.metrics.nFullCoverage).toBe(70387);
  });

  it('is indented, because a human is going to open it', () => {
    expect(toJsonExport(result)).toContain('\n  ');
  });
});
