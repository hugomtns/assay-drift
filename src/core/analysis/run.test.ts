import { describe, it, expect, vi } from 'vitest';
import { runAnalysis } from './run';
import { findBindingSites } from '../binding';
import type { LapisRequest, LapisTransport } from '../lapis/transport';
import type { ReferenceGenome } from '../reference';
import type { Scope } from '../scope';

const REF: ReferenceGenome = {
  pathogenId: 'sars-cov-2',
  segments: [{ name: 'main', sequence: `${'A'.repeat(99)}ATGCATGCATGCATGCATGC${'A'.repeat(200)}` }],
};

const scope: Scope = {
  pathogenId: 'sars-cov-2', dateFrom: '2025-01-01', dateTo: '2025-06-30',
  countries: ['United Kingdom'], lineages: [],
};

const oligo = () => {
  const site = findBindingSites('ATGCATGCATGCATGCATGC', REF)[0]!;
  return { id: 'o1', name: 'Test-F', role: 'forward' as const, sequence: 'ATGCATGCATGCATGCATGC', site };
};

/** Answers every request shape the orchestrator can emit. */
const scriptedTransport = (): { transport: LapisTransport; seen: LapisRequest[] } => {
  const seen: LapisRequest[] = [];
  const transport: LapisTransport = {
    async query(req) {
      seen.push(req);
      const info = { dataVersion: 'dv-1', requestId: 'rid' };
      if (req.endpoint === 'nucleotideMutations') {
        // Reference base at position 105 in REF below is 'T'.
        return {
          data: [{
            mutation: 'T105G', count: 100, coverage: 900, proportion: 0.111,
            sequenceName: null, mutationFrom: 'T', mutationTo: 'G', position: 105,
          }],
          ...info,
        } as never;
      }
      if (req.endpoint === 'nucleotideInsertions') return { data: [], ...info } as never;

      const q = req.body.advancedQuery as string | undefined;
      const fields = req.body.fields as string[] | undefined;
      if (fields?.[0] === 'pangoLineage') return { data: [{ count: 100, pangoLineage: 'XEC' }], ...info } as never;
      if (fields?.[0] === 'country') return { data: [{ count: 100, country: 'United Kingdom' }], ...info } as never;
      if (q === undefined) return { data: [{ count: 1000, date: '2025-02-01' }], ...info } as never;
      if (q.startsWith('!(')) return { data: [{ count: 900, date: '2025-02-01' }], ...info } as never;
      return { data: [{ count: 100, date: '2025-02-01' }], ...info } as never;
    },
  };
  return { transport, seen };
};

describe('runAnalysis', () => {
  it('issues exactly the queries described in the plan for one oligo', async () => {
    const { transport, seen } = scriptedTransport();
    const result = await runAnalysis({
      transport, scope, oligos: [oligo()], reference: REF,
      now: () => new Date('2026-08-01T00:00:00Z'),
    });
    // 1 scope-by-date + 1 mutations + 1 insertions + 4 per oligo
    expect(seen).toHaveLength(7);
    expect(result.queryCount).toBe(7);
    expect(seen.filter((r) => r.endpoint === 'nucleotideMutations')).toHaveLength(1);
    expect(seen.filter((r) => r.endpoint === 'nucleotideInsertions')).toHaveLength(1);
  });

  it('shares the scope-level queries across multiple oligos', async () => {
    const { transport, seen } = scriptedTransport();
    const three = [oligo(), { ...oligo(), id: 'o2' }, { ...oligo(), id: 'o3', role: 'probe' as const }];
    await runAnalysis({ transport, scope, oligos: three, reference: REF });
    // 3 scope-level + 4 per oligo x 3
    expect(seen).toHaveLength(15);
  });

  it('sends minProportion 0 on the mutations query', async () => {
    const { transport, seen } = scriptedTransport();
    await runAnalysis({ transport, scope, oligos: [oligo()], reference: REF });
    const mutations = seen.find((r) => r.endpoint === 'nucleotideMutations')!;
    expect(mutations.body.minProportion).toBe(0);
  });

  it('assembles metrics, profile, trend, attribution, severity and diagnostics', async () => {
    const { transport } = scriptedTransport();
    const result = await runAnalysis({ transport, scope, oligos: [oligo()], reference: REF });
    const a = result.oligos[0]!;
    expect(result.nScope).toBe(1000);
    expect(a.metrics).toMatchObject({ nScope: 1000, nFullCoverage: 900, nMismatch: 100 });
    expect(a.metrics.mismatchFraction).toBeCloseTo(100 / 900, 6);
    expect(a.profile).toHaveLength(20);
    expect(a.trend.points).toHaveLength(1);
    expect(a.lineage.rows[0]!.value).toBe('XEC');
    expect(a.country.rows[0]!.value).toBe('United Kingdom');
    expect(a.severity.level).toBe('red');
    expect(Array.isArray(a.diagnostics)).toBe(true);
  });

  it('records the data version and a generation timestamp', async () => {
    const { transport } = scriptedTransport();
    const result = await runAnalysis({
      transport, scope, oligos: [oligo()], reference: REF,
      now: () => new Date('2026-08-01T12:00:00Z'),
    });
    expect(result.dataVersion).toBe('dv-1');
    expect(result.generatedAt).toBe('2026-08-01T12:00:00.000Z');
  });

  it('forwards the abort signal to every request', async () => {
    const { transport, seen } = scriptedTransport();
    const signal = new AbortController().signal;
    await runAnalysis({ transport, scope, oligos: [oligo()], reference: REF, signal });
    expect(seen.every((r) => r.signal === signal)).toBe(true);
  });

  it('propagates a transport failure rather than returning partial results', async () => {
    const failing: LapisTransport = { query: vi.fn().mockRejectedValue(new Error('network down')) };
    await expect(
      runAnalysis({ transport: failing, scope, oligos: [oligo()], reference: REF }),
    ).rejects.toThrow('network down');
  });
});
