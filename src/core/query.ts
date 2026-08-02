import { oligoIndexToRefPos, type BindingSite } from './binding';
import { baseAt, type ReferenceGenome } from './reference';
import { acceptedBases, complementBase, normalizeOligo } from './iupac';
import type { OligoRole } from './oligo-input';

/** Alleles LAPIS can report at a position. '-' is a deletion. */
export const ALL_ALLELES = ['A', 'C', 'G', 'T', '-'] as const;

export interface PositionSpec {
  /** 1-based reference position. */
  refPos: number;
  /** Reference base at refPos, plus strand. */
  refBase: string;
  /** The oligo's own base, 5'->3'. */
  oligoBase: string;
  /** The oligo base expressed on the plus strand (complemented for minus-strand sites). */
  plusStrandBase: string;
  /** 0-based index along the oligo, 5'->3'. */
  oligoIndex: number;
  distanceFrom3Prime: number;
  /** Alleles the oligo binds at this position, plus strand. Never contains '-'. */
  acceptedAlleles: string[];
  /** Alleles that constitute a mismatch, plus strand. Always contains '-' unless excluded. */
  mismatchAlleles: string[];
  referenceIsAmbiguous: boolean;
}

export interface WindowSpec {
  /** Segment prefix for query terms, or null when the genome is unsegmented. */
  qualifier: string | null;
  segment: string;
  role: OligoRole;
  length: number;
  /** Ordered 5'->3' along the oligo. */
  positions: PositionSpec[];
}

export function isMismatchAllele(allele: string, plusStrandBase: string): boolean {
  if (allele === '-') return true;
  return !acceptedBases(plusStrandBase).has(allele);
}

export function buildWindowSpec(
  site: BindingSite,
  oligo: string,
  ref: ReferenceGenome,
  role: OligoRole,
  opts: { segmented: boolean },
): WindowSpec {
  const normalized = normalizeOligo(oligo);
  const length = site.end - site.start + 1;
  if (normalized.length !== length) {
    throw new Error(`Oligo length ${normalized.length} does not match site length ${length}`);
  }

  const positions: PositionSpec[] = [];
  for (let i = 0; i < length; i += 1) {
    const refPos = oligoIndexToRefPos(site, i);
    const refBase = baseAt(ref, site.segment, refPos);
    const oligoBase = normalized[i] as string;
    const plusStrandBase = site.strand === 'plus' ? oligoBase : complementBase(oligoBase);
    const accepted = [...acceptedBases(plusStrandBase)].sort();
    positions.push({
      refPos,
      refBase,
      oligoBase,
      plusStrandBase,
      oligoIndex: i,
      distanceFrom3Prime: length - 1 - i,
      acceptedAlleles: accepted,
      mismatchAlleles: ALL_ALLELES.filter((a) => isMismatchAllele(a, plusStrandBase)),
      referenceIsAmbiguous: !['A', 'C', 'G', 'T'].includes(refBase),
    });
  }

  return {
    qualifier: opts.segmented ? site.segment : null,
    segment: site.segment,
    role,
    length,
    positions,
  };
}

function bareTerm(qualifier: string | null, refPos: number): string {
  return qualifier ? `${qualifier}:${refPos}` : `${refPos}`;
}

function alleleTerm(qualifier: string | null, from: string, refPos: number, to: string): string {
  const core = `${from}${refPos}${to}`;
  return qualifier ? `${qualifier}:${core}` : core;
}

export function ambiguityTerm(w: WindowSpec, p: PositionSpec): string {
  return `${bareTerm(w.qualifier, p.refPos)}N`;
}

/**
 * See Part I.4 of the implementation plan. Three cases:
 *   A  oligo is non-degenerate and matches the reference -> bare position term
 *   B  oligo accepts the reference base plus others      -> enumerate disallowed alleles
 *   C  oligo does not accept the reference base          -> negate the accepted alleles
 */
export function mismatchTerm(w: WindowSpec, p: PositionSpec): string {
  const { qualifier } = w;
  const accepted = p.acceptedAlleles;
  const acceptsReference = accepted.includes(p.refBase);

  if (acceptsReference && accepted.length === 1) {
    return bareTerm(qualifier, p.refPos);
  }
  if (acceptsReference) {
    const terms = p.mismatchAlleles.map((x) => alleleTerm(qualifier, p.refBase, p.refPos, x));
    return `(${terms.join(' | ')})`;
  }
  const terms = accepted.map((a) => alleleTerm(qualifier, p.refBase, p.refPos, a));
  return `!(${terms.join(' | ')})`;
}

function usablePositions(w: WindowSpec): PositionSpec[] {
  const usable = w.positions.filter((p) => !p.referenceIsAmbiguous);
  if (usable.length === 0) {
    throw new Error('This binding site has no usable positions: every reference base is ambiguous.');
  }
  return usable;
}

export function fullCoverageQuery(w: WindowSpec): string {
  const terms = usablePositions(w).map((p) => ambiguityTerm(w, p));
  return `!(${terms.join(' | ')})`;
}

export function mismatchWithCoverageQuery(w: WindowSpec): string {
  const usable = usablePositions(w);
  const mismatch = usable.map((p) => mismatchTerm(w, p)).join(' | ');
  const ambiguity = usable.map((p) => ambiguityTerm(w, p)).join(' | ');
  return `(${mismatch}) & !(${ambiguity})`;
}
