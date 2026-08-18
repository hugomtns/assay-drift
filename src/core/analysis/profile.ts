import { isMismatchAllele, type PositionSpec, type WindowSpec } from '../query';
import type { MutationRow } from '../lapis/endpoints';

export interface AlleleStat {
  allele: string;
  count: number;
  proportion: number;
  isMismatch: boolean;
}

export interface PositionStat {
  refPos: number;
  oligoIndex: number;
  oligoBase: string;
  plusStrandBase: string;
  refBase: string;
  distanceFrom3Prime: number;
  /** Per-position coverage as reported by LAPIS, or null when no mutation row exists. */
  coverage: number | null;
  /** True when coverage was unavailable and the window denominator was substituted. */
  coverageIsInferred: boolean;
  effectiveDenominator: number;
  mismatchCount: number;
  substitutionCount: number;
  deletionCount: number;
  mismatchFraction: number;
  alleles: AlleleStat[];
  referenceIsAmbiguous: boolean;
}

export function rowBelongsToWindow(row: MutationRow, w: WindowSpec): boolean {
  if (w.qualifier !== null) return row.sequenceName === w.qualifier;
  return row.sequenceName === null || row.sequenceName === w.segment;
}

/** One reported allele at a position, before any denominator is applied. */
interface AlleleCount {
  allele: string;
  count: number;
}

/**
 * The whole per-position computation, expressed over allele counts and a
 * denominator rather than over LAPIS rows.
 *
 * Two callers need it and they differ only in where the denominator comes
 * from: `buildPositionProfile` takes the `coverage` LAPIS attached to the
 * mutation rows (or none, and borrows the window's), and `applyExactCoverage`
 * takes one measured by its own query. Sharing this function is what makes the
 * exact-coverage path a change of denominator and nothing else -- the mismatch
 * arithmetic, including the subtraction branch for an oligo that does not
 * accept the reference base, cannot drift between the two.
 */
function statFrom(
  spec: PositionSpec,
  alleleCounts: AlleleCount[],
  coverage: number | null,
  fallbackDenominator: number,
): PositionStat {
  const effectiveDenominator = coverage ?? fallbackDenominator;

  // The reference base itself is unusable (non-ACGT), so acceptedAlleles can never
  // contain it and any mismatch inference here would be fabricated, not derived from
  // what LAPIS reported. Mirrors query.ts's usablePositions(), which excludes these
  // positions from the LAPIS query entirely; referenceIsAmbiguous is the signal a
  // consumer must check before trusting this position's mismatch numbers.
  if (spec.referenceIsAmbiguous) {
    return {
      refPos: spec.refPos,
      oligoIndex: spec.oligoIndex,
      oligoBase: spec.oligoBase,
      plusStrandBase: spec.plusStrandBase,
      refBase: spec.refBase,
      distanceFrom3Prime: spec.distanceFrom3Prime,
      coverage,
      coverageIsInferred: coverage === null,
      effectiveDenominator,
      mismatchCount: 0,
      substitutionCount: 0,
      deletionCount: 0,
      mismatchFraction: 0,
      alleles: [],
      referenceIsAmbiguous: true,
    };
  }

  const alleles: AlleleStat[] = alleleCounts.map((a) => ({
    allele: a.allele,
    count: a.count,
    proportion: effectiveDenominator === 0 ? 0 : a.count / effectiveDenominator,
    isMismatch: isMismatchAllele(a.allele, spec.plusStrandBase),
  }));

  const substitutionCount = alleles
    .filter((a) => a.isMismatch && a.allele !== '-')
    .reduce((total, a) => total + a.count, 0);
  const deletionCount = alleles
    .filter((a) => a.allele === '-')
    .reduce((total, a) => total + a.count, 0);

  // When the oligo does not accept the reference base, every sequence that is NOT
  // reported as carrying an accepted allele is itself a mismatch.
  const oligoAcceptsReference = spec.acceptedAlleles.includes(spec.refBase);
  let mismatchCount: number;
  if (oligoAcceptsReference) {
    mismatchCount = substitutionCount + deletionCount;
  } else {
    const acceptedCount = alleles
      .filter((a) => !a.isMismatch)
      .reduce((total, a) => total + a.count, 0);
    mismatchCount = Math.max(0, effectiveDenominator - acceptedCount);
  }

  const mismatchFraction =
    effectiveDenominator === 0 ? 0 : Math.min(1, mismatchCount / effectiveDenominator);

  return {
    refPos: spec.refPos,
    oligoIndex: spec.oligoIndex,
    oligoBase: spec.oligoBase,
    plusStrandBase: spec.plusStrandBase,
    refBase: spec.refBase,
    distanceFrom3Prime: spec.distanceFrom3Prime,
    coverage,
    coverageIsInferred: coverage === null,
    effectiveDenominator,
    mismatchCount,
    substitutionCount,
    deletionCount,
    mismatchFraction,
    alleles: alleles.sort((a, b) => b.count - a.count),
    referenceIsAmbiguous: spec.referenceIsAmbiguous,
  };
}

export function buildPositionProfile(
  w: WindowSpec,
  rows: MutationRow[],
  fallbackDenominator: number,
): PositionStat[] {
  const byPosition = new Map<number, MutationRow[]>();
  for (const row of rows) {
    if (!rowBelongsToWindow(row, w)) continue;
    const bucket = byPosition.get(row.position);
    if (bucket) bucket.push(row);
    else byPosition.set(row.position, [row]);
  }
  return w.positions.map((spec) => {
    const rows = byPosition.get(spec.refPos) ?? [];
    return statFrom(
      spec,
      rows.map((r) => ({ allele: r.mutationTo, count: r.count })),
      rows.length > 0 ? (rows[0] as MutationRow).coverage : null,
      fallbackDenominator,
    );
  });
}

/**
 * The same profile with measured per-position coverage substituted for the
 * inferred denominators.
 *
 * `fetchExactCoverage` answers the one question the mutations payload cannot:
 * how many sequences had a definite call at a position *where nothing was
 * mutated*. LAPIS emits no row for such a position (Part I.1, fact 4), so
 * `buildPositionProfile` has nothing to read and borrows the window
 * denominator, flagged as `coverageIsInferred`. A real count clears that flag,
 * and clearing it is as important as changing the number: the hatching, the
 * `<title>` tooltips and the "window denominator used" note in the hidden
 * table all read from it, so a bar redrawn from a measured denominator stops
 * claiming it borrowed one.
 *
 * A position the map does not mention keeps whatever it had. In practice the
 * map is complete or the fan-out threw, but "measured" must never be inferred
 * from a missing entry.
 *
 * Pure: it returns a new array of new objects and does not touch the input.
 */
export function applyExactCoverage(
  profile: PositionStat[],
  w: WindowSpec,
  coverage: ReadonlyMap<number, number>,
  fallbackDenominator: number,
): PositionStat[] {
  return profile.map((stat, i) => {
    const measured = coverage.get(stat.refPos);
    if (measured === undefined) return stat;
    const spec = w.positions[i];
    if (spec === undefined || spec.refPos !== stat.refPos) return stat;
    return statFrom(
      spec,
      stat.alleles.map((a) => ({ allele: a.allele, count: a.count })),
      measured,
      fallbackDenominator,
    );
  });
}
