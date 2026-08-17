import { version } from '../../../package.json';
import { REGULATORY_STATEMENT, UNIT_OF_ANALYSIS } from '../analysis/constants';
import type { AnalysisResult } from '../analysis/run';
import { getPathogen } from '../registry';
import { referenceFetchedAt } from '../../data/references';

export const TOOL_NAME = 'Assay Drift Watch';

/**
 * Taken from `package.json`, never written out here.
 *
 * The version's whole job in a methods paragraph is to identify the build that
 * produced the numbers, so a hand-maintained copy that drifts from the shipped
 * version is worse than no version at all: it would name a build that never
 * existed and make the result unreproducible while looking reproducible.
 */
export const TOOL_VERSION: string = version;

/**
 * The plural noun for the pathogen's lineage field, taken from
 * `PathogenConfig.lineageLabel` rather than hardcoded.
 *
 *   'Pango lineage' -> 'lineages'   'Clade' -> 'clades'   'HA clade' -> 'HA clades'
 *
 * Hardcoding the word "lineages" would pass this task's tests and still print
 * "all lineages" for an H5N1 analysis, where the field is `clade` and nobody
 * calls the values lineages.
 *
 * The last word is the noun. A word before it survives only if it is an
 * acronym, and that distinction is not cosmetic: "HA clade" says *which* clade
 * assignment is meant, so dropping "HA" would name a different column, whereas
 * "Pango" names the nomenclature system the values come from -- which "all
 * lineages" already implies, since there is only one set of them.
 */
function lineageNounPlural(label: string): string {
  const words = label.split(' ');
  const last = words[words.length - 1] ?? label;
  const qualifiers = words.slice(0, -1).filter((word) => word === word.toUpperCase());
  return [...qualifiers, `${last.toLowerCase()}s`].join(' ');
}

/** 'A' / 'A and B' / 'A, B and C'. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/**
 * The dated, reproducible, citable snapshot: everything someone would need to
 * run this query again and get this answer, in one paragraph they can paste
 * into a methods section.
 *
 * Follows the template in Appendix C.3 of the plan. It describes the *query*,
 * not the findings -- it states no rate anywhere, which is why it is safe to
 * paste somewhere the caveat panel cannot follow it, and why it does not
 * depend on the oligo list being non-empty.
 *
 * `UNIT_OF_ANALYSIS` and `REGULATORY_STATEMENT` are interpolated, never
 * retyped. Global Constraint 8 requires five byte-identical copies of the
 * latter; a "matching" copy typed here would be a fifth thing to keep true and
 * would silently stop matching the first time the wording changes.
 */
export function methodsParagraph(result: AnalysisResult): string {
  const cfg = getPathogen(result.pathogenId);
  const { scope } = result;

  const names = result.oligos.map((oligo) => oligo.name);
  const subject =
    names.length > 0
      ? `Assay drift for ${listPhrase(names)} was assessed`
      : 'Assay drift was assessed';

  const lineageNoun = lineageNounPlural(cfg.lineageLabel);
  const countries =
    scope.countries.length > 0 ? listPhrase(scope.countries) : 'all countries';
  const lineages =
    scope.lineages.length > 0
      ? `${lineageNoun} ${listPhrase(scope.lineages)}`
      : `all ${lineageNoun}`;

  return [
    `${subject} with ${TOOL_NAME} ${TOOL_VERSION} on ${result.generatedAt.slice(0, 10)}.`,
    `Nucleotide mutation frequencies were obtained from ${cfg.lapisBaseUrl}` +
      ` (data version ${result.dataVersion}), covering ${cfg.label}.`,
    `The dataset is ${cfg.attribution}`,
    `Sequences were restricted to collection dates from ${scope.dateFrom} to ${scope.dateTo},` +
      ` ${countries}, and ${lineages}.`,
    UNIT_OF_ANALYSIS,
    `Binding sites were located on the reference genome served by the same instance` +
      ` (retrieved ${referenceFetchedAt(result.pathogenId)}), allowing IUPAC-degenerate` +
      ` matching and automatic orientation detection.`,
    REGULATORY_STATEMENT,
  ].join(' ');
}
