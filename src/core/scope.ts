import type { PathogenConfig, PathogenId } from './registry';

export interface Scope {
  pathogenId: PathogenId;
  /** ISO yyyy-mm-dd, inclusive. */
  dateFrom: string;
  /** ISO yyyy-mm-dd, inclusive. */
  dateTo: string;
  countries: string[];
  lineages: string[];
}

export function scopeToFilters(
  scope: Scope,
  cfg: PathogenConfig,
): Record<string, string | string[]> {
  const filters: Record<string, string | string[]> = {
    [cfg.dateFromParam]: scope.dateFrom,
    [cfg.dateToParam]: scope.dateTo,
  };
  if (scope.countries.length > 0) filters[cfg.countryField] = scope.countries;
  if (scope.lineages.length > 0) filters[cfg.lineageField] = scope.lineages;
  return filters;
}
