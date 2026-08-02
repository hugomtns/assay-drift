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
 * `manualRolesRef` remembers every role a user explicitly chose via
 * `RoleSelector`, and each debounced commit reapplies them straight after
 * `setOligos`, so an explicit choice survives later edits elsewhere in the
 * text.
 *
 * Crucially, `oligoId` (`oligo-${index}` from `parseOligoText`) is a
 * positional id, not a stable identity -- editing the text can make a
 * *different* oligo land at the same index a previous one occupied (e.g.
 * selecting all and pasting fresh content). So `manualRolesRef` is keyed by
 * the oligo's `sequence` (its actual content) rather than its id: on each
 * debounced commit we only reapply a remembered role to whichever *current*
 * oligo still has that exact sequence, at whatever id it currently holds.
 * A remembered role for a sequence no longer present in the parsed output
 * is simply never reapplied.
 */
export function OligoInputPanel() {
  const [text, setText] = useState('');
  const roles = useAppStore((s) => s.roles);
  const setOligos = useAppStore((s) => s.setOligos);
  const setRole = useAppStore((s) => s.setRole);
  const manualRolesBySequenceRef = useRef<Record<string, OligoRole>>({});

  const parsed = useMemo(() => parseOligoText(text), [text]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOligos(parsed.oligos);
      for (const oligo of parsed.oligos) {
        const manualRole = manualRolesBySequenceRef.current[oligo.sequence];
        if (manualRole !== undefined) setRole(oligo.id, manualRole);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [parsed, setOligos, setRole]);

  const handleRoleChange = (oligoId: string, role: OligoRole) => {
    const oligo = parsed.oligos.find((o) => o.id === oligoId);
    if (oligo !== undefined) manualRolesBySequenceRef.current[oligo.sequence] = role;
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
