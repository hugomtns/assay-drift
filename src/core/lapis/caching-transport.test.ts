import { describe, it, expect } from 'vitest';
import { withCache, cacheKey } from './caching-transport';
import type { LapisRequest, LapisTransport } from './transport';

const req: LapisRequest = {
  baseUrl: 'https://example.test/v2', endpoint: 'aggregated', body: { b: 2, a: 1 },
};

const stubTransport = (): LapisTransport & { calls: number } => {
  const t = {
    calls: 0,
    async query<T>() {
      t.calls += 1;
      return { data: [{ count: t.calls } as unknown as T], dataVersion: 'v', requestId: 'r' };
    },
  };
  return t as LapisTransport & { calls: number };
};

describe('cacheKey', () => {
  it('is stable regardless of body key order', () => {
    expect(cacheKey(req)).toBe(
      cacheKey({ ...req, body: { a: 1, b: 2 } }),
    );
  });
  it('differs by endpoint', () => {
    expect(cacheKey(req)).not.toBe(cacheKey({ ...req, endpoint: 'nucleotideMutations' }));
  });
  it('ignores the abort signal', () => {
    expect(cacheKey({ ...req, signal: new AbortController().signal })).toBe(cacheKey(req));
  });
});

describe('withCache', () => {
  it('serves a repeat request from cache', async () => {
    const inner = stubTransport();
    const cached = withCache(inner, { storage: null });
    const a = await cached.query(req);
    const b = await cached.query(req);
    expect(inner.calls).toBe(1);
    expect(b).toEqual(a);
  });

  it('expires entries after the TTL', async () => {
    const inner = stubTransport();
    let now = 0;
    const cached = withCache(inner, { storage: null, ttlMs: 1000, now: () => now });
    await cached.query(req);
    now = 1500;
    await cached.query(req);
    expect(inner.calls).toBe(2);
  });

  it('deduplicates concurrent identical requests', async () => {
    const inner = stubTransport();
    const cached = withCache(inner, { storage: null });
    await Promise.all([cached.query(req), cached.query(req), cached.query(req)]);
    expect(inner.calls).toBe(1);
  });

  it('does not cache failures', async () => {
    let attempts = 0;
    const flaky: LapisTransport = {
      async query() {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        return { data: [], dataVersion: 'v', requestId: 'r' };
      },
    };
    const cached = withCache(flaky, { storage: null });
    await expect(cached.query(req)).rejects.toThrow('boom');
    await expect(cached.query(req)).resolves.toBeDefined();
    expect(attempts).toBe(2);
  });

  /**
   * `runAnalysis` reads `responseBytes` off the mutations response to decide
   * whether to warn about the payload size. A cache that dropped the field
   * would make that warning depend on whether the user happened to be the
   * first person in the session to ask for that scope.
   */
  it('carries responseBytes through both the memory hit and the storage hit', async () => {
    const measuring: LapisTransport = {
      async query() {
        return { data: [], dataVersion: 'v', requestId: 'r', responseBytes: 3_270_000 };
      },
    };
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: () => null,
      length: 0,
    } as unknown as Storage;

    const first = withCache(measuring, { storage });
    expect((await first.query(req)).responseBytes).toBe(3_270_000);
    // Memory hit.
    expect((await first.query(req)).responseBytes).toBe(3_270_000);
    // Storage hit: a fresh wrapper with an empty Map, reading what the first
    // one mirrored out. The transport underneath would answer anyway, so the
    // point is that the number survives JSON round-tripping.
    const second = withCache({ query: () => Promise.reject(new Error('should not be called')) }, { storage });
    expect((await second.query(req)).responseBytes).toBe(3_270_000);
  });

  it('survives a storage that throws on write', async () => {
    const inner = stubTransport();
    const hostile = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded'); },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const cached = withCache(inner, { storage: hostile });
    await expect(cached.query(req)).resolves.toBeDefined();
  });
});
