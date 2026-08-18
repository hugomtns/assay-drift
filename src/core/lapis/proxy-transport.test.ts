import { describe, it, expect, vi } from 'vitest';
import { createProxyTransport, ProxyError, shouldUseProxy } from './proxy-transport';
import { LapisError } from './fetch-transport';
import { POST, ALLOWED_LAPIS_BASE_URLS, isAllowedBaseUrl } from '../../../api/lapis';
import { PATHOGENS } from '../registry';
import type { LapisRequest } from './transport';

/** A fresh 200 every call: a `Response` body can only be read once. */
const upstreamOk = (data: unknown[] = [{ count: 7 }]) =>
  vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data, info: { dataVersion: '123', requestId: 'rid-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

const post = (payload: unknown, fetchImpl?: ReturnType<typeof upstreamOk>) =>
  POST(
    new Request('https://assay-drift.test/api/lapis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
    fetchImpl ? { fetchImpl: fetchImpl as unknown as typeof fetch } : {},
  );

const valid = {
  baseUrl: 'https://lapis.cov-spectrum.org/open/v2',
  endpoint: 'aggregated',
  body: { country: 'X' },
};

const detailOf = async (res: Response): Promise<string> => {
  const parsed = (await res.json()) as { error?: { detail?: string } };
  return parsed.error?.detail ?? '';
};

describe('the proxy allow-list', () => {
  it('is derived from the registry and holds exactly the three configured instances', () => {
    // Retyped here on purpose: the production list is derived, so a test that
    // re-derived it would assert nothing. This is the tripwire that fires if
    // the derivation ever widens.
    expect([...ALLOWED_LAPIS_BASE_URLS].sort()).toEqual([
      'https://lapis.cov-spectrum.org/open/v2',
      'https://lapis.genspectrum.org/h3n2',
      'https://lapis.genspectrum.org/h5n1',
    ]);
    expect([...ALLOWED_LAPIS_BASE_URLS].sort()).toEqual(
      Object.values(PATHOGENS)
        .map((p) => p.lapisBaseUrl)
        .sort(),
    );
  });

  it.each(Object.values(PATHOGENS).map((p) => [p.id, p.lapisBaseUrl] as const))(
    'accepts the configured %s instance and forwards the POST',
    async (_id, baseUrl) => {
      const fetchImpl = upstreamOk();
      const res = await post({ ...valid, baseUrl }, fetchImpl);

      expect(res.status).toBe(200);
      expect(fetchImpl).toHaveBeenCalledOnce();
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`${baseUrl}/sample/aggregated`);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ country: 'X' });
      expect(await res.json()).toEqual({
        data: [{ count: 7 }],
        info: { dataVersion: '123', requestId: 'rid-1' },
      });
    },
  );

  it('rejects a host that is not configured at all', async () => {
    const fetchImpl = upstreamOk();
    const res = await post({ ...valid, baseUrl: 'https://evil.test/open/v2' }, fetchImpl);
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a look-alike host whose name merely starts with an allowed one', async () => {
    // The whole reason the check parses the URL instead of calling `startsWith`
    // on the raw string. This host is under the attacker's control, and
    // 'https://lapis.cov-spectrum.org.evil.test/open/v2'.startsWith(
    // 'https://lapis.cov-spectrum.org') is true.
    const fetchImpl = upstreamOk();
    const res = await post(
      { ...valid, baseUrl: 'https://lapis.cov-spectrum.org.evil.test/open/v2' },
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isAllowedBaseUrl('https://lapis.cov-spectrum.org.evil.test/open/v2')).toBe(false);
  });

  it('rejects an allowed origin whose path merely starts with an allowed prefix', async () => {
    // lapis.genspectrum.org serves both influenza instances, so the origin
    // alone is not enough; the path has to match on a segment boundary.
    const fetchImpl = upstreamOk();
    const res = await post(
      { ...valid, baseUrl: 'https://lapis.genspectrum.org/h5n1-not-really' },
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isAllowedBaseUrl('https://lapis.genspectrum.org/h5n1-not-really')).toBe(false);
    expect(isAllowedBaseUrl('https://lapis.genspectrum.org/h5n1')).toBe(true);
  });

  it('rejects http where the allow-list says https, and rejects a bare origin', () => {
    expect(isAllowedBaseUrl('http://lapis.cov-spectrum.org/open/v2')).toBe(false);
    expect(isAllowedBaseUrl('https://lapis.genspectrum.org')).toBe(false);
    expect(isAllowedBaseUrl('https://lapis.cov-spectrum.org/open')).toBe(false);
  });

  it('rejects embedded credentials, a query string, a fragment and a non-http scheme', () => {
    expect(isAllowedBaseUrl('https://u:p@lapis.cov-spectrum.org/open/v2')).toBe(false);
    expect(isAllowedBaseUrl('https://lapis.cov-spectrum.org/open/v2?redirect=1')).toBe(false);
    expect(isAllowedBaseUrl('https://lapis.cov-spectrum.org/open/v2#x')).toBe(false);
    expect(isAllowedBaseUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedBaseUrl('not a url')).toBe(false);
    expect(isAllowedBaseUrl('')).toBe(false);
  });

  it('tolerates a trailing slash on an otherwise allowed base URL', () => {
    expect(isAllowedBaseUrl('https://lapis.cov-spectrum.org/open/v2/')).toBe(true);
  });

  it('does not echo the rejected input back in the error', async () => {
    const res = await post(
      { ...valid, baseUrl: 'https://lapis.cov-spectrum.org.evil.test/open/v2' },
      upstreamOk(),
    );
    const detail = await detailOf(res);
    expect(detail).not.toContain('evil.test');
    expect(detail).not.toContain('lapis.cov-spectrum.org.evil');
    expect(detail.length).toBeGreaterThan(0);
  });

  it.each([
    ['a free string', 'referenceGenome'],
    ['a traversal attempt', '../../../admin'],
    ['an empty string', ''],
    ['a non-string', 42],
  ])('rejects an endpoint that is %s', async (_label, endpoint) => {
    const fetchImpl = upstreamOk();
    const res = await post({ ...valid, endpoint }, fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['a string', 'country=X'],
    ['an array', []],
    ['null', null],
    ['a number', 3],
  ])('rejects a body that is %s rather than forwarding undefined', async (_label, body) => {
    const fetchImpl = upstreamOk();
    const res = await post({ ...valid, body }, fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a request whose payload is not JSON at all', async () => {
    const fetchImpl = upstreamOk();
    const res = await post('{not json', fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a baseUrl that is missing or not a string', async () => {
    const fetchImpl = upstreamOk();
    expect((await post({ endpoint: 'aggregated', body: {} }, fetchImpl)).status).toBe(403);
    expect((await post({ ...valid, baseUrl: 12 }, fetchImpl)).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caches a successful proxied response with the headers the plan specifies', async () => {
    const res = await post(valid, upstreamOk());
    expect(res.headers.get('Cache-Control')).toBe(
      'public, s-maxage=21600, stale-while-revalidate=86400',
    );
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('upstream');
  });

  it('never caches an upstream error, and forwards its status and body verbatim', async () => {
    const errorBody = JSON.stringify({
      error: { status: 400, title: 'Bad Request', detail: 'unknown field zzz' },
      info: { requestId: 'rid-9' },
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(errorBody, { status: 400, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const res = await post(valid, fetchImpl as unknown as ReturnType<typeof upstreamOk>);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // Upstream's fault, not ours: the caller must be able to tell them apart.
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('upstream');
    expect(await res.text()).toBe(errorBody);
  });

  it('marks its own faults distinctly from upstream ones', async () => {
    const rejected = await post({ ...valid, baseUrl: 'https://evil.test/open/v2' }, upstreamOk());
    expect(rejected.headers.get('X-Assay-Drift-Proxy')).toBe('fault');
    expect(rejected.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 502 with a proxy fault when the upstream cannot be reached', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('getaddrinfo ENOTFOUND')));
    const res = await post(valid, fetchImpl as unknown as ReturnType<typeof upstreamOk>);
    expect(res.status).toBe(502);
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('fault');
    // Not the raw network message: it leaks our egress topology and reads as a
    // LAPIS error to anyone skimming a log.
    expect(await detailOf(res)).not.toContain('ENOTFOUND');
  });
});

const req: LapisRequest = {
  baseUrl: 'https://lapis.genspectrum.org/h3n2',
  endpoint: 'nucleotideMutations',
  body: { minProportion: 0 },
};

const proxied = (body: string, init: ResponseInit = {}) =>
  vi.fn(() => Promise.resolve(new Response(body, { status: 200, ...init })));

const okBody = JSON.stringify({
  data: [{ count: 7 }],
  info: { dataVersion: '123', requestId: 'rid-1' },
});

describe('createProxyTransport', () => {
  it('POSTs the whole request envelope to /api/lapis', async () => {
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await t.query<{ count: number }>(req);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/lapis');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      baseUrl: 'https://lapis.genspectrum.org/h3n2',
      endpoint: 'nucleotideMutations',
      body: { minProportion: 0 },
    });
    expect(res.data).toEqual([{ count: 7 }]);
    expect(res.dataVersion).toBe('123');
    expect(res.requestId).toBe('rid-1');
  });

  it('accepts a custom path', async () => {
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({
      path: '/edge/lapis',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await t.query(req);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/edge/lapis');
  });

  it('passes the caller AbortSignal through (Global Constraint 10)', async () => {
    const controller = new AbortController();
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await t.query({ ...req, signal: controller.signal });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('omits signal entirely when the caller gave none', async () => {
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await t.query(req);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect('signal' in init).toBe(false);
  });

  it('reports the decoded byte count of the proxied body', async () => {
    // Task 6.3's size guard reads `responseBytes`, and `undefined` means
    // *unmeasured*, never *small* -- so a proxy that dropped it would switch
    // the guard off for every user with no visible symptom. A response served
    // from Vercel's edge cache is still a real body over the wire.
    const body = JSON.stringify({
      data: [{ count: 7, country: 'Côte d’Ivoire' }],
      info: { dataVersion: '1', requestId: 'r' },
    });
    const t = createProxyTransport({ fetchImpl: proxied(body) as unknown as typeof fetch });
    const res = await t.query(req);
    expect(res.responseBytes).toBe(new TextEncoder().encode(body).length);
    expect(res.responseBytes).toBeGreaterThan(body.length);
  });

  it('raises an upstream LAPIS error as the LapisError the app already handles', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { status: 400, title: 'Bad Request', detail: 'unknown field zzz' },
            info: { requestId: 'rid-9' },
          }),
          { status: 400, headers: { 'X-Assay-Drift-Proxy': 'upstream' } },
        ),
      ),
    );
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await t.query(req).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LapisError);
    expect(err).not.toBeInstanceOf(ProxyError);
    expect((err as LapisError).status).toBe(400);
    expect((err as LapisError).detail).toBe('unknown field zzz');
    expect((err as LapisError).requestId).toBe('rid-9');
  });

  it('raises a fault in the proxy itself as a ProxyError that is still a LapisError', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { status: 502, title: 'Bad Gateway', detail: 'upstream unreachable' },
          }),
          { status: 502, headers: { 'X-Assay-Drift-Proxy': 'fault' } },
        ),
      ),
    );
    const t = createProxyTransport({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = await t.query(req).catch((e: unknown) => e);

    // One is our fault and one is not, and the caller can tell.
    expect(err).toBeInstanceOf(ProxyError);
    expect(err).toBeInstanceOf(LapisError);
    expect((err as LapisError).status).toBe(502);
    expect((err as LapisError).detail).toBe('upstream unreachable');
  });

  it('treats a non-JSON failure from the platform as a proxy fault', async () => {
    // A 502 from Vercel itself never carries a LAPIS envelope.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('<html>An error occurred</html>', { status: 502 })),
    );
    const t = createProxyTransport({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = await t.query(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProxyError);
    expect((err as LapisError).status).toBe(502);
  });

  it('retries a 429 the way the direct transport does', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    const res = await t.query(req);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(res.data).toEqual([{ count: 7 }]);
  });

  it('does not retry a rejection from the allow-list', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { detail: 'not an allowed instance' } }), {
          status: 403,
          headers: { 'X-Assay-Drift-Proxy': 'fault' },
        }),
      ),
    );
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    await t.query(req).catch(() => undefined);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('shouldUseProxy', () => {
  it('follows the build mode when nothing is set', () => {
    // `npm run dev` has no Vercel functions running, so the dev server must
    // keep talking to LAPIS directly or every query 404s.
    expect(shouldUseProxy({ PROD: false })).toBe(false);
    expect(shouldUseProxy({ PROD: true })).toBe(true);
    expect(shouldUseProxy({ PROD: false, VITE_LAPIS_PROXY: '' })).toBe(false);
  });

  it('lets the environment override the build mode in both directions', () => {
    expect(shouldUseProxy({ PROD: false, VITE_LAPIS_PROXY: '1' })).toBe(true);
    expect(shouldUseProxy({ PROD: false, VITE_LAPIS_PROXY: 'true' })).toBe(true);
    expect(shouldUseProxy({ PROD: true, VITE_LAPIS_PROXY: '0' })).toBe(false);
    expect(shouldUseProxy({ PROD: true, VITE_LAPIS_PROXY: 'false' })).toBe(false);
    expect(shouldUseProxy({ PROD: true, VITE_LAPIS_PROXY: 'off' })).toBe(false);
  });
});
