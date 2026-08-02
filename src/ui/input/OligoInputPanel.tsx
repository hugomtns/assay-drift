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
 * parse (`buildOligoKeys`) -- e.g. the first "ACGT..." entry is
 * `ACGT...::0`, a second identical one is `ACGT...::1`. On each debounced
 * commit we reapply a remembered role only to whichever *current* oligo
 * resolves to that same key, at whatever id it currently holds. A
 * remembered role whose key no longer resolves to any current oligo (its
 * sequence is gone, or there are now fewer same-sequence occurrences) is
 * simply never reapplied.
 */
function buildOligoKeys(oligos: ReadonlyArray<{ id: string; sequence: string }>): Map<string, string> {
  const occurrenceCounts = new Map<string, number>();
  const keysByOligoId = new Map<string, string>();
  for (const oligo of oligos) {
    const occurrence = occurrenceCounts.get(oligo.sequence) ?? 0;
    occurrenceCounts.set(oligo.sequence, occurrence + 1);
    keysByOligoId.set(oligo.id, `${oligo.sequence}::${occurrence}`);
  }
  return keysByOligoId;
}

export function OligoInputPanel() {
  const [text, setText] = useState('');
  const roles = useAppStore((s) => s.roles);
  const setOligos = useAppStore((s) => s.setOligos);
  const setRole = useAppStore((s) => s.setRole);
  const manualRolesByKeyRef = useRef<Record<string, OligoRole>>({});

  const parsed = useMemo(() => parseOligoText(text), [text]);
  const oligoKeys = useMemo(() => buildOligoKeys(parsed.oligos), [parsed]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOligos(parsed.oligos);
      for (const oligo of parsed.oligos) {
        const key = oligoKeys.get(oligo.id);
        const manualRole = key === undefined ? undefined : manualRolesByKeyRef.current[key];
        if (manualRole !== undefined) setRole(oligo.id, manualRole);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [parsed, oligoKeys, setOligos, setRole]);

  const handleRoleChange = (oligoId: string, role: OligoRole) => {
    const key = oligoKeys.get(oligoId);
    if (key !== undefined) manualRolesByKeyRef.current[key] = role;
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
