import { describe, it, expect, vi } from 'vitest';
import {
  createProxyTransport,
  ProxyError,
  shouldUseProxy,
  encodeEnvelope,
  MAX_PROXY_URL_LENGTH,
} from './proxy-transport';
import { LapisError } from './fetch-transport';
import { GET, POST, ALLOWED_LAPIS_BASE_URLS, isAllowedBaseUrl } from '../../../api/lapis';
import { PATHOGENS, getPathogen } from '../registry';
import type { LapisRequest } from './transport';
import { parseLibrary } from '../../data/assays/schema';
import rawLibrary from '../../data/assays/library.json';
import { loadReference } from '../../data/references';
import { findBindingSites } from '../binding';
import { buildWindowSpec, mismatchWithCoverageQuery, fullCoverageQuery } from '../query';
import { scopeToFilters } from '../scope';
import { MAX_OLIGO_LENGTH } from '../oligo-input';

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

/**
 * The browser->proxy hop is a GET and the envelope rides in the query string,
 * so every parameter arrives as a *string*: `body` is JSON text, not an object.
 * These helpers take the wire form on purpose -- a helper that accepted an
 * object and stringified it would hide the parsing the handler actually does,
 * which is where the rejection tests bite.
 */
const proxyUrl = (params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  return `https://assay-drift.test/api/lapis${query ? `?${query}` : ''}`;
};

const get = (params: Record<string, string | undefined>, fetchImpl?: ReturnType<typeof upstreamOk>) =>
  GET(
    new Request(proxyUrl(params)),
    fetchImpl ? { fetchImpl: fetchImpl as unknown as typeof fetch } : {},
  );

const valid = {
  baseUrl: 'https://lapis.cov-spectrum.org/open/v2',
  endpoint: 'aggregated',
  body: '{"country":"X"}',
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
    'accepts the configured %s instance and forwards it upstream as a POST',
    async (_id, baseUrl) => {
      const fetchImpl = upstreamOk();
      const res = await get({ ...valid, baseUrl }, fetchImpl);

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
    const res = await get({ ...valid, baseUrl: 'https://evil.test/open/v2' }, fetchImpl);
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a look-alike host whose name merely starts with an allowed one', async () => {
    // The whole reason the check parses the URL instead of calling `startsWith`
    // on the raw string. This host is under the attacker's control, and
    // 'https://lapis.cov-spectrum.org.evil.test/open/v2'.startsWith(
    // 'https://lapis.cov-spectrum.org') is true.
    const fetchImpl = upstreamOk();
    const res = await get(
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
    const res = await get(
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
    const res = await get(
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
    ['missing', undefined],
    ['a number', '42'],
  ])('rejects an endpoint that is %s', async (_label, endpoint) => {
    const fetchImpl = upstreamOk();
    const res = await get({ ...valid, endpoint }, fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Everything in a query string is a string, so these are the JSON *texts* a
  // caller could put in `body`. Each one parses (or fails to parse) into
  // something that is not a JSON object of filters.
  it.each([
    ['missing', undefined],
    ['form-encoded rather than JSON', 'country=X'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON number', '3'],
    ['a JSON string', '"country=X"'],
  ])('rejects a body that is %s rather than forwarding undefined', async (_label, body) => {
    const fetchImpl = upstreamOk();
    const res = await get({ ...valid, body }, fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a body parameter that is not JSON at all', async () => {
    const fetchImpl = upstreamOk();
    const res = await get({ ...valid, body: '{not json' }, fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a baseUrl that is missing or not a URL', async () => {
    const fetchImpl = upstreamOk();
    expect((await get({ endpoint: 'aggregated', body: '{}' }, fetchImpl)).status).toBe(403);
    expect((await get({ ...valid, baseUrl: '12' }, fetchImpl)).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a request that carries no query string at all', async () => {
    // The GET form makes an empty request reachable in a way the POST form was
    // not: no envelope means no baseUrl, and the allow-list refuses first.
    const fetchImpl = upstreamOk();
    const res = await get({}, fetchImpl);
    expect(res.status).toBe(403);
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('fault');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caches a successful proxied response with the headers the plan specifies', async () => {
    const res = await get(valid, upstreamOk());
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
    const res = await get(valid, fetchImpl as unknown as ReturnType<typeof upstreamOk>);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // Upstream's fault, not ours: the caller must be able to tell them apart.
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('upstream');
    expect(await res.text()).toBe(errorBody);
  });

  it('marks its own faults distinctly from upstream ones', async () => {
    const rejected = await get({ ...valid, baseUrl: 'https://evil.test/open/v2' }, upstreamOk());
    expect(rejected.headers.get('X-Assay-Drift-Proxy')).toBe('fault');
    expect(rejected.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 502 with a proxy fault when the upstream cannot be reached', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('getaddrinfo ENOTFOUND')));
    const res = await get(valid, fetchImpl as unknown as ReturnType<typeof upstreamOk>);
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
  it('GETs the whole request envelope as a query string on /api/lapis', async () => {
    // A GET and not a POST because Vercel's CDN does not cache POST: two
    // identical POSTs to the deployed function both answered
    // `X-Vercel-Cache: MISS` with `s-maxage=21600` present on the response.
    // The envelope is unchanged, it just travels in the URL now.
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await t.query<{ count: number }>(req);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect('body' in init).toBe(false);

    const parsed = new URL(url, 'https://assay-drift.test');
    expect(parsed.pathname).toBe('/api/lapis');
    expect(parsed.searchParams.get('baseUrl')).toBe('https://lapis.genspectrum.org/h3n2');
    expect(parsed.searchParams.get('endpoint')).toBe('nucleotideMutations');
    expect(JSON.parse(parsed.searchParams.get('body') as string)).toEqual({ minProportion: 0 });

    expect(res.data).toEqual([{ count: 7 }]);
    expect(res.dataVersion).toBe('123');
    expect(res.requestId).toBe('rid-1');
  });

  it('encodes the envelope so that key order cannot change the URL', async () => {
    // The URL *is* the CDN cache key. If key order leaked into it, two
    // identical analyses would land on two entries and neither would ever hit;
    // if two different analyses collided, one would be served the other's
    // numbers. Both matter, so both are asserted.
    const a = encodeEnvelope('/api/lapis', {
      baseUrl: 'https://lapis.genspectrum.org/h3n2',
      endpoint: 'aggregated',
      body: { country: ['CH'], advancedQuery: 'x', dateFrom: '2025-01-01' },
    });
    const b = encodeEnvelope('/api/lapis', {
      baseUrl: 'https://lapis.genspectrum.org/h3n2',
      endpoint: 'aggregated',
      body: { dateFrom: '2025-01-01', advancedQuery: 'x', country: ['CH'] },
    });
    expect(a).toBe(b);

    // Nested objects too, not just the top level.
    expect(
      encodeEnvelope('/p', { baseUrl: 'u', endpoint: 'aggregated', body: { n: { x: 1, y: 2 } } }),
    ).toBe(encodeEnvelope('/p', { baseUrl: 'u', endpoint: 'aggregated', body: { n: { y: 2, x: 1 } } }));

    // Arrays are ordered data, not a set: a different order is a different query.
    expect(
      encodeEnvelope('/p', { baseUrl: 'u', endpoint: 'aggregated', body: { c: ['A', 'B'] } }),
    ).not.toBe(encodeEnvelope('/p', { baseUrl: 'u', endpoint: 'aggregated', body: { c: ['B', 'A'] } }));

    // And the three parts of the envelope are all in the key.
    const base = { baseUrl: 'https://lapis.genspectrum.org/h3n2', endpoint: 'aggregated' } as const;
    expect(encodeEnvelope('/p', { ...base, body: { a: 1 } })).not.toBe(
      encodeEnvelope('/p', { ...base, body: { a: 2 } }),
    );
    expect(encodeEnvelope('/p', { ...base, body: { a: 1 } })).not.toBe(
      encodeEnvelope('/p', { ...base, endpoint: 'nucleotideMutations', body: { a: 1 } }),
    );
    expect(encodeEnvelope('/p', { ...base, body: { a: 1 } })).not.toBe(
      encodeEnvelope('/p', { ...base, baseUrl: 'https://lapis.genspectrum.org/h5n1', body: { a: 1 } }),
    );
  });

  it('produces a URL the handler decodes back into the same upstream request', async () => {
    // Encoder and decoder are written apart and deployed apart; this is the one
    // test that runs them against each other.
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await t.query({
      baseUrl: 'https://lapis.cov-spectrum.org/open/v2',
      endpoint: 'aggregated',
      body: { country: ["Côte d'Ivoire"], advancedQuery: '(21765- | 21766-) & !(21765N)' },
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

    const upstream = upstreamOk();
    const res = await GET(new Request(new URL(url, 'https://assay-drift.test').href), {
      fetchImpl: upstream as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    const [target, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe('https://lapis.cov-spectrum.org/open/v2/sample/aggregated');
    expect(JSON.parse(init.body as string)).toEqual({
      country: ["Côte d'Ivoire"],
      advancedQuery: '(21765- | 21766-) & !(21765N)',
    });
  });

  it('keeps the longest real envelope in the bundled library well inside URL limits', () => {
    // The envelope now travels in the URL, so its length stopped being free.
    // The worst case is the mismatch query for the longest oligo in the
    // library: one term per position, on a segmented instance where every term
    // carries a `segN:` qualifier. Built here from the real library, the real
    // bundled reference and the real query builders -- not from an estimate.
    const library = parseLibrary(rawLibrary);
    let longest = { chars: 0, what: 'nothing' };

    for (const assay of library.assays) {
      const cfg = getPathogen(assay.pathogenId);
      const reference = loadReference(assay.pathogenId);
      const filters = scopeToFilters(
        {
          pathogenId: assay.pathogenId,
          dateFrom: '2025-01-01',
          dateTo: '2025-12-31',
          // A deliberately heavy scope: the widest filter set the UI can build.
          countries: ['United Kingdom', 'United States', 'Switzerland', 'South Africa'],
          lineages: ['XBB.1.5', 'JN.1', 'BA.2.86'],
        },
        cfg,
      );
      for (const oligo of assay.oligos) {
        const site = findBindingSites(oligo.sequence, reference, { maxMismatches: 1 })[0];
        if (!site) continue;
        const window = buildWindowSpec(site, oligo.sequence, reference, oligo.role, {
          segmented: cfg.segmented,
        });
        for (const advancedQuery of [mismatchWithCoverageQuery(window), fullCoverageQuery(window)]) {
          const url = encodeEnvelope('/api/lapis', {
            baseUrl: cfg.lapisBaseUrl,
            endpoint: 'aggregated',
            body: { ...filters, fields: [cfg.dateField], advancedQuery },
          });
          if (url.length > longest.chars) {
            longest = { chars: url.length, what: `${assay.id}/${oligo.name}` };
          }
        }
      }
    }

    // Printed rather than only asserted: the number is the evidence, and a
    // future oligo that doubles it should be visible in the run, not just red.
    console.log(`longest proxy URL: ${longest.chars} characters (${longest.what})`);
    expect(longest.chars).toBeGreaterThan(0);
    // What matters is not an arbitrary ceiling but which path the request takes:
    // every bundled assay must fit in a URL, so every bundled assay is cached.
    expect(longest.chars).toBeLessThanOrEqual(MAX_PROXY_URL_LENGTH);
  });

  it('falls back to an uncached POST when the envelope will not fit in a URL', async () => {
    // A user may paste an oligo up to MAX_OLIGO_LENGTH. At 60 nt on a segmented
    // genome with a wide filter set the envelope measures ~2,480 characters,
    // past the conservative URL floor -- and no assay in the bundled library
    // reaches that, so the test above cannot catch it. The sequence is sliced
    // from the bundled reference, never typed (Global Constraint 2).
    const cfg = getPathogen('h5n1');
    const reference = loadReference('h5n1');
    const seg = reference.segments.find((s) => s.name === 'seg4');
    if (seg === undefined) throw new Error('seg4 missing from the bundled h5n1 reference');
    const oligo = seg.sequence.slice(1200, 1200 + MAX_OLIGO_LENGTH);
    expect(oligo).toHaveLength(MAX_OLIGO_LENGTH);

    const site = findBindingSites(oligo, reference)[0];
    if (site === undefined) throw new Error('the sliced oligo does not bind its own reference');
    const window = buildWindowSpec(site, oligo, reference, 'forward', { segmented: true });
    const body = {
      ...scopeToFilters(
        {
          pathogenId: 'h5n1',
          dateFrom: '2025-01-01',
          dateTo: '2025-12-31',
          countries: [
            'United Kingdom',
            'United States',
            'Switzerland',
            'South Africa',
            'Democratic Republic of the Congo',
            "Côte d'Ivoire",
          ],
          lineages: ['2.3.4.4b', '2.3.2.1c', '2.3.4.4e'],
        },
        cfg,
      ),
      advancedQuery: mismatchWithCoverageQuery(window),
    };

    // The premise of the test, asserted rather than assumed: if a future change
    // shortens the query form below the threshold, this stops testing anything
    // and should fail loudly rather than pass vacuously.
    const wouldBe = encodeEnvelope('/api/lapis', {
      baseUrl: cfg.lapisBaseUrl,
      endpoint: 'aggregated',
      body,
    });
    expect(wouldBe.length).toBeGreaterThan(MAX_PROXY_URL_LENGTH);

    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await t.query({ baseUrl: cfg.lapisBaseUrl, endpoint: 'aggregated', body });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/lapis');
    expect(url).not.toContain('?');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      baseUrl: cfg.lapisBaseUrl,
      endpoint: 'aggregated',
      body,
    });
  });

  it('serves the POST fallback but never claims it is cached', async () => {
    // The measured fact this route was reshaped around: Vercel's CDN does not
    // cache POST. A s-maxage header on this response would be inert, and a
    // header claiming a cache that does not exist is worse than none, because
    // the next person to read it believes it.
    const upstream = upstreamOk();
    const res = await POST(
      new Request('https://assay-drift.test/api/lapis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://lapis.cov-spectrum.org/open/v2',
          endpoint: 'aggregated',
          body: { country: 'X' },
        }),
      }),
      { fetchImpl: upstream as unknown as typeof fetch },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('upstream');
  });

  it('applies the allow-list to the POST fallback too', async () => {
    // The fallback is a second door into the same function. A door that skipped
    // the allow-list would be an open proxy regardless of what the other one does.
    const fetchImpl = upstreamOk();
    const res = await POST(
      new Request('https://assay-drift.test/api/lapis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'https://lapis.cov-spectrum.org.evil.test/open/v2',
          endpoint: 'aggregated',
          body: {},
        }),
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(res.status).toBe(403);
    expect(res.headers.get('X-Assay-Drift-Proxy')).toBe('fault');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts a custom path', async () => {
    const fetchImpl = proxied(okBody);
    const t = createProxyTransport({
      path: '/edge/lapis',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await t.query(req);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('/edge/lapis?')).toBe(true);
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
