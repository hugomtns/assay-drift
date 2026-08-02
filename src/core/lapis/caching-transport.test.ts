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
