# Methods

This is the public methods statement for **Assay Drift Watch**. It is the document to read
before quoting a number the tool printed, and the one to cite if you quote one.

> Assay Drift Watch is a research and educational tool, not a diagnostic device. It is not for clinical decision-making, and an in-silico mismatch is not the same as assay failure.

Everything below describes what the tool computes. Nothing below is a claim about how an
assay will perform in a laboratory.

---

## 1. Data sources

The tool holds no database. Every figure is computed from a live query against a public
[LAPIS](https://github.com/GenSpectrum/LAPIS) instance at the moment you ask for it.

| Pathogen | Instance | Dataset |
|---|---|---|
| SARS-CoV-2 | `https://lapis.cov-spectrum.org/open/v2` | GenSpectrum LAPIS over the Nextstrain open SARS-CoV-2 dataset (GenBank-derived) |
| Influenza A/H5N1 | `https://lapis.genspectrum.org/h5n1` | GenSpectrum LAPIS over the Loculus H5N1 dataset (INSDC-derived) |
| Influenza A/H3N2 | `https://lapis.genspectrum.org/h3n2` | GenSpectrum LAPIS over the Loculus H3N2 dataset (INSDC-derived) |

Only aggregate endpoints are used — `aggregated`, `nucleotideMutations` and
`nucleotideInsertions`. **No sequence data is ever downloaded**, by the tool or by your
browser. Nothing you type is stored, logged or sent anywhere except to the LAPIS instance
for the pathogen you chose.

Every response carries a `dataVersion`. The tool records it and prints it in the exported
methods paragraph, so a figure can be tied to the exact snapshot that produced it.

### Reference genomes and coordinates

Binding sites are located against the reference genome served by **the same LAPIS instance**
that serves the mutation data, not against an NCBI accession. The two coordinate systems are
not guaranteed to agree, and a silent one-base offset would corrupt every number the tool
prints without producing a single visible error. The bundled copies live in
`src/data/references/` and each records the date it was fetched; the nightly job re-checks
their lengths against the live instances.

All positions in this tool are **1-based and inclusive**, on the plus strand of the
reference, and are always LAPIS coordinates.

---

## 2. The unit of analysis

For a binding site occupying positions `p₁…pₙ` on segment `s`:

| Symbol | Definition | How it is obtained |
|---|---|---|
| `nScope` | sequences matching the date / country / lineage filters | `aggregated` with filters only |
| `nFullCoverage` | of those, sequences with a **definite** base call at every one of `p₁…pₙ` | `aggregated` + `advancedQuery = !(p₁N \| … \| pₙN)` |
| `nMismatch` | of `nFullCoverage`, sequences carrying ≥ 1 allele the oligo cannot bind | `aggregated` + `advancedQuery = (m₁ \| … \| mₙ) & !(p₁N \| … \| pₙN)` |
| `coverageGap` | `nScope − nFullCoverage` | derived |
| **headline** | `nMismatch / nFullCoverage` | derived |

The headline therefore reads: **"of the sequences that can be assessed, this fraction carries
at least one mismatch."** `coverageGap` is the count that *cannot* be assessed, and it is
displayed next to the headline, always.

> Percentages are over sequences in scope that have a definite base call at every position of the binding site. Sequences with an ambiguous base (N) anywhere in the site are excluded and reported separately as the coverage gap.

**Why not "all sequences in scope".** An N-masked base would count as a match, so a region
that is poorly sequenced *because* it is diverging would be reported as conserved. That is
precisely the failure mode this tool exists to make visible, so it cannot be allowed into the
denominator.

Two rules follow, and both are enforced in code:

- When `nFullCoverage` is 0 the headline is **null** and the tool renders "no assessable
  sequences". It never renders `0%`.
- When `nFullCoverage` is below `MIN_DENOMINATOR` = **50** the headline is
  suppressed and replaced with "insufficient data (n = X)".

And one rule governs the whole interface: **no percentage is ever rendered without the count
it was computed from.** This is enforced twice — by a custom ESLint rule
(`eslint-rules/require-n-with-percentage.js`) and by a runtime test over the rendered DOM
(`src/ui/results/no-bare-percentage.test.tsx`).

### Absence of a mutation is not evidence of conservation

`nucleotideMutations` returns **no row at all** for a position where nothing was observed.
A missing row therefore carries no coverage information whatsoever. Where the tool needs a
per-position denominator and LAPIS reported none, it substitutes the window denominator and
**labels that position as inferred** — in the chart, in the tooltip and in the screen-reader
table. The opt-in "exact coverage" control replaces those inferred denominators with measured
ones at the cost of one extra query per position, capped at
60 positions per click.

---

## 3. Locating the binding site

An oligo is matched against both strands of every segment of the reference, allowing IUPAC
degeneracy and up to `DEFAULT_MAX_MISMATCHES` = **3** mismatches.
Orientation is detected, not asked for.

- If exactly one site ties for the fewest mismatches, it is used.
- If several tie, the tool refuses to choose and asks you to.
- If the oligo's IUPAC degeneracy product exceeds `MAX_DEGENERACY_PRODUCT` =
  **64**, the located site is flagged as needing confirmation.
- Degenerate bases are never "resolved" to a single base. A `Y` stays a `Y`.

---

## 4. Building the mismatch term

This is the subtlest part of the tool. A degenerate oligo base *accepts* more than one allele,
and an oligo is allowed to mismatch its own reference — a published assay may predate the
reference, or target a different lineage. Both break the naive assumption that "any
non-reference allele is a mismatch".

For position `i` with reference base `R` and oligo base `O` (expressed on the plus strand;
the oligo base is complemented first for a minus-strand site):

- `M(i)` = the **accepted** alleles = the IUPAC expansion of `O`, intersected with `{A,C,G,T}`.
  **A deletion never matches.**
- `X(i)` = `{A,C,G,T,-} \ M(i)` = the **mismatch** alleles.

Three cases, implemented in `mismatchTerm` in `src/core/query.ts`:

| Case | Condition | Term emitted |
|---|---|---|
| **A — simple** | `M(i) = {R}` — the oligo is non-degenerate here and matches the reference | the bare position term, `21765` (or `seg4:614`) |
| **B — degenerate** | `R ∈ M(i)` and `\|M(i)\| > 1` | `(R{pos}x₁ \| R{pos}x₂ \| …)` over every `x ∈ X(i)` |
| **C — inverted** | `R ∉ M(i)` — the oligo mismatches the reference here | `!(R{pos}a₁ \| R{pos}a₂ \| …)` over every `a ∈ M(i)` |

A bare position term means "any **definite** non-reference allele at this position, including
a deletion, excluding ambiguity", which is why case A is exact and short.

Case C reads "does not carry any allele the oligo accepts". Because the whole expression is
ANDed with the full-coverage clause, ambiguity is already excluded, so the negation is exact —
and note that it correctly counts a sequence carrying the *reference* allele as a mismatch,
which is right when the oligo itself diverges from the reference.

**Ambiguous reference base.** If `R` itself is not one of `A,C,G,T` — rare, but real — the
position is excluded from *both* the mismatch clause and the ambiguity clause, and the tool
says so rather than guessing. If every position of a site is like that, the tool refuses to
analyse it.

The two window queries are then:

```
fullCoverage      := !( p₁N | p₂N | … | pₙN )
mismatchInWindow  := ( m₁ | m₂ | … | mₙ ) & !( p₁N | p₂N | … | pₙN )
```

### Insertions

`nucleotideInsertions` has **no `coverage` field** — insertions have counts only. They are
therefore reported as counts against the window denominator, labelled as such, and are not
folded into the headline.

---

## 5. The severity indicator

> The severity indicator is a heuristic based on mismatch count, mismatch frequency and proximity to the 3′ end. It is not a thermodynamic model and not a statement about assay performance.

The indicator has four states: **green**, **amber**, **red**, and **unknown**.

**Unknown** wins over everything else. A site is rated unknown, with no colour claim at all,
when either:

- `nFullCoverage` is below `MIN_DENOMINATOR` (50), or
- the coverage gap exceeds `COVERAGE_GAP_UNUSABLE` = **50 %** of the
  sequences in scope, at which point the rate is not interpretable.

Otherwise a score is computed over the positions of the window:

```
score = Σᵢ  weight(role, dᵢ) × ( substitutionFractionᵢ + DELETION_WEIGHT × deletionFractionᵢ )
```

where `dᵢ` is the distance of position `i` from the oligo's 3′ end (0 = the terminal base) and
each fraction is over that position's own denominator.

| | weight |
|---|---|
| **probe** — every position | 1 |
| **primer**, `d ≤ THREE_PRIME_CRITICAL` (2) | 3 |
| **primer**, `d ≤ THREE_PRIME_NEAR` (5) | 2 |
| **primer**, elsewhere | 1 |

`DELETION_WEIGHT` = **2**: a deletion counts double a substitution.

**A probe weights all positions uniformly; only a primer weights the 3′ end.** A probe has no
extending 3′ terminus, so there is no basis for the weighting, and applying it anyway would
manufacture a difference between two identical mismatch profiles. When a probe is scored, the
tool says so in the reasons list.

The level is then:

| Level | Condition |
|---|---|
| **red** | headline ≥ `RED_FRACTION` (5 %) **or** score ≥ `RED_SCORE` (0.15) |
| **amber** | headline ≥ `AMBER_FRACTION` (1 %) **or** score ≥ `AMBER_SCORE` (0.03) |
| **green** | otherwise |

The score thresholds are deliberately low enough that *position* can override *level*. The
maximum achievable score for a window whose mismatch fraction is `f` is `6f` (weight 3 at the
3′ terminus × deletion weight 2), so a red-by-score threshold above 0.3 could never fire below
`RED_FRACTION` and the 3′ weighting would be decorative. At 0.15, a 2.5 % mismatch
rate concentrated as a terminal 3′ deletion is rated red while a 4 % rate spread mid-oligo
stays amber — which is the entire point of weighting by position.

Colour is never the only signal. Every severity is also carried as a word, a shape and a text
reason list, so the indicator survives greyscale, colour blindness and a screen reader.

---

## 6. What this tool does **not** do

It counts sequences carrying a mismatch in a window. It models neither hybridisation nor
amplification. Specifically, it does **not**:

- predict or compute **ΔTm**, ΔG, or any thermodynamic quantity;
- predict **PCR efficiency**, Ct shift, sensitivity, specificity, or limit of detection;
- predict **assay failure**. A single mid-oligo mismatch frequently has no measurable effect;
  a terminal 3′ mismatch sometimes abolishes amplification. This tool cannot tell you which
  case you are in, and the severity indicator is a triage heuristic, not a verdict;
- **design** primers or probes, suggest replacements, or optimise anything;
- perform any **clinical interpretation**, and it is not validated for any clinical, diagnostic
  or regulatory use;
- account for a **multiplexed** assay's redundancy, for a second target that would rescue a
  failing one, or for anything about the assay chemistry;
- consider **protein-level** consequences. Everything here is nucleotide-level.

---

## 7. Limitations

### 7.1 Limitations the tool can detect, and reports

Three biases are detectable from the data itself, and the tool raises them as diagnostics in
the caveat panel — which is never collapsed, never behind a disclosure and never below the
fold:

- **Deposition lag.** Sequences are usually deposited weeks after collection, so the most
  recent buckets of any trend are incomplete rather than genuinely quiet. When the last
  4 buckets fall below 50 % of the historical
  median, the tool says so. Reading a falling tail as a falling rate is the single easiest way
  to misread this tool.
- **Geographic concentration.** When more than 60 % of the mismatch-
  carrying sequences come from one country, the tool names the country and the counts. This
  usually reflects **where sequencing happens**, not where a variant circulates.
- **Coverage gaps from ambiguous base calls.** The gap is always displayed beside the headline
  as a count and a rate, and above `COVERAGE_GAP_WARN` = 20 % it also
  earns an explicit warning that a mutation at one of those positions would not be visible.

It also reports sequences with no usable collection date, which appear in the headline but not
in the trend, and warns when a single response was large enough to be worth knowing about.

### 7.2 Limitations that are **not** machine-detectable

These cannot be diagnosed from the data and no diagnostic will ever appear for them. They are
the reason a figure from this tool is a starting point for an investigation and not the
conclusion of one.

- **Sequencing platform and pipeline bias.** Different platforms, primer schemes and consensus
  pipelines drop out in different places. Amplicon dropout in a tiling scheme produces exactly
  the pattern this tool reports as an ambiguity-driven coverage gap, and the tool cannot tell
  a real ambiguity from a systematically failed amplicon. Consensus-calling thresholds also
  differ between pipelines, so what one submitter reports as a definite base another reports
  as `N`.
- **Host, specimen and sampling bias.** Which specimens get sequenced at all is driven by
  surveillance programmes, outbreak investigations, travel screening and research interest.
  For the influenza instances in particular, the sequenced population is not a random sample
  of circulating virus, and for H5N1 the host mix (avian, bovine, human) shifts what the data
  even represents. A rate computed here is a rate **in the sequenced sample**, not in
  circulation.
- **Retrospective database revision.** Sequence databases are revised. Records are added,
  corrected, reclassified and withdrawn, so the same query can return a different answer next
  month — this is why `dataVersion` is recorded with every figure, and why the golden cases
  are pinned to committed fixtures rather than to the live API.
- **Metadata quality.** Collection dates, countries and lineage assignments are as reported by
  the submitter. Country is where the sample was *submitted from* as recorded, which is not
  always where it was collected.
- **The oligo you typed.** The tool verifies that the sequence resolves to a site; it cannot
  verify that the sequence is the one your assay actually uses, that it is in the right
  orientation for your chemistry, or that you have entered all of its components.

---

## 8. Verification

Three layers, all of which run in CI:

1. **Unit and component tests** over every module, plus a runtime check over the rendered DOM
   that no percentage appears without its N, and an axe accessibility pass.
2. **Golden cases** — five real measurements from three published outbreaks, asserted
   **exactly** against committed fixtures on every run. See
   [`docs/golden-cases.md`](./golden-cases.md).
3. **A nightly live job** (`.github/workflows/nightly.yml`) that re-checks the LAPIS contract
   and recomputes the same five measurements against the live API, through the production
   query builder. On failure it opens — or comments on an existing — GitHub issue.

The bundled assay library is verified at build time against the bundled reference genomes:
every oligo must resolve to a single site and every entry must carry a citation with a URL and
an access date. No sequence ships without a source; see
[`docs/assay-sources.md`](./assay-sources.md).

### The nightly tolerance, and where it is nearly meaningless

The nightly drift job accepts a headline within **± 2 percentage points** of the figure
recorded on 2026-08-01. That is the right band for G1 (3.26 % → 95.93 %) and G2 (6.47 % →
99.71 %), where a two-point move is a real signal.

**It is close to vacuous for G3.** G3's headline is 0.0067 %, so a ± 2 pp band accepts anything
from 0 % to 2.0067 % — a three-hundred-fold rise in mismatches at a conserved control, which is
exactly the event the control exists to catch, would pass silently. The band is kept because it
is the specified tolerance, but G3 additionally carries an **absolute** check: its mismatch
count must stay within ten times the recorded count, and its headline must stay below
`AMBER_FRACTION` so the case still renders green. The two checks are labelled distinctly in the
job's output. A tolerance band should not be allowed to imply a precision it does not have.

---

## 9. Reproducing a figure

Every result view exports a dated methods paragraph, a CSV and a JSON file, each carrying the
pathogen, the instance URL, the `dataVersion`, the full scope, the unit of analysis and the
regulatory statement. Every result view also has a permalink that encodes the entire query.

Those five artefacts — permalink, methods paragraph, CSV, JSON, and this document — are
between them enough for someone else to obtain the same numbers, or to establish that the
underlying data has changed since you did.
