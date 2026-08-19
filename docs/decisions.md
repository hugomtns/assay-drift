# Decisions

## 2026-08-19 — Workflow orchestration and UI view models stay colocated

`App.tsx` composes the shell and selects the active screen. Permalink restoration/publishing,
the abortable analysis runner, and the bundled worked-example action live under `src/app/` so
their lifecycle invariants are tested without turning the root component into an orchestration
layer. The runner retains one controller at a time: superseded or unmounted runs cannot update
state or publish a permalink.

The scope, binding, and per-position chart derivations live beside their respective components.
They are pure helpers with focused tests; they are deliberately not a cross-domain “view model”
library. This keeps rendering declarative while preserving the existing store and network
boundaries.

## 2026-08-19 — UI verification has two deterministic layers

Storybook records reusable UI states without live LAPIS requests. Playwright intercepts LAPIS at
the browser boundary using committed fixtures, covering flows and layout behaviour jsdom cannot
observe. Both are local release checks; the CI workflow currently retains its faster core gate.

## 2026-08-01 — Runtime dependencies

- `react`, `react-dom` — UI.
- `zustand` — query state; chosen over Context to keep re-renders scoped to the panels that
  change.

## 2026-08-01 — Reference genomes come from LAPIS, not NCBI

LAPIS reports mutation coordinates against its own reference. Sourcing the reference
anywhere else risks a silent coordinate offset in every published number.

## 2026-08-02 — ESLint instead of oxlint for `npm run lint`

The `npm create vite@latest -- --template react-ts` scaffold used during Task 0.1 ships
`oxlint` by default instead of an `eslint.config.js`. Task 0.1's interface contract requires
`npm run lint` to be one of the four standing verification commands, and the plan's tooling
choice is ESLint (flat config) + `eslint-config-prettier`, so `oxlint` was removed and
`eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
`@eslint/js`, and `globals` were added as dev dependencies instead.

## 2026-08-02 — Deployed to Vercel

Production URL: https://assay-drift.vercel.app (project `assay-drift`, team
`hmmartins-gmailcoms-projects`). Deployed manually by the human via the Vercel dashboard
after the Vercel MCP integration returned a 403 (no project-creation permission on the
connected team) when an agent attempted it directly.

## 2026-08-02 — `tsconfig.node.json` uses `esnext`/`bundler`, not `nodenext`

Widening `tsconfig.node.json`'s `include` to cover `scripts/**` and `tests/**` (so those
directories get real type-checking, previously they got none) made `tsc -b` reach into
already-committed `src/` files via relative imports and, under `nodenext`'s stricter
module-resolution rules, flag them for missing explicit `.js` extensions on specifiers that
are correct under `tsconfig.app.json`'s `bundler` resolution. Switching `tsconfig.node.json`
to `esnext`/`bundler` (matching `tsconfig.app.json`) fixes this without editing any `src/`
file; it only changes which import-specifier extension conventions `tsc` accepts, not
whether it validates them — strictness flags are unchanged and type errors are still caught.

## 2026-08-18 — Bundle size measured against the budget, and what the number excludes

Budget: **under 150 kB gzipped, excluding the reference genome JSON.** The shipped bundle is
one JS chunk plus one CSS file (`npm run build`, 2026-08-18):

| | raw | gzipped |
|---|---|---|
| `dist/assets/index-*.js` | 338.21 kB | 105.93 kB |
| `dist/assets/index-*.css` | 15.83 kB | 4.21 kB |
| **total shipped** | **354.04 kB** | **110.14 kB** |
| less the reference genomes | | −18.94 kB |
| **against the budget** | | **91.22 kB** |

**The reference genomes are in the main chunk, not lazily split.** `src/data/references/index.ts`
imports all three JSON files statically, so `loadReference` can stay synchronous, and Vite emits
a single chunk. The 18.94 kB figure was established by taking the built JS, deleting the 17
segment sequences (57,067 nt: SARS-CoV-2 `main` plus eight segments each for H5N1 and H3N2) by
exact string match — every one was found in the chunk — and gzipping before and after at the
same level Vite's reporter uses. gzip is not additive, so this is the marginal cost of those
strings in this bundle rather than the size of the files on their own; the method reproduces
Vite's own reported figure to within 0.05 kB.

Two things the plan assumed are wrong: the reference JSON is **not** lazily imported per
pathogen, and it costs **18.94 kB gzipped for all three pathogens together**, not ~40 kB each.
Both numbers move in our favour, and either way — 110.14 kB with the genomes or 91.22 kB
without — the build is inside the budget.

The plan's remedy if over budget ("almost certainly a charting or date library — remove it")
has nothing to act on: `dependencies` is `react`, `react-dom` and `zustand`. Both charts are
hand-written SVG (Task 4.5) and there is no date library. Nothing was removed and nothing
needs to be.

## 2026-08-18 — Ship the Vercel caching proxy (Task 6.4)

**Decided by the repo owner, asked directly on 2026-08-18: ship it.** Task 6.4 was written as a
conditional ("ship only if Phases 4–6 exposed a real need"). This entry records what was decided
and on what evidence, not a case still being weighed.

The evidence:

- Nothing in Phases 4–6 hit a rate limit, and `withCache` already de-duplicates repeat queries
  within a session. On its own that pointed at *defer*.
- **Task 6.3 changed the load profile.** It added an opt-in exact-coverage fan-out of up to 60
  `aggregated` queries per oligo (`MAX_EXACT_COVERAGE_POSITIONS = 60`), aimed at public LAPIS
  instances the project does not own and does not pay for. A three-oligo assay with the toggle
  used on each is up to 180 extra requests from one browser, and the per-session cache does
  nothing for the next visitor asking the same question. That is the new load the proxy exists
  to absorb, and it is the reason the balance tipped.
- The `LapisTransport` interface has existed since Phase 1 precisely so this would be a drop-in.
  It is: `createProxyTransport()` replaces `createFetchTransport()` in one `useMemo` in
  `App.tsx` and no analysis code changes.

**No new runtime dependency.** `dependencies` is still `react`, `react-dom`, `zustand`.
`api/lapis.ts` uses only the Web `Request`/`Response`/`URL`/`fetch` globals that Vercel's
Node.js runtime already provides, so no `@vercel/node` package was added — not even as a dev
dependency for its types.

**No `vercel.json`.** Vercel's zero-configuration function detection turns every file under
`/api` into a function regardless of the framework preset, and the Vite preset already supplies
the static build (`npm run build` → `dist`). Adding a config file to restate defaults would be
one more thing to keep in sync. See the caveat below: this has not been verified against a real
deployment.

**The allow-list is the security boundary**, and it is derived from `PATHOGENS` in
`src/core/registry.ts` rather than retyped, so adding a pathogen cannot leave the proxy
refusing it and a typo cannot open a hole. Matching is on parsed-`URL` **origin equality plus a
segment-boundary path prefix**, never a substring: `startsWith` on the raw string would accept
`https://lapis.cov-spectrum.org.evil.test/open/v2`. There is a test for exactly that host.

**`Cache-Control` is applied to successful responses only.** The plan gives the header verbatim
(`public, s-maxage=21600, stale-while-revalidate=86400`) and that is what a 2xx carries. A
non-2xx — an upstream 400, or a fault in the proxy itself — carries `no-store`, because caching
an error at the edge for six hours would outlast the mistake that caused it. This is a
deliberate addition to the plan's text, not a departure from it.

### 2026-08-18 — RESOLVED: a POST is not edge-cacheable. The proxy is a GET.

The entry above shipped with an open risk: that Vercel's CDN might not cache POST, making
`s-maxage` inert and the proxy a hop that bought nothing. **It was measured against the deployed
function and the risk was real.** Two identical POSTs to
`https://assay-drift.vercel.app/api/lapis`:

```
Cache-Control: public, s-maxage=21600, stale-while-revalidate=86400
X-Vercel-Cache: MISS      <- first request
X-Vercel-Cache: MISS      <- second, byte-identical request
```

A cache would have answered HIT. Vercel's CDN does not cache POST, so the header was decoration
and every request reached LAPIS.

**Remedy taken: option 1 — the envelope moved into the query string and the browser→proxy hop
became a `GET`.** The upstream hop to LAPIS is still a POST; only the client-facing method
changed. Option 2 (`getCache()` from `@vercel/functions`) was not taken: it is a new runtime
dependency, and it was not needed.

Two consequences worth recording, because neither was obvious:

**The URL is now the cache key**, so encoding has to be canonical. `encodeEnvelope` serialises
the body with sorted object keys — `{country, dateFrom}` and `{dateFrom, country}` must produce
one URL, or one query becomes two cache entries and neither ever hits, silently. Array order is
*preserved*, because a list of countries is ordered data as far as LAPIS is concerned and
sorting it would collapse distinct queries onto one key — the same mistake in the dangerous
direction.

**A URL has a length limit, and the worst case exceeds it.** Measured, not estimated:

| case | encoded URL |
|---|---|
| longest oligo in the bundled library (`who-h5-ha-1201-1387/H5-1387R`) | 1,421 chars |
| a 60 nt oligo (`MAX_OLIGO_LENGTH`) on a segmented genome, 6 countries + 3 clades | **2,482 chars** |

2,482 is past the 2,083-character floor this project already cites in `permalink.ts`. Nothing in
the bundled library reaches it, so no library-driven test would have caught it — a user pasting
a long influenza primer would have. **So the transport sends a GET when the encoded envelope is
within `MAX_PROXY_URL_LENGTH` (2,000) and falls back to an uncached POST when it is not**, and
the POST branch sends `no-store` rather than an `s-maxage` that would be ignored. Cache when the
request fits; stay correct when it does not. The reverse trade would let a rare long oligo
return numbers for a truncated window.

The POST fallback is a second door into the same function, so it runs the same allow-list —
asserted by its own test, because a door that skipped it would be an open proxy regardless of
what the other one does.

**Verified against the real deployment**, unlike the entry above: `GET /api/lapis` returns 200
with `X-Assay-Drift-Proxy: upstream`, and the body carried `count: 71142` — the Part I.6 G1
`nScope` figure, fetched through the deployed function.

**One inference from the entry above turned out to be false, and it broke production.** The
claim was that Vercel's builder would resolve the extensionless `../src/core/registry` import
from inside `api/`. It does not: Vercel compiles `api/lapis.ts` alone and does not pull `src/`
along, so every request returned `500 FUNCTION_INVOCATION_FAILED` with
`ERR_MODULE_NOT_FOUND: /var/task/src/core/registry`. It typechecked, it passed 625 tests, and it
failed on the first real request — unit tests cannot see the deployment boundary. The allow-list
is now written out in `api/lapis.ts` with a test asserting it equals `PATHOGENS`, so the single
source of truth is enforced at test time instead of import time. Type-only imports still cross
the boundary safely, because `tsc` erases them.
