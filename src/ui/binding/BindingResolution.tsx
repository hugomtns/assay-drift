import { useEffect, useMemo, useState } from 'react';
import { checkAssayGeometry, type GeometryCheck } from '../../core/assay-geometry';
import type { BindingSite } from '../../core/binding';
import type { OligoInput, OligoRole } from '../../core/oligo-input';
import { getPathogen } from '../../core/registry';
import { resolveBindingSite, type Resolution } from '../../core/resolution';
import { loadReference, referenceFetchedAt } from '../../data/references';
import { useAppStore } from '../../state/store';
import { formatCount } from '../format';
import { GenomeMap, type GenomeMapSite } from './GenomeMap';
import { committedSites, deriveBindingRows, siteKey } from './binding-view-model';

const ROLE_LABELS: Readonly<Record<OligoRole, string>> = {
  forward: 'Forward primer',
  reverse: 'Reverse primer',
  probe: 'Probe',
};

const STATUS_LABELS: Readonly<Record<Resolution['status'], string>> = {
  resolved: 'Located',
  ambiguous: 'Needs a choice',
  'no-hit': 'Not found',
  'highly-degenerate': 'Needs confirmation',
};

/** The always-mounted region carrying the reason `Continue` will not advance. */
const CONTINUE_BLOCKED_ID = 'binding-continue-blocked';

/**
 * The one place a coordinate is written out. 1-based inclusive on the
 * reference's plus strand for both strands (Global Constraint 3), which the
 * caption under the list states in words -- a bare pair of integers would be
 * indistinguishable from a 0-based half-open range.
 */
const describeSite = (site: BindingSite) =>
  `${site.segment}: ${formatCount(site.start)}–${formatCount(site.end)} (${site.strand} strand)`;

const describeMismatches = (site: BindingSite) =>
  site.mismatches === 1
    ? '1 mismatch against the reference'
    : `${site.mismatches} mismatches against the reference`;

interface OligoBindingRowProps {
  oligo: OligoInput;
  role: OligoRole | null;
  resolution: Resolution;
  /**
   * The raw site currently in the store for this oligo, if any. This is what
   * the row renders, which is deliberately *not* the same as "committed": an
   * untick leaves the store entry in place (there is no unchoose action), so
   * only the parent's derived `committed` view decides what counts. The user
   * must still see the coordinates of the site they are being asked to
   * confirm.
   */
  chosen: BindingSite | undefined;
  confirmed: boolean;
  onChoose: (site: BindingSite) => void;
  onConfirm: (confirmed: boolean) => void;
}

/**
 * One oligo's result. Kept a separate component rather than an inline
 * closure so the four states can be read side by side.
 */
function OligoBindingRow({
  oligo,
  role,
  resolution,
  chosen,
  confirmed,
  onChoose,
  onConfirm,
}: OligoBindingRowProps) {
  // A highly-degenerate site is *located* before it is *chosen*: the user has
  // to see the coordinates in order to confirm them, so the row displays
  // `resolution.chosen` while the store still holds nothing for this oligo.
  const located = chosen ?? resolution.chosen;
  // Offer the candidate list whenever the resolver declined to pick: that is
  // every ambiguous oligo, and also a degenerate one whose best score is tied.
  const needsChoice = resolution.chosen === null && resolution.candidates.length > 0;

  const notes =
    resolution.notes.length > 0 ? (
      <ul aria-label={`Notes for ${oligo.name}`} className="list-disc pl-5 text-sm text-slate-700">
        {resolution.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    ) : null;

  return (
    <li className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-slate-900">{oligo.name}</span>
        <span className="text-sm text-slate-600">
          {role === null ? 'Role not set' : ROLE_LABELS[role]}
        </span>
        <span className="text-sm text-slate-600">{oligo.sequence.length} nt</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {STATUS_LABELS[resolution.status]}
        </span>
        {located !== null && located !== undefined && (
          <span className="font-mono text-sm text-slate-900">{describeSite(located)}</span>
        )}
      </div>

      {located !== null && located !== undefined && (
        <>
          {located.mismatches > 0 && <p className="text-sm text-slate-600">{describeMismatches(located)}</p>}
        </>
      )}

      {needsChoice && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm text-slate-700">
            {`Choose the intended site for ${oligo.name}`}
          </legend>
          {resolution.candidates.map((candidate) => {
            const key = siteKey(candidate);
            return (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`site-${oligo.id}`}
                  value={key}
                  checked={chosen !== undefined && siteKey(chosen) === key}
                  onChange={() => onChoose(candidate)}
                />
                <span className="font-mono">{describeSite(candidate)}</span>
                <span className="text-slate-600">{describeMismatches(candidate)}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      {resolution.status === 'highly-degenerate' && (
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={located === null || located === undefined}
            onChange={(e) => onConfirm(e.target.checked)}
          />
          {`Confirm this site for ${oligo.name}`}
        </label>
      )}

      {resolution.status === 'no-hit' ? (
        <div role="alert" className="flex flex-col gap-1 rounded bg-red-50 p-2 text-red-900">
          <p className="text-sm font-medium">
            {`${oligo.name} could not be placed on the reference.`}
          </p>
          {notes}
        </div>
      ) : (
        notes
      )}
    </li>
  );
}

/**
 * Step 2 of the wizard: show the user *where* each oligo was found before
 * anything is computed from it. Every state is explicit; nothing is guessed
 * on the user's behalf.
 *
 * - resolved: a single best site, chosen automatically.
 * - ambiguous: the resolver refused to pick, so the candidates are offered as
 *   radios with nothing preselected. A silent pick here would silently choose
 *   which drift the user ends up looking at.
 * - no-hit: an error and a suggestion to check the pathogen -- never a
 *   nearest-miss location, which would look like an answer.
 * - highly-degenerate: located, but only counted as chosen once the user
 *   ticks "Confirm this site", because a heavily wildcarded oligo can match
 *   plausibly in more than one place for reasons the resolver cannot rank.
 *
 * `Continue` stays disabled until every oligo has a *committed* site, so no
 * later step can run on a site the user never agreed to.
 *
 * "Committed" is derived once, in `rows`, and is the only notion of agreement
 * the rest of the component uses -- `Continue`, the geometry check and the map
 * all read it rather than the store. That is not indirection for its own sake:
 * the store's `chooseSite` is a merge with no removal action, so unticking a
 * confirmation cannot take the site back out of `chosenSites`. Reading the raw
 * store would leave a retracted site still drawn on the map and still counted
 * in the geometry check while its checkbox showed unticked -- two renderings of
 * one checkbox state, differing only by history, in the step whose whole
 * purpose is telling the user what the tool believes. A stale entry does stay
 * in the store; it is unreachable, because every path out of this step runs
 * through `Continue`. Retracting it properly needs an action the store does not
 * have.
 *
 * Resolution scans the whole reference twice per oligo (once per strand), so
 * it is memoised on the oligo list and the reference and never re-run for a
 * re-render caused by a click. The resulting resolutions are written into the
 * store from an effect rather than during render, because later steps read
 * them from there.
 *
 * Confirmations are held locally, keyed by oligo id, sequence *and the site
 * they confirm*. The ids from `parseOligoText` are positional (`oligo-0`), so
 * a different oligo can inherit the id of one the user already confirmed;
 * adding the sequence closes that. Adding the site closes the rest: local
 * state survives `setPathogen`, which resets the store, so id+sequence alone
 * would show a ticked box for a site resolved against a different genome, and
 * the only way out would be to untick and retick. Keying on the site makes the
 * confirmation self-invalidate on an edit, on a pathogen change, and on any
 * re-resolution.
 *
 * The geometry check runs only when a forward and a reverse site are both
 * chosen, and its problems are rendered as warnings. It never blocks
 * `Continue`: a user may legitimately be checking a non-standard design, and
 * an unusual amplicon is a thing to point out, not to forbid.
 */
export function BindingResolution() {
  const pathogenId = useAppStore((s) => s.pathogenId);
  const oligos = useAppStore((s) => s.oligos);
  const roles = useAppStore((s) => s.roles);
  const chosenSites = useAppStore((s) => s.chosenSites);
  const setResolution = useAppStore((s) => s.setResolution);
  const chooseSite = useAppStore((s) => s.chooseSite);
  const commitSites = useAppStore((s) => s.commitSites);
  const goTo = useAppStore((s) => s.goTo);
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});

  const pathogen = getPathogen(pathogenId);
  const reference = useMemo(() => loadReference(pathogenId), [pathogenId]);
  const resolved = useMemo(
    () =>
      oligos.map((oligo) => ({ oligo, resolution: resolveBindingSite(oligo.sequence, reference) })),
    [oligos, reference],
  );

  useEffect(() => {
    for (const { oligo, resolution } of resolved) {
      setResolution(oligo.id, resolution);
      // Only an unambiguous, non-degenerate hit is chosen without the user.
      if (resolution.status === 'resolved' && resolution.chosen !== null) {
        chooseSite(oligo.id, resolution.chosen);
      }
    }
  }, [resolved, setResolution, chooseSite]);

  // Keyed by the site it confirms, not just by the oligo: `setPathogen` resets
  // the store but cannot clear this component's local state, so an id+sequence
  // key would leave the box ticked for a site that was resolved against a
  // different genome. Including the site makes the key self-invalidate on an
  // edit, on a pathogen change, and on any re-resolution.
  const confirmKey = (oligo: OligoInput, site: BindingSite) =>
    `${oligo.id}\0${oligo.sequence}\0${siteKey(site)}`;
  const isConfirmed = (oligo: OligoInput, site: BindingSite) =>
    confirmations[confirmKey(oligo, site)] === true;

  // The single definition of "the user has agreed to this site". `chooseSite`
  // is a merge with no removal action, so the store cannot forget a retracted
  // confirmation -- everything downstream (Continue, the geometry check, the
  // map) reads `committed` rather than `chosenSites`, so unticking the box
  // renders exactly like never having ticked it.
  const rows = deriveBindingRows(resolved, chosenSites, isConfirmed);

  const handleConfirm = (oligo: OligoInput, located: BindingSite | null, confirmed: boolean) => {
    if (located === null) return;
    setConfirmations((current) => ({ ...current, [confirmKey(oligo, located)]: confirmed }));
    // Unticking needs no store write: `committed` above already stops counting it.
    if (confirmed) chooseSite(oligo.id, located);
  };

  const canContinue = rows.length > 0 && rows.every((row) => row.committed !== null);

  /**
   * Why `Continue` will not advance, or `''` when it will.
   *
   * The button is `aria-disabled` rather than `disabled` (Task 6.2), so it
   * stays in the tab order -- which is only an improvement if focusing it
   * says something. Naming the oligos is the point: with several on screen,
   * "some site is missing" leaves the user hunting for which one.
   */
  const unplaced = rows.filter((row) => row.committed === null).map((row) => row.oligo.name);
  const blockedReason =
    rows.length === 0
      ? 'There are no oligos to place. Go back to step 1 and add some.'
      : unplaced.length > 0
        ? `Every oligo needs a binding site you have agreed to before this step can continue. Still waiting on: ${unplaced.join(', ')}.`
        : '';

  /**
   * The one write that makes the store agree with the screen.
   *
   * Up to this point `chosenSites` is a superset of what the user agreed to:
   * `chooseSite` merges and there is no unchoose, so a confirmation the user
   * ticked and then retracted is still in there, as is anything left by an
   * oligo list that has since changed. Everything downstream of this step
   * reads the store rather than `committed`, so leaving the step replaces the
   * map wholesale with exactly the committed set. `canContinue` guarantees
   * every current row is in it.
   */
  const handleContinue = () => {
    commitSites(committedSites(rows));
    goTo('scope');
  };

  const siteForRole = (role: OligoRole): BindingSite | undefined => {
    const match = rows.find((row) => (roles[row.oligo.id] ?? row.oligo.role) === role);
    return match?.committed ?? undefined;
  };
  const forward = siteForRole('forward');
  const reverse = siteForRole('reverse');
  const probe = siteForRole('probe');
  // Missing roles simply mean there is nothing to check yet.
  const geometry: GeometryCheck | null =
    forward !== undefined && reverse !== undefined
      ? checkAssayGeometry({ forward, reverse, probe })
      : null;

  // One map per segment that actually carries a committed site: influenza
  // references have eight segments, and empty bars for the other seven would
  // be noise.
  const sitesBySegment = new Map<string, GenomeMapSite[]>();
  for (const { oligo, committed } of rows) {
    if (committed === null) continue;
    const entry: GenomeMapSite = {
      label: oligo.name,
      start: committed.start,
      end: committed.end,
      strand: committed.strand,
    };
    const existing = sitesBySegment.get(committed.segment);
    if (existing === undefined) sitesBySegment.set(committed.segment, [entry]);
    else existing.push(entry);
  }
  const segmentLength = (name: string) =>
    reference.segments.find((segment) => segment.name === name)?.sequence.length ?? 0;

  return (
    <section aria-labelledby="binding-resolution-heading" className="flex flex-col gap-4">
      <h2 id="binding-resolution-heading" className="text-xl font-semibold">
        Step 2: Check the binding sites
      </h2>
      <details className="text-sm text-slate-700">
        <summary className="cursor-pointer font-medium text-slate-900">Reference details</summary>
        <p className="mt-2">{`Bundled ${pathogen.label} reference, snapshot ${referenceFetchedAt(pathogenId)}. Positions are 1-based, inclusive, and counted along the reference strand.`}</p>
      </details>

      {oligos.length === 0 ? (
        <p className="text-sm text-slate-700">No oligos yet. Go back to step 1 and add some.</p>
      ) : (
        <ul aria-label="Binding sites" className="flex flex-col gap-3">
          {rows.map(({ oligo, resolution, stored, located, confirmed }) => (
            <OligoBindingRow
              key={oligo.id}
              oligo={oligo}
              role={roles[oligo.id] ?? oligo.role}
              resolution={resolution}
              chosen={stored}
              confirmed={confirmed}
              onChoose={(site) => chooseSite(oligo.id, site)}
              onConfirm={(isConfirmedNow) => handleConfirm(oligo, located, isConfirmedNow)}
            />
          ))}
        </ul>
      )}

      {geometry !== null && (geometry.ampliconLength !== null || geometry.problems.length > 0) && (
        <section aria-labelledby="assay-geometry-heading" className="flex flex-col gap-1">
          <h3 id="assay-geometry-heading" className="text-base font-semibold">
            Assay geometry
          </h3>
          {geometry.ampliconLength !== null && (
            <p className="text-sm text-slate-700">{`Amplicon: ${formatCount(geometry.ampliconLength)} nt`}</p>
          )}
          {geometry.problems.length > 0 && (
            <>
              <ul aria-label="Geometry warnings" className="list-disc pl-5 text-sm text-amber-800">
                {geometry.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              <p className="text-xs text-slate-600">
                These are warnings, not errors. A non-standard design is still analysed.
              </p>
            </>
          )}
        </section>
      )}

      {sitesBySegment.size > 0 && <section aria-labelledby="genome-map-heading" className="flex flex-col gap-3">
        <h3 id="genome-map-heading" className="text-base font-semibold">
          Genome map
        </h3>
        {[...sitesBySegment.entries()].map(([segment, sites]) => (
            <GenomeMap
              key={segment}
              segmentLabel={pathogen.segmentLabels[segment] ?? segment}
              segmentLength={segmentLength(segment)}
              sites={sites}
            />
          ))}
      </section>}

      {/*
        Always mounted with its text swapped in, like every other message
        region in this app: a live region inserted at the same instant as its
        text is frequently never announced, and `aria-describedby` must not
        point at an id that is absent from the document half the time.
      */}
      <p id={CONTINUE_BLOCKED_ID} role="status" className="text-sm text-slate-700">
        {blockedReason}
      </p>

      <button
        type="button"
        aria-disabled={!canContinue}
        aria-describedby={canContinue ? undefined : CONTINUE_BLOCKED_ID}
        onClick={() => {
          if (canContinue) handleContinue();
        }}
        className={`self-start rounded px-4 py-2 ${
          canContinue ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700'
        }`}
      >
        Continue
      </button>
    </section>
  );
}
