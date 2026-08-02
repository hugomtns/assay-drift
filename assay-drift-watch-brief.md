# Assay Drift Watch — Product Brief

*Draft v0.1 — for review. Nothing here is committed; the technical section is directional only.*

---

## 1. The problem

PCR and qPCR assays are designed once, against a reference genome, at a fixed point in time. The pathogen population does not hold still. Substitutions and deletions accumulate under primer and probe binding sites, and the assay degrades — first in efficiency, then in sensitivity, and eventually into outright target dropout.

The failure is **silent**. There is no signal inside the reaction that says "your primer no longer matches." A lab discovers the problem when results start looking wrong, which is downstream of the harm: false negatives in clinical diagnostics, distorted surveillance denominators, wasted reagents, and delayed detection of the very thing that caused the drift.

The best-documented case is the S-gene target failure observed when Alpha spread: a six-nucleotide spike deletion sat directly under a commercial kit's primer binding site. Mismatches in the last two or three bases at the 3′ end are disproportionately damaging, so *where* a mismatch falls matters as much as whether one exists.

**What existing tools do.** Primer-BLAST, UCSC In-Silico PCR, FastPCR, AssayBLAST and equivalents answer: *does this oligo bind the reference genome, and does it bind anywhere it shouldn't?* That is a specificity and off-target question, asked against a static reference.

**What nothing routinely answers.** *What fraction of the genomes actually circulating this month carry a mismatch under my primer — and is that fraction rising?*

The data to answer this is public, free, and updated continuously. The gap is entirely one of tooling and interface. That is the opportunity.

### Explicit non-goals

- Not a diagnostic device, and not for clinical decision-making.
- Not an assay design tool. It evaluates oligos; it does not propose them.
- Not a thermodynamic simulator. It reports mismatch position and count, not predicted ΔTm or amplification efficiency (a v2 candidate, clearly labelled as an estimate).

---

## 2. Target audience

**Primary — assay owners.** Molecular diagnostic developers and public-health laboratory bioinformaticians who are accountable for an assay's ongoing performance. Small enough teams that they have no internal surveillance pipeline, technical enough to know what a 3′ mismatch means.

**Secondary — research virology labs.** Groups running in-house qPCR for a pathogen they study, who inherited primers from a paper three years ago and have never re-checked them.

**Tertiary — teaching.** MSc/PhD courses in molecular diagnostics and genomic epidemiology. The tool makes an abstract point (assays decay because pathogens evolve) concrete and interactive in one screen.

**Deliberately excluded.** Regulated signal-detection workflows in large IVD manufacturers. They have validated internal pipelines; competing there is neither possible nor useful.

---

## 3. What the user is trying to achieve

Framed as jobs, in priority order:

1. **Reactive check.** *When a new lineage starts spreading, I want to know within days whether my assay's binding sites are affected, so I can decide whether to redesign, add a second target, or do nothing.* Doing nothing is a legitimate and common outcome — the tool must make "you're fine" as clear and trustworthy as "you have a problem."

2. **Design-time conservation check.** *When I'm choosing a target region for a new assay, I want to pick something conserved in the current population, not just in the reference.*

3. **Evidence for a document.** *When I present assay performance to a committee, a reviewer, or a regulator, I want a dated, reproducible, citable snapshot with an explicit method.*

**What success looks like from the user's side:** an answer in under a minute, with no install and no account; a number they trust enough to act on; and a link they can paste into an email.

**What failure looks like:** a confident-looking percentage with no visible caveats, which they quote in a document, and which turns out to have been computed over 40 sequences from one country.

---

## 4. User journey

**Step 0 — Landing.** No signup. One sentence of explanation and a worked example ("See how the CDC N1 assay has drifted since 2020"). Pathogen selector visible immediately.

**Step 1 — Input.** Two paths:
- Paste oligos — FASTA or plain text, with forward / reverse / probe roles assigned in the UI.
- Pick a published assay from a bundled, cited library (CDC N1/N2, Charité E/RdRp, WHO influenza protocols, etc.).

Orientation is auto-detected; the user does not have to reverse-complement anything by hand. IUPAC degenerate bases accepted.

**Step 2 — Binding site resolution.** The tool locates each oligo on the reference genome and shows the coordinates on a small genome map. Ambiguous cases (no hit, multiple hits, heavily degenerate oligo) are surfaced for the user to confirm rather than silently resolved. This step builds trust: the user sees that the tool found the right place before it computes anything.

**Step 3 — Scope.** Time window (default: last six months), geography, and lineage/clade filter. Defaults are sensible so most users never touch this.

**Step 4 — Results.** Per oligo:
- **Headline** — percentage of in-scope sequences carrying ≥1 mismatch in the binding site, with the absolute N alongside it, never alone.
- **Position profile** — a bar chart of mismatch frequency per base, rendered directly beneath the oligo sequence, with the 3′ terminal region shaded.
- **Severity indicator** — a traffic light derived from mismatch count and 3′ proximity, labelled explicitly as a heuristic, not a prediction.
- **Trend** — the same metric over time, so the user sees direction, not just level.
- **Attribution** — which lineages and which countries carry the mismatch.

**Step 5 — Interpretation.** A caveat panel that is always visible, not collapsed: sequence databases are sampling-biased; coverage gaps and N-masking mean "no mutation observed" is not "no mutation"; deposition lag means the last few weeks are thin; and an in-silico mismatch is not the same as assay failure. This panel is a core feature, not a legal disclaimer.

**Step 6 — Act.** Copy a permalink encoding the full query. Download CSV/JSON plus a dated methods paragraph suitable for pasting into a report.

**Step 7 — Watch (v2).** Subscribe an assay to a scheduled recheck; get notified when a binding site crosses a threshold. This is where the product stops being a lookup and starts being a service.

---

## 5. Data sources and third parties

| Source | Role | Access | Notes |
|---|---|---|---|
| **GenSpectrum LAPIS** (open instances) | Primary mutation-frequency backend | Free REST, no key | Covers SARS-CoV-2, Influenza A (H5N1, H3N2, H1N1pdm), Influenza B, RSV, West Nile |
| **Pathoplexus LAPIS instances** | Additional pathogens | Free REST | Measles, mpox, dengue, Ebola (Zaire/Sudan/Bundibugyo), Marburg, CCHF, HMPV, RSV-A/B, yellow fever, Andes |
| **NCBI RefSeq** | Reference genomes for coordinate resolution | Free | Small files; can be bundled as static assets |
| **Nextstrain open data files** | Cross-check and fallback | Free (data.nextstrain.org) | Useful for validation and for pathogens LAPIS doesn't serve |
| **Published assay sequences** | Bundled library | Public literature / EUA documents | Every entry cited and linked; sequences are facts, but curation should be attributed |
| **Cloudflare Pages + Workers** | Hosting and caching | Free tier | Unlimited bandwidth, 100k Worker requests/day, commercial use permitted |
| **GitHub Actions** | Scheduled precompute | Free on public repos | Nightly refresh of the bundled library |

No user accounts, no personal data, no uploads retained in v1. The v2 watch feature introduces email addresses — consider an RSS/webhook-only first release to avoid handling PII at all.

---

## 6. Technical direction (to be reviewed)

**Shape.** A static single-page frontend plus one serverless Worker acting as a caching query proxy. No database in v1.

**Oligo → coordinate resolution.** Runs client-side. Reference genomes are tiny (SARS-CoV-2 is ~30 kb), so a sliding-window match with a configurable mismatch tolerance is adequate — no alignment library, no WASM. Needs to handle IUPAC ambiguity codes and auto-detect reverse-complement orientation. This is a small, well-bounded piece of code and a good early spike.

**Mutation statistics.** Query LAPIS's nucleotide-mutation endpoints with metadata filters (date range, country, lineage), then restrict to the binding-site coordinate window. Aggregate queries only — never download FASTA in v1.

**Three things that decide whether the numbers are honest:**

1. **Denominator and coverage.** A position with no reported mutation may mean "conserved" or "not sequenced." These must be distinguishable in the output. Surface coverage explicitly rather than treating absence as a match.
2. **Indels, not just substitutions.** Deletions are the highest-impact failure mode — the Alpha case was a deletion. Deletion and insertion data must be queried alongside substitutions, not skipped because the endpoint shape is different.
3. **Unit of analysis.** State clearly whether percentages are over sequences with coverage at that site, or over all sequences in scope. Pick one, label it everywhere.

**Severity heuristic.** v1: mismatch count weighted by distance from the 3′ end. v2 candidate: nearest-neighbour ΔTm using SantaLucia parameters, computed client-side. Neither is a wet-lab prediction and both should say so in the UI.

**Caching.** Worker KV keyed on (pathogen, oligo set, window, filters), TTL of hours. The underlying data updates daily at most, so cache aggressively.

**Scheduled precompute (v2).** GitHub Actions cron on a public repo recomputes the bundled assay library nightly and commits the results as static JSON. The frontend reads that file directly. Zero infrastructure, fully auditable history, and the commit log doubles as a change record.

**Alerting (v2).** Cloudflare Cron Triggers plus KV for subscriptions. Prefer RSS or webhook over email for the first iteration.

**Validation strategy — and the credibility story.** Build golden-case regression tests that reproduce known historical events: Alpha S-gene dropout, and at least one influenza or RSV drift example. Publishing "here is the tool correctly detecting a failure we already know happened" is both the test suite and the launch argument.

**Scope guardrails for v1.** Three pathogens. One bundled assay library. No Tm modelling. No assay design. No user sequence uploads.

---

## 7. Open questions and risks

- **Segmented genomes.** Influenza coordinate systems are per-segment. Verify early how LAPIS exposes segment references — this could be a day of work or a week.
- **Deletion granularity.** Confirm the LAPIS deletion/insertion endpoints give position-level resolution inside a binding window.
- **Sampling bias.** Needs a designed answer — a visible N, a geographic coverage indicator, a deposition-lag warning — not a paragraph of small print. If this is done badly the tool is actively harmful.
- **Regulatory positioning.** Prominent, unambiguous statement that this is a research and educational tool, not a diagnostic device.
- **Adoption.** Assay owners are conservative and busy. The bundled library of well-known published assays is the wedge: the first visit should be useful with zero input.
