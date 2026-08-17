/**
 * Build-time gate for the bundled assay library (Global Constraint 2).
 *
 * Parses src/data/assays/library.json, then re-verifies every assay against the
 * bundled reference genome: every oligo must resolve to a single site with at
 * most one mismatch, the primers must frame a plausible amplicon, and the
 * citation must carry a url and an accessed date. Exits non-zero if any entry
 * fails, or if the file does not parse.
 *
 * Run: npm run verify:assays [path/to/library.json]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseLibrary,
  verifyAssay,
  type LibraryAssay,
  type ResolvedOligo,
} from '../src/data/assays/schema.js';

const DEFAULT_PATH = join(process.cwd(), 'src', 'data', 'assays', 'library.json');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * The tolerance is one mismatch, so a single mistyped base still verifies. The
 * count is therefore printed for every oligo and flagged when non-zero: an oligo
 * the source says is exact must show 0 here, and anything else has to be
 * explained in docs/assay-sources.md before it ships.
 */
function oligoLine(r: ResolvedOligo): string {
  const where = `${r.segment}:${r.start}-${r.end} ${r.strand}`;
  const count = `${r.mismatches} mismatch${r.mismatches === 1 ? '' : 'es'}`;
  const flag = r.mismatches > 0 ? '  <-- CHECK against the cited source' : '';
  return `  ${pad(r.role, 7)}  ${pad(r.name, 12)}  ${pad(where, 26)}  ${count}${flag}`;
}

function main(): void {
  const path = process.argv[2] ?? DEFAULT_PATH;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    err(`Could not read ${path}: ${(e as Error).message}`);
    process.exit(1);
  }

  let library;
  try {
    library = parseLibrary(raw);
  } catch (e) {
    // The thrown message starts with the offending field path. Print it as-is;
    // a swallowed "failed" would tell whoever broke the file nothing at all.
    err(`Malformed assay library ${path}`);
    err(`  ${(e as Error).message}`);
    process.exit(1);
  }

  out(`Assay library ${path} (version ${library.version})`);

  if (library.assays.length === 0) {
    out('Verified zero assays: the library is empty. Nothing was checked.');
    process.exit(0);
  }

  const rows: {
    assay: LibraryAssay;
    ok: boolean;
    problems: string[];
    resolved: ResolvedOligo[];
  }[] = library.assays.map((assay) => ({ assay, ...verifyAssay(assay) }));

  const idWidth = Math.max(2, ...rows.map((r) => r.assay.id.length));
  const pathogenWidth = Math.max(8, ...rows.map((r) => r.assay.pathogenId.length));

  out('');
  out(`${pad('ID', idWidth)}  ${pad('PATHOGEN', pathogenWidth)}  OLIGOS  RESULT`);
  for (const row of rows) {
    out(
      `${pad(row.assay.id, idWidth)}  ${pad(row.assay.pathogenId, pathogenWidth)}  ` +
        `${pad(String(row.assay.oligos.length), 6)}  ${row.ok ? 'OK' : 'FAIL'}`,
    );
  }

  for (const row of rows) {
    out('');
    out(`${row.assay.id} (${row.assay.name}) -> ${row.assay.citation.url}`);
    for (const r of row.resolved) out(oligoLine(r));
  }

  const inexact = rows.flatMap((r) => r.resolved).filter((r) => r.mismatches > 0);
  const failed = rows.filter((r) => !r.ok);
  out('');
  if (failed.length === 0) {
    out(`Verified ${rows.length} assay${rows.length === 1 ? '' : 's'}: all OK.`);
    if (inexact.length > 0) {
      out(
        `${inexact.length} oligo${inexact.length === 1 ? ' binds' : 's bind'} with a mismatch ` +
          `(${inexact.map((r) => r.name).join(', ')}). Confirm each against its cited source ` +
          `and record the mismatch in docs/assay-sources.md.`,
      );
    }
    return;
  }

  for (const row of failed) {
    err(`${row.assay.id} (${row.assay.name}):`);
    for (const problem of row.problems) err(`  - ${problem}`);
  }
  err(`${failed.length} of ${rows.length} assays failed verification.`);
  process.exit(1);
}

main();
