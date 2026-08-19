# Assay Drift Watch

**What fraction of the genomes sequenced this month carry a mismatch under my primer or probe,
and is that fraction rising?**

Paste an oligo, pick a pathogen and a date range, and get an answer computed live from public
sequence data — with the sampling caveats printed next to the number rather than under it.
No install, no account, no data retention.

**Live:** <https://assay-drift.vercel.app>

> Assay Drift Watch is a research and educational tool, not a diagnostic device. It is not for clinical decision-making, and an in-silico mismatch is not the same as assay failure.

---

## Pathogens and data sources

Every figure is computed at request time from a public
[LAPIS](https://github.com/GenSpectrum/LAPIS) instance. There is no database and no cached
copy of anyone's data.

| Pathogen | Instance | Dataset |
|---|---|---|
| SARS-CoV-2 | [`lapis.cov-spectrum.org/open/v2`](https://lapis.cov-spectrum.org/open/v2/sample/aggregated) | [GenSpectrum](https://cov-spectrum.org) LAPIS over the [Nextstrain](https://nextstrain.org/sars-cov-2/) open SARS-CoV-2 dataset (GenBank-derived) |
| Influenza A/H5N1 | [`lapis.genspectrum.org/h5n1`](https://lapis.genspectrum.org/h5n1/sample/aggregated) | GenSpectrum LAPIS over the [Loculus](https://loculus.org) H5N1 dataset (INSDC-derived) |
| Influenza A/H3N2 | [`lapis.genspectrum.org/h3n2`](https://lapis.genspectrum.org/h3n2/sample/aggregated) | GenSpectrum LAPIS over the Loculus H3N2 dataset (INSDC-derived) |

Only aggregate endpoints are used. **No sequence data is ever downloaded.** Reference genomes
come from the same instance that serves the mutation data, so the coordinate systems cannot
disagree.

---

## How the numbers are computed

For a binding site occupying positions `p₁…pₙ`:

| | |
|---|---|
| `nScope` | sequences matching the date / country / lineage filters |
| `nFullCoverage` | of those, sequences with a **definite** base call at every one of `p₁…pₙ` |
| `nMismatch` | of `nFullCoverage`, sequences carrying at least one allele the oligo cannot bind |
| `coverageGap` | `nScope − nFullCoverage` — the sequences that **could not be assessed** |
| **headline** | `nMismatch / nFullCoverage` |

The headline reads *"of the sequences that can be assessed, this fraction carries at least one
mismatch"*, and the coverage gap is displayed beside it, always. A sequence with an ambiguous
base under the site is excluded rather than counted as a match — otherwise a region that is
poorly sequenced *because* it is diverging would be reported as conserved.

Degenerate oligo bases are respected, deletions are counted as mismatches at single-base
resolution, and an oligo that mismatches the reference itself is handled by negating the
alleles it does accept rather than by assuming the reference is right.

**Full detail, including the severity heuristic and every limitation:
[`docs/methods.md`](./docs/methods.md).**

---

## Does it work? Three cases where the answer is already known

| Case | Window | Scope | Period | Headline |
|---|---|---|---|---|
| **G1** Alpha S-gene target failure | SARS-CoV-2 `main:21765–21786` (spans ΔH69/V70) | United Kingdom | 2020-09-01 → 2020-10-01 | **3.26 %** (612 / 18,747) |
| | | | 2021-02-01 → 2021-03-01 | **95.93 %** (67,520 / 70,387) |
| **G2** H3N2 HA drift | H3N2 `seg4:600–621` | global | 2022-01-01 → 2022-12-31 | **6.47 %** (2,706 / 41,794) |
| | | | 2025-01-01 → 2025-12-31 | **99.71 %** (22,380 / 22,445) |
| **G3** Conserved control | SARS-CoV-2 `main:15784–15805` (ORF1ab / RdRp) | United Kingdom | 2024-01-01 → 2025-06-30 | **0.0067 %** (3 / 44,669) |

G1 is a six-nucleotide deletion appearing under a binding site and going from 3 % to 96 % of
UK sequencing in five months. G2 is two substitutions sweeping an influenza HA window between
two seasons. G3 is the control: it must come out **green**, and it must still report that
1,998 sequences (4.28 % of those in scope) could not be assessed at all.

These are retrospective — the tool was run against sequences deposited years earlier, and that
is not the same as having raised the alarm at the time. What they establish is that when the
drift was real the number moved, and when it was not, the number stayed still and the tool
still showed its blind spot.

The five measurements are asserted exactly against committed fixtures on every test run, and
re-measured against the live API nightly. Write-up, with the biology:
[`docs/golden-cases.md`](./docs/golden-cases.md).

---

## Development

```bash
npm install
npm run dev
```

**`npm run dev` talks to the three LAPIS instances directly.** They send
`Access-Control-Allow-Origin: *`, so the browser can reach them without a proxy, and nothing has
to be running locally.

A **production** build instead routes every query through `api/lapis.ts`, a Vercel Function that
validates the target against an allow-list derived from `src/core/registry.ts` and caches the
answer at the edge for six hours. That is what the deployed site uses, and it exists so the
opt-in exact-coverage fan-out (up to 60 queries per oligo) does not land on public
infrastructure this project does not own, once per visitor.

The switch is `VITE_LAPIS_PROXY`, and it is only needed when the default guess is wrong:

| | |
|---|---|
| `npm run dev` | direct — the default in a dev build |
| deployed on Vercel | proxied — the default in a production build |
| `npm run preview`, or any static host that is not Vercel | set `VITE_LAPIS_PROXY=0`, or every query 404s |
| `vercel dev` | set `VITE_LAPIS_PROXY=1` to exercise the function locally |

## Verification

The complete local gate is:

```bash
npm test:coverage     # unit, component, a11y and golden-fixture tests with coverage
npm run typecheck
npm run lint
npm run verify:assays # every bundled oligo re-resolves and carries a citation
npm run build-storybook
npm run test-storybook # non-interactive Storybook compilation check
npm run test:e2e      # deterministic mocked browser workflow tests
npm run build
```

CI runs the fast non-browser subset (`npm test`, typecheck, lint, assay verification, and build).
The Storybook and browser suites are local release checks until they are added to CI.

Two more talk to the network and are therefore **not** in the PR gate. They run nightly
(`.github/workflows/nightly.yml`), and on failure the workflow opens — or comments on an
existing — GitHub issue:

```bash
npm run test:live     # the LAPIS contract: field names, date params, reference lengths
npm run verify:golden # recompute the five golden measurements against the live API
```

Decisions on runtime dependencies and other cross-cutting choices are recorded in
[`docs/decisions.md`](./docs/decisions.md). Provenance for every bundled oligo is in
[`docs/assay-sources.md`](./docs/assay-sources.md) — no sequence ships without a citation.

---

## Adding a pathogen

1. **Add a `PathogenConfig` to `src/core/registry.ts`.** The metadata schemas of LAPIS
   instances differ substantially, which is the entire reason this file exists: the date field
   you group by, the date parameters you filter with, the country field and the lineage field
   all have to be read off the target instance rather than assumed. The discovery trick is to
   send a deliberately bogus value — `?fields=zzz` — and read the enumeration back out of the
   HTTP 400 `detail`.
2. **Fetch its reference genome:** `npm run refs`. This writes `src/data/references/<id>.json`
   from the instance's own `/sample/referenceGenome`, with the fetch date. Never source a
   reference anywhere else; a one-base offset would silently corrupt every number.
3. **Add golden coverage.** Pick a window and a period where the answer is already known
   independently, record fixtures with `npm run fixtures`, and assert the figures exactly in
   `tests/golden/`. A pathogen without a golden case is a pathogen nobody has checked.
4. **Add it to the nightly drift check** in `scripts/check-golden-drift.ts` so a change in the
   instance's schema is caught by an alarm rather than by a user.

---

## Licence

**TODO: no licence has been chosen for this repository yet.** There is no `LICENSE` file, so
default copyright applies and no permissions are granted. This needs to be settled by the
repository owner before the tool is promoted anywhere.

Note that this is a separate question from the data: the sequence data reached this tool
through GenSpectrum and Loculus from INSDC/GenBank submissions, and is subject to those
sources' own terms.
