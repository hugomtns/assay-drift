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

function statFor(
  spec: PositionSpec,
  rows: MutationRow[],
  fallbackDenominator: number,
): PositionStat {
  const coverage = rows.length > 0 ? (rows[0] as MutationRow).coverage : null;
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

  const alleles: AlleleStat[] = rows.map((r) => ({
    allele: r.mutationTo,
    count: r.count,
    proportion: effectiveDenominator === 0 ? 0 : r.count / effectiveDenominator,
    isMismatch: isMismatchAllele(r.mutationTo, spec.plusStrandBase),
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
  return w.positions.map((spec) =>
    statFor(spec, byPosition.get(spec.refPos) ?? [], fallbackDenominator),
  );
}
