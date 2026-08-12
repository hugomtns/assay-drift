/**
 * The bundled assay library: its shape, its parser, and the verification gate
 * that stands between a mistyped primer and a published percentage.
 *
 * `parseLibrary` checks structure only. `verifyAssay` checks biology. They are
 * deliberately separate: a library entry can be perfectly well-formed JSON and
 * still be nonsense against the reference, and the CI gate needs to be able to
 * say which of the two went wrong.
 */
import { normalizeOligo } from '../../core/iupac';
import { PATHOGENS, type PathogenId } from '../../core/registry';
import type { OligoRole } from '../../core/oligo-input';
import { resolveBindingSite } from '../../core/resolution';
import { checkAssayGeometry } from '../../core/assay-geometry';
import type { BindingSite } from '../../core/binding';
import { loadReference } from '../references';

/** A library oligo always carries a role; unlike user input, it is never null. */
export interface LibraryOligo {
  name: string;
  role: OligoRole;
  sequence: string;
}

export interface LibraryCitation {
  title: string;
  source: string;
  url: string;
  accessed: string;
}

export interface LibraryAssay {
  id: string;
  name: string;
  pathogenId: PathogenId;
  target: string;
  oligos: LibraryOligo[];
  citation: LibraryCitation;
  notes?: string;
}

export interface AssayLibrary {
  version: string;
  assays: LibraryAssay[];
}

export interface AssayVerification {
  ok: boolean;
  problems: string[];
}

/** A library oligo must land on one site with at most this many mismatches. */
export const MAX_LIBRARY_MISMATCHES = 1;

const ROLES: readonly OligoRole[] = ['forward', 'reverse', 'probe'];

// ---------------------------------------------------------------------------
// parseLibrary — structure only, hand-written so every message carries a path
// ---------------------------------------------------------------------------

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, `expected an array, got ${describe(value)}`);
  return value;
}

function asNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, `expected a string, got ${describe(value)}`);
  if (value.trim() === '') fail(path, 'expected a non-empty string');
  return value;
}

function asOptionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(path, `expected a string, got ${describe(value)}`);
  return value;
}

function asPathogenId(value: unknown, path: string): PathogenId {
  const id = asNonEmptyString(value, path);
  if (!Object.prototype.hasOwnProperty.call(PATHOGENS, id)) {
    fail(path, `unknown pathogenId "${id}"; expected one of ${Object.keys(PATHOGENS).join(', ')}`);
  }
  return id as PathogenId;
}

function asRole(value: unknown, path: string): OligoRole {
  const role = asNonEmptyString(value, `${path}.role`);
  if (!ROLES.includes(role as OligoRole)) {
    fail(`${path}.role`, `unknown role "${role}"; expected one of ${ROLES.join(', ')}`);
  }
  return role as OligoRole;
}

function asSequence(value: unknown, path: string): string {
  const raw = asNonEmptyString(value, `${path}.sequence`);
  try {
    return normalizeOligo(raw);
  } catch (err) {
    fail(`${path}.sequence`, (err as Error).message);
  }
}

function parseOligo(raw: unknown, path: string): LibraryOligo {
  const obj = asObject(raw, path);
  return {
    name: asNonEmptyString(obj['name'], `${path}.name`),
    role: asRole(obj['role'], path),
    sequence: asSequence(obj['sequence'], path),
  };
}

function parseCitation(raw: unknown, path: string): LibraryCitation {
  const obj = asObject(raw, path);
  return {
    title: asNonEmptyString(obj['title'], `${path}.title`),
    source: asNonEmptyString(obj['source'], `${path}.source`),
    url: asOptionalString(obj['url'], `${path}.url`) ?? '',
    accessed: asOptionalString(obj['accessed'], `${path}.accessed`) ?? '',
  };
}

function parseAssay(raw: unknown, path: string): LibraryAssay {
  const obj = asObject(raw, path);
  const oligosRaw = asArray(obj['oligos'], `${path}.oligos`);
  const assay: LibraryAssay = {
    id: asNonEmptyString(obj['id'], `${path}.id`),
    name: asNonEmptyString(obj['name'], `${path}.name`),
    pathogenId: asPathogenId(obj['pathogenId'], `${path}.pathogenId`),
    target: asNonEmptyString(obj['target'], `${path}.target`),
    oligos: oligosRaw.map((o, i) => parseOligo(o, `${path}.oligos[${i}]`)),
    citation: parseCitation(obj['citation'], `${path}.citation`),
  };
  const notes = asOptionalString(obj['notes'], `${path}.notes`);
  return notes === undefined ? assay : { ...assay, notes };
}

/** Throws an Error whose message begins with the field path that went wrong. */
export function parseLibrary(raw: unknown): AssayLibrary {
  const obj = asObject(raw, 'library');
  const assaysRaw = asArray(obj['assays'], 'assays');
  const library: AssayLibrary = {
    version: asNonEmptyString(obj['version'], 'version'),
    assays: assaysRaw.map((a, i) => parseAssay(a, `assays[${i}]`)),
  };
  const seen = new Set<string>();
  for (const [i, assay] of library.assays.entries()) {
    if (seen.has(assay.id)) fail(`assays[${i}].id`, `duplicate assay id "${assay.id}"`);
    seen.add(assay.id);
  }
  return library;
}

// ---------------------------------------------------------------------------
// verifyAssay — biology. Geometry is delegated to checkAssayGeometry.
// ---------------------------------------------------------------------------

/**
 * Resolves every oligo against the bundled reference, then hands the primers to
 * `checkAssayGeometry` and folds its problems in. Never throws: a library entry
 * that cannot be checked is a failed entry, not a crashed gate.
 */
export function verifyAssay(assay: LibraryAssay): AssayVerification {
  const problems: string[] = [];

  if (assay.citation.url.trim() === '') {
    problems.push(`${assay.id}: citation is missing a url.`);
  }
  if (assay.citation.accessed.trim() === '') {
    problems.push(`${assay.id}: citation is missing an accessed date.`);
  }

  let ref;
  try {
    ref = loadReference(assay.pathogenId);
  } catch (err) {
    problems.push(`${assay.id}: ${(err as Error).message}`);
    return { ok: false, problems };
  }

  const sites = new Map<LibraryOligo, BindingSite>();
  for (const oligo of assay.oligos) {
    let resolution;
    try {
      resolution = resolveBindingSite(oligo.sequence, ref, {
        maxMismatches: MAX_LIBRARY_MISMATCHES,
      });
    } catch (err) {
      problems.push(`${oligo.name}: ${(err as Error).message}`);
      continue;
    }
    if (resolution.candidates.length === 0) {
      problems.push(
        `${oligo.name} does not bind the ${assay.pathogenId} reference within ${MAX_LIBRARY_MISMATCHES} mismatch.`,
      );
      continue;
    }
    if (resolution.candidates.length > 1 || resolution.chosen === null) {
      problems.push(
        `${oligo.name} binds ${resolution.candidates.length} sites equally well; a library oligo must resolve to exactly one site.`,
      );
      continue;
    }
    if (resolution.chosen.mismatches > MAX_LIBRARY_MISMATCHES) {
      problems.push(
        `${oligo.name} binds with ${resolution.chosen.mismatches} mismatches; at most ${MAX_LIBRARY_MISMATCHES} is allowed.`,
      );
      continue;
    }
    sites.set(oligo, resolution.chosen);
  }

  const byRole = (role: OligoRole): LibraryOligo[] => assay.oligos.filter((o) => o.role === role);
  const forwards = byRole('forward');
  const reverses = byRole('reverse');
  const probes = byRole('probe');

  for (const [role, group] of [
    ['forward', forwards],
    ['reverse', reverses],
    ['probe', probes],
  ] as const) {
    if (group.length > 1) {
      problems.push(`${assay.id}: ${group.length} oligos have role "${role}"; expected at most one.`);
    }
  }

  const forward = forwards[0];
  const reverse = reverses[0];
  if (forward === undefined) problems.push(`${assay.id}: no oligo has role "forward".`);
  if (reverse === undefined) problems.push(`${assay.id}: no oligo has role "reverse".`);

  if (forward !== undefined && reverse !== undefined) {
    const forwardSite = sites.get(forward);
    const reverseSite = sites.get(reverse);
    if (forwardSite && reverseSite) {
      const probe = probes[0];
      const probeSite = probe === undefined ? undefined : sites.get(probe);
      const geometry = checkAssayGeometry({
        forward: forwardSite,
        reverse: reverseSite,
        probe: probeSite,
      });
      problems.push(...geometry.problems);
    }
    // If a primer failed to resolve, its problem is already recorded above and
    // there is nothing meaningful left to say about the geometry.
  }

  return { ok: problems.length === 0, problems };
}
