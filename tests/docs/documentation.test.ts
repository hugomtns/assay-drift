import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as C from '../../src/core/analysis/constants';
import { MAX_DEGENERACY_PRODUCT } from '../../src/core/resolution';
import { DEFAULT_MAX_MISMATCHES } from '../../src/core/binding';
import { MAX_EXACT_COVERAGE_POSITIONS } from '../../src/core/lapis/endpoints';
import { loadReference } from '../../src/data/references';
import { getSegment } from '../../src/core/reference';

/**
 * Documentation is code that nothing executes, which is exactly why it rots.
 *
 * Two things in `README.md` and `docs/methods.md` are copies of something that
 * lives elsewhere and can change without anyone thinking about the prose: the
 * tuning constants, and the golden figures. Both are pinned here against their
 * real source -- the constants against the modules that export them, the golden
 * figures against Part I.6 of `implementation.md` itself, parsed out of the plan
 * rather than restated. Changing `RED_SCORE` or a golden count without updating
 * the documents that quote it now fails a test instead of quietly publishing a
 * number that was true last month.
 */

const root = process.cwd();
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

/** Whitespace-insensitive: the documents are hard-wrapped, the facts are not. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

const readme = flat(read('README.md'));
const methods = flat(read('docs/methods.md'));
const goldenCases = flat(read('docs/golden-cases.md'));

const pct = (f: number): string => `${(f * 100).toFixed(0)} %`;
const grouped = (n: number): string => n.toLocaleString('en-GB');

describe('the regulatory statement (Global Constraint 8) appears verbatim in the documents', () => {
  it.each([
    ['README.md', readme],
    ['docs/methods.md', methods],
  ])('%s', (_name, text) => {
    expect(text).toContain(flat(C.REGULATORY_STATEMENT));
  });
});

describe('docs/methods.md quotes the fixed copy blocks verbatim', () => {
  it.each([
    ['UNIT_OF_ANALYSIS', C.UNIT_OF_ANALYSIS],
    ['SEVERITY_DISCLAIMER', C.SEVERITY_DISCLAIMER],
  ])('%s', (_name, value) => {
    expect(methods).toContain(flat(value));
  });
});

describe('docs/methods.md quotes the current value of every constant it names', () => {
  it.each([
    ['MIN_DENOMINATOR', `\`MIN_DENOMINATOR\` = **${C.MIN_DENOMINATOR}**`],
    ['MIN_DENOMINATOR, in the severity section', `\`MIN_DENOMINATOR\` (${C.MIN_DENOMINATOR})`],
    ['DELETION_WEIGHT', `\`DELETION_WEIGHT\` = **${C.DELETION_WEIGHT}**`],
    ['THREE_PRIME_CRITICAL', `\`d ≤ THREE_PRIME_CRITICAL\` (${C.THREE_PRIME_CRITICAL})`],
    ['THREE_PRIME_NEAR', `\`d ≤ THREE_PRIME_NEAR\` (${C.THREE_PRIME_NEAR})`],
    ['AMBER_FRACTION', `\`AMBER_FRACTION\` (${pct(C.AMBER_FRACTION)})`],
    ['RED_FRACTION', `\`RED_FRACTION\` (${pct(C.RED_FRACTION)})`],
    ['AMBER_SCORE', `\`AMBER_SCORE\` (${C.AMBER_SCORE})`],
    ['RED_SCORE', `\`RED_SCORE\` (${C.RED_SCORE})`],
    ['COVERAGE_GAP_WARN', `\`COVERAGE_GAP_WARN\` = ${pct(C.COVERAGE_GAP_WARN)}`],
    ['COVERAGE_GAP_UNUSABLE', `\`COVERAGE_GAP_UNUSABLE\` = **${pct(C.COVERAGE_GAP_UNUSABLE)}**`],
    ['DEPOSITION_LAG_BUCKETS', `the last ${C.DEPOSITION_LAG_BUCKETS} buckets`],
    ['DEPOSITION_LAG_RATIO', `fall below ${pct(C.DEPOSITION_LAG_RATIO)} of the historical median`],
    ['TOP_COUNTRY_SHARE_WARN', `more than ${pct(C.TOP_COUNTRY_SHARE_WARN)} of the mismatch-`],
    ['MAX_DEGENERACY_PRODUCT', `\`MAX_DEGENERACY_PRODUCT\` = **${MAX_DEGENERACY_PRODUCT}**`],
    ['DEFAULT_MAX_MISMATCHES', `\`DEFAULT_MAX_MISMATCHES\` = **${DEFAULT_MAX_MISMATCHES}**`],
    ['MAX_EXACT_COVERAGE_POSITIONS', `capped at ${MAX_EXACT_COVERAGE_POSITIONS} positions`],
  ])('%s', (_name, fragment) => {
    expect(methods).toContain(flat(fragment));
  });
});

/**
 * Part I.6 of the plan, parsed rather than restated.
 *
 * The section is located by its heading, not by a line number, so the plan can
 * grow above it without silently reading the wrong block.
 */
interface GoldenRow {
  nScope: number;
  nFullCoverage: number;
  nMismatch: number;
  headline: string;
  coverageGap: number | null;
}

function partI6(): { rows: GoldenRow[]; referenceBases: string[] } {
  const plan = read('implementation.md');
  const start = plan.indexOf('\n## I.6 ');
  expect(start).toBeGreaterThan(-1);
  const after = plan.indexOf('\n## ', start + 1);
  const section = plan.slice(start, after === -1 ? undefined : after);

  const referenceBases = [...section.matchAll(/^Reference bases: `([ACGT]+)`/gm)].map(
    (m) => m[1] as string,
  );

  const rows: GoldenRow[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.replace(/\*\*/g, '').trim());
    if (cells.length !== 5) continue;
    const count = (c: string | undefined): number => Number((c ?? '').replace(/,/g, ''));
    const isCount = (c: string | undefined): boolean => /^[\d,]+$/.test(c ?? '');

    // G1 and G2: | period | nScope | nFullCoverage | nMismatch | headline |
    if (/^\d{4}-\d{2}-\d{2}/.test(cells[0] as string)) {
      if (!isCount(cells[1]) || !isCount(cells[2]) || !isCount(cells[3])) continue;
      rows.push({
        nScope: count(cells[1]),
        nFullCoverage: count(cells[2]),
        nMismatch: count(cells[3]),
        headline: (cells[4] as string).replace(/\s*%$/, ''),
        coverageGap: null,
      });
      continue;
    }
    // G3: | nScope | nFullCoverage | nMismatch | headline | coverageGap |
    if (isCount(cells[0]) && isCount(cells[1]) && isCount(cells[2])) {
      rows.push({
        nScope: count(cells[0]),
        nFullCoverage: count(cells[1]),
        nMismatch: count(cells[2]),
        headline: (cells[3] as string).replace(/\s*%$/, ''),
        coverageGap: count((cells[4] as string).split(' ')[0]),
      });
    }
  }
  return { rows, referenceBases };
}

describe('the golden figures in the documents come from Part I.6 of the plan', () => {
  const { rows, referenceBases } = partI6();

  it('finds all five measurements and both reference sequences in the plan', () => {
    expect(rows).toHaveLength(5);
    expect(referenceBases).toHaveLength(2);
    // A sanity check on the parse: every headline is nMismatch / nFullCoverage.
    for (const r of rows) {
      const decimals = r.headline.split('.')[1]?.length ?? 0;
      expect((r.nMismatch / r.nFullCoverage) * 100).toBeCloseTo(Number(r.headline), decimals);
    }
  });

  it.each([0, 1, 2, 3, 4])('docs/golden-cases.md states row %i exactly', (i) => {
    const r = rows[i] as GoldenRow;
    expect(goldenCases).toContain(grouped(r.nScope));
    expect(goldenCases).toContain(grouped(r.nFullCoverage));
    expect(goldenCases).toContain(grouped(r.nMismatch));
    expect(goldenCases).toContain(`${r.headline} %`);
  });

  it.each([0, 1, 2, 3, 4])('README.md states row %i exactly', (i) => {
    const r = rows[i] as GoldenRow;
    expect(readme).toContain(`**${r.headline} %** (${grouped(r.nMismatch)} / ${grouped(r.nFullCoverage)})`);
  });

  it("states G3's coverage gap in both documents, beside its green headline", () => {
    const g3 = rows[4] as GoldenRow;
    expect(g3.coverageGap).not.toBeNull();
    expect(goldenCases).toContain(grouped(g3.coverageGap as number));
    expect(readme).toContain(grouped(g3.coverageGap as number));
  });

  it('quotes reference bases that are still what the bundled reference holds', () => {
    // G1 main:21765-21786 and G3 main:15784-15805, sliced rather than typed.
    const seq = getSegment(loadReference('sars-cov-2'), 'main').sequence;
    const slices = [seq.slice(21764, 21786), seq.slice(15783, 15805)];
    expect(slices).toEqual(referenceBases);
    for (const s of slices) expect(goldenCases).toContain(s);
  });
});
