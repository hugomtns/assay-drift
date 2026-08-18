# Decisions

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
