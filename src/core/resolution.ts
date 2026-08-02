import { findBindingSites, type BindingSite, type ReferenceGenome } from './binding';
import { degeneracyProduct, normalizeOligo } from './iupac';

export const MAX_DEGENERACY_PRODUCT = 64;

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'no-hit' | 'highly-degenerate';

export interface Resolution {
  status: ResolutionStatus;
  candidates: BindingSite[];
  chosen: BindingSite | null;
  notes: string[];
}

export function resolveBindingSite(
  oligo: string,
  ref: ReferenceGenome,
  opts: { maxMismatches?: number; maxCandidates?: number } = {},
): Resolution {
  const maxCandidates = opts.maxCandidates ?? 20;
  const normalized = normalizeOligo(oligo);
  const notes: string[] = [];

  const all = findBindingSites(normalized, ref, opts);
  if (all.length === 0) {
    return {
      status: 'no-hit',
      candidates: [],
      chosen: null,
      notes: ['No binding site found within the mismatch tolerance. Check the sequence and the selected pathogen.'],
    };
  }

  const best = all[0]!.mismatches;
  const tied = all.filter((s) => s.mismatches === best);
  const shown = tied.slice(0, maxCandidates);
  if (tied.length > shown.length) {
    notes.push(`Showing ${shown.length} of ${tied.length} equally good candidate sites.`);
  }

  const degeneracy = degeneracyProduct(normalized);
  if (degeneracy > MAX_DEGENERACY_PRODUCT) {
    notes.push(
      `This oligo is highly degenerate (${degeneracy} possible sequences); the located site needs confirmation.`,
    );
    return {
      status: 'highly-degenerate',
      candidates: shown,
      chosen: tied.length === 1 ? (tied[0] as BindingSite) : null,
      notes,
    };
  }

  if (tied.length === 1) {
    return { status: 'resolved', candidates: shown, chosen: tied[0] as BindingSite, notes };
  }

  notes.push(`${tied.length} sites match equally well. Choose the intended one.`);
  return { status: 'ambiguous', candidates: shown, chosen: null, notes };
}
