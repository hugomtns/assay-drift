import { basesMatch, normalizeOligo, reverseComplement } from './iupac';
import { type ReferenceGenome, type ReferenceSegment } from './reference';

export type { ReferenceGenome, ReferenceSegment } from './reference';
export type Strand = 'plus' | 'minus';

export interface BindingSite {
  segment: string;
  strand: Strand;
  /** 1-based inclusive, plus strand of the reference. Always <= end. */
  start: number;
  /** 1-based inclusive, plus strand of the reference. */
  end: number;
  mismatches: number;
  /** 0-based indexes into the oligo, 5' -> 3'. */
  mismatchOligoIndexes: number[];
}

export const DEFAULT_MAX_MISMATCHES = 3;

function scanSegment(
  seg: ReferenceSegment,
  probe: string,
  strand: Strand,
  maxMismatches: number,
  out: BindingSite[],
): void {
  const n = probe.length;
  const limit = seg.sequence.length - n;
  for (let offset = 0; offset <= limit; offset += 1) {
    let mismatches = 0;
    const indexes: number[] = [];
    for (let j = 0; j < n; j += 1) {
      if (!basesMatch(probe[j] as string, seg.sequence[offset + j] as string)) {
        mismatches += 1;
        if (mismatches > maxMismatches) break;
        // probe index j -> oligo index, accounting for orientation
        indexes.push(strand === 'plus' ? j : n - 1 - j);
      }
    }
    if (mismatches <= maxMismatches) {
      out.push({
        segment: seg.name,
        strand,
        start: offset + 1,
        end: offset + n,
        mismatches,
        mismatchOligoIndexes: indexes.sort((a, b) => a - b),
      });
    }
  }
}

export function findBindingSites(
  oligo: string,
  ref: ReferenceGenome,
  opts: { maxMismatches?: number } = {},
): BindingSite[] {
  const maxMismatches = opts.maxMismatches ?? DEFAULT_MAX_MISMATCHES;
  const forward = normalizeOligo(oligo);
  if (forward.length === 0) throw new Error('Oligo is empty');
  const reverse = reverseComplement(forward);
  const out: BindingSite[] = [];
  for (const seg of ref.segments) {
    scanSegment(seg, forward, 'plus', maxMismatches, out);
    scanSegment(seg, reverse, 'minus', maxMismatches, out);
  }
  out.sort(
    (a, b) =>
      a.mismatches - b.mismatches ||
      a.segment.localeCompare(b.segment) ||
      a.start - b.start ||
      a.strand.localeCompare(b.strand),
  );
  return out;
}

/** Reference position of a given 0-based oligo index (5' -> 3'). */
export function oligoIndexToRefPos(site: BindingSite, oligoIndex: number): number {
  const length = site.end - site.start + 1;
  if (oligoIndex < 0 || oligoIndex >= length) {
    throw new Error(`Oligo index ${oligoIndex} outside site of length ${length}`);
  }
  return site.strand === 'plus' ? site.start + oligoIndex : site.end - oligoIndex;
}
