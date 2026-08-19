import type { AnalysisOligo } from '../core/analysis/run';
import { findBindingSites, type BindingSite } from '../core/binding';
import { decodePermalink, encodePermalink, type PermalinkScope, type PermalinkState } from '../core/permalink';
import type { OligoInput } from '../core/oligo-input';
import type { Scope } from '../core/scope';
import { loadReference } from '../data/references';

export interface RestoredQuery { pathogenId: PermalinkState['pathogenId']; oligos: OligoInput[]; sites: Record<string, BindingSite>; scope: PermalinkScope; }

export function restoreFromHash(hash: string): RestoredQuery | null {
  const decoded = decodePermalink(hash);
  if (decoded === null) return null;
  try {
    const reference = loadReference(decoded.pathogenId); const oligos: OligoInput[] = []; const sites: Record<string, BindingSite> = {};
    for (const [index, oligo] of decoded.oligos.entries()) {
      const id = `oligo-${index}`; const wanted = decoded.sites[oligo.name];
      const site = wanted === undefined ? undefined : findBindingSites(oligo.sequence, reference).find((candidate) => candidate.segment === wanted.segment && candidate.strand === wanted.strand && candidate.start === wanted.start);
      if (site === undefined) return null;
      oligos.push({ id, name: oligo.name, role: oligo.role, sequence: oligo.sequence }); sites[id] = site;
    }
    return { pathogenId: decoded.pathogenId, oligos, sites, scope: decoded.scope };
  } catch { return null; }
}

export function publishPermalink(scope: Scope, oligos: AnalysisOligo[]): void {
  const state: PermalinkState = { pathogenId: scope.pathogenId, oligos: oligos.map((o) => ({ name: o.name, role: o.role, sequence: o.sequence })), sites: Object.fromEntries(oligos.map((o) => [o.name, { segment: o.site.segment, strand: o.site.strand, start: o.site.start }])), scope: { dateFrom: scope.dateFrom, dateTo: scope.dateTo, countries: scope.countries, lineages: scope.lineages } };
  try { window.history.replaceState(null, '', encodePermalink(state)); }
  catch { window.history.replaceState(null, '', window.location.pathname + window.location.search); }
}
