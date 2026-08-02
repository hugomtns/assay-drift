# Assay Drift Watch — v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task is strict TDD: write the failing test, run it and see it fail, implement, run it and see it pass, commit. **Paste the actual command output as evidence before marking a step done.** Never claim a test passes without having run it.

**Goal:** A no-install, no-account web tool that answers "what fraction of the genomes circulating this month carry a mismatch under my primer, and is that fraction rising?" for three pathogens, with the sampling caveats made structurally impossible to ignore.

**Architecture:** A static single-page app. Oligo→coordinate resolution runs client-side against reference genomes fetched from the same LAPIS instance that serves the mutation data (so coordinate systems cannot disagree). Mutation statistics come from aggregate LAPIS queries only — no FASTA is ever downloaded. Every network call goes through a `LapisTransport` interface so a caching Route Handler can be inserted later without touching analysis code. No database, no accounts, no user data retention.

**Tech Stack:** Vite 6 · React 19 · TypeScript 5 (strict) · Vitest + React Testing Library · Tailwind CSS 4 · Zustand · hand-written SVG for both charts (no charting library — see Task 4.5) · deployed as a static build on Vercel.

---

## Global Constraints

These apply to **every** task. They are not repeated per-task.

1. **TypeScript strict mode on.** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. No `any`. No `@ts-ignore` without a comment naming the upstream issue.
2. **No invented biology.** Primer/probe sequences, citations, and reference genomes are **sourced, never recalled**. Any oligo sequence that an agent cannot trace to a URL or DOI in the same commit must not be committed. See Task 5.2 for the procedure and the automated guard.
3. **Coordinates are 1-based, inclusive, and always LAPIS coordinates.** Never NCBI accession coordinates, never 0-based. Every function that takes a position names the parameter `refPos` or `pos1` to make this loud.
4. **One unit of analysis, labelled everywhere.** The headline denominator is *sequences in scope with a definite (non-ambiguous) base call at every position of the binding site*. Any number rendered without its denominator in the same visual unit is a bug.
5. **Absence of a mutation row is never treated as evidence of conservation.** A position with no LAPIS row has *unknown* per-position coverage; it must inherit the window denominator and be labelled as such.
6. **Never render a percentage without N.** Enforced by a lint rule in Task 6.1 and by component tests.
7. **The caveat panel is never collapsed, never behind a disclosure, never below the fold on desktop.** It is a feature, not a legal disclaimer.
8. **Regulatory copy is fixed text.** The string in Appendix C.1 appears verbatim in the header, the footer, the exported CSV, the exported JSON, and the methods paragraph. A test asserts all five.
9. **All network calls are abortable.** Every query accepts an `AbortSignal`; changing scope cancels in-flight work.
10. **Commit after every task** with a Conventional Commits message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). Never batch two tasks into one commit.
11. **Node 22 LTS.** `packageManager` pinned in `package.json`.
12. **No new runtime dependency** may be added without recording the reason in `docs/decisions.md`. Dev dependencies are unrestricted.

---

## How to use this plan

- **Part I** is verified ground truth. Every claim in it was checked against the live APIs on 2026-08-01 with the exact request shapes the product will use. Treat it as the specification for the data layer; do not re-derive it, and do not "improve" a query form without re-verifying it against the live API and updating Part I.
- **Part II** fixes the file layout and the public API surface of each module. Task authors must use these exact names — later tasks depend on them.
- **Part III** is the phased task list. Phases end at a **review gate**: stop, present the evidence, wait for the human.
- **Part IV** holds the risk register, the glossary, the fixed copy blocks, the final verification checklist, the deliberate deviations from the brief, and the open judgement calls.

**Review gates:** at the end of each phase, post (a) the test command and its full output, (b) a one-paragraph summary of anything that turned out differently from this plan, (c) any question you had to answer by guessing. Then stop.

---

# Part I — Verified ground truth

Everything in this part was probed live on **2026-08-01** against `lapisVersion 0.8.3 / siloVersion 0.11.2`. Where a number is quoted, it is a real response.

## I.1 What LAPIS actually returns

### `POST /sample/aggregated`

Body is a JSON object of filters. Returns `{ data: [{ count, ...groupFields }], info: {...} }`.

- `fields: ["date"]` groups the count by that metadata field. This is how the trend series is obtained — **one request, not one per bucket**.
- `advancedQuery` is a string carrying a boolean sequence-filter expression (grammar in I.4).
- Rows for records with a null value in a grouped field come back with `null` in that field. Handle them; do not assume presence.

### `POST /sample/nucleotideMutations`

Returns one row **per (position, alternate allele)** that occurs at or above `minProportion`:

```json
{ "mutation": "T21765-", "count": 67469, "coverage": 70454, "proportion": 0.9576,
  "sequenceName": null, "mutationFrom": "T", "mutationTo": "-", "position": 21765 }
```

Four facts that shape the whole design:

1. **Deletions arrive in-band**, as `mutationTo: "-"`, at single-position resolution. There is no separate deletion endpoint and none is needed. The brief's second open question is closed.
2. **`coverage` is per-position** and equals `(sequences in scope) − (sequences with an ambiguous call at that position)`. Verified arithmetic: scope = 71,142; `21765N` = 688; 71,142 − 688 = 70,454 = the reported `coverage`. The denominator problem is exactly solvable, not approximable.
3. **`sequenceName` is the segment name** — `null` for unsegmented genomes, `"seg4"` for influenza.
4. **There is no row for a position with zero observed mutations.** Absence carries no coverage information. This is the single most dangerous property of the endpoint; Global Constraint 5 exists because of it.

Payload size: `minProportion: 0` over SARS-CoV-2 / United Kingdom / one month returned 20,844 rows, **3.27 MB raw, 438 KB gzipped, ~1.0 s**. Positions with at least one mutation: 15,849 of 29,903. This is fetched **once per scope**, not once per oligo.

### `POST /sample/nucleotideInsertions`

```json
{ "insertion": "ins_27384:TCTC", "count": 20, "insertedSymbols": "TCTC", "position": 27384, "sequenceName": null }
```

Segmented form: `ins_seg8:735:GTG`. **No `coverage` field** — insertions have counts only. Report them as counts against the window denominator and say so.

### `GET /sample/referenceGenome`

Returns `{ nucleotideSequences: [{name, sequence}], genes: [{name, sequence}] }`. SARS-CoV-2: one sequence named `main`, length **29,903** (= NC_045512.2). H5N1 and H3N2: eight sequences `seg1`…`seg8`.

**Use this, not NCBI RefSeq.** It is by construction the coordinate system the mutation data is reported in. Fetching the reference from anywhere else risks an off-by-n that would silently corrupt every number the product prints.

### Transport facts

- `Access-Control-Allow-Origin: *` — the browser can call LAPIS directly. No proxy needed for v1.
- `Cache-Control: no-cache, no-store` — LAPIS will not help you cache. Caching is entirely our responsibility.
- POST with a JSON body works on every endpoint and is preferred: `advancedQuery` strings reach ~700 characters for a 40-mer and URL length limits are not worth discovering in production.
- Errors are HTTP 400 with `{ "error": { "status", "title", "detail" } }`. `detail` is genuinely useful — surface it in dev, log it in prod.
- 12 rapid sequential requests produced no throttling, but `Retry-After` is in `Access-Control-Expose-Headers`, so 429 is possible. Implement backoff (Task 2.4).
- Field/filter discovery trick: send `?fields=zzz` or `?bogusKey=1`; the 400 `detail` enumerates every legal value. `GET /api-docs` returns the full OpenAPI JSON (~1.4 MB).

## I.2 The three pathogen instances — exact configuration

Metadata schemas differ substantially between instances. This is the reason `PathogenConfig` exists. **These values are verified; do not paraphrase them.**

| | **sars-cov-2** | **h5n1** | **h3n2** |
|---|---|---|---|
| `lapisBaseUrl` | `https://lapis.cov-spectrum.org/open/v2` | `https://lapis.genspectrum.org/h5n1` | `https://lapis.genspectrum.org/h3n2` |
| segmented | no | yes | yes |
| segments | `main` (29903) | `seg1`…`seg8` | `seg1`…`seg8` |
| seg4 length | — | 1760 | 1737 |
| `dateField` (group-by) | `date` | `sampleCollectionDateRangeLower` | `sampleCollectionDateRangeLower` |
| `dateFromParam` | `dateFrom` | `sampleCollectionDateRangeLowerFrom` | `sampleCollectionDateRangeLowerFrom` |
| `dateToParam` | `dateTo` | `sampleCollectionDateRangeUpperTo` | `sampleCollectionDateRangeUpperTo` |
| `countryField` | `country` | `country` | `country` |
| `lineageField` | `pangoLineage` | `clade` | `cladeHA` |

**Trap:** on the influenza instances `sampleCollectionDate` is a plain string field with **no** `…From`/`…To` variants. `sampleCollectionDateFrom` returns HTTP 400. Ranges must go through `sampleCollectionDateRangeLowerFrom` / `sampleCollectionDateRangeUpperTo`.

**Trap:** `nucleotideMutations` is a valid *filter key* on the SARS-CoV-2 instance but **not** on the influenza instances, where `advancedQuery` is the only mutation filter. Standardise on `advancedQuery` everywhere — it works on all three.

Influenza segment → gene product (identical for both influenza A instances):

| seg1 | seg2 | seg3 | seg4 | seg5 | seg6 | seg7 | seg8 |
|---|---|---|---|---|---|---|---|
| PB2 | PB1 | PA | **HA** | NP | **NA** | M | NS |

## I.3 The unit of analysis

Fix these definitions once. They appear in code, in the UI, in the CSV header, and in the methods paragraph, and they must be identical in all four.

For a binding site occupying positions `p₁…pₙ` on segment `s`:

| Symbol | Definition | How it is obtained |
|---|---|---|
| `nScope` | sequences matching the date/country/lineage filters | `aggregated` with filters only |
| `nFullCoverage` | of those, sequences with a **definite** base call at every one of `p₁…pₙ` | `aggregated` + `advancedQuery = !(p₁N \| … \| pₙN)` |
| `nMismatch` | of `nFullCoverage`, sequences carrying ≥1 allele the oligo cannot bind | `aggregated` + `advancedQuery = (m₁ \| … \| mₙ) & !(p₁N \| … \| pₙN)` |
| `coverageGap` | `nScope − nFullCoverage` | derived |
| **headline** | `nMismatch / nFullCoverage` | derived |

The headline is therefore: **"of the sequences that can be assessed, this fraction carries at least one mismatch."** `coverageGap` is the count that *cannot* be assessed and is displayed next to the headline, always.

When `nFullCoverage === 0`, the headline is `null` — render "no assessable sequences", never `0%`.
When `nFullCoverage < 50` (`MIN_DENOMINATOR`), the headline is suppressed and replaced with "insufficient data (n = X)".

**Why not "all in-scope sequences":** an N-masked base would count as a match, so a region that is poorly sequenced *because* it is diverging would report as conserved. That is the exact failure mode the brief warns about.

## I.4 Query grammar — the part that must be exactly right

`advancedQuery` supports `|` (or), `&` (and), `!` (not), and parentheses. Verified term forms on an unsegmented genome (prefix with `seg4:` etc. for segmented — `seg4:100`, `seg4:100N`, `seg4:A100G` all verified):

| Form | Meaning | Verified value (UK, Feb 2021) |
|---|---|---|
| `21765` | any **definite** non-reference allele at 21765, **including deletion**, excluding ambiguity | 67,469 |
| `T21765-` | specifically a deletion | 67,469 |
| `T21765A \| T21765C \| T21765G \| T21765-` | explicit enumeration | 67,469 — identical to bare `21765` ✔ |
| `21765N` | ambiguous / no definite call | 688 |
| `maybe(T21765-)` | definite ∪ ambiguous | 68,157 = 67,469 + 688 ✔ |
| `21765 \| 21766` | union | 67,560 |
| `!(!21765 & !21766)` | De Morgan of the above | 67,560 — identical ✔ |
| `(21766 \| !(T21765A \| T21765C)) & !(21765N \| 21766N)` | nested negation inside a disjunct | parses and evaluates ✔ |

Scope total was 71,142; `coverage` reported at 21765 was 70,454 = 71,142 − 688 ✔.

### Building the mismatch term for one position

This is the subtlest piece of logic in the product and the easiest to get quietly wrong. A degenerate oligo base (`Y`) *accepts* more than one allele, and a binding site is allowed up to `maxMismatches` positions where the oligo does **not** match the reference. Both cases break the naive "any non-reference allele is a mismatch" assumption.

For position `i` with reference base `R` and oligo base `O`:

- `M(i)` = the set of **accepted** alleles = IUPAC expansion of `O`, intersected with `{A,C,G,T}`. A deletion never matches.
- `X(i)` = `{A,C,G,T,-} \ M(i)` = the **mismatch alleles**.

Three cases:

| Case | Condition | `mismatchTerm(i)` |
|---|---|---|
| **A — simple** | `M(i) = {R}` (oligo non-degenerate and matches reference) | `` `${pos}` `` — the bare position term |
| **B — degenerate** | `R ∈ M(i)` and `|M(i)| > 1` | `` `(${X(i).map(x => `${R}${pos}${x}`).join(' | ')})` `` |
| **C — inverted** | `R ∉ M(i)` (the oligo mismatches the reference here) | `` `!(${M(i).map(a => `${R}${pos}${a}`).join(' | ')})` `` |

Case C reads "does not carry any allele the oligo accepts". Because the whole expression is ANDed with the full-coverage clause, ambiguity is already excluded, so this is exact — and note that it correctly counts a sequence carrying the *reference* allele as a mismatch, which is right when the oligo itself diverges from the reference.

Case A is the common one and reduces to the form verified above. Prefer it whenever it applies; it keeps queries short.

If `R ∉ {A,C,G,T}` (reference itself ambiguous — rare but real), **exclude the position from both the mismatch and the ambiguity clause**, and add a visible note. Do not guess.

### The two window queries

```
fullCoverage      := !( p₁N | p₂N | … | pₙN )
mismatchInWindow  := ( m₁ | m₂ | … | mₙ ) & !( p₁N | p₂N | … | pₙN )
```

A 40-position window yields an 80-term expression of ~682 characters and returns in well under a second — verified.

## I.5 The query plan for one analysis

For a three-oligo assay this is **15 requests**, issued in parallel, all verified:

| # | Endpoint | Per | Body additions | Yields |
|---|---|---|---|---|
| A | `aggregated` | scope | `fields: [dateField]` | scope totals per date → trend denominator context, deposition-lag diagnostic |
| B | `aggregated` | oligo | `fields: [dateField]`, `advancedQuery: fullCoverage` | `nFullCoverage` per date |
| C | `aggregated` | oligo | `fields: [dateField]`, `advancedQuery: mismatchInWindow` | `nMismatch` per date |
| D | `nucleotideMutations` | scope | `minProportion: 0` | per-base profile for all oligos, deletions included |
| E | `nucleotideInsertions` | scope | — | insertions inside any window |
| F | `aggregated` | oligo | `fields: [lineageField]`, `advancedQuery: mismatchInWindow` | lineage attribution |
| G | `aggregated` | oligo | `fields: [countryField]`, `advancedQuery: mismatchInWindow` | country attribution |

Totals for the whole scope (`nScope`, `nFullCoverage`, `nMismatch`) are obtained by summing the grouped rows from A/B/C — **no extra requests**. Do not issue ungrouped duplicates.

Per-position *exact* coverage at positions with no mutation row would need one extra request per position. That is deliberately **not** in the default path (Task 3.3 renders the window denominator with a label instead); it is available on demand in Task 6.3.

## I.6 Golden cases — real numbers, computed with the production query form

These were computed on 2026-08-01 using exactly the `fullCoverage` / `mismatchInWindow` expressions above. They are the acceptance criteria for Phase 3.

### G1 — Alpha S-gene target failure (the headline case)

Window: SARS-CoV-2 `main:21765–21786` (22 nt, spanning the six-nucleotide ΔH69/V70 deletion).
Reference bases: `TACATGTCTCTGGGACCAATGG`
Filter: `country = "United Kingdom"`

| Period | `nScope` | `nFullCoverage` | `nMismatch` | headline |
|---|---|---|---|---|
| 2020-09-01 → 2020-10-01 | 18,892 | 18,747 | 612 | **3.26 %** |
| 2021-02-01 → 2021-03-01 | 71,142 | 70,387 | 67,520 | **95.93 %** |

The same window, same country, five months apart. This is the temporal control and the launch argument in one figure.

### G2 — Influenza HA drift (the segmented-genome case)

Window: H3N2 `seg4:600–621` (22 nt in HA).

| Period | `nScope` | `nFullCoverage` | `nMismatch` | headline |
|---|---|---|---|---|
| 2022-01-01 → 2022-12-31 | 41,848 | 41,794 | 2,706 | **6.47 %** |
| 2025-01-01 → 2025-12-31 | 22,480 | 22,445 | 22,380 | **99.71 %** |

Driven by substitutions that swept from 0 % to ~98 % at `seg4:614` and `seg4:617` between those seasons.

### G3 — Conserved site negative control (the "you're fine" case)

Window: SARS-CoV-2 `main:15784–15805` (22 nt in ORF1ab / RdRp).
Reference bases: `TTTAAGTCAGTTCTTTATTATC`
Filter: `country = "United Kingdom"`, 2024-01-01 → 2025-06-30

| `nScope` | `nFullCoverage` | `nMismatch` | headline | `coverageGap` |
|---|---|---|---|---|
| 46,667 | 44,669 | 3 | **0.0067 %** | 1,998 (4.28 %) |

This case must render **green**, and it must still show the 1,998-sequence coverage gap. A tool that says "you're fine" without showing what it could not assess has not earned the "you're fine".

> **Determinism:** these numbers can shift as sequence databases are revised. Golden tests therefore run against **committed fixtures** (Task 2.6) and assert exactly. A separate nightly live job (Task 6.5) re-runs them against the real API and asserts within ±2 percentage points, alerting on drift.

---

# Part II — File structure

Every path below is created by exactly one task. The **Interfaces** block in each task repeats the signatures its neighbours need, because implementers see only their own task.

```
assay-drift/
├─ implementation.md                    # this file
├─ docs/
│  ├─ decisions.md                      # dependency + design decisions log (Task 0.1)
│  └─ methods.md                        # public methods statement (Task 6.5)
├─ scripts/
│  ├─ fetch-references.ts               # 2.2  LAPIS → src/data/references/*.json
│  ├─ record-fixtures.ts                # 2.6  live API → tests/fixtures/*.json
│  └─ verify-assays.ts                  # 5.2  library integrity gate (runs in CI)
├─ src/
│  ├─ core/
│  │  ├─ iupac.ts                       # 1.1  degenerate-base algebra
│  │  ├─ reference.ts                   # 1.2  ReferenceGenome accessors
│  │  ├─ binding.ts                     # 1.2  orientation-aware sliding-window search
│  │  ├─ resolution.ts                  # 1.3  ambiguity policy over binding hits
│  │  ├─ oligo-input.ts                 # 1.4  FASTA / plain-text parsing
│  │  ├─ assay-geometry.ts              # 1.5  amplicon plausibility
│  │  ├─ registry.ts                    # 2.1  PathogenConfig × 3
│  │  ├─ scope.ts                       # 2.1  Scope → LAPIS filter object
│  │  ├─ query.ts                       # 2.3  WindowSpec + advancedQuery construction
│  │  ├─ lapis/
│  │  │  ├─ transport.ts                # 2.4  interface, LapisError
│  │  │  ├─ fetch-transport.ts          # 2.4  real transport, retry/backoff
│  │  │  ├─ caching-transport.ts        # 2.4  decorator: in-memory + sessionStorage
│  │  │  ├─ fixture-transport.ts        # 2.6  deterministic transport for tests
│  │  │  └─ endpoints.ts                # 2.5  typed row shapes + endpoint wrappers
│  │  ├─ analysis/
│  │  │  ├─ constants.ts                # 3.1  every threshold, in one file
│  │  │  ├─ metrics.ts                  # 3.2  nScope / nFullCoverage / nMismatch
│  │  │  ├─ profile.ts                  # 3.3  per-base position profile
│  │  │  ├─ insertions.ts               # 3.4  insertions inside the window
│  │  │  ├─ trend.ts                    # 3.5  date bucketing
│  │  │  ├─ attribution.ts              # 3.6  lineage / country breakdown
│  │  │  ├─ severity.ts                 # 3.7  the heuristic
│  │  │  ├─ diagnostics.ts              # 3.8  sampling-bias warnings
│  │  │  └─ run.ts                      # 3.9  orchestrator
│  │  ├─ permalink.ts                   # 5.3  URL state codec
│  │  └─ export/
│  │     ├─ csv.ts                      # 5.4
│  │     └─ methods.ts                  # 5.4  dated methods paragraph
│  ├─ data/
│  │  ├─ references/{sars-cov-2,h5n1,h3n2}.json   # 2.2  generated, committed
│  │  └─ assays/{schema.ts,library.json}           # 5.1 / 5.2  curated, cited
│  ├─ state/store.ts                    # 4.1  zustand store
│  ├─ ui/
│  │  ├─ AppShell.tsx                   # 4.1
│  │  ├─ CaveatPanel.tsx                # 4.6
│  │  ├─ RegulatoryNotice.tsx           # 4.1
│  │  ├─ format.ts                      # 6.1  the only approved number formatters
│  │  ├─ input/{OligoInputPanel,AssayPicker,RoleSelector}.tsx # 4.2 / 5.2
│  │  ├─ binding/{BindingResolution,GenomeMap}.tsx            # 4.3
│  │  ├─ scope/ScopeControls.tsx                              # 4.4
│  │  ├─ results/{ResultsPanel,HeadlineCard,PositionProfile,  # 4.5
│  │  │           SeverityBadge,TrendChart,AttributionTable,
│  │  │           InsertionNote}.tsx
│  │  └─ common/{Stat,Loading,ErrorState,EmptyState}.tsx      # 4.7
│  ├─ App.tsx                           # 4.1
│  └─ main.tsx                          # 0.1
└─ tests/
   ├─ fixtures/                         # 2.6  recorded LAPIS responses
   └─ golden/                           # 3.9  G1 / G2 / G3
```

Phase 6 adds a small number of further files (`src/core/lapis/size-guard.ts`, `src/ui/results/ExactCoverageToggle.tsx`, `eslint-rules/`, and optionally `api/lapis.ts` + `src/core/lapis/proxy-transport.ts`); they are listed in their own tasks.

**Sizing rule:** if a file passes ~250 lines, stop and ask whether it is doing two things. `run.ts` and `ResultsPanel.tsx` are the two most likely to bloat; both have explicit split points noted in their tasks.

---

# Part III — Phases and tasks

---

## Phase 0 — Foundation

**Exit criteria:** a public repo, a green CI run, and a deployed placeholder URL. Nothing else. Prove the pipeline before building anything that depends on it.

### Task 0.1: Scaffold, tooling, CI, and a deployed walking skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Create: `.github/workflows/ci.yml`
- Create: `docs/decisions.md`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` — every later task's verification command is one of these four.

- [ ] **Step 1: Initialise the repo**

The working directory already contains `assay-drift-watch-brief.md` and `implementation.md`, and `npm create vite` refuses to scaffold into a non-empty directory. Scaffold into a temporary subdirectory and move the result up:

```bash
cd /c/Users/hmmar/GitHub/assay-drift
git init -b main
npm create vite@latest .scaffold -- --template react-ts
mv .scaffold/* .scaffold/.* . 2>/dev/null || true
rmdir .scaffold
npm install
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install -D tailwindcss @tailwindcss/vite prettier eslint-config-prettier tsx
npm install zustand
```

Confirm `assay-drift-watch-brief.md` and `implementation.md` still exist before continuing.

- [ ] **Step 2: Set strict TypeScript**

In `tsconfig.json`, inside `compilerOptions`, ensure all of:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "verbatimModuleSyntax": true,
  "resolveJsonModule": true
}
```

- [ ] **Step 3: Configure Vitest**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    coverage: { provider: 'v8', include: ['src/core/**'], thresholds: { lines: 90, functions: 90 } },
  },
});
```

`src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
{
  "packageManager": "npm@10.9.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "format": "prettier --write ."
  }
}
```

- [ ] **Step 5: Write the failing smoke test**

`src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the product name and the regulatory notice', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /assay drift watch/i })).toBeInTheDocument();
    expect(
      screen.getByText(/research and educational tool, not a diagnostic device/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — the default Vite template App renders neither string.

- [ ] **Step 7: Make it pass**

`src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Assay Drift Watch</h1>
      <p className="mt-2 text-sm">
        A research and educational tool, not a diagnostic device. Not for clinical
        decision-making.
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Run the full gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all four pass. Paste the output.

- [ ] **Step 9: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 10: Seed the decisions log**

`docs/decisions.md`:

```markdown
# Decisions

## 2026-08-01 — Runtime dependencies
- `react`, `react-dom` — UI.
- `zustand` — query state; chosen over Context to keep re-renders scoped to the panels that change.

## 2026-08-01 — Reference genomes come from LAPIS, not NCBI
LAPIS reports mutation coordinates against its own reference. Sourcing the reference
anywhere else risks a silent coordinate offset in every published number.
```

- [ ] **Step 11: Commit and publish**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS with strict config, Vitest, and CI"
gh auth status || gh auth login
gh repo create assay-drift --public --source=. --remote=origin --push
```

If `gh auth login` needs an interactive browser flow, ask the human to run it — do not try to automate it.

- [ ] **Step 12: Deploy the skeleton to Vercel**

Ask the human to run `vercel link` and `vercel --prod` (or connect the GitHub repo in the Vercel dashboard — framework preset **Vite**, build `npm run build`, output `dist`). Record the production URL in `docs/decisions.md`.

**Do not proceed until a real URL renders the heading.** The point of this task is that deployment is never an unknown later.

> ### ⛔ REVIEW GATE — Phase 0
> Post: the four-command output, the CI run URL, the Vercel production URL. Then stop.

---

## Phase 1 — Sequence engine

Pure functions. **No network, no React, no I/O.** This phase is entirely deterministic and should reach 100 % line coverage. It is also the brief's nominated early spike — if the orientation and 3′-mapping logic is wrong here, every number the product prints is wrong.

### Task 1.1: IUPAC algebra

**Files:**
- Create: `src/core/iupac.ts`
- Test: `src/core/iupac.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `IUPAC_SETS: Readonly<Record<string, string>>`
  - `normalizeOligo(raw: string): string` — uppercases, strips whitespace/digits, maps `U`→`T`, throws `Error` on any other non-IUPAC character
  - `acceptedBases(code: string): ReadonlySet<string>` — the `{A,C,G,T}` alleles a code accepts
  - `basesMatch(a: string, b: string): boolean` — true if the accepted sets intersect
  - `reverseComplement(seq: string): string`
  - `degeneracyProduct(seq: string): number` — product of `acceptedBases(c).size`; how many concrete sequences the oligo represents

- [ ] **Step 1: Write the failing tests**

`src/core/iupac.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeOligo, acceptedBases, basesMatch, reverseComplement, degeneracyProduct,
} from './iupac';

describe('normalizeOligo', () => {
  it('uppercases, strips whitespace and digits, and maps U to T', () => {
    expect(normalizeOligo(' acg u\n12 t ')).toBe('ACGTT');
  });
  it('preserves degenerate codes', () => {
    expect(normalizeOligo('acgryswkmbdhvn')).toBe('ACGRYSWKMBDHVN');
  });
  it('throws on a non-IUPAC character', () => {
    expect(() => normalizeOligo('ACGX')).toThrow(/X/);
  });
});

describe('acceptedBases', () => {
  it('expands unambiguous codes to themselves', () => {
    expect([...acceptedBases('A')]).toEqual(['A']);
  });
  it('expands Y to C and T', () => {
    expect([...acceptedBases('Y')].sort()).toEqual(['C', 'T']);
  });
  it('expands N to all four bases', () => {
    expect([...acceptedBases('N')].sort()).toEqual(['A', 'C', 'G', 'T']);
  });
});

describe('basesMatch', () => {
  it('matches identical unambiguous bases', () => {
    expect(basesMatch('A', 'A')).toBe(true);
  });
  it('does not match different unambiguous bases', () => {
    expect(basesMatch('A', 'C')).toBe(false);
  });
  it('matches when a degenerate code covers the other base', () => {
    expect(basesMatch('Y', 'C')).toBe(true);
    expect(basesMatch('Y', 'A')).toBe(false);
  });
  it('is symmetric', () => {
    expect(basesMatch('R', 'S')).toBe(basesMatch('S', 'R')); // R={A,G} S={C,G} share G
    expect(basesMatch('R', 'S')).toBe(true);
  });
  it('never matches a deletion character', () => {
    expect(basesMatch('N', '-')).toBe(false);
  });
});

describe('reverseComplement', () => {
  it('reverse-complements an unambiguous sequence', () => {
    expect(reverseComplement('GCATGCAT')).toBe('ATGCATGC');
  });
  it('complements degenerate codes correctly', () => {
    expect(reverseComplement('RYSWKM')).toBe('KMWSRY');
  });
  it('round-trips', () => {
    expect(reverseComplement(reverseComplement('ACGTRYKMBV'))).toBe('ACGTRYKMBV');
  });
});

describe('degeneracyProduct', () => {
  it('is 1 for a fully specified oligo', () => {
    expect(degeneracyProduct('ACGT')).toBe(1);
  });
  it('multiplies across degenerate positions', () => {
    expect(degeneracyProduct('AYRN')).toBe(2 * 2 * 4);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/iupac.test.ts`
Expected: FAIL — `Failed to resolve import "./iupac"`.

- [ ] **Step 3: Implement**

`src/core/iupac.ts`:

```ts
export const IUPAC_SETS: Readonly<Record<string, string>> = Object.freeze({
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
});

const COMPLEMENT: Readonly<Record<string, string>> = Object.freeze({
  A: 'T', C: 'G', G: 'C', T: 'A',
  R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
  B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
});

export function normalizeOligo(raw: string): string {
  const cleaned = raw.replace(/[\s0-9]/g, '').toUpperCase().replace(/U/g, 'T');
  for (const ch of cleaned) {
    if (!(ch in IUPAC_SETS)) {
      throw new Error(`Not a valid IUPAC nucleotide code: "${ch}"`);
    }
  }
  return cleaned;
}

const ACCEPTED_CACHE = new Map<string, ReadonlySet<string>>();

export function acceptedBases(code: string): ReadonlySet<string> {
  const cached = ACCEPTED_CACHE.get(code);
  if (cached) return cached;
  const expansion = IUPAC_SETS[code];
  const set: ReadonlySet<string> = new Set(expansion ? [...expansion] : []);
  ACCEPTED_CACHE.set(code, set);
  return set;
}

export function basesMatch(a: string, b: string): boolean {
  const setA = acceptedBases(a);
  if (setA.size === 0) return false;
  for (const base of acceptedBases(b)) {
    if (setA.has(base)) return true;
  }
  return false;
}

export function reverseComplement(seq: string): string {
  let out = '';
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    const ch = seq[i] as string;
    const comp = COMPLEMENT[ch];
    if (comp === undefined) throw new Error(`Cannot complement "${ch}"`);
    out += comp;
  }
  return out;
}

export function degeneracyProduct(seq: string): number {
  let product = 1;
  for (const ch of seq) product *= acceptedBases(ch).size;
  return product;
}
```

Note `basesMatch('N', '-')` returns `false` because `'-'` is not a key of `IUPAC_SETS`, so its accepted set is empty. This is load-bearing: a deletion is always a mismatch.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/iupac.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/iupac.ts src/core/iupac.test.ts
git commit -m "feat(core): IUPAC degenerate-base algebra"
```

---

### Task 1.2: Reference genome accessors and the sliding-window search

**Files:**
- Create: `src/core/reference.ts`, `src/core/binding.ts`
- Test: `src/core/binding.test.ts`

**Interfaces:**
- Consumes: `normalizeOligo`, `reverseComplement`, `basesMatch` from `src/core/iupac.ts`.
- Produces:
  - `interface ReferenceSegment { name: string; sequence: string }`
  - `interface ReferenceGenome { pathogenId: string; segments: ReferenceSegment[] }`
  - `baseAt(ref: ReferenceGenome, segment: string, pos1: number): string`
  - `type Strand = 'plus' | 'minus'`
  - `interface BindingSite { segment: string; strand: Strand; start: number; end: number; mismatches: number; mismatchOligoIndexes: number[] }`
  - `findBindingSites(oligo: string, ref: ReferenceGenome, opts?: { maxMismatches?: number }): BindingSite[]`
  - `oligoIndexToRefPos(site: BindingSite, oligoIndex: number): number`

**Coordinate contract — read before writing code.** `start` and `end` are 1-based inclusive positions on the **plus strand of the reference**, with `start ≤ end` always, regardless of orientation. `oligoIndex` is 0-based along the oligo **5′→3′**. For a `plus` site the oligo's 5′ end sits at `start`; for a `minus` site the oligo's 5′ end sits at `end` and its **3′ end sits at `start`**. Getting this backwards inverts the entire severity heuristic.

- [ ] **Step 1: Write the failing tests**

`src/core/binding.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findBindingSites, oligoIndexToRefPos, type ReferenceGenome } from './binding';
import { baseAt } from './reference';

// 1-based positions:  1234567890123456
const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};

describe('baseAt', () => {
  it('is 1-based', () => {
    expect(baseAt(REF, 'main', 1)).toBe('G');
    expect(baseAt(REF, 'main', 5)).toBe('A');
    expect(baseAt(REF, 'main', 16)).toBe('A');
  });
  it('throws outside the segment', () => {
    expect(() => baseAt(REF, 'main', 17)).toThrow(/out of range/i);
  });
  it('throws for an unknown segment', () => {
    expect(() => baseAt(REF, 'seg9', 1)).toThrow(/seg9/);
  });
});

const EXACT = { maxMismatches: 0 } as const;

describe('findBindingSites — plus strand', () => {
  it('finds an exact match and reports 1-based inclusive coordinates', () => {
    const sites = findBindingSites('ATGCATGC', REF, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      segment: 'main', strand: 'plus', start: 5, end: 12, mismatches: 0,
    });
  });

  it("maps the oligo's 5' end to start and its 3' end to end", () => {
    const site = findBindingSites('ATGCATGC', REF, EXACT)[0]!;
    expect(oligoIndexToRefPos(site, 0)).toBe(5);
    expect(oligoIndexToRefPos(site, 7)).toBe(12);
  });

  it('accepts a degenerate base that covers the reference base', () => {
    const sites = findBindingSites('ATGYATGC', REF, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.mismatches).toBe(0);
  });

  it('reports mismatch offsets in oligo coordinates', () => {
    const sites = findBindingSites('ATGCATGA', REF, { maxMismatches: 1 });
    expect(sites).toHaveLength(1);
    expect(sites[0]!.mismatches).toBe(1);
    expect(sites[0]!.mismatchOligoIndexes).toEqual([7]);
  });

  it('rejects a site above the mismatch tolerance', () => {
    expect(findBindingSites('ATGCATAA', REF, EXACT)).toHaveLength(0);
  });

  it('returns near matches when the tolerance allows them', () => {
    // At the default tolerance of 3, offset 0 ("GGGGATGC") is also within tolerance.
    const sites = findBindingSites('ATGCATGC', REF);
    expect(sites.length).toBeGreaterThan(1);
    expect(sites[0]!.mismatches).toBe(0);
  });
});

describe('findBindingSites — minus strand', () => {
  it('detects a reverse-complement oligo without the user flipping it', () => {
    const sites = findBindingSites('GCATGCAT', REF, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      segment: 'main', strand: 'minus', start: 5, end: 12, mismatches: 0,
    });
  });

  it("maps the oligo's 3' end to the LOWER reference coordinate", () => {
    const site = findBindingSites('GCATGCAT', REF, EXACT)[0]!;
    expect(oligoIndexToRefPos(site, 0)).toBe(12); // 5' end
    expect(oligoIndexToRefPos(site, 7)).toBe(5);  // 3' end
  });
});

describe('findBindingSites — segments', () => {
  const SEGMENTED: ReferenceGenome = {
    pathogenId: 'test-flu',
    segments: [
      { name: 'seg1', sequence: 'TTTTTTTTTTTT' },
      { name: 'seg4', sequence: 'CCCCATGCATGCGGGG' },
    ],
  };
  it('reports which segment the site is on', () => {
    const sites = findBindingSites('ATGCATGC', SEGMENTED, EXACT);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.segment).toBe('seg4');
    expect(sites[0]!.start).toBe(5);
  });
});

describe('findBindingSites — ranking', () => {
  const REPEAT: ReferenceGenome = {
    pathogenId: 'test',
    segments: [{ name: 'main', sequence: 'ATGCATGCTTTTATGCATGA' }],
  };
  it('returns best matches first', () => {
    const sites = findBindingSites('ATGCATGC', REPEAT, { maxMismatches: 1 });
    expect(sites).toHaveLength(2);
    expect(sites[0]).toMatchObject({ mismatches: 0, start: 1 });
    expect(sites[1]).toMatchObject({ mismatches: 1, start: 13 });
  });
});
```

> **Why `EXACT` appears everywhere above.** The default tolerance is 3 mismatches, and in a 16 nt toy reference an 8-mer finds several 3-mismatch windows by chance. Passing `{ maxMismatches: 0 }` keeps these unit tests about the coordinate arithmetic rather than about how permissive the default is. Tests in later tasks take `findBindingSites(...)[0]` instead, which is safe because results are sorted best-first.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/binding.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/core/reference.ts`**

```ts
export interface ReferenceSegment {
  name: string;
  sequence: string;
}

export interface ReferenceGenome {
  pathogenId: string;
  segments: ReferenceSegment[];
}

export function getSegment(ref: ReferenceGenome, name: string): ReferenceSegment {
  const seg = ref.segments.find((s) => s.name === name);
  if (!seg) throw new Error(`Unknown segment "${name}" in reference ${ref.pathogenId}`);
  return seg;
}

/** 1-based, inclusive. */
export function baseAt(ref: ReferenceGenome, segment: string, pos1: number): string {
  const seg = getSegment(ref, segment);
  if (pos1 < 1 || pos1 > seg.sequence.length) {
    throw new Error(`Position ${pos1} out of range for ${segment} (length ${seg.sequence.length})`);
  }
  return seg.sequence[pos1 - 1] as string;
}
```

- [ ] **Step 4: Implement `src/core/binding.ts`**

```ts
import { basesMatch, normalizeOligo, reverseComplement } from './iupac';
import { type ReferenceGenome, type ReferenceSegment } from './reference';

export type { ReferenceGenome, ReferenceSegment } from './reference';
export type Strand = 'plus' | 'minus';

export interface BindingSite {
  segment: string;
  strand: Strand;
  /** 1-based inclusive, plus strand of the reference. Always <= end. */
  start: number;
  /** 1-based inclusive, plus strand of the reference. */
  end: number;
  mismatches: number;
  /** 0-based indexes into the oligo, 5' -> 3'. */
  mismatchOligoIndexes: number[];
}

export const DEFAULT_MAX_MISMATCHES = 3;

function scanSegment(
  seg: ReferenceSegment,
  probe: string,
  strand: Strand,
  maxMismatches: number,
  out: BindingSite[],
): void {
  const n = probe.length;
  const limit = seg.sequence.length - n;
  for (let offset = 0; offset <= limit; offset += 1) {
    let mismatches = 0;
    const indexes: number[] = [];
    for (let j = 0; j < n; j += 1) {
      if (!basesMatch(probe[j] as string, seg.sequence[offset + j] as string)) {
        mismatches += 1;
        if (mismatches > maxMismatches) break;
        // probe index j -> oligo index, accounting for orientation
        indexes.push(strand === 'plus' ? j : n - 1 - j);
      }
    }
    if (mismatches <= maxMismatches) {
      out.push({
        segment: seg.name,
        strand,
        start: offset + 1,
        end: offset + n,
        mismatches,
        mismatchOligoIndexes: indexes.sort((a, b) => a - b),
      });
    }
  }
}

export function findBindingSites(
  oligo: string,
  ref: ReferenceGenome,
  opts: { maxMismatches?: number } = {},
): BindingSite[] {
  const maxMismatches = opts.maxMismatches ?? DEFAULT_MAX_MISMATCHES;
  const forward = normalizeOligo(oligo);
  if (forward.length === 0) throw new Error('Oligo is empty');
  const reverse = reverseComplement(forward);
  const out: BindingSite[] = [];
  for (const seg of ref.segments) {
    scanSegment(seg, forward, 'plus', maxMismatches, out);
    scanSegment(seg, reverse, 'minus', maxMismatches, out);
  }
  out.sort(
    (a, b) =>
      a.mismatches - b.mismatches ||
      a.segment.localeCompare(b.segment) ||
      a.start - b.start ||
      a.strand.localeCompare(b.strand),
  );
  return out;
}

/** Reference position of a given 0-based oligo index (5' -> 3'). */
export function oligoIndexToRefPos(site: BindingSite, oligoIndex: number): number {
  const length = site.end - site.start + 1;
  if (oligoIndex < 0 || oligoIndex >= length) {
    throw new Error(`Oligo index ${oligoIndex} outside site of length ${length}`);
  }
  return site.strand === 'plus' ? site.start + oligoIndex : site.end - oligoIndex;
}
```

Complexity is `O(genome × oligo)` — about 750 k base comparisons for a 25-mer against SARS-CoV-2. Measured in the browser this is single-digit milliseconds. Do not optimise it; do not reach for an alignment library or WASM.

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run src/core/binding.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/reference.ts src/core/binding.ts src/core/binding.test.ts
git commit -m "feat(core): reference accessors and orientation-aware binding-site search"
```

---

### Task 1.3: Binding-site resolution policy

The brief is explicit that ambiguous cases are **surfaced for the user to confirm, not silently resolved**. That policy lives here, separately from the search, so it can be tested and changed independently.

**Files:**
- Create: `src/core/resolution.ts`
- Test: `src/core/resolution.test.ts`

**Interfaces:**
- Consumes: `findBindingSites`, `BindingSite`, `ReferenceGenome` from `src/core/binding.ts`; `degeneracyProduct`, `normalizeOligo` from `src/core/iupac.ts`.
- Produces:
  - `type ResolutionStatus = 'resolved' | 'ambiguous' | 'no-hit' | 'highly-degenerate'`
  - `interface Resolution { status: ResolutionStatus; candidates: BindingSite[]; chosen: BindingSite | null; notes: string[] }`
  - `resolveBindingSite(oligo: string, ref: ReferenceGenome, opts?: { maxMismatches?: number; maxCandidates?: number }): Resolution`
  - `MAX_DEGENERACY_PRODUCT = 64`

Policy, in order:
1. `degeneracyProduct(oligo) > 64` → `highly-degenerate`. Candidates are still returned and `chosen` is still set if a unique best exists, but the status forces a UI confirmation. Rationale: a heavily degenerate oligo matches too easily, so the location is not trustworthy without a human look.
2. Zero candidates → `no-hit`, `chosen: null`.
3. Exactly one candidate at the minimum mismatch count → `resolved`.
4. Two or more candidates tied at the minimum → `ambiguous`, `chosen: null`, all tied candidates returned (capped at `maxCandidates`, default 20).

- [ ] **Step 1: Write the failing tests**

`src/core/resolution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveBindingSite } from './resolution';
import type { ReferenceGenome } from './binding';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};

const DUPLICATED: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'ATGCATGCTTTTATGCATGC' }],
};

describe('resolveBindingSite', () => {
  it('resolves a unique best hit', () => {
    const r = resolveBindingSite('ATGCATGC', REF);
    expect(r.status).toBe('resolved');
    expect(r.chosen).toMatchObject({ start: 5, end: 12, strand: 'plus' });
  });

  it('reports no-hit rather than inventing a location', () => {
    const r = resolveBindingSite('TTTTTTTTTTTTTTTT', REF, { maxMismatches: 1 });
    expect(r.status).toBe('no-hit');
    expect(r.chosen).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it('reports ambiguity and refuses to choose when two sites tie', () => {
    const r = resolveBindingSite('ATGCATGC', DUPLICATED);
    expect(r.status).toBe('ambiguous');
    expect(r.chosen).toBeNull();
    expect(r.candidates.map((c) => c.start)).toEqual([1, 13]);
  });

  it('flags a heavily degenerate oligo even when the hit is unique', () => {
    const r = resolveBindingSite('NNNNNNNNNNNN', REF);
    expect(r.status).toBe('highly-degenerate');
    expect(r.notes.join(' ')).toMatch(/degenerate/i);
  });

  it('prefers the site with fewer mismatches over a tie at a worse score', () => {
    const ref: ReferenceGenome = {
      pathogenId: 'test',
      segments: [{ name: 'main', sequence: 'ATGCATGCTTTTATGCATGA' }],
    };
    const r = resolveBindingSite('ATGCATGC', ref, { maxMismatches: 2 });
    expect(r.status).toBe('resolved');
    expect(r.chosen!.start).toBe(1);
  });

  it('caps the number of returned candidates', () => {
    const many: ReferenceGenome = {
      pathogenId: 'test',
      segments: [{ name: 'main', sequence: 'AT'.repeat(200) }],
    };
    const r = resolveBindingSite('ATAT', many, { maxCandidates: 5 });
    expect(r.candidates.length).toBeLessThanOrEqual(5);
    expect(r.notes.join(' ')).toMatch(/showing 5 of/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/resolution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/resolution.ts`:

```ts
import { findBindingSites, type BindingSite, type ReferenceGenome } from './binding';
import { degeneracyProduct, normalizeOligo } from './iupac';

export const MAX_DEGENERACY_PRODUCT = 64;

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'no-hit' | 'highly-degenerate';

export interface Resolution {
  status: ResolutionStatus;
  candidates: BindingSite[];
  chosen: BindingSite | null;
  notes: string[];
}

export function resolveBindingSite(
  oligo: string,
  ref: ReferenceGenome,
  opts: { maxMismatches?: number; maxCandidates?: number } = {},
): Resolution {
  const maxCandidates = opts.maxCandidates ?? 20;
  const normalized = normalizeOligo(oligo);
  const notes: string[] = [];

  const all = findBindingSites(normalized, ref, opts);
  if (all.length === 0) {
    return {
      status: 'no-hit',
      candidates: [],
      chosen: null,
      notes: ['No binding site found within the mismatch tolerance. Check the sequence and the selected pathogen.'],
    };
  }

  const best = all[0]!.mismatches;
  const tied = all.filter((s) => s.mismatches === best);
  const shown = tied.slice(0, maxCandidates);
  if (tied.length > shown.length) {
    notes.push(`Showing ${shown.length} of ${tied.length} equally good candidate sites.`);
  }

  const degeneracy = degeneracyProduct(normalized);
  if (degeneracy > MAX_DEGENERACY_PRODUCT) {
    notes.push(
      `This oligo is highly degenerate (${degeneracy} possible sequences); the located site needs confirmation.`,
    );
    return {
      status: 'highly-degenerate',
      candidates: shown,
      chosen: tied.length === 1 ? (tied[0] as BindingSite) : null,
      notes,
    };
  }

  if (tied.length === 1) {
    return { status: 'resolved', candidates: shown, chosen: tied[0] as BindingSite, notes };
  }

  notes.push(`${tied.length} sites match equally well. Choose the intended one.`);
  return { status: 'ambiguous', candidates: shown, chosen: null, notes };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/resolution.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/resolution.ts src/core/resolution.test.ts
git commit -m "feat(core): binding-site resolution policy that surfaces ambiguity"
```

---

### Task 1.4: Oligo input parsing

**Files:**
- Create: `src/core/oligo-input.ts`
- Test: `src/core/oligo-input.test.ts`

**Interfaces:**
- Consumes: `normalizeOligo` from `src/core/iupac.ts`.
- Produces:
  - `type OligoRole = 'forward' | 'reverse' | 'probe'`
  - `interface OligoInput { id: string; name: string; role: OligoRole | null; sequence: string }`
  - `interface ParseResult { oligos: OligoInput[]; errors: string[] }`
  - `parseOligoText(text: string): ParseResult`

Accepts FASTA (`>name` headers) and bare lines. Role is **guessed** from the name when the name contains `fwd`/`forward`/`-F`, `rev`/`reverse`/`-R`, or `probe`/`prb`/`-P`, and left `null` otherwise for the UI to ask. A guessed role is still shown to the user for confirmation — never silently applied. Sequences shorter than 12 nt or longer than 60 nt produce an error entry and are excluded.

- [ ] **Step 1: Write the failing tests**

`src/core/oligo-input.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseOligoText } from './oligo-input';

describe('parseOligoText', () => {
  it('parses FASTA with multi-line sequences', () => {
    const { oligos, errors } = parseOligoText('>N1-F\nGACCCCAAAA\nTCAGCGAAAT\n>N1-R\nTCTGGTTACTGCCAGTTGAATCTG');
    expect(errors).toEqual([]);
    expect(oligos).toHaveLength(2);
    expect(oligos[0]).toMatchObject({ name: 'N1-F', sequence: 'GACCCCAAAATCAGCGAAAT', role: 'forward' });
    expect(oligos[1]!.role).toBe('reverse');
  });

  it('parses bare sequence lines and leaves the role unset', () => {
    const { oligos } = parseOligoText('ACGTACGTACGTACGT\nTTTTGGGGCCCCAAAA');
    expect(oligos).toHaveLength(2);
    expect(oligos[0]!.role).toBeNull();
    expect(oligos[0]!.name).toBe('Oligo 1');
  });

  it('guesses probe roles from common naming', () => {
    const { oligos } = parseOligoText('>2019-nCoV_N1-Probe\nACCCCGCATTACGTTTGGTGGACC');
    expect(oligos[0]!.role).toBe('probe');
  });

  it('normalises whitespace, case and U', () => {
    const { oligos } = parseOligoText('>x\nacg u acg uacgtacgt');
    expect(oligos[0]!.sequence).toBe('ACGTACGTACGTACGT');
  });

  it('reports invalid characters without dropping the other oligos', () => {
    const { oligos, errors } = parseOligoText('>bad\nACGTXACGTACGT\n>good\nACGTACGTACGTACGT');
    expect(oligos.map((o) => o.name)).toEqual(['good']);
    expect(errors[0]).toMatch(/bad/);
    expect(errors[0]).toMatch(/X/);
  });

  it('rejects sequences that are too short or too long', () => {
    const { oligos, errors } = parseOligoText('>tiny\nACGTACG\n>huge\n' + 'A'.repeat(61));
    expect(oligos).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toMatch(/12/);
    expect(errors.join(' ')).toMatch(/60/);
  });

  it('assigns stable unique ids', () => {
    const { oligos } = parseOligoText('>a\nACGTACGTACGTACGT\n>a\nTTTTGGGGCCCCAAAA');
    expect(new Set(oligos.map((o) => o.id)).size).toBe(2);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/oligo-input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/oligo-input.ts`:

```ts
import { normalizeOligo } from './iupac';

export type OligoRole = 'forward' | 'reverse' | 'probe';

export interface OligoInput {
  id: string;
  name: string;
  role: OligoRole | null;
  sequence: string;
}

export interface ParseResult {
  oligos: OligoInput[];
  errors: string[];
}

export const MIN_OLIGO_LENGTH = 12;
export const MAX_OLIGO_LENGTH = 60;

export function guessRole(name: string): OligoRole | null {
  const n = name.toLowerCase();
  if (/(probe|prb|[-_]p$|[-_]p[-_])/.test(n)) return 'probe';
  if (/(reverse|rev|[-_]r$|[-_]r[-_])/.test(n)) return 'reverse';
  if (/(forward|fwd|fw|[-_]f$|[-_]f[-_])/.test(n)) return 'forward';
  return null;
}

interface RawEntry {
  name: string;
  lines: string[];
  named: boolean;
}

export function parseOligoText(text: string): ParseResult {
  const entries: RawEntry[] = [];
  let current: RawEntry | null = null;
  let anonymousCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('>')) {
      current = { name: line.slice(1).trim() || `Oligo ${entries.length + 1}`, lines: [], named: true };
      entries.push(current);
    } else if (current && current.named) {
      current.lines.push(line);
    } else {
      anonymousCount += 1;
      current = { name: `Oligo ${anonymousCount}`, lines: [line], named: false };
      entries.push(current);
    }
  }

  const oligos: OligoInput[] = [];
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    const joined = entry.lines.join('');
    let sequence: string;
    try {
      sequence = normalizeOligo(joined);
    } catch (err) {
      errors.push(`${entry.name}: ${(err as Error).message}`);
      return;
    }
    if (sequence.length < MIN_OLIGO_LENGTH) {
      errors.push(`${entry.name}: sequence is ${sequence.length} nt; the minimum is ${MIN_OLIGO_LENGTH} nt.`);
      return;
    }
    if (sequence.length > MAX_OLIGO_LENGTH) {
      errors.push(`${entry.name}: sequence is ${sequence.length} nt; the maximum is ${MAX_OLIGO_LENGTH} nt.`);
      return;
    }
    oligos.push({ id: `oligo-${index}`, name: entry.name, role: guessRole(entry.name), sequence });
  });

  return { oligos, errors };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/oligo-input.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/oligo-input.ts src/core/oligo-input.test.ts
git commit -m "feat(core): FASTA and plain-text oligo parsing with role hints"
```

---

### Task 1.5: Assay geometry check

This exists for one reason: it is the automated guard that catches a mistranscribed primer in the bundled library (Global Constraint 2). A single wrong base often still finds a binding site; a wrong *sequence* almost never produces a plausible amplicon.

**Files:**
- Create: `src/core/assay-geometry.ts`
- Test: `src/core/assay-geometry.test.ts`

**Interfaces:**
- Consumes: `BindingSite` from `src/core/binding.ts`; `OligoRole` from `src/core/oligo-input.ts`.
- Produces:
  - `interface GeometryInput { forward: BindingSite; reverse: BindingSite; probe?: BindingSite | undefined }`
  - `interface GeometryCheck { ok: boolean; ampliconLength: number | null; problems: string[] }`
  - `checkAssayGeometry(input: GeometryInput): GeometryCheck`
  - `MIN_AMPLICON = 50`, `MAX_AMPLICON = 300`

Rules: forward on `plus`; reverse on `minus`; same segment; `reverse.end > forward.start`; amplicon length `= reverse.end − forward.start + 1` within `[50, 300]`; probe (if present) fully inside `[forward.start, reverse.end]` and not overlapping either primer.

- [ ] **Step 1: Write the failing tests**

`src/core/assay-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkAssayGeometry } from './assay-geometry';
import type { BindingSite } from './binding';

const site = (over: Partial<BindingSite>): BindingSite => ({
  segment: 'main', strand: 'plus', start: 100, end: 120, mismatches: 0, mismatchOligoIndexes: [], ...over,
});

describe('checkAssayGeometry', () => {
  it('accepts a well-formed qPCR assay', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 200, end: 222, strand: 'minus' }),
      probe: site({ start: 140, end: 162, strand: 'plus' }),
    });
    expect(r.ok).toBe(true);
    expect(r.ampliconLength).toBe(123);
    expect(r.problems).toEqual([]);
  });

  it('rejects primers on the same strand', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 200, end: 222, strand: 'plus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/minus strand/i);
  });

  it('rejects primers on different segments', () => {
    const r = checkAssayGeometry({
      forward: site({ segment: 'seg4', strand: 'plus' }),
      reverse: site({ segment: 'seg6', strand: 'minus', start: 200, end: 222 }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/same segment/i);
  });

  it('rejects an implausibly long amplicon', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 900, end: 922, strand: 'minus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.ampliconLength).toBe(823);
    expect(r.problems.join(' ')).toMatch(/300/);
  });

  it('rejects an inverted primer pair', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 400, end: 420, strand: 'plus' }),
      reverse: site({ start: 100, end: 122, strand: 'minus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/downstream/i);
  });

  it('rejects a probe that overlaps a primer', () => {
    const r = checkAssayGeometry({
      forward: site({ start: 100, end: 120, strand: 'plus' }),
      reverse: site({ start: 200, end: 222, strand: 'minus' }),
      probe: site({ start: 118, end: 140, strand: 'plus' }),
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/overlap/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/assay-geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/assay-geometry.ts`:

```ts
import type { BindingSite } from './binding';

export const MIN_AMPLICON = 50;
export const MAX_AMPLICON = 300;

export interface GeometryInput {
  forward: BindingSite;
  reverse: BindingSite;
  probe?: BindingSite | undefined;
}

export interface GeometryCheck {
  ok: boolean;
  ampliconLength: number | null;
  problems: string[];
}

export function checkAssayGeometry({ forward, reverse, probe }: GeometryInput): GeometryCheck {
  const problems: string[] = [];

  if (forward.segment !== reverse.segment) {
    problems.push(
      `Forward and reverse primers must bind the same segment (found ${forward.segment} and ${reverse.segment}).`,
    );
  }
  if (forward.strand !== 'plus') problems.push('The forward primer should bind the plus strand.');
  if (reverse.strand !== 'minus') problems.push('The reverse primer should bind the minus strand.');

  let ampliconLength: number | null = null;
  if (forward.segment === reverse.segment) {
    if (reverse.end <= forward.start) {
      problems.push('The reverse primer must sit downstream of the forward primer.');
    } else {
      ampliconLength = reverse.end - forward.start + 1;
      if (ampliconLength < MIN_AMPLICON) {
        problems.push(`Amplicon is ${ampliconLength} nt; expected at least ${MIN_AMPLICON} nt.`);
      } else if (ampliconLength > MAX_AMPLICON) {
        problems.push(`Amplicon is ${ampliconLength} nt; expected at most ${MAX_AMPLICON} nt.`);
      }
    }
  }

  if (probe) {
    if (probe.segment !== forward.segment) {
      problems.push('The probe must bind the same segment as the primers.');
    } else if (probe.start <= forward.end || probe.end >= reverse.start) {
      problems.push('The probe must lie between the primers and must not overlap them.');
    }
  }

  return { ok: problems.length === 0, ampliconLength, problems };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/assay-geometry.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add src/core/assay-geometry.ts src/core/assay-geometry.test.ts
git commit -m "feat(core): amplicon plausibility check for assay verification"
```

> ### ⛔ REVIEW GATE — Phase 1
> Post the full `npm test` output and the coverage figure for `src/core/**`. Confirm in one sentence that a minus-strand oligo's 3′ end maps to the **lower** reference coordinate — this is the assumption every downstream number rests on. Then stop.

---

## Phase 2 — Pathogen registry, query construction, and the LAPIS client

This phase turns Part I into code. **Part I is the spec.** If something here disagrees with a live API response, stop and report it at the review gate rather than adjusting the code to whatever the API happened to return.

### Task 2.1: Pathogen registry and scope filters

**Files:**
- Create: `src/core/registry.ts`, `src/core/scope.ts`
- Test: `src/core/registry.test.ts`, `src/core/scope.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type PathogenId = 'sars-cov-2' | 'h5n1' | 'h3n2'`
  - `interface PathogenConfig { id; label; lapisBaseUrl; segmented; segmentLabels; dateField; dateFromParam; dateToParam; countryField; lineageField; lineageLabel; defaultWindowMonths; attribution }`
  - `PATHOGENS: Readonly<Record<PathogenId, PathogenConfig>>`
  - `getPathogen(id: PathogenId): PathogenConfig`
  - `interface Scope { pathogenId: PathogenId; dateFrom: string; dateTo: string; countries: string[]; lineages: string[] }`
  - `scopeToFilters(scope: Scope, cfg: PathogenConfig): Record<string, string | string[]>`

- [ ] **Step 1: Write the failing tests**

`src/core/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PATHOGENS, getPathogen } from './registry';

describe('PATHOGENS', () => {
  it('carries the three v1 pathogens', () => {
    expect(Object.keys(PATHOGENS).sort()).toEqual(['h3n2', 'h5n1', 'sars-cov-2']);
  });

  it('uses the verified SARS-CoV-2 instance and date parameters', () => {
    const p = getPathogen('sars-cov-2');
    expect(p.lapisBaseUrl).toBe('https://lapis.cov-spectrum.org/open/v2');
    expect(p.segmented).toBe(false);
    expect(p.dateField).toBe('date');
    expect(p.dateFromParam).toBe('dateFrom');
    expect(p.dateToParam).toBe('dateTo');
    expect(p.lineageField).toBe('pangoLineage');
  });

  it('uses the range-bound date parameters on the influenza instances', () => {
    for (const id of ['h5n1', 'h3n2'] as const) {
      const p = getPathogen(id);
      expect(p.segmented).toBe(true);
      expect(p.dateField).toBe('sampleCollectionDateRangeLower');
      expect(p.dateFromParam).toBe('sampleCollectionDateRangeLowerFrom');
      expect(p.dateToParam).toBe('sampleCollectionDateRangeUpperTo');
    }
  });

  it('labels influenza segments by gene product', () => {
    expect(getPathogen('h5n1').segmentLabels.seg4).toMatch(/HA/);
    expect(getPathogen('h3n2').segmentLabels.seg6).toMatch(/NA/);
  });

  it('uses the correct lineage field per instance', () => {
    expect(getPathogen('h5n1').lineageField).toBe('clade');
    expect(getPathogen('h3n2').lineageField).toBe('cladeHA');
  });

  it('throws on an unknown id', () => {
    expect(() => getPathogen('ebola' as never)).toThrow(/ebola/);
  });
});
```

`src/core/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scopeToFilters, type Scope } from './scope';
import { getPathogen } from './registry';

const base: Scope = {
  pathogenId: 'sars-cov-2', dateFrom: '2021-02-01', dateTo: '2021-03-01',
  countries: ['United Kingdom'], lineages: [],
};

describe('scopeToFilters', () => {
  it('maps dates onto the instance-specific parameter names', () => {
    expect(scopeToFilters(base, getPathogen('sars-cov-2'))).toEqual({
      dateFrom: '2021-02-01', dateTo: '2021-03-01', country: ['United Kingdom'],
    });
  });

  it('uses range-bound parameters for influenza', () => {
    const flu: Scope = { ...base, pathogenId: 'h3n2', countries: [] };
    expect(scopeToFilters(flu, getPathogen('h3n2'))).toEqual({
      sampleCollectionDateRangeLowerFrom: '2021-02-01',
      sampleCollectionDateRangeUpperTo: '2021-03-01',
    });
  });

  it('omits empty country and lineage lists rather than sending empty arrays', () => {
    const empty: Scope = { ...base, countries: [], lineages: [] };
    expect(scopeToFilters(empty, getPathogen('sars-cov-2'))).not.toHaveProperty('country');
    expect(scopeToFilters(empty, getPathogen('sars-cov-2'))).not.toHaveProperty('pangoLineage');
  });

  it('includes lineages under the instance-specific field name', () => {
    const withLineage: Scope = { ...base, pathogenId: 'h3n2', lineages: ['J.2'] };
    expect(scopeToFilters(withLineage, getPathogen('h3n2'))).toMatchObject({ cladeHA: ['J.2'] });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/registry.test.ts src/core/scope.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/core/registry.ts`**

```ts
export type PathogenId = 'sars-cov-2' | 'h5n1' | 'h3n2';

export interface PathogenConfig {
  id: PathogenId;
  label: string;
  lapisBaseUrl: string;
  segmented: boolean;
  /** Segment name -> human label. Single entry keyed 'main' for unsegmented genomes. */
  segmentLabels: Readonly<Record<string, string>>;
  /** Metadata field to group by for the trend series. */
  dateField: string;
  dateFromParam: string;
  dateToParam: string;
  countryField: string;
  lineageField: string;
  lineageLabel: string;
  defaultWindowMonths: number;
  /** Shown in the methods paragraph and the caveat panel. */
  attribution: string;
}

const INFLUENZA_A_SEGMENTS: Readonly<Record<string, string>> = Object.freeze({
  seg1: 'PB2 (segment 1)',
  seg2: 'PB1 (segment 2)',
  seg3: 'PA (segment 3)',
  seg4: 'HA (segment 4)',
  seg5: 'NP (segment 5)',
  seg6: 'NA (segment 6)',
  seg7: 'M (segment 7)',
  seg8: 'NS (segment 8)',
});

export const PATHOGENS: Readonly<Record<PathogenId, PathogenConfig>> = Object.freeze({
  'sars-cov-2': {
    id: 'sars-cov-2',
    label: 'SARS-CoV-2',
    lapisBaseUrl: 'https://lapis.cov-spectrum.org/open/v2',
    segmented: false,
    segmentLabels: Object.freeze({ main: 'Genome' }),
    dateField: 'date',
    dateFromParam: 'dateFrom',
    dateToParam: 'dateTo',
    countryField: 'country',
    lineageField: 'pangoLineage',
    lineageLabel: 'Pango lineage',
    defaultWindowMonths: 6,
    attribution: 'GenSpectrum LAPIS over the Nextstrain open SARS-CoV-2 dataset (GenBank-derived).',
  },
  h5n1: {
    id: 'h5n1',
    label: 'Influenza A/H5N1',
    lapisBaseUrl: 'https://lapis.genspectrum.org/h5n1',
    segmented: true,
    segmentLabels: INFLUENZA_A_SEGMENTS,
    dateField: 'sampleCollectionDateRangeLower',
    dateFromParam: 'sampleCollectionDateRangeLowerFrom',
    dateToParam: 'sampleCollectionDateRangeUpperTo',
    countryField: 'country',
    lineageField: 'clade',
    lineageLabel: 'Clade',
    defaultWindowMonths: 12,
    attribution: 'GenSpectrum LAPIS over the Loculus H5N1 dataset (INSDC-derived).',
  },
  h3n2: {
    id: 'h3n2',
    label: 'Influenza A/H3N2',
    lapisBaseUrl: 'https://lapis.genspectrum.org/h3n2',
    segmented: true,
    segmentLabels: INFLUENZA_A_SEGMENTS,
    dateField: 'sampleCollectionDateRangeLower',
    dateFromParam: 'sampleCollectionDateRangeLowerFrom',
    dateToParam: 'sampleCollectionDateRangeUpperTo',
    countryField: 'country',
    lineageField: 'cladeHA',
    lineageLabel: 'HA clade',
    defaultWindowMonths: 12,
    attribution: 'GenSpectrum LAPIS over the Loculus H3N2 dataset (INSDC-derived).',
  },
});

export function getPathogen(id: PathogenId): PathogenConfig {
  const cfg = PATHOGENS[id];
  if (!cfg) throw new Error(`Unknown pathogen id "${id}"`);
  return cfg;
}
```

- [ ] **Step 4: Implement `src/core/scope.ts`**

```ts
import type { PathogenConfig, PathogenId } from './registry';

export interface Scope {
  pathogenId: PathogenId;
  /** ISO yyyy-mm-dd, inclusive. */
  dateFrom: string;
  /** ISO yyyy-mm-dd, inclusive. */
  dateTo: string;
  countries: string[];
  lineages: string[];
}

export function scopeToFilters(
  scope: Scope,
  cfg: PathogenConfig,
): Record<string, string | string[]> {
  const filters: Record<string, string | string[]> = {
    [cfg.dateFromParam]: scope.dateFrom,
    [cfg.dateToParam]: scope.dateTo,
  };
  if (scope.countries.length > 0) filters[cfg.countryField] = scope.countries;
  if (scope.lineages.length > 0) filters[cfg.lineageField] = scope.lineages;
  return filters;
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run src/core/registry.test.ts src/core/scope.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/registry.ts src/core/scope.ts src/core/registry.test.ts src/core/scope.test.ts
git commit -m "feat(core): pathogen registry with per-instance field mapping"
```

---

### Task 2.2: Fetch and bundle reference genomes

**Files:**
- Create: `scripts/fetch-references.ts`
- Create (generated, committed): `src/data/references/sars-cov-2.json`, `h5n1.json`, `h3n2.json`
- Create: `src/data/references/index.ts`
- Test: `src/data/references/references.test.ts`

**Interfaces:**
- Consumes: `PATHOGENS` from `src/core/registry.ts`; `ReferenceGenome` from `src/core/reference.ts`.
- Produces: `loadReference(id: PathogenId): ReferenceGenome`

- [ ] **Step 1: Write the failing test**

`src/data/references/references.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadReference } from './index';

describe('bundled reference genomes', () => {
  it('has SARS-CoV-2 as a single 29903 nt segment named main', () => {
    const ref = loadReference('sars-cov-2');
    expect(ref.segments).toHaveLength(1);
    expect(ref.segments[0]!.name).toBe('main');
    expect(ref.segments[0]!.sequence).toHaveLength(29903);
  });

  it('matches the reference bases at the Alpha deletion window', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(21764, 21786)).toBe('TACATGTCTCTGGGACCAATGG');
  });

  it('matches the reference bases at the conserved control window', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(15783, 15805)).toBe('TTTAAGTCAGTTCTTTATTATC');
  });

  it('has eight segments for each influenza instance', () => {
    for (const id of ['h5n1', 'h3n2'] as const) {
      const ref = loadReference(id);
      expect(ref.segments.map((s) => s.name)).toEqual(
        ['seg1', 'seg2', 'seg3', 'seg4', 'seg5', 'seg6', 'seg7', 'seg8'],
      );
    }
  });

  it('has the verified HA segment lengths', () => {
    expect(loadReference('h5n1').segments[3]!.sequence).toHaveLength(1760);
    expect(loadReference('h3n2').segments[3]!.sequence).toHaveLength(1737);
  });

  it('contains only unambiguous IUPAC characters', () => {
    for (const id of ['sars-cov-2', 'h5n1', 'h3n2'] as const) {
      for (const seg of loadReference(id).segments) {
        expect(seg.sequence).toMatch(/^[ACGTRYSWKMBDHVN]+$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/data/references/references.test.ts`
Expected: FAIL — data files do not exist.

- [ ] **Step 3: Write the fetch script**

`scripts/fetch-references.ts`:

```ts
/**
 * Fetches reference genomes from each configured LAPIS instance and writes them
 * to src/data/references/<id>.json.
 *
 * The reference MUST come from the same instance that serves the mutation data,
 * otherwise reported coordinates and our binding-site coordinates can silently
 * disagree. Never substitute an NCBI RefSeq download.
 *
 * Run: npx tsx scripts/fetch-references.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PATHOGENS } from '../src/core/registry';

interface ReferenceGenomeResponse {
  nucleotideSequences: { name: string; sequence: string }[];
}

const OUT_DIR = join(process.cwd(), 'src', 'data', 'references');

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const cfg of Object.values(PATHOGENS)) {
    const url = `${cfg.lapisBaseUrl}/sample/referenceGenome`;
    process.stdout.write(`Fetching ${cfg.id} from ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${cfg.id}: HTTP ${res.status}`);
    const body = (await res.json()) as ReferenceGenomeResponse;
    const segments = body.nucleotideSequences.map((s) => ({
      name: s.name,
      sequence: s.sequence.toUpperCase(),
    }));
    if (segments.length === 0) throw new Error(`${cfg.id}: no segments returned`);
    if (cfg.segmented !== segments.length > 1) {
      throw new Error(
        `${cfg.id}: registry says segmented=${String(cfg.segmented)} but got ${segments.length} segment(s)`,
      );
    }
    const payload = {
      pathogenId: cfg.id,
      fetchedAt: new Date().toISOString().slice(0, 10),
      source: url,
      segments,
    };
    writeFileSync(join(OUT_DIR, `${cfg.id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `  ${segments.map((s) => `${s.name}:${s.sequence.length}`).join(' ')}\n`,
    );
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 4: Run the script**

```bash
npm install -D tsx
npx tsx scripts/fetch-references.ts
```

Expected output includes `main:29903`, and `seg4:1760` for h5n1, `seg4:1737` for h3n2. If any length differs from Part I, **stop and report at the review gate** — the reference has been revised upstream and the golden-case numbers need re-verifying.

- [ ] **Step 5: Implement the loader**

`src/data/references/index.ts`:

```ts
import type { PathogenId } from '../../core/registry';
import type { ReferenceGenome } from '../../core/reference';
import sarsCov2 from './sars-cov-2.json';
import h5n1 from './h5n1.json';
import h3n2 from './h3n2.json';

interface ReferenceFile {
  pathogenId: string;
  fetchedAt: string;
  source: string;
  segments: { name: string; sequence: string }[];
}

const FILES: Record<PathogenId, ReferenceFile> = {
  'sars-cov-2': sarsCov2 as ReferenceFile,
  h5n1: h5n1 as ReferenceFile,
  h3n2: h3n2 as ReferenceFile,
};

export function loadReference(id: PathogenId): ReferenceGenome {
  const file = FILES[id];
  if (!file) throw new Error(`No bundled reference for "${id}"`);
  return { pathogenId: file.pathogenId, segments: file.segments };
}

export function referenceFetchedAt(id: PathogenId): string {
  return FILES[id].fetchedAt;
}
```

- [ ] **Step 6: Run and confirm pass**

Run: `npx vitest run src/data/references/references.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Add a script alias and commit**

Add to `package.json` scripts: `"refs": "tsx scripts/fetch-references.ts"`.

```bash
git add scripts/fetch-references.ts src/data/references package.json
git commit -m "feat(data): bundle LAPIS reference genomes for the three v1 pathogens"
```

---

### Task 2.3: Window specification and `advancedQuery` construction

**This is the highest-risk task in the project.** A subtle error here produces numbers that look plausible and are wrong. Re-read Part I.4 before starting.

**Files:**
- Create: `src/core/query.ts`
- Modify: `src/core/iupac.ts` (add `complementBase`)
- Test: `src/core/query.test.ts`

**Interfaces:**
- Consumes: `BindingSite`, `oligoIndexToRefPos` from `src/core/binding.ts`; `baseAt` from `src/core/reference.ts`; `acceptedBases`, `normalizeOligo` from `src/core/iupac.ts`; `OligoRole` from `src/core/oligo-input.ts`.
- Produces:
  - `complementBase(code: string): string` (added to `iupac.ts`)
  - `interface PositionSpec { refPos; refBase; oligoBase; plusStrandBase; oligoIndex; distanceFrom3Prime; acceptedAlleles: string[]; mismatchAlleles: string[]; referenceIsAmbiguous: boolean }`
  - `interface WindowSpec { qualifier: string | null; segment: string; role: OligoRole; length: number; positions: PositionSpec[] }`
  - `buildWindowSpec(site: BindingSite, oligo: string, ref: ReferenceGenome, role: OligoRole, opts: { segmented: boolean }): WindowSpec`
  - `mismatchTerm(w: WindowSpec, p: PositionSpec): string`
  - `ambiguityTerm(w: WindowSpec, p: PositionSpec): string`
  - `fullCoverageQuery(w: WindowSpec): string`
  - `mismatchWithCoverageQuery(w: WindowSpec): string`
  - `isMismatchAllele(allele: string, plusStrandBase: string): boolean`

`positions` is ordered **5′→3′ along the oligo**, so for a minus-strand site `refPos` descends. This ordering is what the position-profile chart renders beneath the oligo sequence.

`plusStrandBase` is the oligo base **expressed on the plus strand of the reference** — identical to `oligoBase` for a plus-strand site, and its complement for a minus-strand site. All allele comparisons use `plusStrandBase`, because LAPIS reports alleles on the plus strand.

- [ ] **Step 1: Add `complementBase` to `src/core/iupac.ts`**

Append to `src/core/iupac.ts`:

```ts
export function complementBase(code: string): string {
  const comp = COMPLEMENT[code];
  if (comp === undefined) throw new Error(`Cannot complement "${code}"`);
  return comp;
}
```

Append to `src/core/iupac.test.ts`:

```ts
import { complementBase } from './iupac';

describe('complementBase', () => {
  it('complements single bases including degenerate codes', () => {
    expect(complementBase('A')).toBe('T');
    expect(complementBase('Y')).toBe('R');
    expect(complementBase('N')).toBe('N');
  });
  it('throws on an unknown code', () => {
    expect(() => complementBase('-')).toThrow();
  });
});
```

- [ ] **Step 2: Write the failing tests**

`src/core/query.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildWindowSpec, mismatchTerm, ambiguityTerm,
  fullCoverageQuery, mismatchWithCoverageQuery, isMismatchAllele,
} from './query';
import { findBindingSites, type ReferenceGenome } from './binding';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};
const SEGMENTED: ReferenceGenome = {
  pathogenId: 'test-flu',
  segments: [{ name: 'seg4', sequence: 'CCCCATGCATGCGGGG' }],
};

const plusSite = () => findBindingSites('ATGCATGC', REF)[0]!;
const minusSite = () => findBindingSites('GCATGCAT', REF)[0]!;

describe('buildWindowSpec — plus strand', () => {
  const w = () => buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });

  it('orders positions 5prime to 3prime with ascending refPos', () => {
    expect(w().positions.map((p) => p.refPos)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });
  it('computes distance from the 3prime end', () => {
    expect(w().positions.map((p) => p.distanceFrom3Prime)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
  });
  it('leaves the qualifier null for an unsegmented genome', () => {
    expect(w().qualifier).toBeNull();
  });
  it('records the plus-strand base identical to the oligo base', () => {
    expect(w().positions[0]).toMatchObject({ oligoBase: 'A', plusStrandBase: 'A', refBase: 'A' });
  });
});

describe('buildWindowSpec — minus strand', () => {
  const w = () => buildWindowSpec(minusSite(), 'GCATGCAT', REF, 'reverse', { segmented: false });

  it('orders positions 5prime to 3prime with descending refPos', () => {
    expect(w().positions.map((p) => p.refPos)).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
  });
  it("puts the oligo's 3prime end at the lowest reference position", () => {
    const last = w().positions.at(-1)!;
    expect(last.refPos).toBe(5);
    expect(last.distanceFrom3Prime).toBe(0);
  });
  it('records the complement of the oligo base as the plus-strand base', () => {
    // oligo 5' base is G; on the plus strand that position reads C
    expect(w().positions[0]).toMatchObject({ oligoBase: 'G', plusStrandBase: 'C', refBase: 'C' });
  });
});

describe('buildWindowSpec — segmented', () => {
  it('sets the qualifier to the segment name', () => {
    const site = findBindingSites('ATGCATGC', SEGMENTED)[0]!;
    const w = buildWindowSpec(site, 'ATGCATGC', SEGMENTED, 'forward', { segmented: true });
    expect(w.qualifier).toBe('seg4');
    expect(w.segment).toBe('seg4');
  });
});

describe('isMismatchAllele', () => {
  it('treats a deletion as a mismatch under any oligo base', () => {
    expect(isMismatchAllele('-', 'N')).toBe(true);
  });
  it('accepts an allele covered by a degenerate oligo base', () => {
    expect(isMismatchAllele('C', 'Y')).toBe(false);
    expect(isMismatchAllele('A', 'Y')).toBe(true);
  });
});

describe('mismatchTerm', () => {
  it('case A: emits a bare position term when the oligo matches the reference exactly', () => {
    const w = buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[0]!)).toBe('5');
  });

  it('case A with a segment qualifier', () => {
    const site = findBindingSites('ATGCATGC', SEGMENTED)[0]!;
    const w = buildWindowSpec(site, 'ATGCATGC', SEGMENTED, 'forward', { segmented: true });
    expect(mismatchTerm(w, w.positions[0]!)).toBe('seg4:5');
  });

  it('case B: enumerates disallowed alleles for a degenerate oligo base', () => {
    // ref position 8 is C; oligo base Y accepts C and T, so mismatches are A, G and deletion
    const site = findBindingSites('ATGYATGC', REF)[0]!;
    const w = buildWindowSpec(site, 'ATGYATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[3]!)).toBe('(C8A | C8G | C8-)');
  });

  it('case B: an N oligo base leaves only the deletion as a mismatch', () => {
    const site = findBindingSites('ATGNATGC', REF)[0]!;
    const w = buildWindowSpec(site, 'ATGNATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[3]!)).toBe('(C8-)');
  });

  it('case C: inverts when the oligo does not match the reference at that position', () => {
    // ref position 8 is C; oligo base A matches nothing there, so any allele other than A is a mismatch
    const site = findBindingSites('ATGAATGC', REF, { maxMismatches: 1 })[0]!;
    const w = buildWindowSpec(site, 'ATGAATGC', REF, 'forward', { segmented: false });
    expect(mismatchTerm(w, w.positions[3]!)).toBe('!(C8A)');
  });
});

describe('ambiguityTerm', () => {
  it('emits the N term, qualified when segmented', () => {
    const w = buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });
    expect(ambiguityTerm(w, w.positions[0]!)).toBe('5N');
    const site = findBindingSites('ATGCATGC', SEGMENTED)[0]!;
    const ws = buildWindowSpec(site, 'ATGCATGC', SEGMENTED, 'forward', { segmented: true });
    expect(ambiguityTerm(ws, ws.positions[0]!)).toBe('seg4:5N');
  });
});

describe('window queries', () => {
  const w = () => buildWindowSpec(plusSite(), 'ATGCATGC', REF, 'forward', { segmented: false });

  it('builds the full-coverage clause', () => {
    expect(fullCoverageQuery(w())).toBe('!(5N | 6N | 7N | 8N | 9N | 10N | 11N | 12N)');
  });

  it('builds the mismatch clause anded with full coverage', () => {
    expect(mismatchWithCoverageQuery(w())).toBe(
      '(5 | 6 | 7 | 8 | 9 | 10 | 11 | 12) & !(5N | 6N | 7N | 8N | 9N | 10N | 11N | 12N)',
    );
  });

  it('matches the exact shape verified against the live API for the Alpha window', () => {
    // Filler is poly-G, not poly-N: an N in the reference matches every oligo base,
    // so an N-filled prefix would produce a zero-mismatch hit at every offset.
    const alpha: ReferenceGenome = {
      pathogenId: 'sars-cov-2',
      segments: [{ name: 'main', sequence: 'G'.repeat(21764) + 'TACATGTCTCTGGGACCAATGG' }],
    };
    const site = findBindingSites('TACATGTCTCTGGGACCAATGG', alpha)[0]!;
    const spec = buildWindowSpec(site, 'TACATGTCTCTGGGACCAATGG', alpha, 'forward', { segmented: false });
    expect(spec.positions[0]!.refPos).toBe(21765);
    expect(spec.positions.at(-1)!.refPos).toBe(21786);
    expect(mismatchWithCoverageQuery(spec)).toContain('(21765 | 21766 | 21767');
    expect(mismatchWithCoverageQuery(spec)).toContain('& !(21765N | 21766N');
  });
});

describe('ambiguous reference bases', () => {
  const AMBIG: ReferenceGenome = {
    pathogenId: 'test',
    segments: [{ name: 'main', sequence: 'GGGGATGNATGCAAAA' }],
  };
  it('excludes a position whose reference base is ambiguous from both clauses', () => {
    const site = findBindingSites('ATGCATGC', AMBIG)[0]!;
    const w = buildWindowSpec(site, 'ATGCATGC', AMBIG, 'forward', { segmented: false });
    expect(w.positions[3]!.referenceIsAmbiguous).toBe(true);
    expect(fullCoverageQuery(w)).not.toContain('8N');
    expect(mismatchWithCoverageQuery(w)).not.toContain(' 8 ');
  });

  it('throws if every position is unusable', () => {
    const allAmbig: ReferenceGenome = {
      pathogenId: 'test',
      segments: [{ name: 'main', sequence: 'NNNNNNNNNNNN' }],
    };
    const site = findBindingSites('NNNNNNNN', allAmbig)[0]!;
    const w = buildWindowSpec(site, 'NNNNNNNN', allAmbig, 'forward', { segmented: false });
    expect(() => fullCoverageQuery(w)).toThrow(/no usable positions/i);
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run src/core/query.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`src/core/query.ts`:

```ts
import { oligoIndexToRefPos, type BindingSite } from './binding';
import { baseAt, type ReferenceGenome } from './reference';
import { acceptedBases, complementBase, normalizeOligo } from './iupac';
import type { OligoRole } from './oligo-input';

/** Alleles LAPIS can report at a position. '-' is a deletion. */
export const ALL_ALLELES = ['A', 'C', 'G', 'T', '-'] as const;

export interface PositionSpec {
  /** 1-based reference position. */
  refPos: number;
  /** Reference base at refPos, plus strand. */
  refBase: string;
  /** The oligo's own base, 5'->3'. */
  oligoBase: string;
  /** The oligo base expressed on the plus strand (complemented for minus-strand sites). */
  plusStrandBase: string;
  /** 0-based index along the oligo, 5'->3'. */
  oligoIndex: number;
  distanceFrom3Prime: number;
  /** Alleles the oligo binds at this position, plus strand. Never contains '-'. */
  acceptedAlleles: string[];
  /** Alleles that constitute a mismatch, plus strand. Always contains '-' unless excluded. */
  mismatchAlleles: string[];
  referenceIsAmbiguous: boolean;
}

export interface WindowSpec {
  /** Segment prefix for query terms, or null when the genome is unsegmented. */
  qualifier: string | null;
  segment: string;
  role: OligoRole;
  length: number;
  /** Ordered 5'->3' along the oligo. */
  positions: PositionSpec[];
}

export function isMismatchAllele(allele: string, plusStrandBase: string): boolean {
  if (allele === '-') return true;
  return !acceptedBases(plusStrandBase).has(allele);
}

export function buildWindowSpec(
  site: BindingSite,
  oligo: string,
  ref: ReferenceGenome,
  role: OligoRole,
  opts: { segmented: boolean },
): WindowSpec {
  const normalized = normalizeOligo(oligo);
  const length = site.end - site.start + 1;
  if (normalized.length !== length) {
    throw new Error(`Oligo length ${normalized.length} does not match site length ${length}`);
  }

  const positions: PositionSpec[] = [];
  for (let i = 0; i < length; i += 1) {
    const refPos = oligoIndexToRefPos(site, i);
    const refBase = baseAt(ref, site.segment, refPos);
    const oligoBase = normalized[i] as string;
    const plusStrandBase = site.strand === 'plus' ? oligoBase : complementBase(oligoBase);
    const accepted = [...acceptedBases(plusStrandBase)].sort();
    positions.push({
      refPos,
      refBase,
      oligoBase,
      plusStrandBase,
      oligoIndex: i,
      distanceFrom3Prime: length - 1 - i,
      acceptedAlleles: accepted,
      mismatchAlleles: ALL_ALLELES.filter((a) => isMismatchAllele(a, plusStrandBase)),
      referenceIsAmbiguous: !['A', 'C', 'G', 'T'].includes(refBase),
    });
  }

  return {
    qualifier: opts.segmented ? site.segment : null,
    segment: site.segment,
    role,
    length,
    positions,
  };
}

function bareTerm(qualifier: string | null, refPos: number): string {
  return qualifier ? `${qualifier}:${refPos}` : `${refPos}`;
}

function alleleTerm(qualifier: string | null, from: string, refPos: number, to: string): string {
  const core = `${from}${refPos}${to}`;
  return qualifier ? `${qualifier}:${core}` : core;
}

export function ambiguityTerm(w: WindowSpec, p: PositionSpec): string {
  return `${bareTerm(w.qualifier, p.refPos)}N`;
}

/**
 * See Part I.4 of the implementation plan. Three cases:
 *   A  oligo is non-degenerate and matches the reference -> bare position term
 *   B  oligo accepts the reference base plus others      -> enumerate disallowed alleles
 *   C  oligo does not accept the reference base          -> negate the accepted alleles
 */
export function mismatchTerm(w: WindowSpec, p: PositionSpec): string {
  const { qualifier } = w;
  const accepted = p.acceptedAlleles;
  const acceptsReference = accepted.includes(p.refBase);

  if (acceptsReference && accepted.length === 1) {
    return bareTerm(qualifier, p.refPos);
  }
  if (acceptsReference) {
    const terms = p.mismatchAlleles.map((x) => alleleTerm(qualifier, p.refBase, p.refPos, x));
    return `(${terms.join(' | ')})`;
  }
  const terms = accepted.map((a) => alleleTerm(qualifier, p.refBase, p.refPos, a));
  return `!(${terms.join(' | ')})`;
}

function usablePositions(w: WindowSpec): PositionSpec[] {
  const usable = w.positions.filter((p) => !p.referenceIsAmbiguous);
  if (usable.length === 0) {
    throw new Error('This binding site has no usable positions: every reference base is ambiguous.');
  }
  return usable;
}

export function fullCoverageQuery(w: WindowSpec): string {
  const terms = usablePositions(w).map((p) => ambiguityTerm(w, p));
  return `!(${terms.join(' | ')})`;
}

export function mismatchWithCoverageQuery(w: WindowSpec): string {
  const usable = usablePositions(w);
  const mismatch = usable.map((p) => mismatchTerm(w, p)).join(' | ');
  const ambiguity = usable.map((p) => ambiguityTerm(w, p)).join(' | ');
  return `(${mismatch}) & !(${ambiguity})`;
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run src/core/query.test.ts src/core/iupac.test.ts`
Expected: PASS — 21 tests in `query.test.ts`, and `iupac.test.ts` now at 18 with the two new `complementBase` cases.

- [ ] **Step 6: Commit**

```bash
git add src/core/query.ts src/core/query.test.ts src/core/iupac.ts src/core/iupac.test.ts
git commit -m "feat(core): window specification and advancedQuery construction"
```

---

### Task 2.4: Transport layer

**Files:**
- Create: `src/core/lapis/transport.ts`, `src/core/lapis/fetch-transport.ts`, `src/core/lapis/caching-transport.ts`
- Test: `src/core/lapis/fetch-transport.test.ts`, `src/core/lapis/caching-transport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LapisEndpoint = 'aggregated' | 'nucleotideMutations' | 'nucleotideInsertions'`
  - `interface LapisRequest { baseUrl: string; endpoint: LapisEndpoint; body: Record<string, unknown>; signal?: AbortSignal | undefined }`
  - `interface LapisResponse<T> { data: T[]; dataVersion: string; requestId: string }`
  - `interface LapisTransport { query<T>(req: LapisRequest): Promise<LapisResponse<T>> }`
  - `class LapisError extends Error { status: number; detail: string; requestId: string | null }`
  - `createFetchTransport(opts?: { fetchImpl?: typeof fetch; maxRetries?: number; sleep?: (ms: number) => Promise<void> }): LapisTransport`
  - `withCache(inner: LapisTransport, opts?: { ttlMs?: number; storage?: Storage | null; now?: () => number }): LapisTransport`
  - `cacheKey(req: LapisRequest): string`

Retry policy: on HTTP 429 or 5xx, retry up to `maxRetries` (default 3) with `Retry-After` if present, otherwise exponential backoff `500ms × 2ⁿ`. **HTTP 400 is never retried** — it means our query is wrong and retrying hides the bug.

- [ ] **Step 1: Write the failing tests**

`src/core/lapis/fetch-transport.test.ts`:

```ts
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
    expect(res).toEqual({ data: [{ count: 7 }], dataVersion: '123', requestId: 'rid-1' });
  });

  it('throws LapisError carrying the API detail on 400 and does not retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { status: 400, title: 'Bad Request', detail: "Unknown field: 'zzz'" } }),
        { status: 400 },
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
```

`src/core/lapis/caching-transport.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/lapis`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/core/lapis/transport.ts`**

```ts
export type LapisEndpoint = 'aggregated' | 'nucleotideMutations' | 'nucleotideInsertions';

export interface LapisRequest {
  baseUrl: string;
  endpoint: LapisEndpoint;
  body: Record<string, unknown>;
  signal?: AbortSignal | undefined;
}

export interface LapisResponse<T> {
  data: T[];
  dataVersion: string;
  requestId: string;
}

export interface LapisTransport {
  query<T>(req: LapisRequest): Promise<LapisResponse<T>>;
}
```

- [ ] **Step 4: Implement `src/core/lapis/fetch-transport.ts`**

```ts
import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

export class LapisError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly requestId: string | null;

  constructor(status: number, detail: string, requestId: string | null) {
    super(`LAPIS ${status}: ${detail}`);
    this.name = 'LapisError';
    this.status = status;
    this.detail = detail;
    this.requestId = requestId;
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
  new Promise((resolve) => { setTimeout(resolve, ms); });

export function createFetchTransport(
  opts: {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): LapisTransport {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      const url = `${req.baseUrl}/sample/${req.endpoint}`;
      let attempt = 0;

      for (;;) {
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(req.body),
          ...(req.signal ? { signal: req.signal } : {}),
        });

        if (res.ok) {
          const body = (await res.json()) as SuccessBody<T>;
          return {
            data: body.data,
            dataVersion: body.info?.dataVersion ?? 'unknown',
            requestId: body.info?.requestId ?? 'unknown',
          };
        }

        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= maxRetries) {
          let detail = `HTTP ${res.status}`;
          let requestId: string | null = null;
          try {
            const body = (await res.json()) as ErrorBody;
            if (body.error?.detail) detail = body.error.detail;
            requestId = body.info?.requestId ?? null;
          } catch {
            // non-JSON error body; keep the status-only detail
          }
          throw new LapisError(res.status, detail, requestId);
        }

        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 500 * 2 ** attempt;
        await sleep(waitMs);
        attempt += 1;
      }
    },
  };
}
```

- [ ] **Step 5: Implement `src/core/lapis/caching-transport.ts`**

```ts
import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

const STORAGE_PREFIX = 'adw:q:';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function cacheKey(req: LapisRequest): string {
  return `${req.baseUrl}|${req.endpoint}|${stableStringify(req.body)}`;
}

interface Entry {
  at: number;
  value: LapisResponse<unknown>;
}

export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours; LAPIS data updates daily at most

export function withCache(
  inner: LapisTransport,
  opts: { ttlMs?: number; storage?: Storage | null; now?: () => number } = {},
): LapisTransport {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const storage =
    opts.storage === undefined
      ? (typeof sessionStorage === 'undefined' ? null : sessionStorage)
      : opts.storage;

  const memory = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<LapisResponse<unknown>>>();

  const readStorage = (key: string): Entry | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_PREFIX + key);
      return raw ? (JSON.parse(raw) as Entry) : null;
    } catch {
      return null;
    }
  };

  const writeStorage = (key: string, entry: Entry): void => {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // storage full or unavailable; the memory cache still works
    }
  };

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      const key = cacheKey(req);
      const fresh = (e: Entry | null): boolean => e !== null && now() - e.at < ttlMs;

      const hit = memory.get(key) ?? readStorage(key);
      if (fresh(hit)) return hit!.value as LapisResponse<T>;

      const existing = inFlight.get(key);
      if (existing) return (await existing) as LapisResponse<T>;

      const promise = inner.query<T>(req).then((value) => {
        const entry: Entry = { at: now(), value: value as LapisResponse<unknown> };
        memory.set(key, entry);
        writeStorage(key, entry);
        return value as LapisResponse<unknown>;
      });
      inFlight.set(key, promise);
      try {
        return (await promise) as LapisResponse<T>;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
```

- [ ] **Step 6: Run and confirm pass**

Run: `npx vitest run src/core/lapis`
Expected: PASS, 13 tests (5 transport, 3 cache-key, 5 cache behaviour).

- [ ] **Step 7: Commit**

```bash
git add src/core/lapis
git commit -m "feat(lapis): transport interface, fetch implementation with backoff, caching decorator"
```

---

### Task 2.5: Typed endpoint wrappers

**Files:**
- Create: `src/core/lapis/endpoints.ts`
- Test: `src/core/lapis/endpoints.test.ts`

**Interfaces:**
- Consumes: `LapisTransport`, `LapisResponse` from `./transport`; `PathogenConfig` from `../registry`.
- Produces:
  - `interface AggregatedRow { count: number; [field: string]: string | number | null }`
  - `interface MutationRow { mutation: string; count: number; coverage: number; proportion: number; sequenceName: string | null; mutationFrom: string; mutationTo: string; position: number }`
  - `interface InsertionRow { insertion: string; count: number; insertedSymbols: string; position: number; sequenceName: string | null }`
  - `queryAggregated(t, cfg, filters, opts?: { fields?: string[]; advancedQuery?: string; signal?: AbortSignal }): Promise<LapisResponse<AggregatedRow>>`
  - `queryNucleotideMutations(t, cfg, filters, opts?: { minProportion?: number; signal?: AbortSignal }): Promise<LapisResponse<MutationRow>>`
  - `queryNucleotideInsertions(t, cfg, filters, opts?: { signal?: AbortSignal }): Promise<LapisResponse<InsertionRow>>`

- [ ] **Step 1: Write the failing tests**

`src/core/lapis/endpoints.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { queryAggregated, queryNucleotideMutations, queryNucleotideInsertions } from './endpoints';
import { getPathogen } from '../registry';
import type { LapisRequest, LapisTransport } from './transport';

const recorder = () => {
  const seen: LapisRequest[] = [];
  const transport: LapisTransport = {
    async query(req) {
      seen.push(req);
      return { data: [], dataVersion: 'v', requestId: 'r' };
    },
  };
  return { seen, transport };
};

describe('queryAggregated', () => {
  it('targets the pathogen base url and merges filters, fields and advancedQuery', async () => {
    const { seen, transport } = recorder();
    await queryAggregated(
      transport,
      getPathogen('sars-cov-2'),
      { dateFrom: '2021-02-01', country: ['United Kingdom'] },
      { fields: ['date'], advancedQuery: '21765' },
    );
    expect(seen[0]).toMatchObject({
      baseUrl: 'https://lapis.cov-spectrum.org/open/v2',
      endpoint: 'aggregated',
      body: {
        dateFrom: '2021-02-01',
        country: ['United Kingdom'],
        fields: ['date'],
        advancedQuery: '21765',
      },
    });
  });

  it('omits fields and advancedQuery when not supplied', async () => {
    const { seen, transport } = recorder();
    await queryAggregated(transport, getPathogen('h3n2'), {});
    expect(seen[0]!.body).not.toHaveProperty('fields');
    expect(seen[0]!.body).not.toHaveProperty('advancedQuery');
  });
});

describe('queryNucleotideMutations', () => {
  it('defaults minProportion to 0 so rare mismatches are not hidden', async () => {
    const { seen, transport } = recorder();
    await queryNucleotideMutations(transport, getPathogen('sars-cov-2'), {});
    expect(seen[0]!.endpoint).toBe('nucleotideMutations');
    expect(seen[0]!.body).toMatchObject({ minProportion: 0 });
  });
});

describe('queryNucleotideInsertions', () => {
  it('sends no minProportion because the endpoint has no coverage concept', async () => {
    const { seen, transport } = recorder();
    await queryNucleotideInsertions(transport, getPathogen('h5n1'), {});
    expect(seen[0]!.endpoint).toBe('nucleotideInsertions');
    expect(seen[0]!.body).not.toHaveProperty('minProportion');
  });
});

describe('abort signals', () => {
  it('are forwarded to the transport', async () => {
    const { seen, transport } = recorder();
    const signal = new AbortController().signal;
    await queryAggregated(transport, getPathogen('h5n1'), {}, { signal });
    expect(seen[0]!.signal).toBe(signal);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/lapis/endpoints.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/lapis/endpoints.ts`:

```ts
import type { PathogenConfig } from '../registry';
import type { LapisResponse, LapisTransport } from './transport';

export interface AggregatedRow {
  count: number;
  [field: string]: string | number | null;
}

export interface MutationRow {
  mutation: string;
  count: number;
  /** Sequences in scope with a definite call at this position. */
  coverage: number;
  proportion: number;
  /** Segment name, or null on unsegmented genomes. */
  sequenceName: string | null;
  mutationFrom: string;
  /** Alternate allele; '-' denotes a deletion. */
  mutationTo: string;
  position: number;
}

export interface InsertionRow {
  insertion: string;
  count: number;
  insertedSymbols: string;
  position: number;
  sequenceName: string | null;
}

type Filters = Record<string, unknown>;

export async function queryAggregated(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  opts: { fields?: string[]; advancedQuery?: string; signal?: AbortSignal } = {},
): Promise<LapisResponse<AggregatedRow>> {
  return transport.query<AggregatedRow>({
    baseUrl: cfg.lapisBaseUrl,
    endpoint: 'aggregated',
    body: {
      ...filters,
      ...(opts.fields ? { fields: opts.fields } : {}),
      ...(opts.advancedQuery ? { advancedQuery: opts.advancedQuery } : {}),
    },
    signal: opts.signal,
  });
}

export async function queryNucleotideMutations(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  opts: { minProportion?: number; signal?: AbortSignal } = {},
): Promise<LapisResponse<MutationRow>> {
  return transport.query<MutationRow>({
    baseUrl: cfg.lapisBaseUrl,
    endpoint: 'nucleotideMutations',
    body: { ...filters, minProportion: opts.minProportion ?? 0 },
    signal: opts.signal,
  });
}

export async function queryNucleotideInsertions(
  transport: LapisTransport,
  cfg: PathogenConfig,
  filters: Filters,
  opts: { signal?: AbortSignal } = {},
): Promise<LapisResponse<InsertionRow>> {
  return transport.query<InsertionRow>({
    baseUrl: cfg.lapisBaseUrl,
    endpoint: 'nucleotideInsertions',
    body: { ...filters },
    signal: opts.signal,
  });
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/lapis/endpoints.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/lapis/endpoints.ts src/core/lapis/endpoints.test.ts
git commit -m "feat(lapis): typed endpoint wrappers"
```

---

### Task 2.6: Fixture recording and the live contract test

Golden tests must be deterministic, so they run against committed fixtures. A **separate** live test proves the fixtures still describe reality.

**Files:**
- Create: `scripts/record-fixtures.ts`
- Create: `src/core/lapis/fixture-transport.ts`
- Create (generated, committed): `tests/fixtures/*.json`
- Test: `src/core/lapis/fixture-transport.test.ts`, `tests/live/contract.live.test.ts`

**Interfaces:**
- Consumes: `LapisTransport`, `LapisRequest` from `./transport`.
- Produces:
  - `interface FixtureRecord { request: { baseUrl: string; endpoint: string; body: Record<string, unknown> }; response: { data: unknown[]; dataVersion: string; requestId: string } }`
  - `createFixtureTransport(records: FixtureRecord[]): LapisTransport` — throws a descriptive error listing available keys when a request is unmatched
  - `loadFixtureSet(name: string): FixtureRecord[]`

- [ ] **Step 1: Write the failing test for the fixture transport**

`src/core/lapis/fixture-transport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFixtureTransport, type FixtureRecord } from './fixture-transport';

const records: FixtureRecord[] = [
  {
    request: { baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { a: 1, b: 2 } },
    response: { data: [{ count: 42 }], dataVersion: 'dv', requestId: 'rid' },
  },
];

describe('createFixtureTransport', () => {
  it('matches a request regardless of body key order', async () => {
    const t = createFixtureTransport(records);
    const res = await t.query({ baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { b: 2, a: 1 } });
    expect(res.data).toEqual([{ count: 42 }]);
    expect(res.dataVersion).toBe('dv');
  });

  it('throws a diagnostic error when no fixture matches', async () => {
    const t = createFixtureTransport(records);
    await expect(
      t.query({ baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { a: 9 } }),
    ).rejects.toThrow(/no fixture/i);
    await expect(
      t.query({ baseUrl: 'https://x/v2', endpoint: 'aggregated', body: { a: 9 } }),
    ).rejects.toThrow(/"a":1/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/lapis/fixture-transport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fixture transport**

`src/core/lapis/fixture-transport.ts`:

```ts
import { cacheKey } from './caching-transport';
import type { LapisRequest, LapisResponse, LapisTransport } from './transport';

export interface FixtureRecord {
  request: { baseUrl: string; endpoint: string; body: Record<string, unknown> };
  response: { data: unknown[]; dataVersion: string; requestId: string };
}

export function createFixtureTransport(records: FixtureRecord[]): LapisTransport {
  const index = new Map<string, FixtureRecord>();
  for (const record of records) {
    index.set(cacheKey(record.request as unknown as LapisRequest), record);
  }

  return {
    async query<T>(req: LapisRequest): Promise<LapisResponse<T>> {
      const key = cacheKey(req);
      const hit = index.get(key);
      if (!hit) {
        throw new Error(
          `No fixture recorded for:\n  ${key}\nAvailable:\n  ${[...index.keys()].join('\n  ')}`,
        );
      }
      return {
        data: hit.response.data as T[],
        dataVersion: hit.response.dataVersion,
        requestId: hit.response.requestId,
      };
    },
  };
}
```

- [ ] **Step 4: Write the recording script**

`scripts/record-fixtures.ts`:

```ts
/**
 * Records the exact LAPIS responses the golden tests assert on.
 * Run: npx tsx scripts/record-fixtures.ts
 *
 * Re-run only deliberately. Re-recording is how a genuine upstream data change
 * enters the test suite, so the resulting diff must be reviewed by a human.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPathogen } from '../src/core/registry';
import { createFetchTransport } from '../src/core/lapis/fetch-transport';
import type { LapisRequest } from '../src/core/lapis/transport';
import type { FixtureRecord } from '../src/core/lapis/fixture-transport';

const OUT = join(process.cwd(), 'tests', 'fixtures');
const transport = createFetchTransport();

const window = (from: number, to: number, qualifier: string | null): { mismatch: string; coverage: string } => {
  const label = (p: number) => (qualifier ? `${qualifier}:${p}` : `${p}`);
  const positions = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const mism = positions.map((p) => label(p)).join(' | ');
  const ambi = positions.map((p) => `${label(p)}N`).join(' | ');
  return { mismatch: `(${mism}) & !(${ambi})`, coverage: `!(${ambi})` };
};

interface Case {
  name: string;
  requests: LapisRequest[];
}

const sc2 = getPathogen('sars-cov-2').lapisBaseUrl;
const h3n2 = getPathogen('h3n2').lapisBaseUrl;
const alpha = window(21765, 21786, null);
const control = window(15784, 15805, null);
const flu = window(600, 621, 'seg4');

const sc2Filters = (dateFrom: string, dateTo: string) => ({
  country: ['United Kingdom'], dateFrom, dateTo,
});
const fluFilters = (from: string, to: string) => ({
  sampleCollectionDateRangeLowerFrom: from, sampleCollectionDateRangeUpperTo: to,
});

const agg = (baseUrl: string, body: Record<string, unknown>): LapisRequest => ({
  baseUrl, endpoint: 'aggregated', body,
});

const CASES: Case[] = [
  {
    name: 'g1-alpha-2020-09',
    requests: [
      agg(sc2, sc2Filters('2020-09-01', '2020-10-01')),
      agg(sc2, { ...sc2Filters('2020-09-01', '2020-10-01'), advancedQuery: alpha.coverage }),
      agg(sc2, { ...sc2Filters('2020-09-01', '2020-10-01'), advancedQuery: alpha.mismatch }),
    ],
  },
  {
    name: 'g1-alpha-2021-02',
    requests: [
      agg(sc2, sc2Filters('2021-02-01', '2021-03-01')),
      agg(sc2, { ...sc2Filters('2021-02-01', '2021-03-01'), advancedQuery: alpha.coverage }),
      agg(sc2, { ...sc2Filters('2021-02-01', '2021-03-01'), advancedQuery: alpha.mismatch }),
      {
        baseUrl: sc2,
        endpoint: 'nucleotideMutations',
        body: { ...sc2Filters('2021-02-01', '2021-03-01'), minProportion: 0.001 },
      },
      { baseUrl: sc2, endpoint: 'nucleotideInsertions', body: sc2Filters('2021-02-01', '2021-03-01') },
    ],
  },
  {
    name: 'g2-h3n2-2022',
    requests: [
      agg(h3n2, fluFilters('2022-01-01', '2022-12-31')),
      agg(h3n2, { ...fluFilters('2022-01-01', '2022-12-31'), advancedQuery: flu.coverage }),
      agg(h3n2, { ...fluFilters('2022-01-01', '2022-12-31'), advancedQuery: flu.mismatch }),
    ],
  },
  {
    name: 'g2-h3n2-2025',
    requests: [
      agg(h3n2, fluFilters('2025-01-01', '2025-12-31')),
      agg(h3n2, { ...fluFilters('2025-01-01', '2025-12-31'), advancedQuery: flu.coverage }),
      agg(h3n2, { ...fluFilters('2025-01-01', '2025-12-31'), advancedQuery: flu.mismatch }),
    ],
  },
  {
    name: 'g3-conserved-control',
    requests: [
      agg(sc2, sc2Filters('2024-01-01', '2025-06-30')),
      agg(sc2, { ...sc2Filters('2024-01-01', '2025-06-30'), advancedQuery: control.coverage }),
      agg(sc2, { ...sc2Filters('2024-01-01', '2025-06-30'), advancedQuery: control.mismatch }),
    ],
  },
];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const testCase of CASES) {
    const records: FixtureRecord[] = [];
    for (const request of testCase.requests) {
      process.stdout.write(`${testCase.name} <- ${request.endpoint}\n`);
      const response = await transport.query(request);
      records.push({
        request: { baseUrl: request.baseUrl, endpoint: request.endpoint, body: request.body },
        response: { data: response.data, dataVersion: response.dataVersion, requestId: response.requestId },
      });
    }
    writeFileSync(join(OUT, `${testCase.name}.json`), `${JSON.stringify(records, null, 2)}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 5: Record the fixtures**

```bash
npx tsx scripts/record-fixtures.ts
```

The `g1-alpha-2021-02` mutations fixture uses `minProportion: 0.001` rather than `0` deliberately — at `0` the file is ~3 MB and unpleasant in a repo, while `0.001` still includes everything the golden assertions touch. **The production code path still uses `0`;** only this fixture is trimmed, and Task 3.9 asserts on positions that are present at this threshold.

- [ ] **Step 6: Write the live contract test**

`tests/live/contract.live.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFetchTransport } from '../../src/core/lapis/fetch-transport';
import { queryAggregated, queryNucleotideMutations } from '../../src/core/lapis/endpoints';
import { getPathogen, PATHOGENS } from '../../src/core/registry';
import { loadReference } from '../../src/data/references';

const transport = createFetchTransport();

describe('LAPIS contract (live)', () => {
  it.each(Object.values(PATHOGENS))('$id answers an aggregated query', async (cfg) => {
    const res = await queryAggregated(transport, cfg, {});
    expect(res.data[0]!.count).toBeGreaterThan(0);
  }, 60_000);

  it.each(Object.values(PATHOGENS))('$id date parameters are still valid', async (cfg) => {
    const res = await queryAggregated(transport, cfg, {
      [cfg.dateFromParam]: '2024-01-01',
      [cfg.dateToParam]: '2024-06-30',
    });
    expect(res.data[0]!.count).toBeGreaterThan(0);
  }, 60_000);

  it.each(Object.values(PATHOGENS))('$id groups by its date field', async (cfg) => {
    const res = await queryAggregated(
      transport, cfg,
      { [cfg.dateFromParam]: '2024-01-01', [cfg.dateToParam]: '2024-01-10' },
      { fields: [cfg.dateField] },
    );
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0]).toHaveProperty(cfg.dateField);
  }, 60_000);

  it.each(Object.values(PATHOGENS))('$id bundled reference still matches the instance', async (cfg) => {
    const res = await fetch(`${cfg.lapisBaseUrl}/sample/referenceGenome`);
    const body = (await res.json()) as { nucleotideSequences: { name: string; sequence: string }[] };
    const bundled = loadReference(cfg.id);
    expect(body.nucleotideSequences.map((s) => `${s.name}:${s.sequence.length}`)).toEqual(
      bundled.segments.map((s) => `${s.name}:${s.sequence.length}`),
    );
  }, 60_000);

  it('still reports deletions in-band with per-position coverage', async () => {
    const cfg = getPathogen('sars-cov-2');
    const res = await queryNucleotideMutations(
      transport, cfg,
      { country: ['United Kingdom'], dateFrom: '2021-02-01', dateTo: '2021-03-01' },
      { minProportion: 0.5 },
    );
    const deletion = res.data.find((r) => r.position === 21765 && r.mutationTo === '-');
    expect(deletion).toBeDefined();
    expect(deletion!.coverage).toBeGreaterThan(deletion!.count);
    expect(deletion!.proportion).toBeCloseTo(deletion!.count / deletion!.coverage, 6);
  }, 120_000);

  it('still supports boolean operators in advancedQuery', async () => {
    const cfg = getPathogen('sars-cov-2');
    const filters = { country: ['United Kingdom'], dateFrom: '2021-02-01', dateTo: '2021-03-01' };
    const plain = await queryAggregated(transport, cfg, filters, { advancedQuery: '21765 | 21766' });
    const deMorgan = await queryAggregated(transport, cfg, filters, {
      advancedQuery: '!(!21765 & !21766)',
    });
    expect(plain.data[0]!.count).toBe(deMorgan.data[0]!.count);
  }, 120_000);
});
```

- [ ] **Step 7: Separate live tests from the default run**

In `vitest.config.ts`, add `exclude: ['**/node_modules/**', '**/dist/**', '**/*.live.test.ts']` to `test`, so `npm test` never touches the network.

Create `vitest.live.config.ts`:

```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ['**/node_modules/**', '**/dist/**'],
      include: ['**/*.live.test.ts'],
      testTimeout: 120_000,
    },
  }),
);
```

Add scripts:

```json
{
  "test:live": "vitest run --config vitest.live.config.ts",
  "fixtures": "tsx scripts/record-fixtures.ts"
}
```

- [ ] **Step 8: Run both suites**

Run: `npm test` → PASS, fast, no network.
Run: `npm run test:live` → PASS. Paste both outputs.

If a live test fails, that is a **finding, not a flake** — an upstream contract changed. Report it at the review gate.

- [ ] **Step 9: Commit**

```bash
git add scripts/record-fixtures.ts src/core/lapis/fixture-transport.ts \
        src/core/lapis/fixture-transport.test.ts tests/ \
        vitest.config.ts vitest.live.config.ts package.json
git commit -m "test(lapis): fixture transport, recorded fixtures, and live contract tests"
```

> **Note on the duplicated window-query helper.** `scripts/record-fixtures.ts` builds its query strings inline, and `tests/golden/helpers.ts` (Task 3.10) builds them again. This duplication is deliberate and self-checking: if the two ever disagree, `createFixtureTransport` fails with "No fixture recorded", which is exactly the signal you want.

> ### ⛔ REVIEW GATE — Phase 2
> Post: `npm test` output, `npm run test:live` output, and the reference-fetch output showing segment lengths. State explicitly whether any Part I fact failed to reproduce. Then stop.

---

## Phase 3 — The analysis engine

Everything in this phase is pure: LAPIS rows in, result objects out. Only Task 3.10 touches a transport, and it takes one as a parameter. This is what makes the golden cases cheap to run and impossible to fudge.

### Task 3.1: Thresholds and shared labels

Every magic number in the product lives in this one file so that a reviewer can audit the heuristic without reading the code that uses it.

**Files:**
- Create: `src/core/analysis/constants.ts`
- Test: `src/core/analysis/constants.test.ts`

**Interfaces:**
- Produces: `MIN_DENOMINATOR`, `COVERAGE_GAP_WARN`, `COVERAGE_GAP_UNUSABLE`, `AMBER_FRACTION`, `RED_FRACTION`, `AMBER_SCORE`, `RED_SCORE`, `DELETION_WEIGHT`, `THREE_PRIME_CRITICAL`, `THREE_PRIME_NEAR`, `TOP_COUNTRY_SHARE_WARN`, `DEPOSITION_LAG_BUCKETS`, `DEPOSITION_LAG_RATIO`, `MAX_ATTRIBUTION_ROWS`, `UNIT_OF_ANALYSIS`, `SEVERITY_DISCLAIMER`, `REGULATORY_STATEMENT`

`REGULATORY_STATEMENT` lives here, not in the store, because `src/core/export/methods.ts` needs it and nothing under `src/core/` may import from `src/state/`. The store re-exports it for the UI (Task 4.1).

- [ ] **Step 1: Write the failing test**

`src/core/analysis/constants.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MIN_DENOMINATOR, AMBER_FRACTION, RED_FRACTION, AMBER_SCORE, RED_SCORE,
  UNIT_OF_ANALYSIS, SEVERITY_DISCLAIMER, REGULATORY_STATEMENT,
} from './constants';

describe('analysis constants', () => {
  it('orders the severity thresholds sensibly', () => {
    expect(AMBER_FRACTION).toBeLessThan(RED_FRACTION);
    expect(AMBER_SCORE).toBeLessThan(RED_SCORE);
  });
  it('requires a meaningful denominator', () => {
    expect(MIN_DENOMINATOR).toBeGreaterThanOrEqual(50);
  });
  it('states the unit of analysis in plain language', () => {
    expect(UNIT_OF_ANALYSIS).toMatch(/definite base call at every position/i);
  });
  it('labels the severity indicator as a heuristic', () => {
    expect(SEVERITY_DISCLAIMER).toMatch(/heuristic/i);
    expect(SEVERITY_DISCLAIMER).not.toMatch(/predict(s|ion)\b/i);
  });
  it('states the regulatory position without hedging', () => {
    expect(REGULATORY_STATEMENT).toMatch(/not a diagnostic device/i);
    expect(REGULATORY_STATEMENT).toMatch(/not the same as assay failure/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/constants.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/constants.ts`:

```ts
/** Below this many assessable sequences, no headline percentage is shown. */
export const MIN_DENOMINATOR = 50;

/** Coverage gap above this fraction earns a visible warning. */
export const COVERAGE_GAP_WARN = 0.2;
/** Coverage gap above this fraction makes the estimate unusable. */
export const COVERAGE_GAP_UNUSABLE = 0.5;

export const AMBER_FRACTION = 0.01;
export const RED_FRACTION = 0.05;
/**
 * Score thresholds are deliberately low enough that position can override level.
 * The maximum achievable score for a window whose mismatch fraction is f is 6f
 * (weight 3 at the 3' terminus x deletion weight 2), so a red-by-score threshold
 * above 0.3 could never fire below RED_FRACTION and the 3' weighting would be
 * decorative. At 0.15, a 2.5% mismatch rate concentrated as a terminal 3'
 * deletion is rated red while a 4% rate spread mid-oligo stays amber -- which is
 * the whole point of weighting by position.
 */
export const AMBER_SCORE = 0.03;
export const RED_SCORE = 0.15;

/** Deletions are weighted more heavily than substitutions in the heuristic. */
export const DELETION_WEIGHT = 2;
/** Distance from the 3' end (0 = terminal base) treated as critical, then near-critical. */
export const THREE_PRIME_CRITICAL = 2;
export const THREE_PRIME_NEAR = 5;

export const TOP_COUNTRY_SHARE_WARN = 0.6;
/** How many trailing buckets are checked for deposition lag. */
export const DEPOSITION_LAG_BUCKETS = 4;
/** A trailing bucket below this ratio of the historical median counts as thin. */
export const DEPOSITION_LAG_RATIO = 0.5;

export const MAX_ATTRIBUTION_ROWS = 10;

export const UNIT_OF_ANALYSIS =
  'Percentages are over sequences in scope that have a definite base call at every position of the binding site. Sequences with an ambiguous base (N) anywhere in the site are excluded and reported separately as the coverage gap.';

export const SEVERITY_DISCLAIMER =
  'The severity indicator is a heuristic based on mismatch count, mismatch frequency and proximity to the 3′ end. It is not a thermodynamic model and not a statement about assay performance.';

export const REGULATORY_STATEMENT =
  'Assay Drift Watch is a research and educational tool, not a diagnostic device. It is not for clinical decision-making, and an in-silico mismatch is not the same as assay failure.';
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/constants.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/constants.ts src/core/analysis/constants.test.ts
git commit -m "feat(analysis): centralise thresholds and the unit-of-analysis wording"
```

---

### Task 3.2: Window metrics

**Files:**
- Create: `src/core/analysis/metrics.ts`
- Test: `src/core/analysis/metrics.test.ts`

**Interfaces:**
- Consumes: `AggregatedRow` from `../lapis/endpoints`; `MIN_DENOMINATOR` from `./constants`.
- Produces:
  - `interface WindowMetrics { nScope; nFullCoverage; nMismatch; coverageGap; coverageGapFraction; mismatchFraction: number | null; sufficientData: boolean }`
  - `sumCounts(rows: AggregatedRow[]): number`
  - `computeWindowMetrics(input: { nScope: number; nFullCoverage: number; nMismatch: number }): WindowMetrics`

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeWindowMetrics, sumCounts } from './metrics';

describe('sumCounts', () => {
  it('adds the count column across grouped rows', () => {
    expect(sumCounts([{ count: 3, date: 'a' }, { count: 4, date: 'b' }])).toBe(7);
  });
  it('is zero for no rows', () => {
    expect(sumCounts([])).toBe(0);
  });
});

describe('computeWindowMetrics', () => {
  it('reproduces the Alpha February 2021 figures', () => {
    const m = computeWindowMetrics({ nScope: 71142, nFullCoverage: 70387, nMismatch: 67520 });
    expect(m.mismatchFraction).toBeCloseTo(0.9593, 4);
    expect(m.coverageGap).toBe(755);
    expect(m.coverageGapFraction).toBeCloseTo(0.0106, 4);
    expect(m.sufficientData).toBe(true);
  });

  it('reproduces the conserved control figures', () => {
    const m = computeWindowMetrics({ nScope: 46667, nFullCoverage: 44669, nMismatch: 3 });
    expect(m.mismatchFraction).toBeCloseTo(0.0000672, 7);
    expect(m.coverageGap).toBe(1998);
    expect(m.coverageGapFraction).toBeCloseTo(0.0428, 4);
  });

  it('returns null rather than zero when nothing is assessable', () => {
    const m = computeWindowMetrics({ nScope: 40, nFullCoverage: 0, nMismatch: 0 });
    expect(m.mismatchFraction).toBeNull();
    expect(m.sufficientData).toBe(false);
    expect(m.coverageGapFraction).toBe(1);
  });

  it('flags an insufficient denominator', () => {
    expect(computeWindowMetrics({ nScope: 60, nFullCoverage: 49, nMismatch: 1 }).sufficientData).toBe(false);
    expect(computeWindowMetrics({ nScope: 60, nFullCoverage: 50, nMismatch: 1 }).sufficientData).toBe(true);
  });

  it('reports a zero coverage gap fraction when the scope itself is empty', () => {
    const m = computeWindowMetrics({ nScope: 0, nFullCoverage: 0, nMismatch: 0 });
    expect(m.coverageGapFraction).toBe(0);
    expect(m.mismatchFraction).toBeNull();
  });

  it('throws when the numerator exceeds the denominator', () => {
    expect(() => computeWindowMetrics({ nScope: 100, nFullCoverage: 80, nMismatch: 81 }))
      .toThrow(/exceeds/i);
  });

  it('throws when full coverage exceeds the scope', () => {
    expect(() => computeWindowMetrics({ nScope: 10, nFullCoverage: 11, nMismatch: 0 }))
      .toThrow(/exceeds/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/metrics.ts`:

```ts
import type { AggregatedRow } from '../lapis/endpoints';
import { MIN_DENOMINATOR } from './constants';

export interface WindowMetrics {
  /** Sequences matching the scope filters. */
  nScope: number;
  /** Of those, sequences with a definite call at every position of the binding site. */
  nFullCoverage: number;
  /** Of nFullCoverage, sequences carrying at least one allele the oligo cannot bind. */
  nMismatch: number;
  coverageGap: number;
  coverageGapFraction: number;
  /** nMismatch / nFullCoverage, or null when nothing is assessable. */
  mismatchFraction: number | null;
  sufficientData: boolean;
}

export function sumCounts(rows: AggregatedRow[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

export function computeWindowMetrics(input: {
  nScope: number;
  nFullCoverage: number;
  nMismatch: number;
}): WindowMetrics {
  const { nScope, nFullCoverage, nMismatch } = input;

  // These are impossible unless a query was built wrongly. Fail loudly rather
  // than printing a number that cannot be true.
  if (nFullCoverage > nScope) {
    throw new Error(`Full-coverage count ${nFullCoverage} exceeds scope count ${nScope}`);
  }
  if (nMismatch > nFullCoverage) {
    throw new Error(`Mismatch count ${nMismatch} exceeds full-coverage count ${nFullCoverage}`);
  }

  const coverageGap = nScope - nFullCoverage;
  return {
    nScope,
    nFullCoverage,
    nMismatch,
    coverageGap,
    coverageGapFraction: nScope === 0 ? 0 : coverageGap / nScope,
    mismatchFraction: nFullCoverage === 0 ? null : nMismatch / nFullCoverage,
    sufficientData: nFullCoverage >= MIN_DENOMINATOR,
  };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/metrics.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/metrics.ts src/core/analysis/metrics.test.ts
git commit -m "feat(analysis): window metrics with numerator/denominator invariants"
```

---

### Task 3.3: Position profile

**Files:**
- Create: `src/core/analysis/profile.ts`
- Test: `src/core/analysis/profile.test.ts`

**Interfaces:**
- Consumes: `WindowSpec`, `PositionSpec`, `isMismatchAllele` from `../query`; `MutationRow` from `../lapis/endpoints`.
- Produces:
  - `interface AlleleStat { allele: string; count: number; proportion: number; isMismatch: boolean }`
  - `interface PositionStat { refPos; oligoIndex; oligoBase; plusStrandBase; refBase; distanceFrom3Prime; coverage: number | null; coverageIsInferred: boolean; effectiveDenominator: number; mismatchCount: number; deletionCount: number; substitutionCount: number; mismatchFraction: number; alleles: AlleleStat[]; referenceIsAmbiguous: boolean }`
  - `rowBelongsToWindow(row: MutationRow, w: WindowSpec): boolean`
  - `buildPositionProfile(w: WindowSpec, rows: MutationRow[], fallbackDenominator: number): PositionStat[]`

`coverageIsInferred` is the honesty flag: `true` means LAPIS returned no row for that position, so per-position coverage is unknown and the window denominator was substituted. The UI must render those bars differently (Task 4.5).

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPositionProfile, rowBelongsToWindow } from './profile';
import { buildWindowSpec } from '../query';
import { findBindingSites, type ReferenceGenome } from '../binding';
import type { MutationRow } from '../lapis/endpoints';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};
const SEG: ReferenceGenome = {
  pathogenId: 'flu',
  segments: [
    { name: 'seg1', sequence: 'TTTTTTTTTTTTTTTT' },
    { name: 'seg4', sequence: 'CCCCATGCATGCGGGG' },
  ],
};

const row = (over: Partial<MutationRow>): MutationRow => ({
  mutation: 'x', count: 0, coverage: 1000, proportion: 0,
  sequenceName: null, mutationFrom: 'A', mutationTo: 'C', position: 5, ...over,
});

const plusWindow = () =>
  buildWindowSpec(findBindingSites('ATGCATGC', REF)[0]!, 'ATGCATGC', REF, 'forward', { segmented: false });

describe('rowBelongsToWindow', () => {
  it('accepts a null sequenceName on an unsegmented genome', () => {
    expect(rowBelongsToWindow(row({ sequenceName: null }), plusWindow())).toBe(true);
  });
  it('accepts a sequenceName equal to the segment name on an unsegmented genome', () => {
    expect(rowBelongsToWindow(row({ sequenceName: 'main' }), plusWindow())).toBe(true);
  });
  it('rejects rows from another segment', () => {
    const w = buildWindowSpec(
      findBindingSites('ATGCATGC', SEG)[0]!, 'ATGCATGC', SEG, 'forward', { segmented: true },
    );
    expect(rowBelongsToWindow(row({ sequenceName: 'seg1' }), w)).toBe(false);
    expect(rowBelongsToWindow(row({ sequenceName: 'seg4' }), w)).toBe(true);
  });
});

describe('buildPositionProfile', () => {
  it('produces one entry per oligo position, in 5prime to 3prime order', () => {
    const profile = buildPositionProfile(plusWindow(), [], 1000);
    expect(profile).toHaveLength(8);
    expect(profile.map((p) => p.refPos)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(profile[0]!.oligoIndex).toBe(0);
  });

  it('marks positions with no row as inferred and zero mismatch', () => {
    const p = buildPositionProfile(plusWindow(), [], 1000)[0]!;
    expect(p.coverage).toBeNull();
    expect(p.coverageIsInferred).toBe(true);
    expect(p.effectiveDenominator).toBe(1000);
    expect(p.mismatchCount).toBe(0);
    expect(p.mismatchFraction).toBe(0);
  });

  it('uses the reported per-position coverage when a row exists', () => {
    const rows = [row({ position: 5, mutationFrom: 'A', mutationTo: 'G', count: 30, coverage: 900 })];
    const p = buildPositionProfile(plusWindow(), rows, 1000)[0]!;
    expect(p.coverage).toBe(900);
    expect(p.coverageIsInferred).toBe(false);
    expect(p.effectiveDenominator).toBe(900);
    expect(p.mismatchFraction).toBeCloseTo(30 / 900, 6);
  });

  it('separates deletions from substitutions', () => {
    const rows = [
      row({ position: 5, mutationTo: 'G', count: 10, coverage: 1000 }),
      row({ position: 5, mutationTo: '-', count: 40, coverage: 1000 }),
    ];
    const p = buildPositionProfile(plusWindow(), rows, 1000)[0]!;
    expect(p.substitutionCount).toBe(10);
    expect(p.deletionCount).toBe(40);
    expect(p.mismatchCount).toBe(50);
  });

  it('does not count an allele that a degenerate oligo base accepts', () => {
    // oligo base Y at reference position 8 (ref C) accepts C and T
    const site = findBindingSites('ATGYATGC', REF)[0]!;
    const w = buildWindowSpec(site, 'ATGYATGC', REF, 'forward', { segmented: false });
    const rows = [
      row({ position: 8, mutationFrom: 'C', mutationTo: 'T', count: 500, coverage: 1000 }),
      row({ position: 8, mutationFrom: 'C', mutationTo: 'A', count: 20, coverage: 1000 }),
    ];
    const p = buildPositionProfile(w, rows, 1000)[3]!;
    expect(p.mismatchCount).toBe(20);
    expect(p.alleles.find((a) => a.allele === 'T')!.isMismatch).toBe(false);
    expect(p.alleles.find((a) => a.allele === 'A')!.isMismatch).toBe(true);
  });

  it('counts the reference allele as a mismatch when the oligo diverges there', () => {
    // oligo base A at reference position 8 (ref C): 940 of 1000 carry C, which the oligo cannot bind
    const site = findBindingSites('ATGAATGC', REF, { maxMismatches: 1 })[0]!;
    const w = buildWindowSpec(site, 'ATGAATGC', REF, 'forward', { segmented: false });
    const rows = [row({ position: 8, mutationFrom: 'C', mutationTo: 'A', count: 60, coverage: 1000 })];
    const p = buildPositionProfile(w, rows, 1000)[3]!;
    expect(p.mismatchCount).toBe(940);
    expect(p.mismatchFraction).toBeCloseTo(0.94, 6);
  });

  it('maps minus-strand positions to the correct oligo index', () => {
    const site = findBindingSites('GCATGCAT', REF)[0]!;
    const w = buildWindowSpec(site, 'GCATGCAT', REF, 'reverse', { segmented: false });
    const rows = [row({ position: 5, mutationFrom: 'A', mutationTo: 'G', count: 100, coverage: 1000 })];
    const profile = buildPositionProfile(w, rows, 1000);
    const hit = profile.find((p) => p.mismatchCount > 0)!;
    expect(hit.refPos).toBe(5);
    expect(hit.oligoIndex).toBe(7);
    expect(hit.distanceFrom3Prime).toBe(0);
  });

  it('ignores rows outside the window', () => {
    const rows = [row({ position: 400, mutationTo: 'G', count: 999, coverage: 1000 })];
    const profile = buildPositionProfile(plusWindow(), rows, 1000);
    expect(profile.every((p) => p.mismatchCount === 0)).toBe(true);
  });

  it('never reports a mismatch fraction above 1', () => {
    const rows = [
      row({ position: 5, mutationTo: 'C', count: 400, coverage: 1000 }),
      row({ position: 5, mutationTo: 'G', count: 700, coverage: 1000 }),
    ];
    const p = buildPositionProfile(plusWindow(), rows, 1000)[0]!;
    expect(p.mismatchFraction).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/profile.ts`:

```ts
import { isMismatchAllele, type PositionSpec, type WindowSpec } from '../query';
import type { MutationRow } from '../lapis/endpoints';

export interface AlleleStat {
  allele: string;
  count: number;
  proportion: number;
  isMismatch: boolean;
}

export interface PositionStat {
  refPos: number;
  oligoIndex: number;
  oligoBase: string;
  plusStrandBase: string;
  refBase: string;
  distanceFrom3Prime: number;
  /** Per-position coverage as reported by LAPIS, or null when no mutation row exists. */
  coverage: number | null;
  /** True when coverage was unavailable and the window denominator was substituted. */
  coverageIsInferred: boolean;
  effectiveDenominator: number;
  mismatchCount: number;
  substitutionCount: number;
  deletionCount: number;
  mismatchFraction: number;
  alleles: AlleleStat[];
  referenceIsAmbiguous: boolean;
}

export function rowBelongsToWindow(row: MutationRow, w: WindowSpec): boolean {
  if (w.qualifier !== null) return row.sequenceName === w.qualifier;
  return row.sequenceName === null || row.sequenceName === w.segment;
}

function statFor(
  spec: PositionSpec,
  rows: MutationRow[],
  fallbackDenominator: number,
): PositionStat {
  const coverage = rows.length > 0 ? (rows[0] as MutationRow).coverage : null;
  const effectiveDenominator = coverage ?? fallbackDenominator;

  const alleles: AlleleStat[] = rows.map((r) => ({
    allele: r.mutationTo,
    count: r.count,
    proportion: effectiveDenominator === 0 ? 0 : r.count / effectiveDenominator,
    isMismatch: isMismatchAllele(r.mutationTo, spec.plusStrandBase),
  }));

  const substitutionCount = alleles
    .filter((a) => a.isMismatch && a.allele !== '-')
    .reduce((total, a) => total + a.count, 0);
  const deletionCount = alleles
    .filter((a) => a.allele === '-')
    .reduce((total, a) => total + a.count, 0);

  // When the oligo does not accept the reference base, every sequence that is NOT
  // reported as carrying an accepted allele is itself a mismatch.
  const oligoAcceptsReference = spec.acceptedAlleles.includes(spec.refBase);
  let mismatchCount: number;
  if (oligoAcceptsReference) {
    mismatchCount = substitutionCount + deletionCount;
  } else {
    const acceptedCount = alleles
      .filter((a) => !a.isMismatch)
      .reduce((total, a) => total + a.count, 0);
    mismatchCount = Math.max(0, effectiveDenominator - acceptedCount);
  }

  const mismatchFraction =
    effectiveDenominator === 0 ? 0 : Math.min(1, mismatchCount / effectiveDenominator);

  return {
    refPos: spec.refPos,
    oligoIndex: spec.oligoIndex,
    oligoBase: spec.oligoBase,
    plusStrandBase: spec.plusStrandBase,
    refBase: spec.refBase,
    distanceFrom3Prime: spec.distanceFrom3Prime,
    coverage,
    coverageIsInferred: coverage === null,
    effectiveDenominator,
    mismatchCount,
    substitutionCount,
    deletionCount,
    mismatchFraction,
    alleles: alleles.sort((a, b) => b.count - a.count),
    referenceIsAmbiguous: spec.referenceIsAmbiguous,
  };
}

export function buildPositionProfile(
  w: WindowSpec,
  rows: MutationRow[],
  fallbackDenominator: number,
): PositionStat[] {
  const byPosition = new Map<number, MutationRow[]>();
  for (const row of rows) {
    if (!rowBelongsToWindow(row, w)) continue;
    const bucket = byPosition.get(row.position);
    if (bucket) bucket.push(row);
    else byPosition.set(row.position, [row]);
  }
  return w.positions.map((spec) =>
    statFor(spec, byPosition.get(spec.refPos) ?? [], fallbackDenominator),
  );
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/profile.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/profile.ts src/core/analysis/profile.test.ts
git commit -m "feat(analysis): per-base position profile with explicit coverage provenance"
```

---

### Task 3.4: Insertions inside the window

**Files:**
- Create: `src/core/analysis/insertions.ts`
- Test: `src/core/analysis/insertions.test.ts`

**Interfaces:**
- Consumes: `WindowSpec` from `../query`; `InsertionRow` from `../lapis/endpoints`.
- Produces:
  - `interface WindowInsertion { refPos: number; insertedSymbols: string; count: number; fractionOfDenominator: number }`
  - `insertionsInWindow(w: WindowSpec, rows: InsertionRow[], denominator: number): WindowInsertion[]`

LAPIS insertion `position` denotes the reference position **after which** the bases are inserted, and the endpoint reports **no coverage**. Both facts must reach the UI as text (Task 4.5).

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/insertions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { insertionsInWindow } from './insertions';
import { buildWindowSpec } from '../query';
import { findBindingSites, type ReferenceGenome } from '../binding';
import type { InsertionRow } from '../lapis/endpoints';

const REF: ReferenceGenome = {
  pathogenId: 'test',
  segments: [{ name: 'main', sequence: 'GGGGATGCATGCAAAA' }],
};
const w = () =>
  buildWindowSpec(findBindingSites('ATGCATGC', REF)[0]!, 'ATGCATGC', REF, 'forward', { segmented: false });

const ins = (over: Partial<InsertionRow>): InsertionRow => ({
  insertion: 'ins_7:AA', count: 5, insertedSymbols: 'AA', position: 7, sequenceName: null, ...over,
});

describe('insertionsInWindow', () => {
  it('keeps insertions inside the window and reports the fraction', () => {
    const out = insertionsInWindow(w(), [ins({ position: 7, count: 25 })], 500);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ refPos: 7, insertedSymbols: 'AA', count: 25 });
    expect(out[0]!.fractionOfDenominator).toBeCloseTo(0.05, 6);
  });

  it('drops insertions outside the window', () => {
    expect(insertionsInWindow(w(), [ins({ position: 3 }), ins({ position: 15 })], 500)).toHaveLength(0);
  });

  it('filters by segment', () => {
    const SEG: ReferenceGenome = {
      pathogenId: 'flu',
      segments: [
        { name: 'seg1', sequence: 'TTTTTTTTTTTTTTTT' },
        { name: 'seg4', sequence: 'CCCCATGCATGCGGGG' },
      ],
    };
    const spec = buildWindowSpec(
      findBindingSites('ATGCATGC', SEG)[0]!, 'ATGCATGC', SEG, 'forward', { segmented: true },
    );
    const out = insertionsInWindow(
      spec, [ins({ position: 7, sequenceName: 'seg1' }), ins({ position: 7, sequenceName: 'seg4' })], 500,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.refPos).toBe(7);
  });

  it('returns a zero fraction rather than dividing by zero', () => {
    expect(insertionsInWindow(w(), [ins({ position: 7 })], 0)[0]!.fractionOfDenominator).toBe(0);
  });

  it('sorts by count descending', () => {
    const out = insertionsInWindow(
      w(), [ins({ position: 7, count: 2 }), ins({ position: 9, count: 30, insertedSymbols: 'T' })], 500,
    );
    expect(out.map((o) => o.count)).toEqual([30, 2]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/insertions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/insertions.ts`:

```ts
import type { WindowSpec } from '../query';
import type { InsertionRow } from '../lapis/endpoints';

export interface WindowInsertion {
  /** Reference position AFTER which the bases are inserted. */
  refPos: number;
  insertedSymbols: string;
  count: number;
  /**
   * Count divided by the window's full-coverage denominator. The insertions
   * endpoint reports no coverage of its own, so this is an approximation and
   * must be labelled as such wherever it is shown.
   */
  fractionOfDenominator: number;
}

export function insertionsInWindow(
  w: WindowSpec,
  rows: InsertionRow[],
  denominator: number,
): WindowInsertion[] {
  const positions = w.positions.map((p) => p.refPos);
  const low = Math.min(...positions);
  const high = Math.max(...positions);

  return rows
    .filter((row) => {
      const segmentMatches =
        w.qualifier !== null
          ? row.sequenceName === w.qualifier
          : row.sequenceName === null || row.sequenceName === w.segment;
      return segmentMatches && row.position >= low && row.position <= high;
    })
    .map((row) => ({
      refPos: row.position,
      insertedSymbols: row.insertedSymbols,
      count: row.count,
      fractionOfDenominator: denominator === 0 ? 0 : row.count / denominator,
    }))
    .sort((a, b) => b.count - a.count || a.refPos - b.refPos);
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/insertions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/insertions.ts src/core/analysis/insertions.test.ts
git commit -m "feat(analysis): surface insertions inside the binding window"
```

---

### Task 3.5: Trend series

**Files:**
- Create: `src/core/analysis/trend.ts`
- Test: `src/core/analysis/trend.test.ts`

**Interfaces:**
- Consumes: `AggregatedRow` from `../lapis/endpoints`; `MIN_DENOMINATOR` from `./constants`.
- Produces:
  - `type Granularity = 'week' | 'month'`
  - `interface TrendPoint { bucket: string; nFullCoverage: number; nMismatch: number; mismatchFraction: number | null; sufficientData: boolean }`
  - `interface TrendSeries { granularity: Granularity; points: TrendPoint[]; undatedFullCoverage: number; undatedMismatch: number }`
  - `chooseGranularity(dateFrom: string, dateTo: string): Granularity`
  - `bucketOf(isoDate: string, granularity: Granularity): string`
  - `buildTrend(input: { coverageRows: AggregatedRow[]; mismatchRows: AggregatedRow[]; dateField: string; dateFrom: string; dateTo: string }): TrendSeries`

Weekly buckets are labelled by their ISO-Monday date; monthly buckets by `YYYY-MM`. Rows with a null date are excluded from the series and reported separately so they are never silently dropped.

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/trend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTrend, bucketOf, chooseGranularity } from './trend';
import type { AggregatedRow } from '../lapis/endpoints';

const rows = (pairs: [string | null, number][]): AggregatedRow[] =>
  pairs.map(([date, count]) => ({ count, date }));

describe('chooseGranularity', () => {
  it('uses weeks for short windows', () => {
    expect(chooseGranularity('2025-01-01', '2025-03-01')).toBe('week');
  });
  it('uses months beyond six months', () => {
    expect(chooseGranularity('2024-01-01', '2025-06-30')).toBe('month');
  });
});

describe('bucketOf', () => {
  it('buckets by calendar month', () => {
    expect(bucketOf('2025-03-17', 'month')).toBe('2025-03');
  });
  it('buckets by the ISO Monday of the week', () => {
    expect(bucketOf('2025-03-19', 'week')).toBe('2025-03-17'); // Wednesday -> Monday
    expect(bucketOf('2025-03-17', 'week')).toBe('2025-03-17'); // Monday -> itself
    expect(bucketOf('2025-03-23', 'week')).toBe('2025-03-17'); // Sunday -> that Monday
  });
});

describe('buildTrend', () => {
  it('joins coverage and mismatch rows by bucket', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-01-10', 100], ['2025-02-10', 200]]),
      mismatchRows: rows([['2025-01-10', 5], ['2025-02-10', 60]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.granularity).toBe('month');
    expect(series.points.map((p) => p.bucket)).toEqual(['2025-01', '2025-02']);
    expect(series.points[0]!.mismatchFraction).toBeCloseTo(0.05, 6);
    expect(series.points[1]!.mismatchFraction).toBeCloseTo(0.3, 6);
  });

  it('sums multiple dates falling in the same bucket', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-01-02', 40], ['2025-01-20', 60]]),
      mismatchRows: rows([['2025-01-02', 4], ['2025-01-20', 6]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points).toHaveLength(1);
    expect(series.points[0]!.nFullCoverage).toBe(100);
    expect(series.points[0]!.nMismatch).toBe(10);
  });

  it('emits buckets in chronological order', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-03-01', 100], ['2025-01-01', 100], ['2025-02-01', 100]]),
      mismatchRows: [], dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points.map((p) => p.bucket)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('reports undated rows separately instead of dropping them', () => {
    const series = buildTrend({
      coverageRows: rows([[null, 17], ['2025-01-01', 100]]),
      mismatchRows: rows([[null, 3]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.undatedFullCoverage).toBe(17);
    expect(series.undatedMismatch).toBe(3);
    expect(series.points).toHaveLength(1);
  });

  it('marks thin buckets as insufficient and nulls their fraction', () => {
    const series = buildTrend({
      coverageRows: rows([['2025-01-01', 10]]),
      mismatchRows: rows([['2025-01-01', 5]]),
      dateField: 'date', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points[0]!.sufficientData).toBe(false);
    expect(series.points[0]!.mismatchFraction).toBeNull();
  });

  it('honours a non-default date field name', () => {
    const series = buildTrend({
      coverageRows: [{ count: 80, sampleCollectionDateRangeLower: '2025-05-05' }],
      mismatchRows: [{ count: 40, sampleCollectionDateRangeLower: '2025-05-05' }],
      dateField: 'sampleCollectionDateRangeLower', dateFrom: '2025-01-01', dateTo: '2025-12-31',
    });
    expect(series.points[0]!.nFullCoverage).toBe(80);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/trend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/trend.ts`:

```ts
import type { AggregatedRow } from '../lapis/endpoints';
import { MIN_DENOMINATOR } from './constants';

export type Granularity = 'week' | 'month';

export interface TrendPoint {
  bucket: string;
  nFullCoverage: number;
  nMismatch: number;
  mismatchFraction: number | null;
  sufficientData: boolean;
}

export interface TrendSeries {
  granularity: Granularity;
  points: TrendPoint[];
  undatedFullCoverage: number;
  undatedMismatch: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function chooseGranularity(dateFrom: string, dateTo: string): Granularity {
  const spanDays = (Date.parse(dateTo) - Date.parse(dateFrom)) / DAY_MS;
  return spanDays > 180 ? 'month' : 'week';
}

export function bucketOf(isoDate: string, granularity: Granularity): string {
  if (granularity === 'month') return isoDate.slice(0, 7);
  const date = new Date(`${isoDate}T00:00:00Z`);
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday
  const offsetToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(date.getTime() - offsetToMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function accumulate(
  rows: AggregatedRow[],
  dateField: string,
  granularity: Granularity,
): { buckets: Map<string, number>; undated: number } {
  const buckets = new Map<string, number>();
  let undated = 0;
  for (const row of rows) {
    const raw = row[dateField];
    if (typeof raw !== 'string' || raw === '') {
      undated += row.count;
      continue;
    }
    const bucket = bucketOf(raw, granularity);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + row.count);
  }
  return { buckets, undated };
}

export function buildTrend(input: {
  coverageRows: AggregatedRow[];
  mismatchRows: AggregatedRow[];
  dateField: string;
  dateFrom: string;
  dateTo: string;
}): TrendSeries {
  const granularity = chooseGranularity(input.dateFrom, input.dateTo);
  const coverage = accumulate(input.coverageRows, input.dateField, granularity);
  const mismatch = accumulate(input.mismatchRows, input.dateField, granularity);

  const points: TrendPoint[] = [...coverage.buckets.keys()]
    .sort()
    .map((bucket) => {
      const nFullCoverage = coverage.buckets.get(bucket) ?? 0;
      const nMismatch = mismatch.buckets.get(bucket) ?? 0;
      const sufficientData = nFullCoverage >= MIN_DENOMINATOR;
      return {
        bucket,
        nFullCoverage,
        nMismatch,
        mismatchFraction: sufficientData ? nMismatch / nFullCoverage : null,
        sufficientData,
      };
    });

  return {
    granularity,
    points,
    undatedFullCoverage: coverage.undated,
    undatedMismatch: mismatch.undated,
  };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/trend.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/trend.ts src/core/analysis/trend.test.ts
git commit -m "feat(analysis): trend series with explicit handling of undated records"
```

---

### Task 3.6: Attribution

**Files:**
- Create: `src/core/analysis/attribution.ts`
- Test: `src/core/analysis/attribution.test.ts`

**Interfaces:**
- Consumes: `AggregatedRow` from `../lapis/endpoints`; `MAX_ATTRIBUTION_ROWS` from `./constants`.
- Produces:
  - `interface AttributionRow { value: string; count: number; share: number }`
  - `interface Attribution { field: string; rows: AttributionRow[]; otherCount: number; unassignedCount: number; total: number; topShare: number }`
  - `buildAttribution(rows: AggregatedRow[], field: string, opts?: { limit?: number }): Attribution`

`share` is of the **total attributed count** (the mismatch-carrying set), which the UI must state.

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/attribution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildAttribution } from './attribution';
import type { AggregatedRow } from '../lapis/endpoints';

const rows = (pairs: [string | null, number][]): AggregatedRow[] =>
  pairs.map(([value, count]) => ({ count, pangoLineage: value }));

describe('buildAttribution', () => {
  it('sorts descending and computes shares of the total', () => {
    const a = buildAttribution(rows([['B.1.1.7', 900], ['B.1.177', 100]]), 'pangoLineage');
    expect(a.rows.map((r) => r.value)).toEqual(['B.1.1.7', 'B.1.177']);
    expect(a.rows[0]!.share).toBeCloseTo(0.9, 6);
    expect(a.total).toBe(1000);
    expect(a.topShare).toBeCloseTo(0.9, 6);
  });

  it('collapses the tail into otherCount', () => {
    const many: [string | null, number][] = Array.from(
      { length: 15 }, (_, i) => [`L${i}`, 15 - i],
    );
    const a = buildAttribution(rows(many), 'pangoLineage', { limit: 3 });
    expect(a.rows).toHaveLength(3);
    expect(a.otherCount).toBe(a.total - a.rows.reduce((s, r) => s + r.count, 0));
    expect(a.otherCount).toBeGreaterThan(0);
  });

  it('counts null values as unassigned rather than as a lineage', () => {
    const a = buildAttribution(rows([[null, 40], ['B.1.1.7', 60]]), 'pangoLineage');
    expect(a.unassignedCount).toBe(40);
    expect(a.rows).toHaveLength(1);
    expect(a.total).toBe(100);
  });

  it('handles an empty result', () => {
    const a = buildAttribution([], 'pangoLineage');
    expect(a.rows).toEqual([]);
    expect(a.total).toBe(0);
    expect(a.topShare).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/attribution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/attribution.ts`:

```ts
import type { AggregatedRow } from '../lapis/endpoints';
import { MAX_ATTRIBUTION_ROWS } from './constants';

export interface AttributionRow {
  value: string;
  count: number;
  /** Share of `total`, i.e. of all sequences carrying a mismatch in this window. */
  share: number;
}

export interface Attribution {
  field: string;
  rows: AttributionRow[];
  otherCount: number;
  /** Sequences whose value for this field is null or blank. */
  unassignedCount: number;
  total: number;
  topShare: number;
}

export function buildAttribution(
  rows: AggregatedRow[],
  field: string,
  opts: { limit?: number } = {},
): Attribution {
  const limit = opts.limit ?? MAX_ATTRIBUTION_ROWS;
  let unassignedCount = 0;
  const named: { value: string; count: number }[] = [];

  for (const row of rows) {
    const raw = row[field];
    if (typeof raw !== 'string' || raw === '') {
      unassignedCount += row.count;
      continue;
    }
    named.push({ value: raw, count: row.count });
  }

  named.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const total = named.reduce((s, r) => s + r.count, 0) + unassignedCount;
  const head = named.slice(0, limit);
  const otherCount = named.slice(limit).reduce((s, r) => s + r.count, 0);

  return {
    field,
    rows: head.map((r) => ({ ...r, share: total === 0 ? 0 : r.count / total })),
    otherCount,
    unassignedCount,
    total,
    topShare: total === 0 ? 0 : (head[0]?.count ?? 0) / total,
  };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/attribution.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/attribution.ts src/core/analysis/attribution.test.ts
git commit -m "feat(analysis): lineage and geography attribution"
```

---

### Task 3.7: Severity heuristic

The brief requires this to be labelled a heuristic, not a prediction. The code must make that structurally true: it returns its reasons, and the level can be `unknown`.

**Files:**
- Create: `src/core/analysis/severity.ts`
- Test: `src/core/analysis/severity.test.ts`

**Interfaces:**
- Consumes: `WindowMetrics` from `./metrics`; `PositionStat` from `./profile`; thresholds from `./constants`; `OligoRole` from `../oligo-input`.
- Produces:
  - `type SeverityLevel = 'green' | 'amber' | 'red' | 'unknown'`
  - `interface Severity { level: SeverityLevel; score: number; reasons: string[] }`
  - `positionWeight(role: OligoRole, distanceFrom3Prime: number): number`
  - `scoreSeverity(input: { role: OligoRole; metrics: WindowMetrics; profile: PositionStat[] }): Severity`

Definition, so a reviewer can check it by hand:

```
weight(i) = 1                                if role is 'probe'
          = 3  if distanceFrom3Prime(i) <= 2
          = 2  if distanceFrom3Prime(i) <= 5
          = 1  otherwise

score = Σ over positions of  weight(i) × ( substitutionFraction(i) + 2 × deletionFraction(i) )
```

A probe gets uniform weighting because its 3′ end is blocked and carries no extension chemistry; the reason string says so.

Level: `unknown` when the denominator is too small or the coverage gap is unusable; otherwise `red` at ≥5 % **or score ≥0.15**, `amber` at ≥1 % **or score ≥0.03**, else `green`.

The score thresholds are what make position matter. Because the highest achievable score for a window with mismatch fraction *f* is 6*f*, a red-by-score threshold of 0.15 fires from *f* ≈ 0.025 upward when the mismatch sits on the terminal 3′ base as a deletion — below the 5 % headline threshold. A mismatch of the same frequency in the middle of the oligo scores 1×*f* and stays amber. If you raise `RED_SCORE` above 0.3, the 3′ weighting stops being able to change any verdict.

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/severity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { positionWeight, scoreSeverity } from './severity';
import { computeWindowMetrics } from './metrics';
import type { PositionStat } from './profile';

const stat = (over: Partial<PositionStat>): PositionStat => ({
  refPos: 100, oligoIndex: 0, oligoBase: 'A', plusStrandBase: 'A', refBase: 'A',
  distanceFrom3Prime: 10, coverage: 1000, coverageIsInferred: false,
  effectiveDenominator: 1000, mismatchCount: 0, substitutionCount: 0, deletionCount: 0,
  mismatchFraction: 0, alleles: [], referenceIsAmbiguous: false, ...over,
});

describe('positionWeight', () => {
  it('weights the terminal 3prime bases most heavily for primers', () => {
    expect(positionWeight('forward', 0)).toBe(3);
    expect(positionWeight('forward', 2)).toBe(3);
    expect(positionWeight('reverse', 3)).toBe(2);
    expect(positionWeight('forward', 5)).toBe(2);
    expect(positionWeight('forward', 6)).toBe(1);
  });
  it('weights probe positions uniformly', () => {
    expect(positionWeight('probe', 0)).toBe(1);
    expect(positionWeight('probe', 20)).toBe(1);
  });
});

describe('scoreSeverity', () => {
  const metrics = (fraction: number) =>
    computeWindowMetrics({
      nScope: 1000, nFullCoverage: 1000, nMismatch: Math.round(fraction * 1000),
    });

  it('is green for a conserved site', () => {
    const s = scoreSeverity({ role: 'forward', metrics: metrics(0.0001), profile: [stat({})] });
    expect(s.level).toBe('green');
    expect(s.score).toBeCloseTo(0, 6);
  });

  it('is red above the headline threshold', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.96),
      profile: [stat({ distanceFrom3Prime: 0, deletionCount: 960, mismatchCount: 960, mismatchFraction: 0.96 })],
    });
    expect(s.level).toBe('red');
    expect(s.reasons.join(' ')).toMatch(/deletion/i);
  });

  it('escalates to red on a 3prime terminal deletion below the headline threshold', () => {
    // 3% of sequences carry a deletion at the terminal 3' base.
    // Headline 3% would be amber; score = weight 3 x deletion weight 2 x 0.03 = 0.18 -> red.
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.03),
      profile: [stat({
        distanceFrom3Prime: 0, deletionCount: 30, mismatchCount: 30, mismatchFraction: 0.03,
      })],
    });
    expect(s.score).toBeCloseTo(0.18, 6);
    expect(s.level).toBe('red');
    expect(s.reasons.join(' ')).toMatch(/3′|3'/);
  });

  it('leaves the same frequency amber when it sits mid-oligo', () => {
    // Identical 3% rate, but 12 bases from the 3' end and a substitution:
    // score = weight 1 x 0.03 = 0.03, which is amber, not red.
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.03),
      profile: [stat({
        distanceFrom3Prime: 12, substitutionCount: 30, mismatchCount: 30, mismatchFraction: 0.03,
      })],
    });
    expect(s.score).toBeCloseTo(0.03, 6);
    expect(s.level).toBe('amber');
  });

  it('is amber in the middle band', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.02),
      profile: [stat({ distanceFrom3Prime: 12, substitutionCount: 20, mismatchCount: 20, mismatchFraction: 0.02 })],
    });
    expect(s.level).toBe('amber');
  });

  it('is unknown when the denominator is too small', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: computeWindowMetrics({ nScope: 40, nFullCoverage: 30, nMismatch: 20 }),
      profile: [stat({})],
    });
    expect(s.level).toBe('unknown');
    expect(s.reasons.join(' ')).toMatch(/too few/i);
  });

  it('is unknown when most sequences could not be assessed', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: computeWindowMetrics({ nScope: 10000, nFullCoverage: 3000, nMismatch: 10 }),
      profile: [stat({})],
    });
    expect(s.level).toBe('unknown');
    expect(s.reasons.join(' ')).toMatch(/coverage/i);
  });

  it('notes when a position profile relied on inferred coverage', () => {
    const s = scoreSeverity({
      role: 'forward',
      metrics: metrics(0.001),
      profile: [stat({ coverageIsInferred: true })],
    });
    expect(s.reasons.join(' ')).toMatch(/inferred|not reported/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/severity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/severity.ts`:

```ts
import type { OligoRole } from '../oligo-input';
import type { WindowMetrics } from './metrics';
import type { PositionStat } from './profile';
import {
  AMBER_FRACTION, AMBER_SCORE, COVERAGE_GAP_UNUSABLE, DELETION_WEIGHT,
  RED_FRACTION, RED_SCORE, THREE_PRIME_CRITICAL, THREE_PRIME_NEAR,
} from './constants';

export type SeverityLevel = 'green' | 'amber' | 'red' | 'unknown';

export interface Severity {
  level: SeverityLevel;
  score: number;
  reasons: string[];
}

export function positionWeight(role: OligoRole, distanceFrom3Prime: number): number {
  if (role === 'probe') return 1;
  if (distanceFrom3Prime <= THREE_PRIME_CRITICAL) return 3;
  if (distanceFrom3Prime <= THREE_PRIME_NEAR) return 2;
  return 1;
}

export function scoreSeverity(input: {
  role: OligoRole;
  metrics: WindowMetrics;
  profile: PositionStat[];
}): Severity {
  const { role, metrics, profile } = input;
  const reasons: string[] = [];

  let score = 0;
  for (const p of profile) {
    const denominator = p.effectiveDenominator;
    if (denominator === 0) continue;
    const substitutionFraction = p.substitutionCount / denominator;
    const deletionFraction = p.deletionCount / denominator;
    score += positionWeight(role, p.distanceFrom3Prime) *
      (substitutionFraction + DELETION_WEIGHT * deletionFraction);
  }

  if (!metrics.sufficientData) {
    reasons.push(
      `Too few assessable sequences (n = ${metrics.nFullCoverage}) to report a rate.`,
    );
    return { level: 'unknown', score, reasons };
  }
  if (metrics.coverageGapFraction > COVERAGE_GAP_UNUSABLE) {
    reasons.push(
      `${Math.round(metrics.coverageGapFraction * 100)}% of sequences in scope lack coverage across this site, so the rate is not interpretable.`,
    );
    return { level: 'unknown', score, reasons };
  }

  if (role === 'probe') {
    reasons.push('Probe positions are weighted uniformly; the 3′ weighting applies to primers only.');
  }

  const near3Prime = profile.filter(
    (p) => role !== 'probe' && p.distanceFrom3Prime <= THREE_PRIME_CRITICAL && p.mismatchFraction > 0.01,
  );
  if (near3Prime.length > 0) {
    reasons.push(
      `${near3Prime.length} mismatch position(s) fall within the terminal three bases of the 3′ end.`,
    );
  }

  const deletions = profile.filter((p) => p.deletionCount > 0);
  if (deletions.length > 0) {
    reasons.push(
      `Deletions observed at ${deletions.length} position(s); deletions are weighted ${DELETION_WEIGHT}× substitutions.`,
    );
  }

  if (profile.some((p) => p.coverageIsInferred)) {
    reasons.push(
      'Per-position coverage was not reported at some positions (no mutation observed there); the window denominator was used instead.',
    );
  }

  const fraction = metrics.mismatchFraction ?? 0;
  let level: SeverityLevel;
  if (fraction >= RED_FRACTION || score >= RED_SCORE) level = 'red';
  else if (fraction >= AMBER_FRACTION || score >= AMBER_SCORE) level = 'amber';
  else level = 'green';

  return { level, score, reasons };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/severity.test.ts`
Expected: PASS, 10 tests.

The pair "escalates to red…" / "leaves the same frequency amber…" is the test that proves the 3′ weighting does real work. If a threshold change ever makes both cases land on the same level, the heuristic has stopped distinguishing position and the change should be reverted.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/severity.ts src/core/analysis/severity.test.ts
git commit -m "feat(analysis): 3-prime weighted severity heuristic with stated reasons"
```

---

### Task 3.8: Sampling-bias diagnostics

The brief says a designed answer to sampling bias, not a paragraph of small print. These are the machine-checkable parts of that answer.

**Files:**
- Create: `src/core/analysis/diagnostics.ts`
- Test: `src/core/analysis/diagnostics.test.ts`

**Interfaces:**
- Consumes: `WindowMetrics` from `./metrics`; `TrendSeries` from `./trend`; `Attribution` from `./attribution`; thresholds from `./constants`.
- Produces:
  - `type DiagnosticId = 'no-data' | 'small-n' | 'coverage-gap' | 'deposition-lag' | 'geographic-concentration' | 'undated-records'`
  - `interface Diagnostic { id: DiagnosticId; severity: 'info' | 'warn'; message: string }`
  - `computeDiagnostics(input: { metrics: WindowMetrics; trend: TrendSeries; country: Attribution }): Diagnostic[]`

- [ ] **Step 1: Write the failing tests**

`src/core/analysis/diagnostics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDiagnostics } from './diagnostics';
import { computeWindowMetrics } from './metrics';
import type { TrendSeries } from './trend';
import type { Attribution } from './attribution';

const trend = (counts: number[], over: Partial<TrendSeries> = {}): TrendSeries => ({
  granularity: 'month',
  points: counts.map((n, i) => ({
    bucket: `2025-${String(i + 1).padStart(2, '0')}`,
    nFullCoverage: n, nMismatch: 0,
    mismatchFraction: n > 0 ? 0 : null, sufficientData: n >= 50,
  })),
  undatedFullCoverage: 0, undatedMismatch: 0, ...over,
});

const country = (topShare: number): Attribution => ({
  field: 'country',
  rows: [{ value: 'United Kingdom', count: Math.round(topShare * 1000), share: topShare }],
  otherCount: 1000 - Math.round(topShare * 1000), unassignedCount: 0, total: 1000, topShare,
});

const ids = (list: { id: string }[]) => list.map((d) => d.id);

describe('computeDiagnostics', () => {
  it('reports no-data when nothing is in scope', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 0, nFullCoverage: 0, nMismatch: 0 }),
      trend: trend([]), country: country(0),
    });
    expect(ids(out)).toContain('no-data');
  });

  it('reports a small denominator', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 45, nFullCoverage: 40, nMismatch: 1 }),
      trend: trend([40]), country: country(0.4),
    });
    expect(ids(out)).toContain('small-n');
  });

  it('reports a large coverage gap', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 1000, nFullCoverage: 700, nMismatch: 10 }),
      trend: trend([700]), country: country(0.4),
    });
    const gap = out.find((d) => d.id === 'coverage-gap')!;
    expect(gap.message).toMatch(/300/);
    expect(gap.severity).toBe('warn');
  });

  it('reports deposition lag when the trailing buckets collapse', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 5000, nFullCoverage: 5000, nMismatch: 5 }),
      trend: trend([1000, 1000, 1000, 1000, 1000, 1000, 100, 40, 10, 2]),
      country: country(0.3),
    });
    expect(ids(out)).toContain('deposition-lag');
  });

  it('does not report deposition lag on a stable series', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 5000, nFullCoverage: 5000, nMismatch: 5 }),
      trend: trend([1000, 900, 1100, 950, 1000, 1050, 980, 1020]),
      country: country(0.3),
    });
    expect(ids(out)).not.toContain('deposition-lag');
  });

  it('reports geographic concentration', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 5000, nFullCoverage: 5000, nMismatch: 500 }),
      trend: trend([1000, 1000, 1000, 1000, 1000]), country: country(0.85),
    });
    const geo = out.find((d) => d.id === 'geographic-concentration')!;
    expect(geo.message).toMatch(/United Kingdom/);
    expect(geo.message).toMatch(/85/);
  });

  it('reports undated records', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 1000, nFullCoverage: 1000, nMismatch: 5 }),
      trend: trend([1000], { undatedFullCoverage: 120 }), country: country(0.3),
    });
    expect(ids(out)).toContain('undated-records');
  });

  it('returns nothing for a clean, well-sampled query', () => {
    const out = computeDiagnostics({
      metrics: computeWindowMetrics({ nScope: 10000, nFullCoverage: 9900, nMismatch: 5 }),
      trend: trend([1000, 1000, 1000, 1000, 1000, 1000]), country: country(0.25),
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/diagnostics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/diagnostics.ts`:

```ts
import type { Attribution } from './attribution';
import type { WindowMetrics } from './metrics';
import type { TrendSeries } from './trend';
import {
  COVERAGE_GAP_WARN, DEPOSITION_LAG_BUCKETS, DEPOSITION_LAG_RATIO,
  MIN_DENOMINATOR, TOP_COUNTRY_SHARE_WARN,
} from './constants';

export type DiagnosticId =
  | 'no-data' | 'small-n' | 'coverage-gap'
  | 'deposition-lag' | 'geographic-concentration' | 'undated-records';

export interface Diagnostic {
  id: DiagnosticId;
  severity: 'info' | 'warn';
  message: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

export function computeDiagnostics(input: {
  metrics: WindowMetrics;
  trend: TrendSeries;
  country: Attribution;
}): Diagnostic[] {
  const { metrics, trend, country } = input;
  const out: Diagnostic[] = [];

  if (metrics.nScope === 0) {
    out.push({
      id: 'no-data', severity: 'warn',
      message: 'No sequences match these filters. Widen the date range or remove a filter.',
    });
    return out;
  }

  if (!metrics.sufficientData) {
    out.push({
      id: 'small-n', severity: 'warn',
      message: `Only ${metrics.nFullCoverage} sequences can be assessed at this site (minimum ${MIN_DENOMINATOR}). Treat any rate as indicative only.`,
    });
  }

  if (metrics.coverageGapFraction > COVERAGE_GAP_WARN) {
    out.push({
      id: 'coverage-gap', severity: 'warn',
      message: `${metrics.coverageGap} of ${metrics.nScope} sequences (${Math.round(metrics.coverageGapFraction * 100)}%) have an ambiguous base somewhere in this binding site and are excluded. A mutation there would not be visible.`,
    });
  }

  const counts = trend.points.map((p) => p.nFullCoverage);
  if (counts.length >= DEPOSITION_LAG_BUCKETS * 2) {
    const tail = counts.slice(-DEPOSITION_LAG_BUCKETS);
    const historical = median(counts.slice(0, -DEPOSITION_LAG_BUCKETS));
    if (historical > 0 && median(tail) < historical * DEPOSITION_LAG_RATIO) {
      out.push({
        id: 'deposition-lag', severity: 'warn',
        message: `The most recent ${DEPOSITION_LAG_BUCKETS} ${trend.granularity}s contain far fewer sequences than earlier periods. Sequences are usually deposited weeks after collection, so the end of the trend is incomplete rather than genuinely quiet.`,
      });
    }
  }

  if (country.topShare > TOP_COUNTRY_SHARE_WARN && country.rows.length > 0) {
    const top = country.rows[0] as { value: string; count: number };
    out.push({
      id: 'geographic-concentration', severity: 'warn',
      message: `${Math.round(country.topShare * 100)}% of the mismatch-carrying sequences come from ${top.value}. This may reflect where sequencing happens rather than where the variant circulates.`,
    });
  }

  if (trend.undatedFullCoverage > 0) {
    out.push({
      id: 'undated-records', severity: 'info',
      message: `${trend.undatedFullCoverage} assessable sequences carry no usable collection date and appear in the headline figure but not in the trend.`,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/diagnostics.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/diagnostics.ts src/core/analysis/diagnostics.test.ts
git commit -m "feat(analysis): sampling-bias diagnostics"
```

---

### Task 3.9: Orchestrator

**Files:**
- Create: `src/core/analysis/run.ts`
- Test: `src/core/analysis/run.test.ts`

**Interfaces:**
- Consumes: everything in `src/core/analysis/*`, `src/core/query.ts`, `src/core/lapis/endpoints.ts`, `src/core/scope.ts`, `src/core/registry.ts`.
- Produces:
  - `interface AnalysisOligo { id: string; name: string; role: OligoRole; sequence: string; site: BindingSite }`
  - `interface OligoAnalysis { oligoId; name; role; sequence; site; window: WindowSpec; metrics: WindowMetrics; profile: PositionStat[]; insertions: WindowInsertion[]; trend: TrendSeries; lineage: Attribution; country: Attribution; severity: Severity; diagnostics: Diagnostic[] }`
  - `interface AnalysisResult { scope: Scope; pathogenId: PathogenId; generatedAt: string; dataVersion: string; nScope: number; oligos: OligoAnalysis[]; queryCount: number }`
  - `runAnalysis(input: { transport: LapisTransport; scope: Scope; oligos: AnalysisOligo[]; reference: ReferenceGenome; signal?: AbortSignal; now?: () => Date }): Promise<AnalysisResult>`

Query issuing follows Part I.5 exactly: **one** scope-by-date query, **one** mutations query, **one** insertions query, and four per oligo. All are issued with `Promise.all`. If the caller aborts, the rejection propagates unchanged.

**Split point:** if `run.ts` exceeds ~200 lines, move the per-oligo assembly into `src/core/analysis/run-oligo.ts` and keep `run.ts` as the fan-out.

- [ ] **Step 1: Write the failing test**

`src/core/analysis/run.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runAnalysis } from './run';
import { findBindingSites } from '../binding';
import { getPathogen } from '../registry';
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/analysis/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/core/analysis/run.ts`:

```ts
import type { BindingSite } from '../binding';
import type { ReferenceGenome } from '../reference';
import type { OligoRole } from '../oligo-input';
import type { LapisTransport } from '../lapis/transport';
import {
  queryAggregated, queryNucleotideInsertions, queryNucleotideMutations,
  type AggregatedRow, type InsertionRow, type MutationRow,
} from '../lapis/endpoints';
import { getPathogen, type PathogenId } from '../registry';
import { scopeToFilters, type Scope } from '../scope';
import {
  buildWindowSpec, fullCoverageQuery, mismatchWithCoverageQuery, type WindowSpec,
} from '../query';
import { buildAttribution, type Attribution } from './attribution';
import { computeDiagnostics, type Diagnostic } from './diagnostics';
import { insertionsInWindow, type WindowInsertion } from './insertions';
import { computeWindowMetrics, sumCounts, type WindowMetrics } from './metrics';
import { buildPositionProfile, type PositionStat } from './profile';
import { scoreSeverity, type Severity } from './severity';
import { buildTrend, type TrendSeries } from './trend';

export interface AnalysisOligo {
  id: string;
  name: string;
  role: OligoRole;
  sequence: string;
  site: BindingSite;
}

export interface OligoAnalysis {
  oligoId: string;
  name: string;
  role: OligoRole;
  sequence: string;
  site: BindingSite;
  window: WindowSpec;
  metrics: WindowMetrics;
  profile: PositionStat[];
  insertions: WindowInsertion[];
  trend: TrendSeries;
  lineage: Attribution;
  country: Attribution;
  severity: Severity;
  diagnostics: Diagnostic[];
}

export interface AnalysisResult {
  scope: Scope;
  pathogenId: PathogenId;
  generatedAt: string;
  dataVersion: string;
  nScope: number;
  oligos: OligoAnalysis[];
  queryCount: number;
}

export async function runAnalysis(input: {
  transport: LapisTransport;
  scope: Scope;
  oligos: AnalysisOligo[];
  reference: ReferenceGenome;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<AnalysisResult> {
  const { transport, scope, oligos, reference, signal } = input;
  const now = input.now ?? (() => new Date());
  const cfg = getPathogen(scope.pathogenId);
  const filters = scopeToFilters(scope, cfg);
  const opts = signal ? { signal } : {};
  let queryCount = 0;

  const windows = oligos.map((o) =>
    buildWindowSpec(o.site, o.sequence, reference, o.role, { segmented: cfg.segmented }),
  );

  const scopePromise = queryAggregated(transport, cfg, filters, { fields: [cfg.dateField], ...opts });
  const mutationsPromise = queryNucleotideMutations(transport, cfg, filters, { minProportion: 0, ...opts });
  const insertionsPromise = queryNucleotideInsertions(transport, cfg, filters, opts);
  queryCount += 3;

  const perOligoPromises = windows.map((w) => {
    const coverage = fullCoverageQuery(w);
    const mismatch = mismatchWithCoverageQuery(w);
    queryCount += 4;
    return Promise.all([
      queryAggregated(transport, cfg, filters, { fields: [cfg.dateField], advancedQuery: coverage, ...opts }),
      queryAggregated(transport, cfg, filters, { fields: [cfg.dateField], advancedQuery: mismatch, ...opts }),
      queryAggregated(transport, cfg, filters, { fields: [cfg.lineageField], advancedQuery: mismatch, ...opts }),
      queryAggregated(transport, cfg, filters, { fields: [cfg.countryField], advancedQuery: mismatch, ...opts }),
    ]);
  });

  const [scopeRes, mutationsRes, insertionsRes, perOligo] = await Promise.all([
    scopePromise, mutationsPromise, insertionsPromise, Promise.all(perOligoPromises),
  ]);

  const nScope = sumCounts(scopeRes.data);
  const mutationRows: MutationRow[] = mutationsRes.data;
  const insertionRows: InsertionRow[] = insertionsRes.data;

  const analyses: OligoAnalysis[] = oligos.map((o, i) => {
    const w = windows[i] as WindowSpec;
    const responses = perOligo[i];
    if (!responses) throw new Error(`Missing responses for oligo ${o.id}`);
    const [coverageRes, mismatchRes, lineageRes, countryRes] = responses;

    const metrics = computeWindowMetrics({
      nScope,
      nFullCoverage: sumCounts(coverageRes.data),
      nMismatch: sumCounts(mismatchRes.data),
    });
    const profile = buildPositionProfile(w, mutationRows, metrics.nFullCoverage);
    const trend = buildTrend({
      coverageRows: coverageRes.data, mismatchRows: mismatchRes.data,
      dateField: cfg.dateField, dateFrom: scope.dateFrom, dateTo: scope.dateTo,
    });
    const lineage = buildAttribution(lineageRes.data, cfg.lineageField);
    const country = buildAttribution(countryRes.data, cfg.countryField);

    return {
      oligoId: o.id, name: o.name, role: o.role, sequence: o.sequence, site: o.site,
      window: w, metrics, profile,
      insertions: insertionsInWindow(w, insertionRows, metrics.nFullCoverage),
      trend, lineage, country,
      severity: scoreSeverity({ role: o.role, metrics, profile }),
      diagnostics: computeDiagnostics({ metrics, trend, country }),
    };
  });

  return {
    scope,
    pathogenId: scope.pathogenId,
    generatedAt: now().toISOString(),
    dataVersion: scopeRes.dataVersion,
    nScope,
    oligos: analyses,
    queryCount,
  };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run src/core/analysis/run.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/analysis/run.ts src/core/analysis/run.test.ts
git commit -m "feat(analysis): orchestrator issuing the fixed 3+4n query plan"
```

---

### Task 3.10: Golden cases

The point of this task is that the tool is shown reproducing failures that really happened, and correctly reporting a site that really is fine. If any assertion here needs loosening to pass, something upstream is wrong — **do not loosen it without reporting at the review gate.**

**Files:**
- Create: `tests/golden/golden.test.ts`
- Create: `tests/golden/helpers.ts`
- Test: itself

**Interfaces:**
- Consumes: `createFixtureTransport` from `src/core/lapis/fixture-transport`; `computeWindowMetrics` from `src/core/analysis/metrics`; `scoreSeverity`; `buildWindowSpec`; `fullCoverageQuery`; `mismatchWithCoverageQuery`; `loadReference`.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Write the helper**

`tests/golden/helpers.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixtureTransport, type FixtureRecord } from '../../src/core/lapis/fixture-transport';
import type { LapisTransport } from '../../src/core/lapis/transport';

export function loadFixtureSet(name: string): LapisTransport {
  const path = join(process.cwd(), 'tests', 'fixtures', `${name}.json`);
  return createFixtureTransport(JSON.parse(readFileSync(path, 'utf8')) as FixtureRecord[]);
}

/** Builds the two window queries for a coordinate range without going through a binding search. */
export function windowQueries(
  from: number, to: number, qualifier: string | null,
): { coverage: string; mismatch: string } {
  const label = (p: number) => (qualifier ? `${qualifier}:${p}` : `${p}`);
  const positions = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const ambiguity = positions.map((p) => `${label(p)}N`).join(' | ');
  return {
    coverage: `!(${ambiguity})`,
    mismatch: `(${positions.map(label).join(' | ')}) & !(${ambiguity})`,
  };
}
```

- [ ] **Step 2: Write the failing golden tests**

`tests/golden/golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadFixtureSet, windowQueries } from './helpers';
import { queryAggregated, queryNucleotideMutations } from '../../src/core/lapis/endpoints';
import { getPathogen } from '../../src/core/registry';
import { computeWindowMetrics } from '../../src/core/analysis/metrics';
import { buildPositionProfile } from '../../src/core/analysis/profile';
import { scoreSeverity } from '../../src/core/analysis/severity';
import { buildWindowSpec, mismatchWithCoverageQuery } from '../../src/core/query';
import { findBindingSites } from '../../src/core/binding';
import { loadReference } from '../../src/data/references';

const sc2 = getPathogen('sars-cov-2');
const h3n2 = getPathogen('h3n2');

const sc2Filters = (dateFrom: string, dateTo: string) => ({
  country: ['United Kingdom'], dateFrom, dateTo,
});
const fluFilters = (from: string, to: string) => ({
  sampleCollectionDateRangeLowerFrom: from, sampleCollectionDateRangeUpperTo: to,
});

async function measure(
  fixtureSet: string,
  cfg: typeof sc2,
  filters: Record<string, unknown>,
  q: { coverage: string; mismatch: string },
) {
  const transport = loadFixtureSet(fixtureSet);
  const [scope, coverage, mismatch] = await Promise.all([
    queryAggregated(transport, cfg, filters),
    queryAggregated(transport, cfg, filters, { advancedQuery: q.coverage }),
    queryAggregated(transport, cfg, filters, { advancedQuery: q.mismatch }),
  ]);
  return computeWindowMetrics({
    nScope: scope.data[0]!.count,
    nFullCoverage: coverage.data[0]!.count,
    nMismatch: mismatch.data[0]!.count,
  });
}

describe('G1 — Alpha S-gene target failure', () => {
  const q = windowQueries(21765, 21786, null);

  it('the window sits over the reference bases spanning the six-nucleotide deletion', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(21764, 21786)).toBe('TACATGTCTCTGGGACCAATGG');
  });

  it('the production query builder emits the same expression as the fixture', () => {
    const oligo = 'TACATGTCTCTGGGACCAATGG';
    const ref = loadReference('sars-cov-2');
    const site = findBindingSites(oligo, ref)[0]!;
    const w = buildWindowSpec(site, oligo, ref, 'forward', { segmented: false });
    expect(mismatchWithCoverageQuery(w)).toBe(q.mismatch);
  });

  it('reports ~3.3% before Alpha spread', async () => {
    const m = await measure('g1-alpha-2020-09', sc2, sc2Filters('2020-09-01', '2020-10-01'), q);
    expect(m.nScope).toBe(18892);
    expect(m.nFullCoverage).toBe(18747);
    expect(m.nMismatch).toBe(612);
    expect(m.mismatchFraction!).toBeCloseTo(0.0326, 4);
  });

  it('reports ~95.9% five months later', async () => {
    const m = await measure('g1-alpha-2021-02', sc2, sc2Filters('2021-02-01', '2021-03-01'), q);
    expect(m.nScope).toBe(71142);
    expect(m.nFullCoverage).toBe(70387);
    expect(m.nMismatch).toBe(67520);
    expect(m.mismatchFraction!).toBeCloseTo(0.9593, 4);
  });

  it('rates the February 2021 state red', async () => {
    const m = await measure('g1-alpha-2021-02', sc2, sc2Filters('2021-02-01', '2021-03-01'), q);
    expect(scoreSeverity({ role: 'forward', metrics: m, profile: [] }).level).toBe('red');
  });

  it('resolves the six-nucleotide deletion at single-base resolution in the profile', async () => {
    const transport = loadFixtureSet('g1-alpha-2021-02');
    const oligo = 'TACATGTCTCTGGGACCAATGG';
    const ref = loadReference('sars-cov-2');
    const site = findBindingSites(oligo, ref)[0]!;
    const w = buildWindowSpec(site, oligo, ref, 'forward', { segmented: false });

    const mutations = await queryNucleotideMutations(
      transport, sc2, sc2Filters('2021-02-01', '2021-03-01'), { minProportion: 0.001 },
    );
    const profile = buildPositionProfile(w, mutations.data, 70387);

    // Positions 21765-21770 are the deletion; 21771 onward are not.
    const deleted = profile.filter((p) => p.deletionCount > 1000);
    expect(deleted.map((p) => p.refPos)).toEqual([21765, 21766, 21767, 21768, 21769, 21770]);
    expect(profile[0]!.deletionCount).toBe(67469);
    expect(profile[0]!.coverage).toBe(70454);
    expect(profile[0]!.coverageIsInferred).toBe(false);
    expect(profile[0]!.mismatchFraction).toBeCloseTo(0.9576, 4);
  });
});

describe('G2 — Influenza A/H3N2 HA drift', () => {
  const q = windowQueries(600, 621, 'seg4');

  it('qualifies every term with the segment', () => {
    expect(q.mismatch.startsWith('(seg4:600 | seg4:601')).toBe(true);
    expect(q.coverage.startsWith('!(seg4:600N')).toBe(true);
  });

  it('reports ~6.5% in 2022', async () => {
    const m = await measure('g2-h3n2-2022', h3n2, fluFilters('2022-01-01', '2022-12-31'), q);
    expect(m.nFullCoverage).toBe(41794);
    expect(m.nMismatch).toBe(2706);
    expect(m.mismatchFraction!).toBeCloseTo(0.0647, 4);
  });

  it('reports ~99.7% in 2025', async () => {
    const m = await measure('g2-h3n2-2025', h3n2, fluFilters('2025-01-01', '2025-12-31'), q);
    expect(m.nFullCoverage).toBe(22445);
    expect(m.nMismatch).toBe(22380);
    expect(m.mismatchFraction!).toBeCloseTo(0.9971, 4);
  });
});

describe('G3 — conserved site negative control', () => {
  const q = windowQueries(15784, 15805, null);

  it('the window sits over the expected reference bases', () => {
    const seq = loadReference('sars-cov-2').segments[0]!.sequence;
    expect(seq.slice(15783, 15805)).toBe('TTTAAGTCAGTTCTTTATTATC');
  });

  it('reports essentially zero mismatch', async () => {
    const m = await measure('g3-conserved-control', sc2, sc2Filters('2024-01-01', '2025-06-30'), q);
    expect(m.nFullCoverage).toBe(44669);
    expect(m.nMismatch).toBe(3);
    expect(m.mismatchFraction!).toBeLessThan(0.0001);
  });

  it('rates it green', async () => {
    const m = await measure('g3-conserved-control', sc2, sc2Filters('2024-01-01', '2025-06-30'), q);
    expect(scoreSeverity({ role: 'forward', metrics: m, profile: [] }).level).toBe('green');
  });

  it('still reports the 1998-sequence coverage gap alongside the green result', async () => {
    const m = await measure('g3-conserved-control', sc2, sc2Filters('2024-01-01', '2025-06-30'), q);
    expect(m.coverageGap).toBe(1998);
    expect(m.coverageGapFraction).toBeCloseTo(0.0428, 4);
  });
});
```

- [ ] **Step 3: Run and confirm failure, then pass**

Run: `npx vitest run tests/golden`
Expected first: FAIL (helpers/fixtures missing or assertions unmet). After the fixtures from Task 2.6 are present: PASS, 13 tests.

If the "production query builder emits the same expression" test fails, **that is the most important failure in the suite** — it means the code that runs in the browser is not the code the golden numbers were measured with. Fix `query.ts`, never the test.

- [ ] **Step 4: Commit**

```bash
git add tests/golden
git commit -m "test(golden): Alpha, H3N2 HA drift, and conserved-site control"
```

> ### ⛔ REVIEW GATE — Phase 3
> Post the full `npm test` output including the golden suite, and the `src/core/**` coverage figure. State the computed headline for each of the five golden measurements and confirm each matches Part I.6 to four decimal places. Then stop.

---

## Phase 4 — Interface

The analysis engine is finished and tested. This phase puts a face on it and adds **no new arithmetic** — if a component needs to compute something, that computation belongs in `src/core/analysis/` with its own unit test.

Component tests use React Testing Library and assert on what a user can perceive: text, roles, labels. Do not assert on class names.

### Task 4.1: App shell, store, and the regulatory notice

**Files:**
- Create: `src/state/store.ts`, `src/ui/AppShell.tsx`, `src/ui/RegulatoryNotice.tsx`
- Modify: `src/App.tsx`, `src/index.css`
- Test: `src/state/store.test.ts`, `src/ui/RegulatoryNotice.test.tsx`

**Interfaces:**
- Consumes: `PathogenId` from `src/core/registry`; `Scope` from `src/core/scope`; `OligoInput` from `src/core/oligo-input`; `Resolution`, `BindingSite`; `AnalysisResult`.
- Produces:
  - `REGULATORY_STATEMENT` — **re-exported** from `src/core/analysis/constants.ts`, not redefined. UI code imports it from the store; `src/core/**` imports it from `constants.ts`.
  - `type Step = 'input' | 'binding' | 'scope' | 'results'`
  - `interface AppState { step; pathogenId; oligos; roles; resolutions; chosenSites; scope; result; status; error; ... }` plus the actions listed below
  - `useAppStore` (zustand)

Actions: `setPathogen(id)`, `setOligos(oligos)`, `setRole(oligoId, role)`, `setResolution(oligoId, resolution)`, `chooseSite(oligoId, site)`, `setScope(partial)`, `goTo(step)`, `startAnalysis()`, `analysisSucceeded(result)`, `analysisFailed(message)`, `reset()`.

- [ ] **Step 1: Write the failing store tests**

`src/state/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './store';

const reset = () => { useAppStore.getState().reset(); };

describe('app store', () => {
  beforeEach(reset);

  it('starts on the input step with SARS-CoV-2 selected', () => {
    const s = useAppStore.getState();
    expect(s.step).toBe('input');
    expect(s.pathogenId).toBe('sars-cov-2');
    expect(s.status).toBe('idle');
  });

  it('defaults the scope to the pathogen window ending today', () => {
    const { scope } = useAppStore.getState();
    expect(scope.dateTo >= scope.dateFrom).toBe(true);
    expect(scope.countries).toEqual([]);
  });

  it('clears resolutions and results when the pathogen changes', () => {
    const s = () => useAppStore.getState();
    s().setOligos([{ id: 'o1', name: 'x', role: 'forward', sequence: 'ACGTACGTACGTACGT' }]);
    s().chooseSite('o1', { segment: 'main', strand: 'plus', start: 1, end: 16, mismatches: 0, mismatchOligoIndexes: [] });
    s().setPathogen('h3n2');
    expect(s().chosenSites).toEqual({});
    expect(s().result).toBeNull();
    expect(s().step).toBe('input');
  });

  it('records a role override', () => {
    const s = () => useAppStore.getState();
    s().setOligos([{ id: 'o1', name: 'x', role: null, sequence: 'ACGTACGTACGTACGT' }]);
    s().setRole('o1', 'probe');
    expect(s().roles['o1']).toBe('probe');
  });

  it('moves through the analysis lifecycle', () => {
    const s = () => useAppStore.getState();
    s().startAnalysis();
    expect(s().status).toBe('loading');
    s().analysisFailed('LAPIS 400: bad query');
    expect(s().status).toBe('error');
    expect(s().error).toMatch(/bad query/);
    s().startAnalysis();
    expect(s().error).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing regulatory-notice test**

`src/ui/RegulatoryNotice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RegulatoryNotice } from './RegulatoryNotice';
import { REGULATORY_STATEMENT } from '../state/store';

describe('RegulatoryNotice', () => {
  it('renders the exact statement', () => {
    render(<RegulatoryNotice />);
    expect(screen.getByText(REGULATORY_STATEMENT)).toBeInTheDocument();
  });
  it('is exposed to assistive technology as a note', () => {
    render(<RegulatoryNotice />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
  it('is not inside a details/summary disclosure', () => {
    const { container } = render(<RegulatoryNotice />);
    expect(container.querySelector('details')).toBeNull();
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run src/state src/ui/RegulatoryNotice.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the store**

`src/state/store.ts` — key points, written in full by the implementer:

```ts
import { create } from 'zustand';
import type { BindingSite } from '../core/binding';
import type { OligoInput, OligoRole } from '../core/oligo-input';
import type { Resolution } from '../core/resolution';
import { getPathogen, type PathogenId } from '../core/registry';
import type { Scope } from '../core/scope';
import type { AnalysisResult } from '../core/analysis/run';

export { REGULATORY_STATEMENT } from '../core/analysis/constants';

export type Step = 'input' | 'binding' | 'scope' | 'results';
export type Status = 'idle' | 'loading' | 'ready' | 'error';

function defaultScope(pathogenId: PathogenId, today = new Date()): Scope {
  const cfg = getPathogen(pathogenId);
  const to = new Date(today);
  const from = new Date(today);
  from.setMonth(from.getMonth() - cfg.defaultWindowMonths);
  return {
    pathogenId,
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    countries: [],
    lineages: [],
  };
}

interface AppState {
  step: Step;
  pathogenId: PathogenId;
  oligos: OligoInput[];
  roles: Record<string, OligoRole>;
  resolutions: Record<string, Resolution>;
  chosenSites: Record<string, BindingSite>;
  scope: Scope;
  result: AnalysisResult | null;
  status: Status;
  error: string | null;

  setPathogen(id: PathogenId): void;
  setOligos(oligos: OligoInput[]): void;
  setRole(oligoId: string, role: OligoRole): void;
  setResolution(oligoId: string, resolution: Resolution): void;
  chooseSite(oligoId: string, site: BindingSite): void;
  setScope(partial: Partial<Scope>): void;
  goTo(step: Step): void;
  startAnalysis(): void;
  analysisSucceeded(result: AnalysisResult): void;
  analysisFailed(message: string): void;
  reset(): void;
}

const initial = (pathogenId: PathogenId = 'sars-cov-2') => ({
  step: 'input' as Step,
  pathogenId,
  oligos: [] as OligoInput[],
  roles: {} as Record<string, OligoRole>,
  resolutions: {} as Record<string, Resolution>,
  chosenSites: {} as Record<string, BindingSite>,
  scope: defaultScope(pathogenId),
  result: null,
  status: 'idle' as Status,
  error: null,
});

export const useAppStore = create<AppState>((set) => ({
  ...initial(),

  setPathogen: (id) => set(() => ({ ...initial(id) })),
  setOligos: (oligos) =>
    set(() => ({
      oligos,
      roles: Object.fromEntries(
        oligos.filter((o) => o.role !== null).map((o) => [o.id, o.role as OligoRole]),
      ),
      resolutions: {},
      chosenSites: {},
      result: null,
      status: 'idle',
      error: null,
    })),
  setRole: (oligoId, role) => set((s) => ({ roles: { ...s.roles, [oligoId]: role } })),
  setResolution: (oligoId, resolution) =>
    set((s) => ({ resolutions: { ...s.resolutions, [oligoId]: resolution } })),
  chooseSite: (oligoId, site) => set((s) => ({ chosenSites: { ...s.chosenSites, [oligoId]: site } })),
  setScope: (partial) => set((s) => ({ scope: { ...s.scope, ...partial }, result: null })),
  goTo: (step) => set(() => ({ step })),
  startAnalysis: () => set(() => ({ status: 'loading', error: null })),
  analysisSucceeded: (result) => set(() => ({ status: 'ready', result, step: 'results' })),
  analysisFailed: (message) => set(() => ({ status: 'error', error: message })),
  reset: () => set(() => ({ ...initial() })),
}));
```

- [ ] **Step 5: Implement the shell and the notice**

`src/ui/RegulatoryNotice.tsx` renders `REGULATORY_STATEMENT` inside `<aside role="note">`. `src/ui/AppShell.tsx` renders the `<h1>`, a one-sentence explanation, the pathogen selector slot, a numbered step indicator, the children, and a footer that repeats `REGULATORY_STATEMENT`.

- [ ] **Step 6: Run and confirm pass**

Run: `npx vitest run src/state src/ui`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/state src/ui/AppShell.tsx src/ui/RegulatoryNotice.tsx src/App.tsx src/index.css
git commit -m "feat(ui): app shell, store, and always-visible regulatory notice"
```

---

### Task 4.2: Step 1 — oligo input and role assignment

**Files:**
- Create: `src/ui/input/OligoInputPanel.tsx`, `src/ui/input/RoleSelector.tsx`
- Test: `src/ui/input/OligoInputPanel.test.tsx`

**Interfaces:**
- Consumes: `parseOligoText`, `OligoRole` from `src/core/oligo-input`; `useAppStore`.
- Produces: `<OligoInputPanel />`, `<RoleSelector oligoId role onChange />`

Behaviour: a textarea accepting FASTA or bare lines; parse on change (debounced 200 ms); show each parsed oligo with its length, guessed role as a preselected but changeable control, and a "role needed" marker where the guess failed. Parse errors render as a list, and valid oligos are still shown. "Continue" is disabled until every oligo has a role.

- [ ] **Step 1: Write the failing tests**

`src/ui/input/OligoInputPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { OligoInputPanel } from './OligoInputPanel';
import { useAppStore } from '../../state/store';

beforeEach(() => { useAppStore.getState().reset(); });

const type = async (text: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(/paste your oligos/i));
  await user.paste(text);
};

describe('OligoInputPanel', () => {
  it('lists parsed oligos with their lengths', async () => {
    render(<OligoInputPanel />);
    await type('>N1-F\nGACCCCAAAATCAGCGAAAT');
    expect(await screen.findByText('N1-F')).toBeInTheDocument();
    expect(screen.getByText(/20 nt/)).toBeInTheDocument();
  });

  it('preselects a guessed role but leaves it changeable', async () => {
    render(<OligoInputPanel />);
    await type('>N1-F\nGACCCCAAAATCAGCGAAAT');
    const select = await screen.findByLabelText(/role for N1-F/i);
    expect(select).toHaveValue('forward');
    await userEvent.selectOptions(select, 'probe');
    expect(useAppStore.getState().roles['oligo-0']).toBe('probe');
  });

  it('marks an oligo whose role could not be guessed', async () => {
    render(<OligoInputPanel />);
    await type('ACGTACGTACGTACGTACGT');
    expect(await screen.findByText(/choose a role/i)).toBeInTheDocument();
  });

  it('shows parse errors without discarding the valid oligos', async () => {
    render(<OligoInputPanel />);
    await type('>bad\nACGTXACGTACGTACGT\n>good\nACGTACGTACGTACGTACGT');
    expect(await screen.findByText(/bad/)).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
  });

  it('disables continue until every role is set', async () => {
    render(<OligoInputPanel />);
    await type('ACGTACGTACGTACGTACGT');
    const button = await screen.findByRole('button', { name: /continue/i });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/role for Oligo 1/i), 'forward');
    expect(button).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/ui/input`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement, then run and confirm pass**

Run: `npx vitest run src/ui/input`
Expected: PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src/ui/input
git commit -m "feat(ui): oligo input with parse feedback and role assignment"
```

---

### Task 4.3: Step 2 — binding-site resolution and genome map

This is the trust-building step. The user must see that the tool found the right place before it computes anything.

**Files:**
- Create: `src/ui/binding/BindingResolution.tsx`, `src/ui/binding/GenomeMap.tsx`
- Test: `src/ui/binding/BindingResolution.test.tsx`, `src/ui/binding/GenomeMap.test.tsx`

**Interfaces:**
- Consumes: `resolveBindingSite` from `src/core/resolution`; `checkAssayGeometry` from `src/core/assay-geometry`; `loadReference`; `useAppStore`.
- Produces: `<BindingResolution />`, `<GenomeMap segment sites width />`

Behaviour per oligo: the chosen coordinates as `segment:start–end (strand)`, the mismatch count against the reference, and one of four states — resolved / ambiguous (radio list of candidates, nothing preselected) / no-hit (error with a suggestion to check the pathogen) / highly-degenerate (resolved but requiring an explicit "confirm this site" checkbox). Below, a `GenomeMap` draws the segment as a horizontal bar with a tick per site. When all three roles are present, the amplicon check runs and its problems are shown as warnings — never as a hard block, because a user may legitimately be checking a non-standard design.

- [ ] **Step 1: Write the failing tests**

`src/ui/binding/BindingResolution.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import { BindingResolution } from './BindingResolution';
import { useAppStore } from '../../state/store';

const seed = (sequence: string, name = 'Test-F') => {
  useAppStore.getState().reset();
  useAppStore.getState().setOligos([{ id: 'oligo-0', name, role: 'forward', sequence }]);
};

beforeEach(() => { useAppStore.getState().reset(); });

describe('BindingResolution', () => {
  it('shows the located coordinates and strand for a unique hit', async () => {
    // 22-mer taken from the SARS-CoV-2 reference at 21765-21786
    seed('TACATGTCTCTGGGACCAATGG');
    render(<BindingResolution />);
    expect(await screen.findByText(/21,?765/)).toBeInTheDocument();
    expect(screen.getByText(/21,?786/)).toBeInTheDocument();
    expect(screen.getByText(/plus strand/i)).toBeInTheDocument();
  });

  it('auto-detects a reverse-complemented oligo without the user flipping it', async () => {
    seed('CCATTGGTCCCAGAGACATGTA'); // reverse complement of the window above
    render(<BindingResolution />);
    expect(await screen.findByText(/minus strand/i)).toBeInTheDocument();
    expect(screen.getByText(/21,?765/)).toBeInTheDocument();
  });

  it('refuses to guess when the site is ambiguous and offers the candidates', async () => {
    seed('TTTTTTTTTTTTTTTTTTTT');
    render(<BindingResolution />);
    const radios = await screen.findAllByRole('radio');
    expect(radios.length).toBeGreaterThan(1);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('reports no hit rather than showing a wrong location', async () => {
    seed('GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG');
    render(<BindingResolution />);
    expect(await screen.findByText(/no binding site found/i)).toBeInTheDocument();
  });

  it('requires explicit confirmation for a heavily degenerate oligo', async () => {
    // The Alpha window with its last four bases wildcarded: degeneracy 4^4 = 256 (> 64),
    // but the first 18 bases still pin it to a single site.
    seed('TACATGTCTCTGGGACCANNNN');
    render(<BindingResolution />);
    const confirm = await screen.findByRole('checkbox', { name: /confirm this site/i });
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    await userEvent.click(confirm);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});
```

`src/ui/binding/GenomeMap.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { GenomeMap } from './GenomeMap';

describe('GenomeMap', () => {
  const sites = [
    { label: 'N1-F', start: 100, end: 120, strand: 'plus' as const },
    { label: 'N1-R', start: 200, end: 222, strand: 'minus' as const },
  ];

  it('labels the segment and its length', () => {
    render(<GenomeMap segmentLabel="Genome" segmentLength={29903} sites={sites} />);
    expect(screen.getByText(/Genome/)).toBeInTheDocument();
    expect(screen.getByText(/29,903/)).toBeInTheDocument();
  });

  it('exposes each site to assistive technology with its coordinates', () => {
    render(<GenomeMap segmentLabel="Genome" segmentLength={29903} sites={sites} />);
    expect(screen.getByLabelText(/N1-F.*100.*120/)).toBeInTheDocument();
    expect(screen.getByLabelText(/N1-R.*200.*222/)).toBeInTheDocument();
  });

  it('renders without sites', () => {
    render(<GenomeMap segmentLabel="Genome" segmentLength={29903} sites={[]} />);
    expect(screen.getByText(/Genome/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/ui/binding`
Expected after implementation: PASS, 8 tests.

- [ ] **Step 3: Commit**

```bash
git add src/ui/binding
git commit -m "feat(ui): binding-site resolution with explicit ambiguity handling and genome map"
```

---

### Task 4.4: Step 3 — scope controls

**Files:**
- Create: `src/ui/scope/ScopeControls.tsx`
- Test: `src/ui/scope/ScopeControls.test.tsx`

**Interfaces:**
- Consumes: `useAppStore`; `getPathogen`; `queryAggregated` (to populate country and lineage option lists).
- Produces: `<ScopeControls onRun />`

Behaviour: date-from and date-to inputs prefilled from the pathogen default window; a multi-select for country and one for lineage, whose options come from a single `aggregated?fields=[countryField]` call per pathogen (cached); a "Run analysis" button. Option lists load lazily and the control stays usable while they load — an empty filter means "all", which is the safe default.

- [ ] **Step 1: Write the failing tests**

`src/ui/scope/ScopeControls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScopeControls } from './ScopeControls';
import { useAppStore } from '../../state/store';

beforeEach(() => { useAppStore.getState().reset(); });

describe('ScopeControls', () => {
  it('prefills the pathogen default window', () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const from = screen.getByLabelText(/collected from/i) as HTMLInputElement;
    const to = screen.getByLabelText(/collected to/i) as HTMLInputElement;
    expect(from.value).toBe(useAppStore.getState().scope.dateFrom);
    expect(to.value <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('writes date changes into the store', async () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const from = screen.getByLabelText(/collected from/i);
    await userEvent.clear(from);
    await userEvent.type(from, '2021-02-01');
    expect(useAppStore.getState().scope.dateFrom).toBe('2021-02-01');
  });

  it('rejects an inverted date range', async () => {
    render(<ScopeControls onRun={vi.fn()} />);
    const to = screen.getByLabelText(/collected to/i);
    await userEvent.clear(to);
    await userEvent.type(to, '1999-01-01');
    expect(await screen.findByText(/end date must be on or after/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run analysis/i })).toBeDisabled();
  });

  it('states that an empty filter means all', () => {
    render(<ScopeControls onRun={vi.fn()} />);
    expect(screen.getAllByText(/all countries|all lineages|all clades/i).length).toBeGreaterThan(0);
  });

  it('labels the lineage control with the pathogen-specific term', () => {
    useAppStore.getState().setPathogen('h3n2');
    render(<ScopeControls onRun={vi.fn()} />);
    expect(screen.getByLabelText(/HA clade/i)).toBeInTheDocument();
  });

  it('calls onRun when the button is pressed', async () => {
    const onRun = vi.fn();
    render(<ScopeControls onRun={onRun} />);
    await userEvent.click(screen.getByRole('button', { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/ui/scope`
Expected after implementation: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add src/ui/scope
git commit -m "feat(ui): scope controls with sensible defaults and range validation"
```

---

### Task 4.5: Step 4 — results

The largest task in the phase. Build the components in the order listed; each has its own test file. **Split point:** `ResultsPanel.tsx` composes, it does not render detail — every visual element below is its own component.

**Files:**
- Create: `src/ui/results/ResultsPanel.tsx`, `HeadlineCard.tsx`, `PositionProfile.tsx`, `SeverityBadge.tsx`, `TrendChart.tsx`, `AttributionTable.tsx`, `InsertionNote.tsx`
- Test: one `.test.tsx` beside each

**Interfaces:**
- Consumes: `OligoAnalysis`, `AnalysisResult` from `src/core/analysis/run`; `UNIT_OF_ANALYSIS`, `SEVERITY_DISCLAIMER` from `src/core/analysis/constants`.
- Produces:
  - `<ResultsPanel result />`
  - `<HeadlineCard analysis />`
  - `<PositionProfile analysis />`
  - `<SeverityBadge severity role />`
  - `<TrendChart trend />`
  - `<AttributionTable attribution label />`
  - `<InsertionNote insertions denominator />`

Required behaviour, each of which is a test:

**HeadlineCard** — renders the percentage and, in the same card, `n = <nMismatch> of <nFullCoverage> assessable sequences`, the coverage gap as a count and a percentage, and `UNIT_OF_ANALYSIS`. When `mismatchFraction` is null it renders "no assessable sequences" and no percentage. When `sufficientData` is false it renders "insufficient data (n = X)" and no percentage.

**PositionProfile** — renders the oligo sequence as a row of monospace bases, 5′ on the left, with a bar beneath each base whose height encodes `mismatchFraction`. The terminal three 3′ bases sit on a shaded background with a visible "3′ end" label (for probes, the shading is omitted and a note explains why). Bars where `coverageIsInferred` are hatched and carry the title "per-position coverage not reported". Deletion and substitution contributions are visually distinguished and named in the legend. Every bar has an accessible name of the form `position 21765, 95.8% mismatch, n = 67469 of 70454`.

**SeverityBadge** — renders one of Fine / Watch / Act on / Not enough data with a non-colour cue (text plus an icon shape), plus `SEVERITY_DISCLAIMER` and the `reasons` list.

**TrendChart** — a line of `mismatchFraction` per bucket, with buckets where `sufficientData` is false drawn as gaps rather than zeros, and a table fallback exposed to screen readers via `<figure>` + `<figcaption>` and a visually hidden `<table>`.

**AttributionTable** — top rows with counts and shares, an "other" row, an "unassigned" row when non-zero, and a caption stating that shares are of the mismatch-carrying set.

**InsertionNote** — renders nothing when there are no insertions; otherwise lists them and states that the insertions endpoint reports no coverage, so the fraction is approximate.

- [ ] **Step 1: Write the failing tests for `HeadlineCard`**

`src/ui/results/HeadlineCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HeadlineCard } from './HeadlineCard';
import { computeWindowMetrics } from '../../core/analysis/metrics';
import { UNIT_OF_ANALYSIS } from '../../core/analysis/constants';
import type { OligoAnalysis } from '../../core/analysis/run';

const analysis = (nScope: number, nFullCoverage: number, nMismatch: number) =>
  ({
    name: 'N1-F', role: 'forward',
    metrics: computeWindowMetrics({ nScope, nFullCoverage, nMismatch }),
  } as unknown as OligoAnalysis);

describe('HeadlineCard', () => {
  it('shows the percentage with its absolute numbers in the same card', () => {
    render(<HeadlineCard analysis={analysis(71142, 70387, 67520)} />);
    expect(screen.getByText(/95\.9\s*%/)).toBeInTheDocument();
    expect(screen.getByText(/67,520/)).toBeInTheDocument();
    expect(screen.getByText(/70,387/)).toBeInTheDocument();
  });

  it('always states the coverage gap', () => {
    render(<HeadlineCard analysis={analysis(46667, 44669, 3)} />);
    expect(screen.getByText(/1,998/)).toBeInTheDocument();
    expect(screen.getByText(/4\.3\s*%/)).toBeInTheDocument();
  });

  it('states the unit of analysis', () => {
    render(<HeadlineCard analysis={analysis(1000, 1000, 10)} />);
    expect(screen.getByText(UNIT_OF_ANALYSIS)).toBeInTheDocument();
  });

  it('shows no percentage when nothing is assessable', () => {
    render(<HeadlineCard analysis={analysis(40, 0, 0)} />);
    expect(screen.getByLabelText(/headline mismatch rate/i))
      .toHaveTextContent(/no assessable sequences/i);
  });

  it('suppresses the percentage below the minimum denominator', () => {
    render(<HeadlineCard analysis={analysis(60, 30, 15)} />);
    const headline = screen.getByLabelText(/headline mismatch rate/i);
    expect(headline).toHaveTextContent(/insufficient data/i);
    expect(headline).toHaveTextContent(/n = 30/);
    expect(headline).not.toHaveTextContent('%');
  });
});
```

> The last two tests scope their assertions to the element labelled *Headline mismatch rate*. A blanket "no `%` anywhere" assertion would fail on the coverage-gap figure, which legitimately renders a percentage in the same card. Give the headline element `aria-label="Headline mismatch rate"`.

- [ ] **Step 2: Write the failing tests for `PositionProfile`**

`src/ui/results/PositionProfile.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PositionProfile } from './PositionProfile';
import type { OligoAnalysis } from '../../core/analysis/run';
import type { PositionStat } from '../../core/analysis/profile';

const stat = (over: Partial<PositionStat>): PositionStat => ({
  refPos: 21765, oligoIndex: 0, oligoBase: 'T', plusStrandBase: 'T', refBase: 'T',
  distanceFrom3Prime: 21, coverage: 70454, coverageIsInferred: false,
  effectiveDenominator: 70454, mismatchCount: 0, substitutionCount: 0, deletionCount: 0,
  mismatchFraction: 0, alleles: [], referenceIsAmbiguous: false, ...over,
});

const analysis = (profile: PositionStat[], role: 'forward' | 'probe' = 'forward') =>
  ({ name: 'N1-F', role, sequence: profile.map((p) => p.oligoBase).join(''), profile } as unknown as OligoAnalysis);

describe('PositionProfile', () => {
  it('renders one bar per position with an accessible description', () => {
    render(<PositionProfile analysis={analysis([
      stat({ refPos: 21765, mismatchCount: 67469, deletionCount: 67469, mismatchFraction: 0.9576 }),
      stat({ refPos: 21766, oligoIndex: 1, distanceFrom3Prime: 20 }),
    ])} />);
    expect(screen.getByLabelText(/position 21,?765.*95\.8\s*%.*67,?469.*70,?454/)).toBeInTheDocument();
    expect(screen.getByLabelText(/position 21,?766.*0(\.0)?\s*%/)).toBeInTheDocument();
  });

  it('marks the 3prime terminal region for primers', () => {
    render(<PositionProfile analysis={analysis([stat({ distanceFrom3Prime: 0 })])} />);
    expect(screen.getByText(/3′ end/)).toBeInTheDocument();
  });

  it('omits 3prime shading for probes and says why', () => {
    render(<PositionProfile analysis={analysis([stat({ distanceFrom3Prime: 0 })], 'probe')} />);
    expect(screen.getByText(/probe.*3′ weighting|3′ weighting.*probe/i)).toBeInTheDocument();
  });

  it('flags bars whose per-position coverage was not reported', () => {
    render(<PositionProfile analysis={analysis([
      stat({ coverage: null, coverageIsInferred: true }),
    ])} />);
    expect(screen.getByTitle(/per-position coverage not reported/i)).toBeInTheDocument();
  });

  it('distinguishes deletions from substitutions in the legend', () => {
    render(<PositionProfile analysis={analysis([
      stat({ mismatchCount: 100, deletionCount: 60, substitutionCount: 40, mismatchFraction: 0.1 }),
    ])} />);
    expect(screen.getByText(/deletion/i)).toBeInTheDocument();
    expect(screen.getByText(/substitution/i)).toBeInTheDocument();
  });

  it('renders the oligo sequence 5prime to 3prime above the bars', () => {
    const { container } = render(<PositionProfile analysis={analysis([
      stat({ oligoBase: 'T', oligoIndex: 0 }), stat({ oligoBase: 'A', oligoIndex: 1, refPos: 21766 }),
    ])} />);
    expect(container.textContent).toContain('5′');
    expect(container.textContent).toContain('3′');
  });
});
```

- [ ] **Step 3: Write the failing tests for `SeverityBadge`**

`src/ui/results/SeverityBadge.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SeverityBadge } from './SeverityBadge';
import { SEVERITY_DISCLAIMER } from '../../core/analysis/constants';
import type { Severity } from '../../core/analysis/severity';

const severity = (over: Partial<Severity>): Severity =>
  ({ level: 'green', score: 0, reasons: [], ...over });

describe('SeverityBadge', () => {
  it.each([
    ['green', /fine/i],
    ['amber', /watch/i],
    ['red', /act on/i],
    ['unknown', /not enough data/i],
  ] as const)('labels %s in words, not only in colour', (level, label) => {
    render(<SeverityBadge severity={severity({ level })} role="forward" />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('always states that this is a heuristic', () => {
    render(<SeverityBadge severity={severity({ level: 'red' })} role="forward" />);
    expect(screen.getByText(SEVERITY_DISCLAIMER)).toBeInTheDocument();
  });

  it('lists every reason the heuristic gave', () => {
    render(
      <SeverityBadge
        severity={severity({ level: 'red', reasons: ['Reason one.', 'Reason two.'] })}
        role="forward"
      />,
    );
    expect(screen.getByText('Reason one.')).toBeInTheDocument();
    expect(screen.getByText('Reason two.')).toBeInTheDocument();
  });

  it('never claims to predict assay performance', () => {
    render(<SeverityBadge severity={severity({ level: 'red' })} role="forward" />);
    expect(document.body.textContent ?? '').not.toMatch(/will fail|predicts|guarantee/i);
  });
});
```

- [ ] **Step 4: Write the failing tests for the remaining three components**

Each bullet below is a required test name and its assertion; write them exactly as specified.

- `TrendChart`
  - "renders a figure with a caption" — `getByRole('figure')` and a `<figcaption>` naming the granularity.
  - "exposes an equivalent table to assistive technology" — a `<table>` with one row per bucket, each row containing the bucket label, `nMismatch` and `nFullCoverage`.
  - "renders a gap, not a zero, for a thin bucket" — for a point with `sufficientData: false`, the table cell reads `not enough data` and the string `0%` does not appear in that row.
  - "orders buckets chronologically" — the rendered row order equals the input order.
- `AttributionTable`
  - "lists the top values with counts and shares" — value, `formatCount(count)` and `formatPercent(share)` all present.
  - "renders an other row only when the tail is non-empty" — present for `otherCount > 0`, absent for `0`.
  - "renders an unassigned row only when non-zero" — same pattern for `unassignedCount`.
  - "states what the shares are of" — the caption contains `of sequences carrying a mismatch`.
- `InsertionNote`
  - "renders nothing when there are no insertions" — `container.firstChild` is `null`.
  - "names the position, the inserted bases and the count" — all three present for one insertion.
  - "states that the insertion endpoint reports no coverage" — the text contains `no coverage`, and the fraction is qualified with `approximate`.

- [ ] **Step 5: Write the failing test for `ResultsPanel`**

`src/ui/results/ResultsPanel.test.tsx` asserts that, for a result with three oligos, the panel renders three headline cards named after the oligos, one severity badge each, and the caveat panel exactly once (see Task 4.6).

- [ ] **Step 6: Run everything, confirm failure, implement, confirm pass**

Run: `npx vitest run src/ui/results`
Expected after implementation: PASS.

Charting: draw the position profile and the trend as **hand-written SVG**. They are a bar row and a single line; a charting library would cost more bundle than it saves, and the accessibility requirements above are easier to satisfy directly. If you disagree after trying, record the reason in `docs/decisions.md` before adding a dependency.

For all Phase 4 components, **the tests are the specification.** Where this plan describes behaviour in prose rather than code, the prose is binding and the test you write from it is the contract; do not narrow it because a component turned out awkward to build.

- [ ] **Step 7: Commit**

```bash
git add src/ui/results
git commit -m "feat(ui): results panel with position profile, trend, attribution and severity"
```

---

### Task 4.6: Step 5 — the caveat panel

**Files:**
- Create: `src/ui/CaveatPanel.tsx`
- Test: `src/ui/CaveatPanel.test.tsx`

**Interfaces:**
- Consumes: `Diagnostic` from `src/core/analysis/diagnostics`; `AnalysisResult`; copy from Appendix C.2.
- Produces: `<CaveatPanel result />`

The panel has two parts: **fixed caveats** (Appendix C.2, always rendered, in full) and **live diagnostics** (whatever `computeDiagnostics` produced for any oligo, de-duplicated by `id`).

- [ ] **Step 1: Write the failing tests**

`src/ui/CaveatPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CaveatPanel, FIXED_CAVEATS } from './CaveatPanel';
import type { AnalysisResult } from '../core/analysis/run';

const result = (diagnostics: { id: string; severity: string; message: string }[]) =>
  ({ oligos: [{ diagnostics }, { diagnostics }] } as unknown as AnalysisResult);

describe('CaveatPanel', () => {
  it('renders every fixed caveat', () => {
    render(<CaveatPanel result={result([])} />);
    for (const caveat of FIXED_CAVEATS) {
      expect(screen.getByText(caveat)).toBeInTheDocument();
    }
  });

  it('is not collapsible', () => {
    const { container } = render(<CaveatPanel result={result([])} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[hidden]')).toBeNull();
  });

  it('renders live diagnostics once even when several oligos report the same one', () => {
    render(<CaveatPanel result={result([
      { id: 'deposition-lag', severity: 'warn', message: 'Recent months are thin.' },
    ])} />);
    expect(screen.getAllByText('Recent months are thin.')).toHaveLength(1);
  });

  it('covers the four caveats the brief requires', () => {
    render(<CaveatPanel result={result([])} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/sampling|not a random sample/i);
    expect(text).toMatch(/N-mask|ambiguous|coverage gap/i);
    expect(text).toMatch(/deposit|lag/i);
    expect(text).toMatch(/not the same as assay failure/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/ui/CaveatPanel.test.tsx`
Expected after implementation: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add src/ui/CaveatPanel.tsx src/ui/CaveatPanel.test.tsx
git commit -m "feat(ui): always-visible caveat panel with live sampling diagnostics"
```

---

### Task 4.7: Wiring, loading, errors, and the worked example

**Files:**
- Create: `src/ui/common/Loading.tsx`, `ErrorState.tsx`, `EmptyState.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.integration.test.tsx`

**Interfaces:**
- Consumes: everything above; `runAnalysis`; `createFetchTransport`; `withCache`.
- Produces: the assembled application.

The landing state shows one sentence of explanation, the pathogen selector, and a **"See how the CDC N1 assay has drifted since 2020"** button that loads a bundled assay, resolves its sites and runs an analysis in one click — the brief's zero-input first visit. Until Task 5.2 lands the real library, this button is wired to the G1 window as a placeholder and the test asserts the button exists and starts an analysis.

- [ ] **Step 1: Write the failing integration test**

`src/App.integration.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import App from './App';
import { useAppStore } from './state/store';

beforeEach(() => { useAppStore.getState().reset(); });

describe('App', () => {
  it('walks from pasted oligos to results', async () => {
    // Endpoint-aware stub: aggregated returns counts, the mutation and insertion
    // endpoints return empty sets so the profile renders with inferred coverage.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.endsWith('/aggregated')
        ? { data: [{ count: 1000, date: '2025-01-01' }] }
        : { data: [] };
      return new Response(
        JSON.stringify({ ...body, info: { dataVersion: 'dv', requestId: 'rid' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText(/paste your oligos/i));
    await user.paste('>N1-F\nTACATGTCTCTGGGACCAATGG');
    await user.click(await screen.findByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/21,?765/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /run analysis/i }));

    await waitFor(() => {
      expect(screen.getByText(/assessable sequences/i)).toBeInTheDocument();
    });
  });

  it('shows a loading state while a query is in flight', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    );
    render(<App />);
    useAppStore.getState().startAnalysis();
    expect(await screen.findByRole('status')).toHaveTextContent(/querying/i);
  });

  it('surfaces a LAPIS error with its detail and offers a retry', async () => {
    render(<App />);
    useAppStore.getState().analysisFailed('LAPIS 400: Unknown field');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unknown field/);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('offers the worked example on the landing screen', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /CDC N1 assay/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npm test`
Expected: PASS, whole suite.

- [ ] **Step 3: Deploy and look at it**

```bash
npm run build
vercel --prod
```

Open the URL, paste `TACATGTCTCTGGGACCAATGG`, set the range 2021-02-01 → 2021-03-01, filter to United Kingdom, and confirm the headline reads ≈95.9 % with n = 67,520 of 70,387. **Paste a screenshot or the observed numbers at the review gate.**

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/ui/common src/App.integration.test.tsx
git commit -m "feat(ui): wire the full flow with loading, error and worked-example states"
```

> ### ⛔ REVIEW GATE — Phase 4
> Post `npm test`, the deployed URL, and the live numbers you observed for the Alpha query. Then stop.

---

## Phase 5 — Library, permalink, export

### Task 5.1: Assay library schema and the verification gate

**Files:**
- Create: `src/data/assays/schema.ts`, `scripts/verify-assays.ts`
- Create (empty to start): `src/data/assays/library.json`
- Test: `src/data/assays/schema.test.ts`

**Interfaces:**
- Consumes: `resolveBindingSite`, `checkAssayGeometry`, `loadReference`, `PathogenId`.
- Produces:
  - `interface LibraryOligo { name: string; role: OligoRole; sequence: string }`
  - `interface LibraryAssay { id: string; name: string; pathogenId: PathogenId; target: string; oligos: LibraryOligo[]; citation: { title: string; source: string; url: string; accessed: string }; notes?: string }`
  - `interface AssayLibrary { version: string; assays: LibraryAssay[] }`
  - `parseLibrary(raw: unknown): AssayLibrary` — throws with a field path on malformed input
  - `verifyAssay(assay: LibraryAssay): { ok: boolean; problems: string[] }`

`verifyAssay` is the guard from Global Constraint 2. It requires: every oligo resolves to a **unique** binding site with ≤1 mismatch; forward and reverse land on opposite strands of the same segment; the amplicon is 50–300 nt; the probe lies between the primers; and the citation carries a non-empty `url` and `accessed` date.

- [ ] **Step 1: Write the failing tests**

`src/data/assays/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseLibrary, verifyAssay, type LibraryAssay } from './schema';

/**
 * Schema-valid, and both oligos really do bind the bundled SARS-CoV-2 reference —
 * the forward at 15784-15805 (plus) and the reverse at 21765-21786 (minus).
 * They are ~6 kb apart, so this fixture passes parseLibrary and deliberately
 * FAILS verifyAssay's amplicon rule. That is what the last test exercises.
 */
const wellFormed: LibraryAssay = {
  id: 'test-assay', name: 'Test assay', pathogenId: 'sars-cov-2', target: 'ORF1ab',
  oligos: [
    { name: 'Test-F', role: 'forward', sequence: 'TTTAAGTCAGTTCTTTATTATC' },
    { name: 'Test-R', role: 'reverse', sequence: 'CCATTGGTCCCAGAGACATGTA' },
  ],
  citation: { title: 'T', source: 'S', url: 'https://example.org/x', accessed: '2026-08-01' },
};

describe('parseLibrary', () => {
  it('accepts a well-formed library', () => {
    expect(parseLibrary({ version: '1', assays: [wellFormed] }).assays).toHaveLength(1);
  });
  it('names the offending path on malformed input', () => {
    expect(() => parseLibrary({ version: '1', assays: [{ ...wellFormed, oligos: [{ name: 'x' }] }] }))
      .toThrow(/assays\[0\]\.oligos\[0\]/);
  });
  it('rejects an unknown role', () => {
    expect(() => parseLibrary({
      version: '1',
      assays: [{ ...wellFormed, oligos: [{ name: 'x', role: 'primer', sequence: 'ACGTACGTACGTACGT' }] }],
    })).toThrow(/role/);
  });
});

describe('verifyAssay', () => {
  it('rejects an assay whose citation has no url', () => {
    const r = verifyAssay({ ...wellFormed, citation: { ...wellFormed.citation, url: '' } });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/citation/i);
  });

  it('rejects an oligo that does not bind the reference', () => {
    const r = verifyAssay({
      ...wellFormed,
      oligos: [
        { name: 'Bad-F', role: 'forward', sequence: 'GGGGGGGGGGGGGGGGGGGGGG' },
        wellFormed.oligos[1]!,
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/Bad-F/);
  });

  it('rejects an implausible amplicon', () => {
    const r = verifyAssay(wellFormed);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/amplicon/i);
  });
});
```

> If you change these sequences, recompute the expected coordinates from the bundled reference rather than guessing.

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/data/assays`
Expected after implementation: PASS, 6 tests.

- [ ] **Step 3: Write the CI gate**

`scripts/verify-assays.ts` loads `library.json`, runs `parseLibrary` then `verifyAssay` on every entry, prints a table, and exits non-zero if any assay fails. Add to `package.json`: `"verify:assays": "tsx scripts/verify-assays.ts"`, and add `- run: npm run verify:assays` to `.github/workflows/ci.yml` after `npm test`.

- [ ] **Step 4: Commit**

```bash
git add src/data/assays scripts/verify-assays.ts package.json .github/workflows/ci.yml
git commit -m "feat(assays): library schema and build-time verification gate"
```

---

### Task 5.2: Populate the bundled assay library

**This task has a different working method from every other task in the plan. Read all of it before starting.**

**Files:**
- Modify: `src/data/assays/library.json`
- Create: `docs/assay-sources.md`
- Test: `src/data/assays/library.test.ts`

**The rule:** every oligo sequence must be copied from a document you have actually opened in this session, and the URL of that document must be recorded in the same commit. **You must not write a primer sequence from memory.** If you cannot open a source, leave the assay out and list it in `docs/assay-sources.md` under "Not included — source not retrievable".

**Procedure per assay:**
1. Fetch the primary source (WebFetch or the firecrawl scrape skill). Candidates: the US CDC 2019-nCoV real-time RT-PCR panel instructions for use; Corman *et al.*, *Eurosurveillance* 2020;25(3):2000045 (E and RdRp assays); WHO influenza PCR reference protocols; CDC influenza A/H5 assay documentation.
2. Copy each oligo sequence character by character from that document into `library.json`, together with the oligo's published name.
3. Record `citation.url` and `citation.accessed`.
4. Run `npm run verify:assays`.
5. If verification fails, **re-read the source** — a failure here is far more likely to be a transcription error than a tool error. If the source genuinely does not verify (for example an oligo targets a region absent from the bundled reference), remove the assay and record why in `docs/assay-sources.md`.

- [ ] **Step 1: Write the failing library test**

`src/data/assays/library.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import raw from './library.json';
import { parseLibrary, verifyAssay } from './schema';

const library = parseLibrary(raw);

describe('bundled assay library', () => {
  it('contains at least one assay per v1 pathogen', () => {
    for (const id of ['sars-cov-2', 'h5n1', 'h3n2'] as const) {
      expect(library.assays.some((a) => a.pathogenId === id)).toBe(true);
    }
  });

  it('every assay carries a resolvable citation with an access date', () => {
    for (const assay of library.assays) {
      expect(assay.citation.url).toMatch(/^https?:\/\//);
      expect(assay.citation.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every assay verifies against the bundled reference', () => {
    for (const assay of library.assays) {
      const result = verifyAssay(assay);
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it('assay ids are unique', () => {
    const ids = library.assays.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/data/assays/library.test.ts`
Expected: FAIL — the library is empty.

- [ ] **Step 3: Source the assays**

Follow the procedure above. Work one assay at a time and run `npm run verify:assays` after each. **Do not batch.**

- [ ] **Step 4: Write `docs/assay-sources.md`**

One section per assay: the published name, the citation with URL and access date, the verified coordinates each oligo resolved to, and any deviation from the source (for example a degenerate base written as a wobble in the source and expanded here). Also a "Not included" section for anything that failed.

- [ ] **Step 5: Run the gate and the tests**

Run: `npm run verify:assays && npm test`
Expected: PASS. Paste the verification table.

- [ ] **Step 6: Wire the picker**

Add `src/ui/input/AssayPicker.tsx`: a grouped list by pathogen, each entry showing the assay name, target, and citation link. Selecting one populates the oligos and roles. Test: selecting an assay puts its oligos into the store with their roles already set, and the citation link is present with `rel="noreferrer"`.

Then re-point the landing worked example (Task 4.7) from its G1 placeholder to the real bundled CDC N1 assay, so the button does what its label says. Update the integration test to assert that clicking it loads three oligos with roles already assigned.

- [ ] **Step 7: Commit**

```bash
git add src/data/assays src/ui/input/AssayPicker.tsx docs/assay-sources.md
git commit -m "feat(assays): bundled, cited, machine-verified assay library"
```

> **Human check required.** At the Phase 5 gate, the reviewer must spot-check at least two oligo sequences against their cited sources by eye. Automated verification proves an oligo binds *somewhere plausible*; only a human comparison proves it is the *published* oligo.

---

### Task 5.3: Permalink

**Files:**
- Create: `src/core/permalink.ts`
- Test: `src/core/permalink.test.ts`

**Interfaces:**
- Consumes: `PathogenId`, `Scope`, `OligoRole`, `BindingSite`.
- Produces:
  - `interface PermalinkState { pathogenId: PathogenId; oligos: { name: string; role: OligoRole; sequence: string }[]; sites: Record<string, { segment: string; strand: 'plus' | 'minus'; start: number }>; scope: Omit<Scope, 'pathogenId'> }`
  - `encodePermalink(state: PermalinkState): string` — returns a URL hash fragment beginning `#q=`
  - `decodePermalink(hash: string): PermalinkState | null` — returns `null` on anything malformed, never throws

Encoding: JSON → `encodeURIComponent`. Explicitly **not** compressed and **not** base64: the URL should be inspectable, and a user pasting one into an email should be able to see what it asks for. Chosen sites are encoded so a permalink reproduces the exact analysis even where resolution was ambiguous.

- [ ] **Step 1: Write the failing tests**

`src/core/permalink.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodePermalink, encodePermalink, type PermalinkState } from './permalink';

const state: PermalinkState = {
  pathogenId: 'sars-cov-2',
  oligos: [{ name: 'N1-F', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' }],
  sites: { 'N1-F': { segment: 'main', strand: 'plus', start: 21765 } },
  scope: { dateFrom: '2021-02-01', dateTo: '2021-03-01', countries: ['United Kingdom'], lineages: [] },
};

describe('permalink', () => {
  it('round-trips', () => {
    expect(decodePermalink(encodePermalink(state))).toEqual(state);
  });
  it('starts with a readable prefix', () => {
    expect(encodePermalink(state).startsWith('#q=')).toBe(true);
  });
  it('preserves the chosen binding site so an ambiguous case reproduces exactly', () => {
    expect(decodePermalink(encodePermalink(state))!.sites['N1-F']!.start).toBe(21765);
  });
  it('returns null for junk rather than throwing', () => {
    expect(decodePermalink('#q=not-json')).toBeNull();
    expect(decodePermalink('')).toBeNull();
    expect(decodePermalink('#q=' + encodeURIComponent('{"pathogenId":"ebola"}'))).toBeNull();
  });
  it('rejects an oversized payload instead of producing an unusable link', () => {
    const huge: PermalinkState = {
      ...state,
      oligos: Array.from({ length: 200 }, (_, i) => ({
        name: `o${i}`, role: 'forward' as const, sequence: 'ACGT'.repeat(10),
      })),
    };
    expect(() => encodePermalink(huge)).toThrow(/too large/i);
  });
});
```

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/core/permalink.test.ts`
Expected after implementation: PASS, 7 tests.

- [ ] **Step 3: Wire it up**

On a successful analysis, replace the URL hash with the permalink (`history.replaceState`, so the back button is not polluted). On load, if a hash is present, decode it, restore state, and run the analysis automatically. Add a "Copy link" button. Test: a decodable hash on first render triggers exactly one analysis.

- [ ] **Step 4: Commit**

```bash
git add src/core/permalink.ts src/core/permalink.test.ts src/App.tsx
git commit -m "feat: shareable permalinks encoding the full query"
```

---

### Task 5.4: Export and the methods paragraph

**Files:**
- Create: `src/core/export/csv.ts`, `src/core/export/methods.ts`
- Test: `src/core/export/csv.test.ts`, `src/core/export/methods.test.ts`

**Interfaces:**
- Consumes: `AnalysisResult`; `UNIT_OF_ANALYSIS` and `REGULATORY_STATEMENT` from `src/core/analysis/constants`; `PathogenConfig.attribution`; `referenceFetchedAt`. **Nothing under `src/core/` imports from `src/state/`.**
- Produces:
  - `toPositionCsv(result: AnalysisResult): string` — one row per oligo × position
  - `toSummaryCsv(result: AnalysisResult): string` — one row per oligo
  - `toJsonExport(result: AnalysisResult): string`
  - `methodsParagraph(result: AnalysisResult): string`

The methods paragraph must state: the tool and version, the LAPIS instance and its `dataVersion`, the exact scope filters, the unit of analysis, the reference genome and when it was fetched, the date the analysis was run, and the regulatory statement. That is the brief's "dated, reproducible, citable snapshot".

- [ ] **Step 1: Write the failing tests**

`src/core/export/methods.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { methodsParagraph } from './methods';
import { UNIT_OF_ANALYSIS, REGULATORY_STATEMENT } from '../analysis/constants';
import type { AnalysisResult } from '../analysis/run';

const result = {
  pathogenId: 'sars-cov-2',
  generatedAt: '2026-08-01T12:00:00.000Z',
  dataVersion: '1785342597',
  nScope: 71142,
  scope: {
    pathogenId: 'sars-cov-2', dateFrom: '2021-02-01', dateTo: '2021-03-01',
    countries: ['United Kingdom'], lineages: [],
  },
  oligos: [],
} as unknown as AnalysisResult;

describe('methodsParagraph', () => {
  const text = methodsParagraph(result);

  it('names the data source and its version', () => {
    expect(text).toMatch(/lapis\.cov-spectrum\.org/);
    expect(text).toContain('1785342597');
  });
  it('states the scope in full', () => {
    expect(text).toContain('2021-02-01');
    expect(text).toContain('2021-03-01');
    expect(text).toContain('United Kingdom');
  });
  it('says "all" where a filter was left empty', () => {
    expect(text).toMatch(/all lineages/i);
  });
  it('states the unit of analysis verbatim', () => {
    expect(text).toContain(UNIT_OF_ANALYSIS);
  });
  it('states the reference genome and when it was fetched', () => {
    expect(text).toMatch(/reference genome/i);
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it('is dated', () => {
    expect(text).toContain('2026-08-01');
  });
  it('ends with the regulatory statement', () => {
    expect(text.trimEnd().endsWith(REGULATORY_STATEMENT)).toBe(true);
  });
});
```

`src/core/export/csv.test.ts` asserts: the summary CSV header contains `oligo,role,segment,start,end,strand,n_scope,n_full_coverage,n_mismatch,mismatch_fraction,coverage_gap,severity`; a value containing a comma or a quote is correctly quoted; the position CSV has one row per oligo × position including `coverage_is_inferred`; and the first line of every CSV is a `#` comment carrying `UNIT_OF_ANALYSIS`.

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/core/export`
Expected after implementation: PASS.

- [ ] **Step 3: Wire the download buttons**

Three buttons on the results panel: "Download CSV", "Download JSON", "Copy methods paragraph". Filenames embed the pathogen and the date: `assay-drift-<pathogen>-<YYYY-MM-DD>.csv`.

- [ ] **Step 4: Commit**

```bash
git add src/core/export src/ui/results
git commit -m "feat(export): CSV, JSON and a dated methods paragraph"
```

> ### ⛔ REVIEW GATE — Phase 5
> Post `npm test`, `npm run verify:assays`, and the methods paragraph for the Alpha query. **Spot-check two library oligos against their sources by eye and say which two.** Then stop.

---

## Phase 6 — Honesty, accessibility, performance, ship

### Task 6.1: Copy pass and the "never a percentage without N" gate

**Files:**
- Create: `eslint-rules/require-n-with-percentage.js`, `src/ui/format.ts`
- Modify: `eslint.config.js`, every results component that formats a number
- Test: `src/ui/format.test.ts`, `src/ui/results/no-bare-percentage.test.tsx`

**Interfaces:**
- Produces:
  - `formatCount(n: number): string` — thousands separators
  - `formatPercent(fraction: number | null): string` — one decimal place; `'—'` for null; `'<0.1%'` for a non-zero fraction that would round to `0.0%`, because printing `0.0%` for 3 sequences in 44,669 reads as "none" when the answer is "three"
  - `formatRate(input: { fraction: number | null; numerator: number; denominator: number }): string` — e.g. `95.9% (67,520 of 70,387)`; the **only** approved way to render a rate

The lint rule is deliberately blunt: it forbids the literal `'%'` inside JSX text and template literals in `src/ui/**`, with an allow-list of the format helpers and of files that legitimately explain percentages in prose. Any component that wants to print a percentage must go through `formatRate`.

- [ ] **Step 1: Write the failing tests**

`src/ui/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatCount, formatPercent, formatRate } from './format';

describe('formatting', () => {
  it('groups thousands', () => {
    expect(formatCount(70387)).toBe('70,387');
  });
  it('shows one decimal place', () => {
    expect(formatPercent(0.9593)).toBe('95.9%');
    expect(formatPercent(0.0647)).toBe('6.5%');
  });
  it('distinguishes "very small" from "none"', () => {
    expect(formatPercent(0.0000672)).toBe('<0.1%');
    expect(formatPercent(0)).toBe('0.0%');
  });
  it('renders an em dash for an unavailable rate', () => {
    expect(formatPercent(null)).toBe('—');
  });
  it('always pairs a rate with its absolute numbers', () => {
    expect(formatRate({ fraction: 0.9593, numerator: 67520, denominator: 70387 }))
      .toBe('95.9% (67,520 of 70,387)');
  });
  it('omits the percentage but keeps the numbers when the rate is unavailable', () => {
    expect(formatRate({ fraction: null, numerator: 0, denominator: 0 }))
      .toBe('— (0 of 0)');
  });
});
```

`src/ui/results/no-bare-percentage.test.tsx` renders each results component with representative props and asserts that every element whose text contains `%` also contains a digit followed by a comma-grouped number, or the word `of`. This is a belt-and-braces check on top of the lint rule.

Also write `src/regulatory-statement.test.tsx`, which discharges Global Constraint 8 in one place:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';
import { REGULATORY_STATEMENT } from './core/analysis/constants';
import { toPositionCsv, toSummaryCsv } from './core/export/csv';
import { toJsonExport } from './core/export/csv';
import { methodsParagraph } from './core/export/methods';
import { sampleResult } from './core/analysis/test-fixtures';

describe('the regulatory statement appears in all five required places', () => {
  it('header and footer', () => {
    render(<App />);
    // AppShell renders it once in the header and once in the footer.
    expect(screen.getAllByText(REGULATORY_STATEMENT)).toHaveLength(2);
  });
  it('summary CSV', () => {
    expect(toSummaryCsv(sampleResult)).toContain(REGULATORY_STATEMENT);
  });
  it('position CSV', () => {
    expect(toPositionCsv(sampleResult)).toContain(REGULATORY_STATEMENT);
  });
  it('JSON export', () => {
    expect(JSON.parse(toJsonExport(sampleResult)).regulatoryStatement).toBe(REGULATORY_STATEMENT);
  });
  it('methods paragraph', () => {
    expect(methodsParagraph(sampleResult)).toContain(REGULATORY_STATEMENT);
  });
});
```

This requires a shared `src/core/analysis/test-fixtures.ts` exporting `sampleResult: AnalysisResult` — build it from the G1 numbers so it is realistic, and reuse it in the results component tests rather than hand-rolling a fixture in each file.

- [ ] **Step 2: Run and confirm failure, implement, run and confirm pass**

Run: `npx vitest run src/ui/format.test.ts src/ui/results && npm run lint`
Expected: PASS, and lint clean.

- [ ] **Step 3: Sweep the copy**

Read every user-visible string against Appendix C. Specifically: no sentence claims the tool predicts assay performance; the severity labels are Fine / Watch / Act on / Not enough data (not Low / Medium / High risk); "mismatch" is never written as "mutation in your primer"; the word "failure" appears only in reference to the historical Alpha case.

- [ ] **Step 4: Commit**

```bash
git add eslint-rules eslint.config.js src/ui/format.ts src/ui
git commit -m "feat(ui): enforce that no percentage is ever shown without its N"
```

---

### Task 6.2: Accessibility

**Files:**
- Modify: components as needed
- Create: `src/a11y.test.tsx`
- Test: as listed

**Interfaces:**
- Consumes: `vitest-axe` (dev dependency).
- Produces: no new runtime API.

Requirements, each a test:
1. `npm install -D vitest-axe` and run axe over the landing state, the binding step, and a full results view; zero violations.
2. Every interactive control is reachable and operable by keyboard; the step navigation follows DOM order.
3. The position profile and trend chart each expose an equivalent data table to assistive technology.
4. Severity is never communicated by colour alone — text label plus shape.
5. Colour contrast of the severity palette meets WCAG AA against its background (assert the computed values in a unit test rather than by eye).
6. `prefers-reduced-motion` disables any transition.
7. The live region announcing "analysis complete" uses `aria-live="polite"`, not `assertive`.

- [ ] **Step 1: Write the failing tests, run, implement, run**

Run: `npx vitest run src/a11y.test.tsx`
Expected after implementation: PASS.

- [ ] **Step 2: Commit**

```bash
git add src/a11y.test.tsx src/ui package.json
git commit -m "feat(a11y): keyboard, contrast, non-colour severity cues and chart alternatives"
```

---

### Task 6.3: Performance and the mutations payload

The `nucleotideMutations` call with `minProportion: 0` is the one heavy request: ~3.3 MB raw, ~438 KB gzipped for a one-month SARS-CoV-2 scope. It is fetched **once per scope** and shared across oligos, and it is what makes the per-base profile possible at all. Three mitigations, in order of value.

**Files:**
- Modify: `src/core/analysis/run.ts`, `src/core/lapis/caching-transport.ts`
- Create: `src/core/lapis/size-guard.ts`, `src/ui/results/ExactCoverageToggle.tsx`
- Test: `src/core/lapis/size-guard.test.ts`, plus additions to `run.test.ts`

**Interfaces:**
- Produces:
  - `MUTATIONS_SIZE_WARN_BYTES = 8_000_000`
  - `guardResponseSize(bytes: number, endpoint: string): { ok: boolean; message: string | null }`
  - `fetchExactCoverage(transport, cfg, filters, window, signal?): Promise<Map<number, number>>` — the lazy per-position coverage path

- [ ] **Step 1: Cache the mutations response across oligos and scopes**

Already true via `withCache` (identical request body ⇒ one fetch). Add a test to `run.test.ts` proving that running two analyses over the same scope with different oligos issues **one** `nucleotideMutations` request when the transport is wrapped in `withCache`.

- [ ] **Step 2: Add the size guard**

`guardResponseSize` returns a warning when a response exceeds `MUTATIONS_SIZE_WARN_BYTES`; the UI surfaces it as an info diagnostic suggesting a narrower scope. Do **not** silently raise `minProportion` — that would hide rare mismatches, which are exactly what the user is looking for.

- [ ] **Step 3: Add the lazy exact-coverage path**

For a selected oligo, `fetchExactCoverage` issues one `aggregated` query per position (`advancedQuery: '<pos>N'`) and returns exact per-position coverage, replacing every inferred bar. Gate it behind an explicit "Load exact per-base coverage (N extra queries)" control that states the query count, and disable it above 60 positions.

- [ ] **Step 4: Measure**

Run `npm run build` and record the gzipped bundle size in `docs/decisions.md`. Budget: **under 150 KB gzipped** excluding the reference genome JSON (which is ~40 KB gzipped and lazily imported per pathogen). If over budget, the cause is almost certainly a charting or date library — remove it.

- [ ] **Step 5: Commit**

```bash
git add src/core/lapis/size-guard.ts src/core/analysis/run.ts src/ui/results/ExactCoverageToggle.tsx docs/decisions.md
git commit -m "perf: share the mutations payload, guard its size, add opt-in exact coverage"
```

---

### Task 6.4: Optional Vercel caching layer

Ship only if Phase 4–6 exposed a real need (rate limiting, slow repeat queries, or a wish to reduce load on the public LAPIS instances). The transport interface exists so this is a drop-in.

**Files:**
- Create: `api/lapis.ts` (Vercel Route Handler), `src/core/lapis/proxy-transport.ts`
- Test: `src/core/lapis/proxy-transport.test.ts`

**Interfaces:**
- Produces: `createProxyTransport(opts?: { path?: string }): LapisTransport`

The handler accepts `{ baseUrl, endpoint, body }`, **validates `baseUrl` against an allow-list of the three configured instances** (an open proxy is not acceptable), forwards the POST, and returns the response with `Cache-Control: public, s-maxage=21600, stale-while-revalidate=86400`. Tests must include a rejected off-allow-list `baseUrl`.

- [ ] **Step 1: Decide**

Record the decision — ship or defer — in `docs/decisions.md` with the evidence that motivated it. If deferring, stop here; the task stays in the plan for later.

- [ ] **Step 2: If shipping, write the failing tests, implement, run, commit**

```bash
git add api src/core/lapis/proxy-transport.ts docs/decisions.md
git commit -m "feat(lapis): optional cached proxy through a Vercel route handler"
```

---

### Task 6.5: Documentation, the nightly live check, and the launch argument

**Files:**
- Create: `README.md`, `docs/methods.md`, `.github/workflows/nightly.yml`
- Modify: `src/ui/AppShell.tsx` (link to the methods page)

**Interfaces:** none.

- [ ] **Step 1: Write `README.md`**

Contents: what the tool answers in one sentence; the regulatory statement; the three pathogens and their data sources with links; how the numbers are computed (a short version of Part I.3, linking to `docs/methods.md`); the three golden cases with their figures as the credibility argument; local development commands; how to add a pathogen (edit `registry.ts`, run `npm run refs`, add golden coverage); the licence.

- [ ] **Step 2: Write `docs/methods.md`**

The public methods statement: the exact definitions of `nScope`, `nFullCoverage`, `nMismatch`; the mismatch-term construction from Part I.4 including the degenerate and inverted cases; the severity formula from Task 3.7 with its thresholds; what the tool does **not** do (no ΔTm, no efficiency prediction, no assay design); and the known limitations that are not machine-detectable (sequencing platform bias, host and specimen bias, retrospective database revision).

- [ ] **Step 3: Add the nightly live check**

`.github/workflows/nightly.yml`: on a `schedule` cron at 06:00 UTC and on `workflow_dispatch`, run `npm ci && npm run test:live`, plus a golden-drift job that recomputes the five golden measurements against the live API and fails if any differs from Part I.6 by more than **2 percentage points**. On failure it opens an issue rather than emailing.

This is also the foundation for the v2 nightly precompute: the workflow, the cron and the auditable commit history are already in place.

- [ ] **Step 4: Write the launch note**

`docs/golden-cases.md`: for each of G1, G2 and G3, the window, the scope, the figures, and a short paragraph explaining what happened biologically. This doubles as the test suite's rationale and the "here is the tool correctly detecting a failure we already know happened" argument the brief calls for.

- [ ] **Step 5: Commit**

```bash
git add README.md docs .github/workflows/nightly.yml src/ui/AppShell.tsx
git commit -m "docs: methods statement, golden-case write-up, nightly live verification"
```

---

### Task 6.6: Final verification

- [ ] **Step 1: Run the whole gate**

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run verify:assays
npm run test:live
npm run build
```

Paste every command's output. **All seven must pass.**

- [ ] **Step 2: Walk Appendix D by hand**

Work through the checklist in Part IV.D against the deployed site, ticking each item and noting anything that fails.

- [ ] **Step 3: Tag**

```bash
git tag -a v1.0.0 -m "Assay Drift Watch v1"
git push --tags
```

> ### ⛔ REVIEW GATE — Phase 6
> Post all seven command outputs, the completed Appendix D checklist, and the production URL. Then stop.

---

## Phase 7 — Beyond v1 (not scheduled)

Recorded so the v1 architecture is judged against where it is going, not built for it.

- **Scheduled precompute.** Extend `nightly.yml` to recompute every bundled assay across a rolling twelve-month window and commit the results as `public/precomputed/<assay-id>.json`. The frontend reads that file directly on the landing screen, so the zero-input first visit costs no queries. The commit log becomes the change record.
- **Watch subscriptions.** RSS first, per the brief — a static `public/feeds/<assay-id>.xml` regenerated by the same workflow, with an entry emitted whenever an assay crosses a threshold. No accounts, no email, no PII. Webhooks second. Email last, if ever.
- **ΔTm estimation.** Nearest-neighbour SantaLucia parameters, computed client-side, labelled an estimate, shown beside the mismatch count and never instead of it.
- **More pathogens.** The registry is the only thing that needs editing; adding one is `registry.ts` + `npm run refs` + a golden case. Pathoplexus instances (`https://lapis.pathoplexus.org/<organism>`) are verified reachable and use the same Loculus field conventions as the influenza instances.
- **Amino-acid view.** LAPIS exposes gene definitions in `referenceGenome.genes` and an `aminoAcidMutations` endpoint; a "what does this mismatch do to the protein" panel is cheap once the nucleotide path exists.

---

# Part IV — Appendices

## A. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Owned by |
|---|---|---|---|---|---|
| 1 | **A silently wrong number.** Orientation, coordinate or degeneracy logic is subtly wrong; output looks plausible. | Medium | Severe — the product's entire value is trust | Golden cases assert exact live-measured figures; Task 3.10 asserts the production query builder emits the same expression the numbers were measured with; metrics throw on impossible numerator/denominator combinations | Phase 1, 2.3, 3.10 |
| 2 | **Mistranscribed library primer.** An agent writes a sequence from memory. | Medium | Severe | Sourcing procedure forbids it; `verify-assays` requires a unique binding site, opposite strands and a plausible amplicon; human eye-check at the Phase 5 gate | 5.2 |
| 3 | **Upstream schema change.** A LAPIS instance renames a field or changes date semantics. | Medium | High | Live contract tests per instance; nightly workflow opens an issue; registry isolates every instance-specific name to one file | 2.6, 6.5 |
| 4 | **Upstream data revision** moves a golden number. | High over months | Medium | Golden tests run on committed fixtures; nightly live job allows ±2 pp and reports drift rather than failing the build | 2.6, 6.5 |
| 5 | **Public LAPIS rate-limits or goes down.** | Low | High | Backoff with `Retry-After`; aggressive client caching; Task 6.4 proxy ready to deploy; error state names the instance and suggests retry | 2.4, 6.4 |
| 6 | **Mutations payload too large** for a wide scope. | Medium | Medium | Size guard warns and suggests narrowing; never silently raises `minProportion` | 6.3 |
| 7 | **Segmented-genome coverage semantics.** A record missing a segment entirely may not behave like an all-N record on every instance. | Medium | High | Verified for H5N1 (`!seg4:100N` = 78,292 of 78,705); Phase 2 gate must confirm the same for H3N2 before Phase 3 relies on it | 2.6 |
| 8 | **Users quote a percentage without its caveats.** | High | High | Percentage never rendered without N (lint rule + tests); caveat panel non-collapsible; coverage gap in the same card; methods paragraph carries the unit of analysis and the regulatory statement into whatever document they paste it in | 4.6, 6.1, 5.4 |
| 9 | **Scope creep into assay design or Tm prediction.** | Medium | Medium | Explicit non-goals in `README.md` and `docs/methods.md`; new runtime dependencies require a `docs/decisions.md` entry | Global |
| 10 | **Influenza clade/lineage fields differ from expectation** (`clade` vs `cladeHA`). | Verified, low residual | Low | Encoded in the registry and asserted in `registry.test.ts` | 2.1 |

## B. Glossary

| Term | Meaning here |
|---|---|
| **Binding site** | The contiguous reference window an oligo anneals to, expressed as 1-based inclusive plus-strand coordinates plus a strand |
| **Window** | The same thing, as a list of `PositionSpec` ready for query construction |
| **Coverage** | Sequences with a definite (non-ambiguous) base call at a position. LAPIS reports it per position on mutation rows |
| **Coverage gap** | `nScope − nFullCoverage`: sequences excluded because they have an ambiguous base somewhere in the binding site |
| **Assessable** | In `nFullCoverage`; the denominator of every headline figure |
| **Mismatch** | An allele the oligo cannot bind, given its IUPAC code at that position. Deletions always count |
| **Mismatch allele** | `{A,C,G,T,-}` minus the alleles the oligo accepts at that position |
| **Segment qualifier** | The `seg4:` prefix on query terms for segmented genomes; `null` for SARS-CoV-2 |
| **Data version** | LAPIS's `info.dataVersion`; the snapshot identifier that makes an analysis reproducible |
| **Inferred coverage** | A per-position denominator that LAPIS did not report (no mutation row existed), substituted from the window denominator and always labelled |

## C. Fixed copy blocks

Use these strings verbatim. Changing them is a deliberate act requiring a `docs/decisions.md` entry.

### C.1 Regulatory statement

> Assay Drift Watch is a research and educational tool, not a diagnostic device. It is not for clinical decision-making, and an in-silico mismatch is not the same as assay failure.

Appears in: the header, the footer, the CSV comment block, the JSON export, and the methods paragraph. Asserted in all five by test.

### C.2 Fixed caveats (the always-visible panel)

1. > Sequence databases are not a random sample. Which countries sequence, how much, and which specimens they choose all vary — the figures below describe the sequences that exist, not the infections that happened.
2. > A position with no reported mutation may be conserved, or may simply not have been sequenced well. Sequences with an ambiguous base anywhere in a binding site are excluded from the denominator and reported as the coverage gap.
3. > Sequences are usually deposited weeks after collection. The most recent part of any trend is incomplete, not necessarily quiet.
4. > An in-silico mismatch is not the same as assay failure. Where a mismatch sits matters, other mismatches may compensate, and only a wet-lab test can tell you what your assay actually does.
5. > This tool evaluates oligos you give it. It does not design assays, model melting temperature, or predict amplification efficiency.

### C.3 Methods paragraph template

```
Assay drift for <assay or oligo names> was assessed with Assay Drift Watch <version>
on <YYYY-MM-DD>. Nucleotide mutation frequencies were obtained from <LAPIS instance URL>
(data version <dataVersion>), covering <pathogen label>. Sequences were restricted to
collection dates from <dateFrom> to <dateTo>, <countries or "all countries">, and
<lineages or "all lineages">. <UNIT_OF_ANALYSIS> Binding sites were located on the
reference genome served by the same instance (retrieved <referenceFetchedAt>), allowing
IUPAC-degenerate matching and automatic orientation detection. <REGULATORY_STATEMENT>
```

## D. Final verification checklist

Walk this against the deployed site, not against the code.

**Numbers**
- [ ] Alpha window, UK, Feb 2021 reports 95.9 % with n = 67,520 of 70,387
- [ ] Alpha window, UK, Sept 2020 reports 3.3 % from the same session without a reload
- [ ] Conserved control reports `<0.1%` — not `0.0%` — and still shows the 1,998-sequence coverage gap
- [ ] H3N2 `seg4:600–621` reports ≈6.5 % for 2022 and ≈99.7 % for 2025
- [ ] No percentage anywhere on the page appears without its absolute numbers

**Honesty**
- [ ] Caveat panel visible without scrolling on a 1280×800 desktop viewport
- [ ] Caveat panel cannot be collapsed or dismissed
- [ ] Coverage gap appears in the same card as the headline
- [ ] Severity badge carries the word "heuristic"
- [ ] Deposition-lag warning appears for a scope ending today
- [ ] Geographic-concentration warning appears for a single-country scope with a real mismatch signal
- [ ] Regulatory statement appears in header, footer, CSV, JSON and methods paragraph

**Binding resolution**
- [ ] A reverse-complemented oligo is located without the user flipping it, and reports minus strand
- [ ] An oligo with two equally good sites offers a choice and preselects nothing
- [ ] An oligo with no site says so and does not show coordinates
- [ ] An influenza oligo reports its segment by gene name, not just `seg4`

**Sharing**
- [ ] Permalink round-trips in a fresh browser profile and reproduces the same numbers
- [ ] CSV opens in a spreadsheet with the unit of analysis in the first line
- [ ] Methods paragraph pastes cleanly into a document and is dated

**Access**
- [ ] Whole flow completable by keyboard alone
- [ ] Zero axe violations on landing, binding and results
- [ ] Severity legible with colour vision deficiency simulation
- [ ] First meaningful paint under 2 s on a throttled Fast 3G profile

**Resilience**
- [ ] Offline: a clear error naming the instance, plus a retry button
- [ ] A LAPIS 400 shows its `detail` rather than a generic failure
- [ ] Changing scope mid-query cancels the in-flight work rather than racing it

## E. Deliberate deviations from the brief

Four places where this plan does not do what the brief's technical section suggested. Each is a considered choice, not an oversight.

1. **Reference genomes come from LAPIS, not NCBI RefSeq.** The brief lists RefSeq as the source for coordinate resolution. LAPIS reports mutation coordinates against its *own* reference, and `GET /sample/referenceGenome` serves it directly. Using RefSeq would introduce a class of bug — a silent coordinate offset — that no test would catch and that would corrupt every published figure. The verified SARS-CoV-2 reference is 29,903 nt, identical in length to NC_045512.2, so nothing is lost.
2. **No Nextstrain cross-check or fallback in v1.** The brief lists `data.nextstrain.org` as a validation and fallback source. The golden cases do the validation job better — they check the whole pipeline against known historical events rather than one number against another source — and a fallback path that is never exercised is a liability. If a LAPIS instance becomes unreliable, revisit; the transport interface makes a second backend a contained change.
3. **Vercel rather than Cloudflare Pages + Workers**, at the user's direction. Functionally equivalent for a static build plus one cached POST proxy; `api/lapis.ts` (Task 6.4) replaces the Worker, and the KV cache becomes `s-maxage` plus the client-side `withCache` decorator.
4. **The influenza golden case is a coordinate window, not a published assay** — see note 3 below.

## F. Notes for the reviewer

Three places where the plan makes a judgement call worth revisiting:

1. **Per-position coverage is inferred by default.** Exact per-position coverage costs one query per base, so the default path substitutes the window denominator and labels it. Task 6.3 adds an opt-in exact path. If you would rather pay the queries by default, that is a one-line change in `run.ts` plus a budget conversation.
2. **The severity thresholds are asserted, not derived.** 1 % / 5 % and the 3× / 2× / 1× weights are defensible but not empirical. They live in one file precisely so a domain expert can change them without reading the code. The golden cases are chosen to be unambiguous under any reasonable threshold, so tuning them will not break the suite.
3. **The influenza golden case uses a coordinate window, not a published assay.** This is deliberate: it tests the segmented path against a real, verifiable sweep without depending on an assay whose sequences an agent might mistranscribe. Once the library lands in Task 5.2, adding a published-assay influenza golden case is worthwhile — but as an addition, not a replacement.

