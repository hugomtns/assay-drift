# Assay sources

Provenance for every oligo in `src/data/assays/library.json`.

**The rule (Global Constraint 2).** Every sequence here was copied character by
character out of a document opened while the entry was written. None was
recalled. If a sequence cannot be traced to a URL in the same change, it does
not ship.

**How to read the coordinates.** They come from `npm run verify:assays`, which
resolves each oligo against the bundled reference genome in
`src/data/references/` (fetched from the same LAPIS instances that serve the
mutation data, on 2026-08-02). Positions are 1-based and inclusive on the plus
strand of the reference, exactly as elsewhere in this codebase.

**Why the mismatch counts are written out.** `verifyAssay` tolerates one
mismatch per oligo, which means a single mistyped base still verifies: it lands
on the true site, uniquely, one base off, and the gate says OK. The count is the
only signal that anything is wrong, so every non-zero count below is explained
from its source. A count that cannot be explained is grounds to drop the assay,
not to widen the tolerance.

All library oligos are below the `highly-degenerate` threshold
(`MAX_DEGENERACY_PRODUCT = 64` in `src/core/resolution.ts`). The most degenerate
is `H5-1201F` at 36.

---

## Influenza segment naming — an assumption, confirmed by coordinates

The bundled influenza references name their segments `seg1`…`seg8`. They do
**not** state which gene each segment carries. Published influenza assays are
described by gene (M, HA, NP, NS), so a mapping has to be assumed:

| seg1 | seg2 | seg3 | seg4 | seg5 | seg6 | seg7 | seg8 |
|---|---|---|---|---|---|---|---|
| PB2 | PB1 | PA | **HA** | NP | NA | **M** | NS |

This is the conventional influenza A ordering. **It is an assumption about the
reference files, not a fact stated by them.** Two parts of it are confirmed by
where the oligos actually landed:

- **HA = seg4.** The A(H5) HA assay and both A(H3) HA assays resolve on `seg4`
  of their respective references, at 0–1 mismatches, with the primers framing a
  plausible amplicon. An HA assay landing on `seg4` is the mapping holding.
- **M = seg7.** The influenza A M-gene assay (FLUAM) resolves on `seg7` of both
  the H5N1 and the H3N2 reference.

The remaining six assignments are **unconfirmed** — no bundled assay targets
PB2, PB1, PA, NP, NA or NS, so nothing in this repository tests them.

---

## `cdc-2019-ncov-n1` — CDC 2019-nCoV_N1 (SARS-CoV-2, N gene)

- **Citation:** 2019-Novel Coronavirus (2019-nCoV) Real-time rRT-PCR Panel
  Primers and Probes. US Centers for Disease Control and Prevention, Division of
  Viral Diseases. Effective 24 Jan 2020.
- **URL:** <https://stacks.cdc.gov/view/cdc/84525> — accessed 2026-08-17.
  The record page is the document's own canonical URL; the file read was its
  attachment, `https://stacks.cdc.gov/view/cdc/84525/cdc_84525_DS1.pdf`
  (`rt-pcr-panel-primer-probes.pdf`).
- **Corroborating document:** the same CDC table is reproduced, row-aligned, in
  the FDA-posted Yale New Haven Hospital SARS-CoV-2 assay EUA Summary,
  <https://www.fda.gov/media/136602/download?attachment=> (accessed 2026-08-17).
  It was opened because the CDC PDF's own table extracted with its name column
  detached from its sequence column; the two documents agree on every base and
  on every name-to-sequence assignment.

Source rows (CDC PDF, page 2 — spacing as printed):

```
2019-nCoV_N1-F  2019-nCoV_N1 Forward Primer  5'-GAC CCC AAA ATC AGC GAA AT-3'          None      20 µM
2019-nCoV_N1-R  2019-nCoV_N1 Reverse Primer  5'-TCT GGT TAC TGC CAG TTG AAT CTG-3'     None      20 µM
2019-nCoV_N1-P  2019-nCoV_N1 Probe           5'-FAM-ACC CCG CAT TAC GTT TGG TGG ACC BHQ1-3'  FAM/BHQ-1  5 µM
```

| Oligo | Role | Resolved | Strand | Mismatches |
|---|---|---|---|---|
| 2019-nCoV_N1-F | forward | `main:28287-28306` | plus | 0 |
| 2019-nCoV_N1-R | reverse | `main:28335-28358` | minus | 0 |
| 2019-nCoV_N1-P | probe | `main:28309-28332` | plus | 0 |

Amplicon 72 nt, probe between the primers and touching neither.

**Deviation from the source:** the probe is published with a 5′ FAM reporter and
a 3′ BHQ-1 quencher. Only the nucleotide sequence is stored; labels are recorded
in the entry's `notes` and are not part of the analysis. Inter-codon spaces in
the printed sequences are formatting and are not stored.

---

## `corman-e-sarbeco` — Corman E_Sarbeco (SARS-CoV-2, E gene)

- **Citation:** Corman VM, Landt O, Kaiser M, et al. Detection of 2019 novel
  coronavirus (2019-nCoV) by real-time RT-PCR. *Euro Surveill.*
  2020;25(3):2000045. Table 1.
- **URL:** <https://www.eurosurveillance.org/content/10.2807/1560-7917.ES.2020.25.3.2000045>
  — accessed 2026-08-17.
- **Retrieval note, stated plainly:** the Eurosurveillance page serves its full
  text through a script the fetcher could not run, and the PMC mirror was behind
  a CAPTCHA. The text transcribed from is the JATS full-text XML of the same
  article of record, retrieved from Europe PMC at
  `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6988269/fullTextXML`
  (accessed 2026-08-17). That is the document that was opened; the
  Eurosurveillance URL above is the citation for the same article.

Source rows (Table 1, "Primers and probes, real-time RT-PCR for 2019 novel
coronavirus"):

```
E gene   E_Sarbeco_F   ACAGGTACGTTAATAGTTAATAGCGT             Use 400 nm per reaction
         E_Sarbeco_P1  FAM-ACACTAGCCATCCTTACTGCGCTTCG-BBQ     Use 200 nm per reaction
         E_Sarbeco_R   ATATTGCAGCAGTACGCACACA                 Use 400 nm per reaction
```

| Oligo | Role | Resolved | Strand | Mismatches |
|---|---|---|---|---|
| E_Sarbeco_F | forward | `main:26269-26294` | plus | 0 |
| E_Sarbeco_R | reverse | `main:26360-26381` | minus | 0 |
| E_Sarbeco_P1 | probe | `main:26332-26357` | plus | 0 |

Amplicon 113 nt, matching the length the assay is published with.

**Deviation from the source:** probe labels (FAM / BBQ) dropped, sequence
unchanged.

---

## `who-h3-ha-266-373` — WHO A(H3) HA, H3-266/H3-373 (H3N2, HA gene)

- **Citation:** *WHO information for the molecular detection of influenza
  viruses* (2024), Annex 2 Protocol 2, table "Primers and probes used for
  detecting influenza A subtype H1pdm09 and H3 viruses", page 25. The assay is
  attributed there to the Microbiology Division, Centre for Health Protection,
  Hong Kong SAR, China (National Influenza Centre, WHO H5 Reference Laboratory).
- **URL:** <https://cdn.who.int/media/docs/default-source/influenza/molecular-detention-of-influenza-viruses/protocols_influenza_virus_detection_2024.pdf?sfvrsn=df7d268a_10>
  — accessed 2026-08-17. (The `molecular-detention-` path segment is WHO's own
  spelling.)

Source rows (page 25):

```
                H3-266-F   ACCCTCAGTGTGATGGCTTTCAAA                     0.1  own designed
A(H3)           H3-373-R   TAAGGGAGGCATAATCCGGCACAT                     0.1  own designed
HA gene         H3-315-P   FAM-ACGAAGCAAAGCCTACAGCAACTGTT-BHQ1          0.1  own designed
```

| Oligo | Role | Resolved | Strand | Mismatches |
|---|---|---|---|---|
| H3-266-F | forward | `seg4:283-306` | plus | **1** |
| H3-373-R | reverse | `seg4:367-390` | minus | 0 |
| H3-315-P | probe | `seg4:332-357` | plus | **1** |

Amplicon 108 nt.

### The two mismatches

Both are genuine differences between the published oligo and the bundled H3N2
reference strain, not transcription errors:

- **H3-266-F, base 20 of 24 — reference position `seg4:302`.** The published
  primer has `T`; the bundled reference has `C`.
- **H3-315-P, base 4 of 26 — reference position `seg4:335`.** The published
  probe has `A`; the bundled reference has `C`.

The sequences were re-read from the source before this was written, using two
independent extractions of page 25 (`pdftotext -layout` and `pdftotext` without
layout); both render the two oligos exactly as transcribed above, so the
difference is in the biology, not the typing.

A second, independent check points the same way. The oligo names encode
positions in the HA numbering the assay was designed against, and all three
oligos in this set sit at a **constant +17 offset** from their named positions in
the bundled reference (266→283, 315→332, 373→390, where a reverse primer's name
gives its highest reference coordinate). A mistyped base would not preserve that
spacing; a strain that has drifted at two positions does.

This is drift of exactly the kind the product exists to measure: an H3 HA assay
designed against contemporary viruses, read against a fixed reference strain.

**Deviation from the source:** probe labels (FAM / BHQ1) dropped, sequence
unchanged.

---

## `who-h3-ha-666-911` — WHO A(H3) HA, H3-666/H3-911 (H3N2, HA gene)

- **Citation and URL:** the same WHO 2024 document and page 25 table as above,
  accessed 2026-08-17.

Source rows (page 25):

```
HA gene         H3-666-F   GCACAGGGAATCTAATTGCTCC                       0.1  own designed
                H3-911-R   ATGCTTCCATTTGGAGTGATGCATTC                   0.1  own designed
                H3-732P2   FAM-GATCAGATGCACCCATTGGCAAATGC-BHQ1          0.1  own designed
```

| Oligo | Role | Resolved | Strand | Mismatches |
|---|---|---|---|---|
| H3-666-F | forward | `seg4:805-826` | plus | 0 |
| H3-911-R | reverse | `seg4:903-928` | minus | 0 |
| H3-732P2 | probe | `seg4:871-896` | plus | 0 |

Amplicon 124 nt.

### A naming discrepancy worth recording

The names of this set do not use a single consistent numbering base against the
bundled reference, and this is stated here rather than smoothed over.
`H3-911-R` lands at the same **+17** offset from its name as every oligo in the
`H3-266/H3-373` set (911 → 928). `H3-666-F` and `H3-732P2` land at **+139**
(666 → 805, 732 → 871). So the amplicon the names imply is 246 nt while the
amplicon the reference gives is 124 nt.

The placements themselves are not in doubt. Both oligos match the reference
exactly, and the next-best site anywhere on `seg4` is 8 mismatches away for
`H3-666-F` and 11 away for `H3-732P2` — including at the position the +17
convention would predict, which is 11 mismatches from `H3-732P2`. The forward
primer and the probe also keep their published spacing exactly (732 − 666 = 66;
871 − 805 = 66). The most likely reading is that this set was numbered against a
different reference sequence from the other set in the same table; nothing about
it is inferred or adjusted here.

**Deviation from the source:** probe labels (FAM / BHQ1) dropped, sequence
unchanged.

---

## `who-h5-ha-1201-1387` — WHO A(H5Nx) HA, H5-1201/H5-1387 (H5N1, HA gene)

- **Citation:** *WHO information for the molecular detection of influenza
  viruses* (2024), Annex 2 Protocol 2, "Real-time RT-PCR for Influenza A(H5) HA
  gene", table "Primers and probe", page 34. Attributed there to the School of
  Public Health, Faculty of Medicine, The University of Hong Kong.
- **URL:** <https://cdn.who.int/media/docs/default-source/influenza/molecular-detention-of-influenza-viruses/protocols_influenza_virus_detection_2024.pdf?sfvrsn=df7d268a_10>
  — accessed 2026-08-17.

Source rows (page 34):

```
Type/ subtype       Gene   Name           Sequence
                           H5-1201F       CARGGGAGTGGDTAYGCBGCAGA
Influenza A (H5Nx)  HA     H5-1387R       ARAAGTTCAGCRTTRTARGTCCA
                           H5-1285P       FAM-AARATGAACASTCARTTYGAGG-MGB
```

| Oligo | Role | Resolved | Strand | Mismatches | Degeneracy |
|---|---|---|---|---|---|
| H5-1201F | forward | `seg4:1147-1169` | plus | 0 | 36 |
| H5-1387R | reverse | `seg4:1333-1355` | minus | 0 | 16 |
| H5-1285P | probe | `seg4:1231-1252` | plus | 0 | 16 |

Amplicon 209 nt. All three oligos sit at a constant **−54** offset from their
named positions (1201→1147, 1285→1231, 1387→1333), which is the same kind of
internal consistency described for the H3 set and is a second check on the
transcription.

**Deviations from the source:** the IUPAC wobbles (`R`, `Y`, `S`, `D`, `B`) are
kept exactly as published — not expanded into separate entries, not silently
resolved to one base. `src/core/iupac.ts` matches them natively. All three are
well under the degeneracy threshold of 64, so none is flagged
`highly-degenerate`. Probe labels (FAM / MGB) dropped, sequence unchanged.

---

## `who-flua-m-fluam-h5n1` and `who-flua-m-fluam-h3n2` — WHO influenza A M gene (FLUAM)

One published assay, bundled twice, because an assay entry is verified against
one pathogen's reference and this one is subtype-independent. The oligos are
identical in both entries; only `pathogenId` and `id` differ.

- **Citation:** *WHO information for the molecular detection of influenza
  viruses* (2024), Annex 2 Protocol 1, table "Primers and probes used for
  detecting influenza A, B and C viruses", page 22. The M gene assay is
  attributed there to Terrier O, et al. *Virol J* 2011;8:285.
- **URL:** <https://cdn.who.int/media/docs/default-source/influenza/molecular-detention-of-influenza-viruses/protocols_influenza_virus_detection_2024.pdf?sfvrsn=df7d268a_10>
  — accessed 2026-08-17.

Source rows (page 22):

```
Influenza A     FLUAM-7-F      CTTCTAACCGAGGTCGAAACGTA                  0.1
virus (M)       FLUAM-161-R    GGTGACAGGATTGGTCTTGTCTTTA                0.1
                FLUAM-49-P6    CFO560-TCAGGCCCCCTCAAAGCCGAG-BHQ1        0.1
```

Against the **H5N1** reference:

| Oligo | Role | Resolved | Strand | Mismatches |
|---|---|---|---|---|
| FLUAM-7-F | forward | `seg7:32-54` | plus | 0 |
| FLUAM-161-R | reverse | `seg7:162-186` | minus | 0 |
| FLUAM-49-P6 | probe | `seg7:74-94` | plus | 0 |

Against the **H3N2** reference:

| Oligo | Role | Resolved | Strand | Mismatches |
|---|---|---|---|---|
| FLUAM-7-F | forward | `seg7:32-54` | plus | 0 |
| FLUAM-161-R | reverse | `seg7:162-186` | minus | **1** |
| FLUAM-49-P6 | probe | `seg7:74-94` | plus | 0 |

Amplicon 155 nt on both references, at a constant +25 offset from the named
positions (7→32, 49→74, 161→186).

### The one mismatch

**FLUAM-161-R, base 9 of 25 — reference position `seg7:178` on the H3N2
reference.** The primer's base 9 is `G`, which pairs with `C` on the plus
strand; the H3N2 reference carries `T` there.

This one cannot be a transcription error, and the library proves it: the
identical string, from the same transcription, binds the H5N1 reference at the
same relative position with **0** mismatches. One string cannot be mistyped
against one reference and correct against another. The difference is between the
two influenza A lineages' M genes.

**Deviation from the source:** probe labels (CAL Fluor Orange 560 / BHQ1)
dropped, sequence unchanged.

---

## Not included — source not retrievable

- **CDC 2019-nCoV Real-Time RT-PCR Diagnostic Panel, Instructions for Use
  (CDC-006-00019).** The FDA copy at `https://www.fda.gov/media/134922/download`
  now returns HTTP 404; the CDC panel's EUA was withdrawn in 2021 and the file
  appears to have been taken down. The N1 oligos were sourced instead from CDC's
  own primer-and-probe document (`stacks.cdc.gov/view/cdc/84525`, above), which
  is the primary document for the sequences themselves. No sequence was taken
  from a search-result snippet.
- **`stacks.cdc.gov` direct PDF download** rejects non-browser clients with
  HTTP 403, and `web.archive.org` was returning HTTP 503 throughout this
  session. Neither blocked a needed sequence; both are recorded so the next
  person does not repeat the attempts.

## Not included — failed verification

Nothing. Every assay transcribed in this session verified and is in the library;
none was dropped, and none was adjusted to make it verify.

Candidate assays that were **read but not transcribed** (no verification was
attempted, so they are neither failures nor omissions): the WHO 2024 document's
clade 2.3.4.4 H5 set (`H5.2344-1673F` / `-1749R` / `-1718P`), the NIID H3 and H5
sets on pages 36–37, and the conventional (non-real-time) RT-PCR primer sets in
Annex 1. Any of them can be added later by the same procedure. They were left
out to keep this change to assays that were verified one at a time, not because
anything is known to be wrong with them.
