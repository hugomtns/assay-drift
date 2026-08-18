import { describe, it, expect, vi } from 'vitest';
import { createFetchTransport, LapisError } from './fetch-transport';
import type { LapisRequest } from './transport';

const req: LapisRequest = {
  baseUrl: 'https://example.test/v2',
  endpoint: 'aggregated',
  body: { country: 'X' },
};

const ok = (data: unknown[]) =>
  new Response(
    JSON.stringify({ data, info: { dataVersion: '123', requestId: 'rid-1' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('createFetchTransport', () => {
  it('POSTs JSON to the endpoint and unwraps data and info', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ count: 7 }]));
    const t = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await t.query<{ count: number }>(req);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.test/v2/sample/aggregated');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ country: 'X' });
    expect(res).toEqual({
      data: [{ count: 7 }],
      dataVersion: '123',
      requestId: 'rid-1',
      responseBytes: JSON.stringify({
        data: [{ count: 7 }],
        info: { dataVersion: '123', requestId: 'rid-1' },
      }).length,
    });
  });

  it('reports the decoded size of the body it parsed', async () => {
    const body = JSON.stringify({
      data: [{ count: 7, country: 'Côte d’Ivoire' }],
      info: { dataVersion: '123', requestId: 'rid-1' },
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const t = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await t.query(req);
    // The UTF-8 length, not the UTF-16 one: this body has three non-ASCII
    // characters, so `body.length` would under-report by three bytes.
    expect(res.responseBytes).toBe(new TextEncoder().encode(body).length);
    expect(res.responseBytes).toBeGreaterThan(body.length);
  });

  it('measures the decoded body, never Content-Length', async () => {
    // LAPIS serves this gzipped and `fetch` decompresses transparently, so
    // Content-Length is the compressed figure. A guard comparing it against a
    // raw threshold would never fire.
    const body = JSON.stringify({ data: [{ count: 7 }], info: {} });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Length': '12' } }),
    );
    const t = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await t.query(req);
    expect(res.responseBytes).toBe(body.length);
    expect(res.responseBytes).not.toBe(12);
  });

  it('throws LapisError carrying the API detail on 400 and does not retry', async () => {
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { status: 400, title: 'Bad Request', detail: "Unknown field: 'zzz'" } }),
          { status: 400 },
        ),
      ),
    );
    const t = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(t.query(req)).rejects.toThrow(LapisError);
    await expect(t.query(req)).rejects.toThrow(/Unknown field/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // once per call, no retries
  });

  it('retries a 429 and honours Retry-After', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(ok([{ count: 1 }]));
    const t = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    const res = await t.query<{ count: number }>(req);
    expect(res.data).toEqual([{ count: 1 }]);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up after maxRetries', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    const t = createFetchTransport({
      fetchImpl: fetchImpl as unknown as typeof fetch, sleep, maxRetries: 2,
    });
    await expect(t.query(req)).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('propagates abort without retrying', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const t = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(t.query({ ...req, signal: controller.signal })).rejects.toThrow(/aborted/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
