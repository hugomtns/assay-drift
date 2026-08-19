import type { BindingSite } from '../../core/binding';
import type { OligoInput } from '../../core/oligo-input';
import type { Resolution } from '../../core/resolution';

export interface BindingRow {
  oligo: OligoInput;
  resolution: Resolution;
  stored: BindingSite | undefined;
  located: BindingSite | null;
  confirmed: boolean;
  committed: BindingSite | null;
}

export const siteKey = (site: BindingSite) => `${site.segment}:${site.start}-${site.end}:${site.strand}`;

export function deriveBindingRows(
  resolved: Array<{ oligo: OligoInput; resolution: Resolution }>,
  chosenSites: Record<string, BindingSite>,
  isConfirmed: (oligo: OligoInput, site: BindingSite) => boolean,
): BindingRow[] {
  return resolved.map(({ oligo, resolution }) => {
    const stored = chosenSites[oligo.id];
    const located = stored ?? resolution.chosen;
    const confirmed = located !== null && isConfirmed(oligo, located);
    const committed = stored !== undefined && (resolution.status !== 'highly-degenerate' || confirmed) ? stored : null;
    return { oligo, resolution, stored, located, confirmed, committed };
  });
}

export function committedSites(rows: BindingRow[]): Record<string, BindingSite> {
  return Object.fromEntries(rows.flatMap((row) => row.committed === null ? [] : [[row.oligo.id, row.committed]]));
}
