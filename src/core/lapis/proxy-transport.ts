import { LapisError } from './fetch-transport';
import { utf8ByteLength } from './size-guard';
import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

/**
 * The client half of the caching proxy in `api/lapis.ts`.
 *
 * A drop-in for `createFetchTransport`: same `LapisTransport` interface, same
 * `LapisError` on failure, same `responseBytes` on success, same retry
 * behaviour. The only difference is the URL it POSTs to and the envelope it
 * wraps the request in, because the destination has to travel in the body --
 * the proxy checks it against an allow-list before forwarding.
 */

/**
 * A failure of the proxy itself, as opposed to a failure LAPIS reported
 * through it.
 *
 * It extends `LapisError`, so every `instanceof LapisError` check in
 * `ErrorState` and the retry logic keeps working unchanged; it is a distinct
 * class so that a caller who cares can tell "our function is broken" from
 * "LAPIS said no". One is our fault and one is not, and they want different
 * responses: an allow-list rejection or a 500 out of the function is a bug
 * report, an upstream 400 is a query the user needs to change.
 *
 * The distinction rides on the `X-Assay-Drift-Proxy` header the handler sets on
 * every response it produces. A body field would not survive a platform-level
 * 502, which never carries a LAPIS envelope at all.
 */
export class ProxyError extends LapisError {
  constructor(status: number, detail: string, requestId: string | null) {
    super(status, detail, requestId);
    this.name = 'ProxyError';
  }
}

interface ErrorBody {
  error?: { status?: number; title?: string; detail?: string };
  info?: { requestId?: string };
}

interface SuccessBody<T> {
  data: T[];
  info?: { dataVersion?: string; requestId?: string };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Where the Vercel Function is mounted. `api/lapis.ts` -> `/api/lapis`. */
export const DEFAULT_PROXY_PATH = '/api/lapis';

export function createProxyTransport(
  opts: {
    path?: string;
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): LapisTransport {
  const path = opts.path ?? DEFAULT_PROXY_PATH;
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      let attempt = 0;

      for (;;) {
        const res = await doFetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            baseUrl: req.baseUrl,
            endpoint: req.endpoint,
            body: req.body,
          }),
          // Global Constraint 10. Spread rather than set, because
          // `exactOptionalPropertyTypes` distinguishes absent from undefined.
          ...(req.signal ? { signal: req.signal } : {}),
        });

        if (res.ok) {
          // `res.text()` then `JSON.parse`, exactly as `createFetchTransport`
          // does, and for the same reason: this is the last point at which the
          // size of the body is knowable, and Task 6.3's `guardResponseSize`
          // reads it. A proxy that returned `undefined` here would switch the
          // size warning off for every user with no visible symptom, because
          // `undefined` means *unmeasured* and the guard then says nothing.
          //
          // A response served from Vercel's edge cache is still a real body
          // over the wire to this client, so the measurement stays honest.
          const text = await res.text();
          const body = JSON.parse(text) as SuccessBody<T>;
          return {
            data: body.data,
            dataVersion: body.info?.dataVersion ?? 'unknown',
            requestId: body.info?.requestId ?? 'unknown',
            responseBytes: utf8ByteLength(text),
          };
        }

        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= maxRetries) {
          // `upstream` is the only value that means "LAPIS answered". `fault`
          // is the handler admitting a failure of its own, and *absence* means
          // the response never reached the handler at all -- a platform 502, a
          // 404 because the function is not deployed, an HTML error page from
          // some intermediary. All three of those are ours, so anything that
          // is not explicitly stamped `upstream` is a `ProxyError`.
          const ours = res.headers.get('X-Assay-Drift-Proxy') !== 'upstream';
          let detail = `HTTP ${res.status}`;
          let requestId: string | null = null;
          try {
            const parsed = (await res.json()) as ErrorBody;
            if (parsed.error?.detail) detail = parsed.error.detail;
            requestId = parsed.info?.requestId ?? null;
          } catch {
            // A platform 502 is an HTML page, not a LAPIS envelope. Keep the
            // status-only detail rather than inventing one.
          }
          throw ours
            ? new ProxyError(res.status, detail, requestId)
            : new LapisError(res.status, detail, requestId);
        }

        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 500 * 2 ** attempt;
        await sleep(waitMs);
        attempt += 1;
      }
    },
  };
}

/**
 * The subset of `import.meta.env` this decision reads.
 *
 * Taken as an argument rather than read from `import.meta` so the rule is a
 * pure function with a truth table, testable without rebuilding.
 */
export interface ProxyEnv {
  PROD: boolean;
  VITE_LAPIS_PROXY?: string | undefined;
}

const OFF = new Set(['0', 'false', 'off', 'no']);
const ON = new Set(['1', 'true', 'on', 'yes']);

/**
 * Should this build talk to LAPIS through the proxy, or directly?
 *
 * **Default: whatever the build mode says.** A production build is what Vercel
 * serves, and that is where the function exists; `npm run dev` has no Vercel
 * functions running, so a dev server that proxied would 404 on every query.
 * Nobody has to configure anything for either of those to be right.
 *
 * `VITE_LAPIS_PROXY` overrides it in both directions, which covers the two
 * cases the default gets wrong: `npm run preview` (or any static host that is
 * not Vercel) serves a production build with no function behind it and needs
 * `VITE_LAPIS_PROXY=0`; and `vercel dev` runs the function locally, where
 * `VITE_LAPIS_PROXY=1` exercises it.
 *
 * An unrecognised value is treated as "on", on the reasoning that someone who
 * set the variable at all meant to turn it on.
 */
export function shouldUseProxy(env: ProxyEnv): boolean {
  const raw = env.VITE_LAPIS_PROXY?.trim().toLowerCase();
  if (raw === undefined || raw === '') return env.PROD;
  if (OFF.has(raw)) return false;
  if (ON.has(raw)) return true;
  return true;
}
