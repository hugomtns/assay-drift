/**
 * The next version, derived from the Conventional Commit messages since the
 * last release tag.
 *
 * This project already writes Conventional Commits for every change, so the
 * information needed to pick a version number is already in the history and
 * nobody should have to remember to act on it. A version somebody has to
 * remember to bump is a version that is silently wrong, and this one is not
 * decorative: `TOOL_VERSION` is read from `package.json` into the methods
 * paragraph that users paste into documents to say what produced a number.
 *
 * The rules are the conventional ones:
 *
 * - a `!` after the type (`feat!:`) or a `BREAKING CHANGE:` trailer -> major
 * - any `feat:` -> minor
 * - anything else (`fix`, `perf`, `docs`, `test`, `chore`, `refactor`) -> patch
 *
 * Patch rather than "no release" for a docs-only push is deliberate. Every push
 * to `main` deploys, so every push produces an artefact someone could cite; if
 * two different artefacts can call themselves the same version, the version has
 * stopped identifying anything. A slightly inflated patch number is a much
 * smaller problem than an ambiguous one.
 *
 * Prints the version to stdout and nothing else, so a workflow can capture it.
 * `--explain` prints the reasoning to stderr instead of staying quiet.
 */
import { execFileSync } from 'node:child_process';

const explain = process.argv.includes('--explain');

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function note(message: string): void {
  if (explain) console.error(message);
}

/** The most recent `vX.Y.Z` tag, or null when nothing has been released yet. */
function lastTag(): string | null {
  try {
    // --abbrev=0 gives the tag name alone; the match keeps stray tags out.
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
  } catch {
    return null;
  }
}

export interface Bump {
  level: 'major' | 'minor' | 'patch';
  reason: string;
}

export function classify(subjects: string[], bodies: string): Bump {
  // `feat!:`, `fix(scope)!:` -- the `!` is the breaking marker wherever the
  // optional scope sits.
  const breaking = subjects.find((s) => /^[a-z]+(\([^)]*\))?!:/.test(s));
  if (breaking !== undefined) return { level: 'major', reason: `breaking change: ${breaking}` };
  if (/^BREAKING CHANGE:/m.test(bodies)) {
    return { level: 'major', reason: 'a commit body carries a BREAKING CHANGE trailer' };
  }

  const feature = subjects.find((s) => /^feat(\([^)]*\))?:/.test(s));
  if (feature !== undefined) return { level: 'minor', reason: `new feature: ${feature}` };

  return { level: 'patch', reason: `${String(subjects.length)} commit(s), none adding a feature` };
}

export function bump(version: string, level: Bump['level']): string {
  const parts = version.split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`not a semver version: ${version}`);
  }
  if (level === 'major') return `${String(major + 1)}.0.0`;
  if (level === 'minor') return `${String(major)}.${String(minor + 1)}.0`;
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/** Only run the CLI flow when invoked directly, so tests can import the rules. */
const isCli = process.argv[1] !== undefined && /next-version\.ts$/.test(process.argv[1]);

if (isCli) {
  const tag = lastTag();
  const range = tag === null ? 'HEAD' : `${tag}..HEAD`;
  note(`Last release tag: ${tag ?? '(none)'}`);

  const log = git('log', range, '--format=%s%n%b%n--%%--');
  const commits = log
    .split('--%--')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  if (commits.length === 0) {
    note('No commits since the last tag; nothing to release.');
    console.log('');
    process.exit(0);
  }

  const subjects = commits.map((c) => (c.split('\n')[0] ?? '').trim());
  const decision = classify(subjects, log);
  const current = tag === null ? '0.0.0' : tag.replace(/^v/, '');
  const next = bump(current, decision.level);

  note(`${String(commits.length)} commit(s) since ${tag ?? 'the beginning'}`);
  note(`Bump: ${decision.level} -- ${decision.reason}`);
  note(`${current} -> ${next}`);

  console.log(next);
}
