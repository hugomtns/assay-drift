/**
 * Nightly golden-drift check (Task 6.5, plan Step 3).
 *
 * Recomputes the five golden measurements of Part I.6 against the LIVE LAPIS
 * instances and compares them with the figures recorded there on 2026-08-01.
 * `tests/golden/golden.test.ts` asserts the same five exactly, but against
 * committed fixtures; this script is the other half of that pair -- it is the
 * one that is allowed to notice that the world moved.
 *
 * Nothing here reimplements the query construction. The window comes out of
 * `buildWindowSpec`, the two expressions out of `fullCoverageQuery` and
 * `mismatchWithCoverageQuery`, the filters out of `scopeToFilters`, and the
 * derived figures out of `computeWindowMetrics` -- the same functions the
 * product calls. A drift check that built its own queries could only prove
 * that its own queries still worked.
 *
 * No sequence and no figure below was typed. `GOLDEN` was generated from
 * `implementation.md` lines 212-252 (Global Constraint 2), and the oligo for
 * each window is sliced out of the bundled reference genome, then checked
 * against the reference bases Part I.6 prints -- which is also a live check
 * that the coordinate system has not shifted under us.
 *
 * Run: npm run verify:golden      (hits the network; NOT part of the PR gate)
 */
import { AMBER_FRACTION } from '../src/core/analysis/constants.js';
import { computeWindowMetrics } from '../src/core/analysis/metrics.js';
import type { BindingSite } from '../src/core/binding.js';
import { queryAggregated } from '../src/core/lapis/endpoints.js';
import { createFetchTransport } from '../src/core/lapis/fetch-transport.js';
import {
  buildWindowSpec, fullCoverageQuery, mismatchWithCoverageQuery,
} from '../src/core/query.js';
import { getSegment } from '../src/core/reference.js';
import { getPathogen, type PathogenId } from '../src/core/registry.js';
import { scopeToFilters, type Scope } from '../src/core/scope.js';
import { loadReference } from '../src/data/references/index.js';

/** The plan's tolerance: a headline may move this far and still pass. */
const TOLERANCE_PP = 2;

/**
 * G3 gets a second, absolute check, because +/-2 pp is nearly vacuous for it.
 *
 * G3's headline is 0.0067 %. A +/-2 pp band around that accepts anything from
 * 0 % to 2.0067 %, so a three-hundred-fold rise in mismatches at a conserved
 * control -- exactly the event the control exists to catch -- would pass
 * silently. The band is kept because it is the specified tolerance and it is
 * the right one for G1 and G2, but for a case whose headline sits three orders
 * of magnitude below the tolerance it carries no information and must not be
 * allowed to imply otherwise.
 *
 * The absolute bound is 10x the Part I.6 count. That is still only ~0.07 % of
 * the denominator, well under AMBER_FRACTION, so it cannot fire on ordinary
 * database revision; it fires on a step change.
 */
const G3_MISMATCH_FACTOR = 10;

interface GoldenCase {
  caseId: string;
  label: string;
  pathogen: PathogenId;
  segment: string;
  /** 1-based, inclusive, LAPIS coordinates (Global Constraint 3). */
  start: number;
  end: number;
  /** As printed in Part I.6, where it prints them. */
  referenceBases: string | null;
  scope: Scope;
  nScope: number;
  nFullCoverage: number;
  nMismatch: number;
  /** Exactly as printed in Part I.6, in percent, including its precision. */
  headlinePct: string;
  /** Part I.6 prints this for G3 only. Reported, never asserted -- see below. */
  coverageGap: number | null;
}

const GOLDEN: GoldenCase[] = [
  {
    caseId: 'G1',
    label: 'G1 2020-09-01 to 2020-10-01',
    pathogen: 'sars-cov-2',
    segment: 'main',
    start: 21765,
    end: 21786,
    referenceBases: 'TACATGTCTCTGGGACCAATGG',
    scope: {
      pathogenId: 'sars-cov-2',
      dateFrom: '2020-09-01',
      dateTo: '2020-10-01',
      countries: ['United Kingdom'],
      lineages: [],
    },
    nScope: 18892,
    nFullCoverage: 18747,
    nMismatch: 612,
    headlinePct: '3.26',
    coverageGap: null,
  },
  {
    caseId: 'G1',
    label: 'G1 2021-02-01 to 2021-03-01',
    pathogen: 'sars-cov-2',
    segment: 'main',
    start: 21765,
    end: 21786,
    referenceBases: 'TACATGTCTCTGGGACCAATGG',
    scope: {
      pathogenId: 'sars-cov-2',
      dateFrom: '2021-02-01',
      dateTo: '2021-03-01',
      countries: ['United Kingdom'],
      lineages: [],
    },
    nScope: 71142,
    nFullCoverage: 70387,
    nMismatch: 67520,
    headlinePct: '95.93',
    coverageGap: null,
  },
  {
    caseId: 'G2',
    label: 'G2 2022-01-01 to 2022-12-31',
    pathogen: 'h3n2',
    segment: 'seg4',
    start: 600,
    end: 621,
    referenceBases: null,
    scope: {
      pathogenId: 'h3n2',
      dateFrom: '2022-01-01',
      dateTo: '2022-12-31',
      countries: [],
      lineages: [],
    },
    nScope: 41848,
    nFullCoverage: 41794,
    nMismatch: 2706,
    headlinePct: '6.47',
    coverageGap: null,
  },
  {
    caseId: 'G2',
    label: 'G2 2025-01-01 to 2025-12-31',
    pathogen: 'h3n2',
    segment: 'seg4',
    start: 600,
    end: 621,
    referenceBases: null,
    scope: {
      pathogenId: 'h3n2',
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
      countries: [],
      lineages: [],
    },
    nScope: 22480,
    nFullCoverage: 22445,
    nMismatch: 22380,
    headlinePct: '99.71',
    coverageGap: null,
  },
  {
    caseId: 'G3',
    label: 'G3 2024-01-01 to 2025-06-30',
    pathogen: 'sars-cov-2',
    segment: 'main',
    start: 15784,
    end: 15805,
    referenceBases: 'TTTAAGTCAGTTCTTTATTATC',
    scope: {
      pathogenId: 'sars-cov-2',
      dateFrom: '2024-01-01',
      dateTo: '2025-06-30',
      countries: ['United Kingdom'],
      lineages: [],
    },
    nScope: 46667,
    nFullCoverage: 44669,
    nMismatch: 3,
    headlinePct: '0.0067',
    coverageGap: 1998,
  },
];

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

function group(n: number): string {
  return n.toLocaleString('en-GB');
}

function signed(n: number): string {
  return `${n >= 0 ? '+' : ''}${group(n)}`;
}

/** Decimal places Part I.6 printed this headline to. */
function printedDecimals(pct: string): number {
  return pct.split('.')[1]?.length ?? 0;
}

/**
 * Guards the transcription itself.
 *
 * `GOLDEN` was generated from the plan rather than typed, but a generator can
 * still line a column up wrongly. Every headline in Part I.6 is
 * nMismatch / nFullCoverage, so if the four numbers on a row belong together
 * they have to reproduce the printed percentage to its own precision. This
 * costs nothing and runs before any network call.
 */
function checkTranscription(): string[] {
  const problems: string[] = [];
  for (const c of GOLDEN) {
    const computed = (c.nMismatch / c.nFullCoverage) * 100;
    const decimals = printedDecimals(c.headlinePct);
    const slack = 0.5 * 10 ** -decimals;
    if (Math.abs(computed - Number(c.headlinePct)) > slack) {
      problems.push(
        `${c.label}: ${c.nMismatch}/${c.nFullCoverage} = ${computed.toFixed(decimals)} %, ` +
          `but Part I.6 prints ${c.headlinePct} %`,
      );
    }
  }
  return problems;
}

interface Measured {
  nScope: number;
  nFullCoverage: number;
  nMismatch: number;
  headlinePct: number | null;
  coverageGap: number;
  dataVersion: string;
  oligo: string;
}

async function measure(c: GoldenCase): Promise<Measured> {
  const cfg = getPathogen(c.pathogen);
  const ref = loadReference(c.pathogen);
  const transport = createFetchTransport();

  // The oligo is the reference itself over the window, so every position takes
  // Part I.4's case A and the two expressions reduce to the exact forms Part
  // I.6 was measured with. Sliced from the bundled reference, never typed.
  const oligo = getSegment(ref, c.segment).sequence.slice(c.start - 1, c.end);
  if (c.referenceBases !== null && oligo !== c.referenceBases) {
    throw new Error(
      `${c.label}: the bundled reference at ${c.segment}:${c.start}-${c.end} reads ${oligo}, ` +
        `but Part I.6 records ${c.referenceBases}. The coordinate system has moved; ` +
        'no measurement below would mean anything.',
    );
  }

  const site: BindingSite = {
    segment: c.segment, strand: 'plus', start: c.start, end: c.end,
    mismatches: 0, mismatchOligoIndexes: [],
  };
  const w = buildWindowSpec(site, oligo, ref, 'forward', { segmented: cfg.segmented });
  const filters = scopeToFilters(c.scope, cfg);

  const [scopeRes, coverageRes, mismatchRes] = await Promise.all([
    queryAggregated(transport, cfg, filters),
    queryAggregated(transport, cfg, filters, { advancedQuery: fullCoverageQuery(w) }),
    queryAggregated(transport, cfg, filters, { advancedQuery: mismatchWithCoverageQuery(w) }),
  ]);

  const metrics = computeWindowMetrics({
    nScope: scopeRes.data[0]?.count ?? 0,
    nFullCoverage: coverageRes.data[0]?.count ?? 0,
    nMismatch: mismatchRes.data[0]?.count ?? 0,
  });

  return {
    nScope: metrics.nScope,
    nFullCoverage: metrics.nFullCoverage,
    nMismatch: metrics.nMismatch,
    headlinePct: metrics.mismatchFraction === null ? null : metrics.mismatchFraction * 100,
    coverageGap: metrics.coverageGap,
    dataVersion: scopeRes.dataVersion,
    oligo,
  };
}

function countLine(name: string, measured: number, target: number): string {
  const delta = measured - target;
  const change = target === 0 ? 0 : (delta / target) * 100;
  const relative = target === 0 ? '' : ` (${change >= 0 ? '+' : '-'}${Math.abs(change).toFixed(2)} %)`;
  return `    ${pad(name, 15)} ${padLeft(group(measured), 10)}   Part I.6 ${padLeft(group(target), 10)}` +
    `   delta ${padLeft(signed(delta), 9)}${relative}`;
}

async function main(): Promise<void> {
  const transcription = checkTranscription();
  if (transcription.length > 0) {
    for (const p of transcription) process.stderr.write(`TRANSCRIPTION ERROR  ${p}\n`);
    process.exit(1);
  }

  out('Golden drift check - the five Part I.6 measurements, recomputed live');
  out(`Run at ${new Date().toISOString()}`);
  out('');
  out(`Band check      headline within +/- ${TOLERANCE_PP.toFixed(2)} pp of Part I.6. This is the plan's`);
  out("                tolerance and it is the right one for G1 and G2.");
  out(`Absolute check  G3 only: nMismatch <= ${G3_MISMATCH_FACTOR}x its Part I.6 count, and the headline still`);
  out('                below AMBER_FRACTION. G3 headlines 0.0067 %, so the band alone would');
  out('                accept anything up to 2.0067 % - a three-hundred-fold rise at a');
  out('                conserved control, passing silently. The band is not sufficient there.');
  out('');

  const failures: string[] = [];

  for (const c of GOLDEN) {
    const m = await measure(c);
    const where = c.scope.countries.length > 0 ? c.scope.countries.join(', ') : 'all countries';
    out(`${c.label}  ${c.pathogen} ${c.segment}:${c.start}-${c.end}  ${where}`);
    out(`    window bases    ${m.oligo}  ${c.referenceBases === null ? '(Part I.6 prints none)' : 'matches Part I.6'}`);
    out(`    dataVersion     ${m.dataVersion}`);
    out(countLine('nScope', m.nScope, c.nScope));
    out(countLine('nFullCoverage', m.nFullCoverage, c.nFullCoverage));
    out(countLine('nMismatch', m.nMismatch, c.nMismatch));
    if (c.coverageGap !== null) {
      out(countLine('coverageGap', m.coverageGap, c.coverageGap));
    } else {
      out(`    ${pad('coverageGap', 15)} ${padLeft(group(m.coverageGap), 10)}   Part I.6 prints none`);
    }

    const decimals = printedDecimals(c.headlinePct);
    if (m.headlinePct === null) {
      failures.push(`${c.label}: no assessable sequences, so there is no headline to compare.`);
      out(`    ${pad('headline', 15)} no assessable sequences                        BAND FAIL`);
    } else {
      const drift = m.headlinePct - Number(c.headlinePct);
      const ok = Math.abs(drift) <= TOLERANCE_PP;
      if (!ok) {
        failures.push(
          `${c.label}: headline ${m.headlinePct.toFixed(decimals)} % against Part I.6's ` +
            `${c.headlinePct} % - drifted ${drift.toFixed(2)} pp, outside the ${TOLERANCE_PP} pp band.`,
        );
      }
      out(`    ${pad('headline', 15)} ${padLeft(`${m.headlinePct.toFixed(decimals)} %`, 10)}` +
        `   Part I.6 ${padLeft(`${c.headlinePct} %`, 10)}` +
        `   drift ${padLeft(`${drift >= 0 ? '+' : ''}${drift.toFixed(2)} pp`, 9)}   ${ok ? 'BAND OK' : 'BAND FAIL'}`);
    }

    if (c.caseId === 'G3') {
      const ceiling = c.nMismatch * G3_MISMATCH_FACTOR;
      const countOk = m.nMismatch <= ceiling;
      if (!countOk) {
        failures.push(
          `${c.label}: nMismatch ${m.nMismatch} exceeds ${ceiling} (${G3_MISMATCH_FACTOR}x the ` +
            `Part I.6 count of ${c.nMismatch}). The +/-${TOLERANCE_PP} pp band does not see this.`,
        );
      }
      out(`    ${pad('G3 absolute', 15)} nMismatch ${m.nMismatch} <= ${ceiling}${' '.repeat(6)}${countOk ? 'ABSOLUTE OK' : 'ABSOLUTE FAIL'}`);

      const amberPct = AMBER_FRACTION * 100;
      const greenOk = m.headlinePct !== null && m.headlinePct < amberPct;
      if (!greenOk) {
        failures.push(
          `${c.label}: the headline is no longer below AMBER_FRACTION (${amberPct} %), so the ` +
            'conserved-site control would no longer render green.',
        );
      }
      out(`    ${pad('G3 green', 15)} headline < AMBER_FRACTION ${amberPct} %   ${greenOk ? 'ABSOLUTE OK' : 'ABSOLUTE FAIL'}`);
    }
    out('');
  }

  if (failures.length === 0) {
    out(`All ${GOLDEN.length} golden measurements are within tolerance of Part I.6.`);
    return;
  }

  process.stderr.write('\n');
  for (const f of failures) process.stderr.write(`DRIFT  ${f}\n`);
  process.stderr.write(
    `\n${failures.length} of ${GOLDEN.length} golden measurements drifted. ` +
      'Do NOT edit the targets to match: they are the 2026-08-01 ground truth recorded in ' +
      'implementation.md Part I.6, and a real move in the underlying data is the finding.\n',
  );
  process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
