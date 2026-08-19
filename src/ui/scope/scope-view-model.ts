import type { AggregatedRow } from '../../core/lapis/endpoints';
import type { Scope } from '../../core/scope';

export interface MergedOptions { options: string[]; unmatched: string[]; }

const sorted = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b, 'en'));

export function optionValues(rows: AggregatedRow[], field: string): string[] {
  return sorted([...new Set(rows.flatMap((row) => typeof row[field] === 'string' && row[field] !== '' ? [row[field]] : []))]);
}

export function mergeSelection(loaded: string[] | null, selected: string[]): MergedOptions {
  if (loaded === null) return { options: sorted([...new Set(selected)]), unmatched: [] };
  return { options: loaded, unmatched: sorted([...new Set(selected.filter((value) => !loaded.includes(value)))]) };
}

export function scopeValidation(scope: Scope) {
  const missingDate = scope.dateFrom === '' || scope.dateTo === '';
  const inverted = !missingDate && scope.dateTo < scope.dateFrom;
  return { missingDate, inverted, canRun: !missingDate && !inverted };
}
