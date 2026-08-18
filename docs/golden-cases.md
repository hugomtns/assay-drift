# The golden cases

Three published outbreaks, five measurements. Every one of them is a failure — or a
non-failure — that virologists already knew about before this tool existed, which is the point:
they are the check that the tool reports what really happened, not the claim that it would have
told anyone something new at the time.

All five figures below were measured on **2026-08-01** with the production query forms and are
recorded in Part I.6 of `implementation.md`. They are asserted **exactly**, on every test run,
against committed fixtures (`tests/golden/golden.test.ts`), and re-measured against the live
API every night (`.github/workflows/nightly.yml` → `npm run verify:golden`).

Read [`docs/methods.md`](./methods.md) for what `nScope`, `nFullCoverage` and `nMismatch` mean.
The short version: the headline is `nMismatch / nFullCoverage` — of the sequences that could be
assessed, the fraction carrying at least one mismatch — and `coverageGap` is the number that
could not be assessed at all.

---

## G1 — Alpha S-gene target failure

**Window** SARS-CoV-2 `main:21765–21786` — 22 nt, spanning the six-nucleotide ΔH69/V70 deletion
**Reference bases** `TACATGTCTCTGGGACCAATGG`
**Scope** `country = "United Kingdom"`, two one-month windows five months apart

| Period | `nScope` | `nFullCoverage` | `nMismatch` | headline |
|---|---|---|---|---|
| 2020-09-01 → 2020-10-01 | 18,892 | 18,747 | 612 | **3.26 %** |
| 2021-02-01 → 2021-03-01 | 71,142 | 70,387 | 67,520 | **95.93 %** |

### What happened

ΔH69/V70 is a six-nucleotide, in-frame deletion in the spike gene, carried by the B.1.1.7
(Alpha) lineage. When Alpha swept the United Kingdom over the winter of 2020–21 the deletion
swept with it, and the two rows above are that sweep seen from underneath a binding site.

Mechanically, this is the worst case for an oligo. Six bases of the target are not substituted,
they are **absent**, so any oligo overlapping positions 21765–21770 loses a quarter of a 22-mer
binding site outright. The tool sees this at single-base resolution because LAPIS reports
deletions in-band, as `mutationTo: "-"`, one row per position: in the February 2021 window,
`T21765-` is carried by 67,469 sequences against a per-position coverage of 70,454.

The two rows are the same window, the same country, five months apart, and nothing else
changed. That is the temporal control and the launch argument in one figure: an assay that was
fine in September was, by February, mismatched against 96 % of everything being sequenced in
its own country.

---

## G2 — Influenza A/H3N2 HA drift

**Window** H3N2 `seg4:600–621` — 22 nt in HA
**Reference bases** `ATTTGGGGGGTTCACCACCCGG` (sliced from the bundled reference; Part I.6
prints none)
**Scope** all countries, two full seasons

| Period | `nScope` | `nFullCoverage` | `nMismatch` | headline |
|---|---|---|---|---|
| 2022-01-01 → 2022-12-31 | 41,848 | 41,794 | 2,706 | **6.47 %** |
| 2025-01-01 → 2025-12-31 | 22,480 | 22,445 | 22,380 | **99.71 %** |

### What happened

Ordinary antigenic drift, which for H3N2 is not ordinary at all — HA is under continuous
immune selection, which is why influenza vaccine composition is revisited every season. Between
those two seasons, substitutions at `seg4:614` and `seg4:617` swept from roughly 0 % to roughly
98 % of sequenced H3N2.

Two substitutions, three years, and a window that was 93.5 % clean becomes 0.29 % clean.

This case also exists to exercise the parts of the tool that only segmented genomes reach.
Influenza is eight segments, so every query term has to carry its segment qualifier —
`seg4:614`, not `614` — and the H3N2 and H5N1 instances use entirely different metadata field
names from the SARS-CoV-2 one (`sampleCollectionDateRangeLowerFrom` rather than `dateFrom`,
`cladeHA` rather than `pangoLineage`). A tool that silently dropped the qualifier would return
a plausible number computed over the wrong segment, and no amount of staring at the result
would reveal it. G2 is the assertion that it does not.

Unlike G1 and G3, this scope has no country filter — it is global. The geographic-concentration
diagnostic is therefore the one to watch here: a global figure is a figure over wherever
influenza sequencing happens to be funded.

---

## G3 — Conserved site negative control

**Window** SARS-CoV-2 `main:15784–15805` — 22 nt in ORF1ab / RdRp
**Reference bases** `TTTAAGTCAGTTCTTTATTATC`
**Scope** `country = "United Kingdom"`, 2024-01-01 → 2025-06-30

| `nScope` | `nFullCoverage` | `nMismatch` | headline | `coverageGap` |
|---|---|---|---|---|
| 46,667 | 44,669 | 3 | **0.0067 %** | 1,998 (4.28 %) |

### What happened

Nothing. That is the entire point.

RdRp sits inside ORF1ab, and this window behaves nothing like the spike one above. Over
eighteen months and nearly 45,000 assessable UK sequences, three carried a mismatch anywhere
in these 22 nucleotides.

A tool that can only ever say "your assay is in trouble" is a tool nobody can act on, because
it never distinguishes a real problem from its own bias. G3 is the case that must render
**green**.

And it must render green **while still showing that 1,998 sequences — 4.28 % of everything in
scope — could not be assessed at all**, because they carry an ambiguous base somewhere in the
window. Those 1,998 sequences are not evidence of conservation and they are not evidence of
drift; they are simply unknown, and the tool has no business quietly dropping them out of a
denominator and reporting the survivors as the whole picture.

> A tool that says "you're fine" without showing what it could not assess has not earned the
> "you're fine".

That sentence is the design brief for the entire results view.

---

## What these cases do and do not prove

They prove that the tool, pointed at archived sequence data, reproduces three outcomes that are
independently documented, including one where the correct answer is "no problem here", and that
it reports the coverage it did not have while doing so.

They do **not** prove that the tool would have raised an alarm before anyone else did. It was
built in 2026 and run against sequences deposited years earlier; that is retrospective
detection, and calling it anything else would be a claim these five rows cannot support. The
argument they make is narrower and sturdier: **when the drift was real, the number moved, and
when it was not, the number stayed still and the tool still showed its blind spot.**

---

## Reproducibility

`npm run verify:golden` recomputes all five against the live API through the production query
builder, and the nightly workflow runs it at 06:00 UTC.

Re-run on **2026-08-18** (SARS-CoV-2 `dataVersion` 1786896492, H3N2 `dataVersion` 1786695673):
four of the five reproduced the 2026-08-01 figures exactly, digit for digit. The 2025 H3N2
season had gained four sequences since — `nScope` 22,484, `nFullCoverage` 22,449, `nMismatch`
22,384 — which moves the headline by less than 0.005 percentage points and is exactly the
retrospective database revision the methods document warns about. It is also why the golden
tests assert against committed fixtures and only the nightly job talks to the live API.
