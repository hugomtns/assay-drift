import type { Strand } from './binding';
import { normalizeOligo } from './iupac';
import { MAX_OLIGO_LENGTH, MIN_OLIGO_LENGTH, type OligoRole } from './oligo-input';
import { PATHOGENS, type PathogenId } from './registry';
import type { Scope } from './scope';

/** The oligo as it travels in a link: no id, because ids are per-session. */
export interface PermalinkOligo {
  name: string;
  role: OligoRole;
  sequence: string;
}

/**
 * The *chosen* binding site, carried so an ambiguous resolution reproduces
 * exactly rather than re-resolving to whichever candidate sorts first.
 *
 * Only the three coordinates that identify the site travel. `end`,
 * `mismatches` and `mismatchOligoIndexes` are functions of the oligo and the
 * reference, so sending them would be sending a second copy of a derived fact
 * that a link could contradict; the reader recomputes them.
 */
export interface PermalinkSite {
  segment: string;
  strand: Strand;
  /** 1-based inclusive, plus strand of the reference (Global Constraint 3). */
  start: number;
}

export type PermalinkScope = Omit<Scope, 'pathogenId'>;

export interface PermalinkState {
  pathogenId: PathogenId;
  oligos: PermalinkOligo[];
  /** Keyed by oligo name. Every oligo has exactly one entry. */
  sites: Record<string, PermalinkSite>;
  scope: PermalinkScope;
}

export const PERMALINK_PREFIX = '#q=';

/**
 * The longest hash fragment `encodePermalink` will produce, in characters.
 *
 * The fragment is never sent to a server -- browsers strip everything from the
 * `#` onwards before making the request -- so server request-line limits
 * (nginx's 8 KB, IIS's 16 KB) are irrelevant here, and Node could hold
 * megabytes. The constraint is what survives being *handed to a person*:
 *
 * - The smallest address-bar limit still in the wild is Internet Explorer's /
 *   legacy Edge's 2083 characters for the **whole** URL, which is where every
 *   "safe URL length" guide's 2000 comes from. This app deploys at a bare
 *   origin plus `/`, so budgeting 2000 for the fragment leaves ~83 characters
 *   for `https://<host>/` -- enough for the production domain and for a
 *   `…-git-<branch>-<user>.vercel.app` preview.
 * - Mail clients wrap at ~78 characters per line and plain-text autolinkers
 *   routinely stop the link at the wrap, so a URL that runs to several
 *   thousand characters arrives broken far more often than it arrives whole.
 *
 * Measured against real payloads: the bundled CDC 2019-nCoV_N1 assay (three
 * oligos, three sites, a date range) encodes to 910 characters, 45% of the
 * budget, and about 1000 once a handful of country and lineage filters are
 * added. The plan's 200-oligo payload encodes to 25,638 and is refused. Both
 * facts hold with room to spare, which is the point of checking them rather
 * than picking a number that hides the problem.
 *
 * Refusing is the right failure: a truncated link does not error, it decodes
 * to nothing or -- worse -- to a shorter, valid-looking query.
 */
export const MAX_PERMALINK_LENGTH = 2000;

const ROLES: readonly string[] = ['forward', 'reverse', 'probe'];
const STRANDS: readonly string[] = ['plus', 'minus'];
const PATHOGEN_IDS: readonly string[] = Object.keys(PATHOGENS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects a record carrying any key we do not read.
 *
 * An unknown key is not harmless: it is either a link from a version that
 * knows something this one does not (so this version cannot honour it), or
 * something a sender added hoping a later version would. Either way the honest
 * answer is that this build cannot reproduce that analysis.
 */
function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isPathogenId(value: unknown): value is PathogenId {
  return typeof value === 'string' && PATHOGEN_IDS.includes(value);
}

/**
 * A real calendar date in `yyyy-mm-dd`, the shape the scope controls and
 * `scopeToFilters` already assume.
 *
 * The shape test alone would accept `2021-02-31`, which LAPIS rejects with a
 * 400 the user cannot act on. Round-tripping through `Date` at UTC (the `Z` is
 * load-bearing: without it the host timezone decides whether the day survives)
 * is the cheapest way to also require the date to exist.
 */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * A sequence this app would itself have accepted at the paste box.
 *
 * `normalizeOligo` is the project's own validator, so a permalink cannot get a
 * string into a genomic query that a user could not have typed. The result is
 * compared back to the input rather than substituted for it: normalising
 * silently would be repairing a bad field into a good one, and `acgt` or
 * `ACGT NNN` arriving in a link is a sender bug worth reporting, not one worth
 * papering over.
 */
function isValidSequence(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let normalized: string;
  try {
    normalized = normalizeOligo(value);
  } catch {
    return false;
  }
  return (
    normalized === value &&
    normalized.length >= MIN_OLIGO_LENGTH &&
    normalized.length <= MAX_OLIGO_LENGTH
  );
}

function parseOligo(value: unknown): PermalinkOligo | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'role', 'sequence'])) return null;
  const { name, role, sequence } = value;
  if (!isNonEmptyString(name)) return null;
  if (typeof role !== 'string' || !ROLES.includes(role)) return null;
  if (!isValidSequence(sequence)) return null;
  return { name, role: role as OligoRole, sequence };
}

function parseSite(value: unknown): PermalinkSite | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['segment', 'strand', 'start'])) return null;
  const { segment, strand, start } = value;
  if (!isNonEmptyString(segment)) return null;
  if (typeof strand !== 'string' || !STRANDS.includes(strand)) return null;
  if (!isPositiveInteger(start)) return null;
  return { segment, strand: strand as Strand, start };
}

function parseScope(value: unknown): PermalinkScope | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['dateFrom', 'dateTo', 'countries', 'lineages'])) {
    return null;
  }
  const { dateFrom, dateTo, countries, lineages } = value;
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo)) return null;
  // The same rule "Run analysis" enforces. An inverted range is not a scope
  // the app will run, so a link carrying one is not reproducible.
  if (dateTo < dateFrom) return null;
  if (!isStringArray(countries) || !isStringArray(lineages)) return null;
  return { dateFrom, dateTo, countries, lineages };
}

/**
 * The state as a URL hash fragment: JSON, then `encodeURIComponent`.
 *
 * Deliberately neither compressed nor base64-encoded. Someone who receives one
 * of these in an email can read what it asks for -- the pathogen, the
 * sequences, the dates -- before deciding whether to open it, and that is worth
 * more than the characters the encoding would save.
 *
 * @throws if the result exceeds {@link MAX_PERMALINK_LENGTH}, or if two oligos
 * share a name (the site map is keyed by name, so it could not describe both).
 */
export function encodePermalink(state: PermalinkState): string {
  const names = state.oligos.map((o) => o.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Cannot build a link: two oligos share a name, so their sites cannot both be recorded.');
  }
  const hash = PERMALINK_PREFIX + encodeURIComponent(JSON.stringify(state));
  if (hash.length > MAX_PERMALINK_LENGTH) {
    throw new Error(
      `This analysis is too large to put in a link: ${hash.length} characters, and the limit is ${MAX_PERMALINK_LENGTH}.`,
    );
  }
  return hash;
}

/**
 * A hash fragment back into state, or `null` if anything about it is wrong.
 * Never throws.
 *
 * Everything here treats the input as hostile, because it is: this is the one
 * place in the app where a stranger's string chooses a pathogen, supplies the
 * sequences that go into a genomic query, and sets filters that appear on
 * screen as if the user had picked them. So every field is validated rather
 * than merely parsed, unknown fields are refused, and a single bad field
 * rejects the whole link -- there is no partially-trusted return value, and
 * nothing is quietly repaired. The caller's fallback is the app's ordinary
 * empty first screen.
 */
export function decodePermalink(hash: string): PermalinkState | null {
  try {
    if (!hash.startsWith(PERMALINK_PREFIX)) return null;
    // Anything longer than we would ever emit is either truncated, tampered
    // with, or an attempt to make `JSON.parse` do the work. Refuse before
    // parsing, not after.
    if (hash.length > MAX_PERMALINK_LENGTH) return null;

    const parsed: unknown = JSON.parse(decodeURIComponent(hash.slice(PERMALINK_PREFIX.length)));
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['pathogenId', 'oligos', 'sites', 'scope'])) {
      return null;
    }

    const { pathogenId, oligos: rawOligos, sites: rawSites, scope: rawScope } = parsed;
    if (!isPathogenId(pathogenId)) return null;
    if (!Array.isArray(rawOligos) || rawOligos.length === 0) return null;

    const oligos: PermalinkOligo[] = [];
    for (const raw of rawOligos) {
      const oligo = parseOligo(raw);
      if (oligo === null) return null;
      oligos.push(oligo);
    }
    const names = oligos.map((o) => o.name);
    // The site map is keyed by name, so duplicate names make it ambiguous.
    if (new Set(names).size !== names.length) return null;

    if (!isRecord(rawSites)) return null;
    // Exactly one site per oligo, and no site for anything else. A missing one
    // would not fail: the oligo would silently drop out of the analysis, and
    // the link would claim to reproduce a result it had quietly narrowed.
    if (!hasOnlyKeys(rawSites, names)) return null;
    const sites: Record<string, PermalinkSite> = {};
    for (const name of names) {
      const site = parseSite(rawSites[name]);
      if (site === null) return null;
      sites[name] = site;
    }

    const scope = parseScope(rawScope);
    if (scope === null) return null;

    return { pathogenId, oligos, sites, scope };
  } catch {
    // Malformed percent-escapes (URIError) and bad JSON (SyntaxError) both
    // land here. A link is untrusted input; it does not get to throw.
    return null;
  }
}
