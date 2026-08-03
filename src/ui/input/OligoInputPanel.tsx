import { useEffect, useMemo, useRef, useState } from 'react';
import { parseOligoText, type OligoRole } from '../../core/oligo-input';
import { useAppStore } from '../../state/store';
import { RoleSelector } from './RoleSelector';

const DEBOUNCE_MS = 200;

/**
 * Step 1 of the wizard: paste FASTA or bare-line oligo sequences, see them
 * parsed with guessed roles, fix any role that couldn't be guessed, and
 * review parse errors without losing the entries that did parse.
 *
 * Parsing itself runs synchronously off the textarea's local state so the
 * preview (names, lengths, errors, role selects) always matches what's on
 * screen. Only the write into the shared store -- which reseeds `roles`
 * from the fresh guesses and clears downstream analysis state -- is
 * debounced, so rapid keystrokes don't churn global state.
 *
 * `setOligos` (from the store) fully replaces `roles` with only the
 * freshly-guessed ones, so a manually-picked role would otherwise be wiped
 * out by the next debounced commit triggered by an unrelated textarea edit.
 * `manualRolesByKeyRef` remembers every role a user explicitly chose via
 * `RoleSelector`, and each debounced commit reapplies them straight after
 * `setOligos`, so an explicit choice survives later edits elsewhere in the
 * text.
 *
 * Crucially, `oligoId` (`oligo-${index}` from `parseOligoText`) is a
 * positional id, not a stable identity -- editing the text can make a
 * *different* oligo land at the same index a previous one occupied (e.g.
 * selecting all and pasting fresh content). Keying purely by `sequence`
 * isn't enough either: two distinct entries can share an identical
 * sequence (e.g. two bare lines with the same content), and would then
 * collide on one key. So each oligo's key is its sequence *plus* its
 * 0-based occurrence rank among same-sequence entries within that same
 * parse (`indexParse`) -- the first "ACGT..." entry is occurrence 0 of
 * "ACGT...", a second identical one is occurrence 1. On each debounced
 * commit we reapply a remembered role only to whichever *current* oligo
 * resolves to that same key, at whatever id it currently holds.
 *
 * That key is still not an identity: occurrence ranks are recomputed from
 * scratch on every parse, so when the *number* of entries sharing a
 * sequence changes, the surviving (or newly inserted) entries take over
 * ranks that were recorded for other entries. Deleting the first of two
 * identical bare lines leaves text byte-identical to deleting the second,
 * so no function of the resulting text can say which entry survived --
 * the ambiguity is genuine, not a keying oversight. Rather than guess, we
 * fail safe: `reconcileManualRoles` compares each parse's per-sequence
 * occurrence counts against the immediately previous parse's, and forgets
 * *every* remembered role for any sequence whose count changed. Losing a
 * role is loud and harmless (the entry shows "Choose a role" and
 * "Continue" stays disabled until the user re-picks); silently moving one
 * onto an oligo the user never chose it for is neither.
 *
 * Reconciliation is cumulative -- it runs on every parse change, eagerly
 * in an effect declared *before* the debounced commit effect (effects run
 * in declaration order), never inside the debounce. So the cache is
 * always in sync with the parse currently on screen before the user can
 * record a choice against it, and a count that goes 2 -> 1 -> 2 within one
 * debounce window still purges, which comparing only the endpoints would
 * miss.
 */
interface OligoKey {
  sequence: string;
  occurrence: number;
}

interface ParseIndex {
  /** Current key (sequence + occurrence rank) for each oligo id in this parse. */
  keysByOligoId: Map<string, OligoKey>;
  /** How many entries in this parse carry each distinct sequence. */
  countsBySequence: Map<string, number>;
}

function indexParse(oligos: ReadonlyArray<{ id: string; sequence: string }>): ParseIndex {
  const countsBySequence = new Map<string, number>();
  const keysByOligoId = new Map<string, OligoKey>();
  for (const oligo of oligos) {
    const occurrence = countsBySequence.get(oligo.sequence) ?? 0;
    countsBySequence.set(oligo.sequence, occurrence + 1);
    keysByOligoId.set(oligo.id, { sequence: oligo.sequence, occurrence });
  }
  return { keysByOligoId, countsBySequence };
}

/**
 * Drops every remembered role for any sequence whose number of occurrences
 * changed since the previous parse -- their occurrence ranks now refer to
 * different entries than the ones the user chose those roles for. Mutates
 * `manualRoles` in place.
 */
function reconcileManualRoles(
  manualRoles: Map<string, Map<number, OligoRole>>,
  previousCounts: ReadonlyMap<string, number>,
  currentCounts: ReadonlyMap<string, number>,
): void {
  for (const sequence of manualRoles.keys()) {
    if ((previousCounts.get(sequence) ?? 0) !== (currentCounts.get(sequence) ?? 0)) {
      manualRoles.delete(sequence);
    }
  }
}

export function OligoInputPanel() {
  const [text, setText] = useState('');
  const roles = useAppStore((s) => s.roles);
  const setOligos = useAppStore((s) => s.setOligos);
  const setRole = useAppStore((s) => s.setRole);
  /** Roles the user picked explicitly: sequence -> occurrence rank -> role. */
  const manualRolesRef = useRef<Map<string, Map<number, OligoRole>>>(new Map());
  /** Per-sequence occurrence counts of the last parse we reconciled against. */
  const previousCountsRef = useRef<ReadonlyMap<string, number>>(new Map());

  const parsed = useMemo(() => parseOligoText(text), [text]);
  const { keysByOligoId, countsBySequence } = useMemo(() => indexParse(parsed.oligos), [parsed]);

  // Declared before the debounced commit so it runs first on every parse
  // change: the remembered roles are always reconciled against the parse the
  // user is looking at before any choice can be recorded against it.
  useEffect(() => {
    reconcileManualRoles(manualRolesRef.current, previousCountsRef.current, countsBySequence);
    previousCountsRef.current = countsBySequence;
  }, [countsBySequence]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOligos(parsed.oligos);
      for (const oligo of parsed.oligos) {
        const key = keysByOligoId.get(oligo.id);
        if (key === undefined) continue;
        const manualRole = manualRolesRef.current.get(key.sequence)?.get(key.occurrence);
        if (manualRole !== undefined) setRole(oligo.id, manualRole);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [parsed, keysByOligoId, setOligos, setRole]);

  const handleRoleChange = (oligoId: string, role: OligoRole) => {
    const key = keysByOligoId.get(oligoId);
    if (key !== undefined) {
      const rolesByOccurrence =
        manualRolesRef.current.get(key.sequence) ?? new Map<number, OligoRole>();
      rolesByOccurrence.set(key.occurrence, role);
      manualRolesRef.current.set(key.sequence, rolesByOccurrence);
    }
    setRole(oligoId, role);
  };

  const effectiveRole = (oligoId: string, guessed: OligoRole | null): OligoRole | undefined =>
    roles[oligoId] ?? guessed ?? undefined;

  const canContinue =
    parsed.oligos.length > 0 &&
    parsed.oligos.every((oligo) => effectiveRole(oligo.id, oligo.role) !== undefined);

  return (
    <section aria-labelledby="oligo-input-heading">
      <h2 id="oligo-input-heading">Step 1: Enter your oligos</h2>
      <label htmlFor="oligo-textarea">Paste your oligos</label>
      {/*
        Deliberately uncontrolled: React keeps a controlled <textarea>'s DOM
        text content mirrored to `value` on every render (to preserve
        selection across updates), which would make the raw pasted text
        queryable via getByText alongside our own rendered output. Reading
        onChange without feeding `value` back avoids that duplication.
      */}
      <textarea id="oligo-textarea" onChange={(e) => setText(e.target.value)} rows={8} />

      {parsed.errors.length > 0 && (
        <ul aria-label="Parse errors">
          {parsed.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <ul aria-label="Parsed oligos">
        {parsed.oligos.map((oligo) => {
          const role = effectiveRole(oligo.id, oligo.role);
          return (
            <li key={oligo.id}>
              <span>{oligo.name}</span> <span>{oligo.sequence.length} nt</span>
              <RoleSelector oligoId={oligo.id} name={oligo.name} role={role} onChange={handleRoleChange} />
              {role === undefined && <span>Choose a role for this oligo.</span>}
            </li>
          );
        })}
      </ul>

      <button type="button" disabled={!canContinue}>
        Continue
      </button>
    </section>
  );
}
