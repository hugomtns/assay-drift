import { describe, it, expect } from 'vitest';
import { loadFixtureSet, windowQueries } from './helpers';
import { queryAggregated, queryNucleotideMutations } from '../../src/core/lapis/endpoints';
import { getPathogen } from '../../src/core/registry';
import { computeWindowMetrics } from '../../src/core/analysis/metrics';
import { buildPositionProfile } from '../../src/core/analysis/profile';
import { scoreSeverity } from '../../src/core/analysis/severity';
import { buildWindowSpec, mismatchWithCoverageQuery } from '../../src/core/query';
import { findBindingSites } from '../../src/core/binding';
import { loadReference } from '../../src/data/references';

const sc2 = getPathogen('sars-cov-2');
const h3n2 = getPathogen('h3n2');

const sc2Filters = (dateFrom: string, dateTo: string) => ({
  country: ['United Kingdom'], dateFrom, dateTo,
});
const fluFilters = (from: string, to: string) => ({
  sampleCollectionDateRangeLowerFrom: from, sampleCollectionDateRangeUpperTo: to,
});

async function measure(
  fixtureSet: string,
  cfg: typeof sc2,
  filters: Record<string, unknown>,
  q: { coverage: string; mismatch: string },
) {
  const transport = loadFixtureSet(fixtureSet);
  const [scope, coverage, mismatch] = await Promise.all([
    queryAggregated(transport, cfg, filters),
    queryAggregated(transport, cfg, filters, { advancedQuery: q.coverage }),
    queryAggregated(transport, cfg, filters, { advancedQuery: q.mismatch }),
  ]);
  return computeWindowMetrics({
    nScope: scope.data[0]!.count,
    nFullCoverage: coverage.data[0]!.count,
    nMismatch: mismatch.data[0]!.count,
  });
}

describe('G1 — Alpha S-gene target failure', () => {
  const q = windowQueries(21765, 21786, null);

  it('the window sits over the reference bases spanning the six-nucleotide deletion', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(21764, 21786)).toBe('TACATGTCTCTGGGACCAATGG');
  });

  it('the production query builder emits the same expression as the fixture', () => {
    const oligo = 'TACATGTCTCTGGGACCAATGG';
    const ref = loadReference('sars-cov-2');
    const site = findBindingSites(oligo, ref)[0]!;
    const w = buildWindowSpec(site, oligo, ref, 'forward', { segmented: false });
    expect(mismatchWithCoverageQuery(w)).toBe(q.mismatch);
  });

  it('reports ~3.3% before Alpha spread', async () => {
    const m = await measure('g1-alpha-2020-09', sc2, sc2Filters('2020-09-01', '2020-10-01'), q);
    expect(m.nScope).toBe(18892);
    expect(m.nFullCoverage).toBe(18747);
    expect(m.nMismatch).toBe(612);
    expect(m.mismatchFraction!).toBeCloseTo(0.0326, 4);
  });

  it('reports ~95.9% five months later', async () => {
    const m = await measure('g1-alpha-2021-02', sc2, sc2Filters('2021-02-01', '2021-03-01'), q);
    expect(m.nScope).toBe(71142);
    expect(m.nFullCoverage).toBe(70387);
    expect(m.nMismatch).toBe(67520);
    expect(m.mismatchFraction!).toBeCloseTo(0.9593, 4);
  });

  it('rates the February 2021 state red', async () => {
    const m = await measure('g1-alpha-2021-02', sc2, sc2Filters('2021-02-01', '2021-03-01'), q);
    expect(scoreSeverity({ role: 'forward', metrics: m, profile: [] }).level).toBe('red');
  });

  it('resolves the six-nucleotide deletion at single-base resolution in the profile', async () => {
    const transport = loadFixtureSet('g1-alpha-2021-02');
    const oligo = 'TACATGTCTCTGGGACCAATGG';
    const ref = loadReference('sars-cov-2');
    const site = findBindingSites(oligo, ref)[0]!;
    const w = buildWindowSpec(site, oligo, ref, 'forward', { segmented: false });

    const mutations = await queryNucleotideMutations(
      transport, sc2, sc2Filters('2021-02-01', '2021-03-01'), { minProportion: 0.001 },
    );
    const profile = buildPositionProfile(w, mutations.data, 70387);

    // Positions 21765-21770 are the deletion; 21771 onward are not.
    const deleted = profile.filter((p) => p.deletionCount > 1000);
    expect(deleted.map((p) => p.refPos)).toEqual([21765, 21766, 21767, 21768, 21769, 21770]);
    expect(profile[0]!.deletionCount).toBe(67469);
    expect(profile[0]!.coverage).toBe(70454);
    expect(profile[0]!.coverageIsInferred).toBe(false);
    expect(profile[0]!.mismatchFraction).toBeCloseTo(0.9576, 4);
  });
});

describe('G2 — Influenza A/H3N2 HA drift', () => {
  const q = windowQueries(600, 621, 'seg4');

  it('qualifies every term with the segment', () => {
    expect(q.mismatch.startsWith('(seg4:600 | seg4:601')).toBe(true);
    expect(q.coverage.startsWith('!(seg4:600N')).toBe(true);
  });

  it('reports ~6.5% in 2022', async () => {
    const m = await measure('g2-h3n2-2022', h3n2, fluFilters('2022-01-01', '2022-12-31'), q);
    expect(m.nFullCoverage).toBe(41794);
    expect(m.nMismatch).toBe(2706);
    expect(m.mismatchFraction!).toBeCloseTo(0.0647, 4);
  });

  it('reports ~99.7% in 2025', async () => {
    const m = await measure('g2-h3n2-2025', h3n2, fluFilters('2025-01-01', '2025-12-31'), q);
    expect(m.nFullCoverage).toBe(22445);
    expect(m.nMismatch).toBe(22380);
    expect(m.mismatchFraction!).toBeCloseTo(0.9971, 4);
  });
});

describe('G3 — conserved site negative control', () => {
  const q = windowQueries(15784, 15805, null);

  it('the window sits over the expected reference bases', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(15783, 15805)).toBe('TTTAAGTCAGTTCTTTATTATC');
  });

  it('reports essentially zero mismatch', async () => {
    const m = await measure('g3-conserved-control', sc2, sc2Filters('2024-01-01', '2025-06-30'), q);
    expect(m.nFullCoverage).toBe(44669);
    expect(m.nMismatch).toBe(3);
    expect(m.mismatchFraction!).toBeLessThan(0.0001);
  });

  it('rates it green', async () => {
    const m = await measure('g3-conserved-control', sc2, sc2Filters('2024-01-01', '2025-06-30'), q);
    expect(scoreSeverity({ role: 'forward', metrics: m, profile: [] }).level).toBe('green');
  });

  it('still reports the 1998-sequence coverage gap alongside the green result', async () => {
    const m = await measure('g3-conserved-control', sc2, sc2Filters('2024-01-01', '2025-06-30'), q);
    expect(m.coverageGap).toBe(1998);
    expect(m.coverageGapFraction).toBeCloseTo(0.0428, 4);
  });
});
