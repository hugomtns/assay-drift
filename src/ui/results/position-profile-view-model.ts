import type { PositionStat } from '../../core/analysis/profile';

export interface Segment { key: string; y: number; height: number; className: string; }

export function segmentsFor(position: PositionStat, plotHeight: number): Segment[] {
  const total = Math.min(1, Math.max(0, position.mismatchFraction)) * plotHeight;
  if (total <= 0 || position.mismatchCount <= 0) return [];
  const parts = [
    { key: 'deletion', height: (position.deletionCount / position.mismatchCount) * total, className: 'fill-purple-700' },
    { key: 'substitution', height: (position.substitutionCount / position.mismatchCount) * total, className: 'fill-rose-600' },
  ];
  const other = Math.max(0, total - parts[0]!.height - parts[1]!.height);
  if (other > 0) parts.push({ key: 'other', height: other, className: 'fill-slate-500' });
  return parts.filter((part) => part.height > 0).map((part, index, all) => ({
    ...part,
    y: plotHeight - all.slice(0, index).reduce((sum, prior) => sum + prior.height, 0) - part.height,
  }));
}

export const unattributed = (position: PositionStat) =>
  !position.referenceIsAmbiguous && position.mismatchCount > position.substitutionCount + position.deletionCount;

export function noteFor(position: PositionStat): string {
  if (position.referenceIsAmbiguous) return 'Not assessable: the reference base is ambiguous, so no rate can be computed here.';
  return position.coverageIsInferred ? 'Per-position coverage not reported; the window denominator is used instead.' : '';
}

export function titleFor(position: PositionStat): string | null {
  if (position.referenceIsAmbiguous) return 'reference base is ambiguous; this position cannot be assessed';
  return position.coverageIsInferred ? 'per-position coverage not reported' : null;
}
