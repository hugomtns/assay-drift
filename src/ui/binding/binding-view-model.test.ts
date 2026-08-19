import { describe, expect, it } from 'vitest';
import type { BindingSite } from '../../core/binding';
import type { Resolution } from '../../core/resolution';
import { committedSites, deriveBindingRows } from './binding-view-model';

const site: BindingSite = { segment: 'main', start: 1, end: 20, strand: 'plus', mismatches: 0, mismatchOligoIndexes: [] };
const resolved = (status: Resolution['status']): Resolution => ({ status, candidates: [site], chosen: site, notes: [] });

describe('binding view model', () => {
  it('requires confirmation before a highly-degenerate stored site is committed', () => {
    const rows = deriveBindingRows([{ oligo: { id: 'a', name: 'A', role: 'forward', sequence: 'ACGT' }, resolution: resolved('highly-degenerate') }], { a: site }, () => false);
    expect(rows[0]?.committed).toBeNull();
    expect(committedSites(rows)).toEqual({});
  });
  it('keeps an ordinary stored site committed', () => {
    const rows = deriveBindingRows([{ oligo: { id: 'a', name: 'A', role: 'forward', sequence: 'ACGT' }, resolution: resolved('resolved') }], { a: site }, () => false);
    expect(committedSites(rows)).toEqual({ a: site });
  });
});
