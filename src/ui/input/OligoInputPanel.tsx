import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseOligoText, type OligoRole } from '../../core/oligo-input';
import { useAppStore } from '../../state/store';
import { RoleSelector } from './RoleSelector';

const DEBOUNCE_MS = 200;

/** The always-mounted region carrying the reason `Continue` will not advance. */
const CONTINUE_BLOCKED_ID = 'oligo-continue-blocked';

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
 * *every* remembered role for any sequence whose count changed while more
 * than one entry carried it on either side of the change. Losing a role is
 * loud and harmless (the entry shows "Choose a role" and "Continue" stays
 * disabled until the user re-picks); silently moving one onto an oligo the
 * user never chose it for is neither. Counts moving only between 0 and 1
 * are never ambiguous and never purge, so a role outlives its sequence
 * going transiently invalid mid-typing.
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
 * Drops every remembered role for a sequence whose occurrence count became
 * *ambiguous* since the previous parse -- that is, the count changed **and**
 * more than one entry carried that sequence on at least one side of the
 * change. Mutates `manualRoles` in place.
 *
 * The `> 1` half of the condition matters: occurrence rank is the only thing
 * distinguishing same-sequence entries, and it only distinguishes anything
 * once there are two of them. While a sequence's count stays at 0 or 1 there
 * is nothing to confuse -- the sole rank that can be cached is 0 (caching a
 * higher rank requires a parse with two or more occurrences, and every move
 * away from such a count purges), and the only entry it can ever be applied
 * to is the unique occurrence of that exact sequence. Purging on 1 -> 0 as
 * well would throw a role away every time the user's typing makes a sequence
 * transiently invalid (a stray character sends the entry to `errors`) or
 * cuts and re-pastes a line, which is loss with nothing gained.
 *
 * Every genuinely ambiguous move still purges: 1 -> 2 (the new occurrence
 * could have been inserted on either side of the old one), 2 -> 1 (deleting
 * the first of two identical lines leaves text byte-identical to deleting
 * the second), 2 -> 3, 2 -> 0, and so on. A count that reaches 2 by way of
 * 1 -> 0 -> 2 purges on the second step, before two occurrences can exist to
 * inherit a stale rank.
 */
function reconcileManualRoles(
  manualRoles: Map<string, Map<number, OligoRole>>,
  previousCounts: ReadonlyMap<string, number>,
  currentCounts: ReadonlyMap<string, number>,
): void {
  for (const sequence of manualRoles.keys()) {
    const previous = previousCounts.get(sequence) ?? 0;
    const current = currentCounts.get(sequence) ?? 0;
    if (previous !== current && Math.max(previous, current) > 1) {
      manualRoles.delete(sequence);
    }
  }
}

export function OligoInputPanel() {
  const [text, setText] = useState('');
  const roles = useAppStore((s) => s.roles);
  const setOligos = useAppStore((s) => s.setOligos);
  const setRole = useAppStore((s) => s.setRole);
  const goTo = useAppStore((s) => s.goTo);
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

  /**
   * Writes the parse currently on screen into the store. Idempotent for a
   * given parse, so running it early (from `handleContinue`) and then again
   * from a later debounce would produce the same store -- but see `flush`,
   * which cancels the pending timer so it does not run twice at all.
   */
  const commit = useCallback(() => {
    setOligos(parsed.oligos);
    for (const oligo of parsed.oligos) {
      const key = keysByOligoId.get(oligo.id);
      if (key === undefined) continue;
      const manualRole = manualRolesRef.current.get(key.sequence)?.get(key.occurrence);
      if (manualRole !== undefined) setRole(oligo.id, manualRole);
    }
  }, [parsed, keysByOligoId, setOligos, setRole]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      timerRef.current = null;
      commit();
    }, DEBOUNCE_MS);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (timerRef.current === timer) timerRef.current = null;
    };
  }, [commit]);

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

  /**
   * Why `Continue` will not advance, or `''` when it will.
   *
   * The button is `aria-disabled` rather than `disabled` (Task 6.2), so it
   * keeps its place in the tab order and can be focused to find out what is
   * missing. The oligos are named: "choose a role" with three on screen is not
   * an instruction anyone can act on without hunting.
   */
  const roleless = parsed.oligos
    .filter((oligo) => effectiveRole(oligo.id, oligo.role) === undefined)
    .map((oligo) => oligo.name);
  const blockedReason =
    parsed.oligos.length === 0
      ? 'Paste at least one oligo above before continuing.'
      : roleless.length > 0
        ? `Every oligo needs a role before this step can continue. Still waiting on: ${roleless.join(', ')}.`
        : '';

  /**
   * Leaving this step is the first moment anything reads `oligos` and `roles`
   * for real, and for up to DEBOUNCE_MS after the last keystroke they still
   * describe the *previous* parse. A user who pastes and immediately clicks
   * Continue would otherwise resolve binding sites for oligos that are no
   * longer on screen -- a complete, plausible, wrong answer.
   *
   * So the pending commit is flushed synchronously and its timer cancelled
   * before we navigate. Shortening the debounce would only narrow the window;
   * only writing before the read closes it. Cancelling matters as much as
   * flushing: a timer that survives the navigation would call `setOligos`
   * again from step 2, and `setOligos` clears `chosenSites` -- silently
   * emptying the sites step 2 had just resolved.
   */
  const handleContinue = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    commit();
    goTo('binding');
  };

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

      {/* Always mounted, text swapped in; see BindingResolution for why. */}
      <p id={CONTINUE_BLOCKED_ID} role="status">
        {blockedReason}
      </p>

      <button
        type="button"
        aria-disabled={!canContinue}
        aria-describedby={canContinue ? undefined : CONTINUE_BLOCKED_ID}
        onClick={() => {
          if (canContinue) handleContinue();
        }}
      >
        Continue
      </button>
    </section>
  );
}
