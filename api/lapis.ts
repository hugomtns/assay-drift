import type { LapisEndpoint } from '../src/core/lapis/transport';

/**
 * A caching proxy in front of the three configured LAPIS instances.
 *
 * Deployed as a Vercel Function (the `/api` directory convention: every file
 * under it becomes a function regardless of the framework preset, so no
 * `vercel.json` is needed to register it). It exists so that the exact-coverage
 * fan-out added in Task 6.3 -- up to 60 `aggregated` queries per oligo -- hits a
 * shared edge cache instead of hitting public infrastructure this project does
 * not own, once per browser, forever.
 *
 * It uses the Web handler signature (`Request` in, `Response` out) rather than
 * the Node `(req, res)` one, so it needs no `@vercel/node` types and therefore
 * adds no dependency of any kind. Everything it touches -- `Request`,
 * `Response`, `URL`, `fetch` -- is a platform global.
 *
 * ## The allow-list is the security boundary
 *
 * Without it this is an open proxy: anyone who can reach the deployed function
 * could make our server POST an arbitrary body to an arbitrary host, with our
 * IP and our egress. Three rules follow, and each has a test:
 *
 * 1. The list is **kept equal to `PATHOGENS` by a test**, not by an import --
 *    see `ALLOWED_LAPIS_BASE_URLS` below for why the import could not survive
 *    deployment. Adding a pathogen to the registry without adding it here fails
 *    the suite, so the proxy cannot silently refuse a configured instance, and
 *    a typo in either copy cannot open a hole.
 * 2. Matching is on **parsed `URL` origin equality plus a segment-boundary path
 *    prefix**, never a substring. `startsWith` on the raw string would accept
 *    `https://lapis.cov-spectrum.org.evil.test/open/v2`.
 * 3. `endpoint` must be one of the three known `LapisEndpoint` values. A free
 *    string there is a path-traversal vector into the upstream host.
 *
 * ## What is not verified
 *
 * The unit tests exercise this as a plain function against a mocked `Request`
 * and a mocked `fetch`. They cannot see the deployment boundary, and the first
 * deploy proved it: everything passed and every request 500'd on a missing
 * module. Whether a POST response is edge-cacheable at all is measured against
 * the deployed function, not asserted here -- see `docs/decisions.md`.
 */

/**
 * Typed as `LapisEndpoint[]` rather than inferred, so a typo here is a compile
 * error rather than an endpoint the proxy quietly refuses. (The import is
 * type-only and erases, so it adds nothing to resolve at build time.)
 */
const ALLOWED_ENDPOINTS: readonly LapisEndpoint[] = [
  'aggregated',
  'nucleotideMutations',
  'nucleotideInsertions',
];

/**
 * The three configured LAPIS instances.
 *
 * These are written out rather than derived from `PATHOGENS`, and that is a
 * deployment constraint rather than a preference. Vercel compiles this file to
 * `/var/task/api/lapis.js` on its own; it does **not** pull `src/` along, so a
 * value import of `../src/core/registry` resolves at build time, typechecks,
 * passes every test, and then throws `ERR_MODULE_NOT_FOUND` on the first real
 * request. That is exactly what shipping it did. The type-only import above
 * survives because tsc erases it.
 *
 * The single source of truth is preserved at **test** time instead of import
 * time: `proxy-transport.test.ts` asserts this list equals
 * `Object.values(PATHOGENS).map(p => p.lapisBaseUrl)`, so adding a pathogen to
 * the registry without adding it here fails the suite. That test also retypes
 * the three strings a second time, so the check cannot pass by both sides
 * drifting together.
 */
export const ALLOWED_LAPIS_BASE_URLS: readonly string[] = Object.freeze([
  'https://lapis.cov-spectrum.org/open/v2',
  'https://lapis.genspectrum.org/h5n1',
  'https://lapis.genspectrum.org/h3n2',
]);

/** `{ origin, path }` with a normalised, slash-free-at-the-end path. */
interface Allowed {
  origin: string;
  path: string;
}

const stripTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

const ALLOWED: readonly Allowed[] = Object.freeze(
  ALLOWED_LAPIS_BASE_URLS.map((raw) => {
    const url = new URL(raw);
    return { origin: url.origin, path: stripTrailingSlash(url.pathname) };
  }),
);

/**
 * Is `candidate` one of the configured LAPIS instances?
 *
 * Rejects, in order: anything `URL` cannot parse; any scheme other than
 * `https:`; embedded credentials, a query string or a fragment (all of which
 * are ways to smuggle something past a naive comparison and none of which a
 * legitimate base URL carries); a different origin; and a path that is not the
 * allowed path or a descendant of it *on a segment boundary*.
 *
 * `https://lapis.genspectrum.org` hosts both influenza instances, so the origin
 * alone would let `/h5n1` stand in for `/h3n2` -- harmless here, but the same
 * looseness would let `/h5n1-not-really` through, which is not.
 */
export function isAllowedBaseUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.search !== '' || url.hash !== '') return false;

  const path = stripTrailingSlash(url.pathname);
  return ALLOWED.some(
    (a) => a.origin === url.origin && (path === a.path || path.startsWith(`${a.path}/`)),
  );
}

const isEndpoint = (value: unknown): value is LapisEndpoint =>
  typeof value === 'string' && (ALLOWED_ENDPOINTS as readonly string[]).includes(value);

/** A JSON object -- not null, not an array, not a primitive. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Verbatim from the plan. Six hours fresh at the edge, a day of
 * stale-while-revalidate behind it. Applied to a 2xx only -- see `fault` and
 * the upstream-error branch, both of which send `no-store`, because caching an
 * error for six hours outlives the mistake that caused it.
 */
const CACHE_CONTROL = 'public, s-maxage=21600, stale-while-revalidate=86400';

/**
 * `upstream` means LAPIS answered and this is its answer, whatever the status.
 * `fault` means the failure is ours -- a rejected request, or an upstream we
 * could not reach at all. The client transport turns the second into a
 * `ProxyError`, so one is distinguishable from the other without guessing.
 */
const SOURCE_HEADER = 'X-Assay-Drift-Proxy';

/**
 * An error in the shape LAPIS itself uses, so the client can parse one path.
 *
 * `detail` is written here, never echoed from the request: repeating an
 * attacker's host back into a response body (and into our logs) is how a proxy
 * becomes a reflection gadget.
 */
function fault(status: number, title: string, detail: string): Response {
  return new Response(JSON.stringify({ error: { status, title, detail } }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      [SOURCE_HEADER]: 'fault',
    },
  });
}

interface Deps {
  fetchImpl?: typeof fetch;
}

/**
 * Vercel dispatches this for `POST /api/lapis`.
 *
 * The second parameter is for tests only. Vercel passes at most a context
 * object there, which has no `fetchImpl`, so the global `fetch` is used in
 * production either way.
 */
export async function POST(request: Request, deps: Deps = {}): Promise<Response> {
  const doFetch = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fault(400, 'Bad Request', 'request body is not valid JSON');
  }

  if (!isPlainObject(payload)) {
    return fault(400, 'Bad Request', 'request body must be a JSON object');
  }

  const { baseUrl, endpoint, body } = payload;

  if (!isAllowedBaseUrl(baseUrl)) {
    return fault(
      403,
      'Forbidden',
      'baseUrl is not one of the LAPIS instances this proxy is configured for',
    );
  }
  if (!isEndpoint(endpoint)) {
    return fault(
      400,
      'Bad Request',
      `endpoint must be one of: ${ALLOWED_ENDPOINTS.join(', ')}`,
    );
  }
  if (!isPlainObject(body)) {
    return fault(400, 'Bad Request', 'body must be a JSON object of LAPIS filters');
  }

  // `baseUrl` passed `isAllowedBaseUrl`, so it is a parseable https URL on the
  // allow-list, and `endpoint` is one of three literals. Neither can traverse.
  const target = `${stripTrailingSlash(new URL(baseUrl).href)}/sample/${endpoint}`;

  let upstream: Response;
  try {
    upstream = await doFetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch {
    // Deliberately not the thrown message: it names hosts and resolver state,
    // and it would arrive at the client looking like a LAPIS error.
    return fault(502, 'Bad Gateway', 'the upstream LAPIS instance could not be reached');
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': upstream.ok ? CACHE_CONTROL : 'no-store',
      [SOURCE_HEADER]: 'upstream',
    },
  });
}
