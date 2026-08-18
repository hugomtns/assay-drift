import { describe, it, expect, vi } from 'vitest';
import { runAnalysis } from './run';
import { findBindingSites } from '../binding';
import { withCache } from '../lapis/caching-transport';
import { MUTATIONS_SIZE_WARN_BYTES } from '../lapis/size-guard';
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

/**
 * The heavy request is `nucleotideMutations` with `minProportion: 0` -- 3.3 MB
 * raw for a one-month SARS-CoV-2 scope. It is a function of the *scope* alone,
 * so it must be paid for once however many oligos or analyses are run over that
 * scope.
 *
 * Every count below is taken at `seen`, which is the transport *underneath*
 * `withCache`. Counting at the wrapper would prove nothing: `withCache`
 * de-duplicates by request key, so a doubled call and a single call look
 * identical from above.
 *
 * What is proven is the **in-memory** cache. `withCache` also mirrors into
 * `sessionStorage`, but that is ~5 MB total and a 3.3 MB mutations entry
 * either fills it or throws `QuotaExceededError`; the second test pins that
 * degrading to memory-only is not a regression but the designed behaviour.
 */
describe('the mutations payload is fetched once per scope', () => {
  // Sliced out of REF rather than typed, so this is a second oligo that really
  // binds and no sequence is written from memory (Global Constraint 2).
  const secondOligo = () => {
    const sequence = (REF.segments[0] as { sequence: string }).sequence.slice(99, 116);
    const site = findBindingSites(sequence, REF)[0]!;
    return { id: 'o2', name: 'Test-R', role: 'reverse' as const, sequence, site };
  };

  const countMutationRequests = (seen: LapisRequest[]) =>
    seen.filter((r) => r.endpoint === 'nucleotideMutations').length;

  it('issues one nucleotideMutations request for two analyses of the same scope with different oligos', async () => {
    const { transport, seen } = scriptedTransport();
    const cached = withCache(transport, { storage: null });

    const first = await runAnalysis({ transport: cached, scope, oligos: [oligo()], reference: REF });
    const second = await runAnalysis({
      transport: cached, scope, oligos: [secondOligo()], reference: REF,
    });

    expect(countMutationRequests(seen)).toBe(1);
    // The oligos really are different, so this is not one analysis run twice.
    expect(first.oligos[0]!.window.positions).not.toHaveLength(
      second.oligos[0]!.window.positions.length,
    );
    // And the shared payload still reached both: each has a real profile.
    expect(first.oligos[0]!.profile.length).toBeGreaterThan(0);
    expect(second.oligos[0]!.profile.length).toBeGreaterThan(0);
  });

  it('still shares it when writing to sessionStorage throws QuotaExceededError', async () => {
    const { transport, seen } = scriptedTransport();
    const setItem = vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const storage = {
      getItem: () => null,
      setItem,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const cached = withCache(transport, { storage });

    await runAnalysis({ transport: cached, scope, oligos: [oligo()], reference: REF });
    await runAnalysis({ transport: cached, scope, oligos: [secondOligo()], reference: REF });

    expect(setItem).toHaveBeenCalled();
    expect(countMutationRequests(seen)).toBe(1);
  });
});

describe('the response-size guard', () => {
  const sized = (bytes: number | undefined) => {
    const { transport } = scriptedTransport();
    return {
      async query(req: LapisRequest) {
        const res = await transport.query(req);
        if (req.endpoint !== 'nucleotideMutations' || bytes === undefined) return res;
        return { ...res, responseBytes: bytes };
      },
    } as LapisTransport;
  };

  it('raises no run-level diagnostic for a payload under the threshold', async () => {
    const result = await runAnalysis({
      transport: sized(3_270_000), scope, oligos: [oligo()], reference: REF,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('raises one info diagnostic on the result, not on an oligo, when the payload is large', async () => {
    const result = await runAnalysis({
      transport: sized(MUTATIONS_SIZE_WARN_BYTES + 1), scope, oligos: [oligo()], reference: REF,
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ id: 'large-response', severity: 'info' });
    expect(result.diagnostics[0]!.message).toContain('nucleotideMutations');
    // It is a property of the scope, so it must not name an oligo, and no
    // oligo may carry it.
    expect(result.diagnostics[0]!.message).not.toContain('Test-F');
    for (const o of result.oligos) {
      expect(o.diagnostics.map((d) => d.id)).not.toContain('large-response');
    }
  });

  it('stays silent when the transport did not measure anything', async () => {
    // A fixture transport replays a recorded object and never saw a wire.
    // Unmeasured is not the same as small, and must not become a claim.
    const result = await runAnalysis({
      transport: sized(undefined), scope, oligos: [oligo()], reference: REF,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('does not change the number of queries an analysis issues', async () => {
    const { transport, seen } = scriptedTransport();
    await runAnalysis({ transport, scope, oligos: [oligo()], reference: REF });
    expect(seen).toHaveLength(7);
  });
});
