import { useEffect, useMemo, useState } from 'react';
import { checkAssayGeometry, type GeometryCheck } from '../../core/assay-geometry';
import type { BindingSite } from '../../core/binding';
import type { OligoInput, OligoRole } from '../../core/oligo-input';
import { getPathogen } from '../../core/registry';
import { resolveBindingSite, type Resolution } from '../../core/resolution';
import { loadReference, referenceFetchedAt } from '../../data/references';
import { useAppStore } from '../../state/store';
import { GenomeMap, type GenomeMapSite } from './GenomeMap';

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

/** Explicit locale so the grouping separator does not depend on the host. */
const format = (n: number) => n.toLocaleString('en-US');

const siteKey = (site: BindingSite) => `${site.segment}:${site.start}-${site.end}:${site.strand}`;

/**
 * The one place a coordinate is written out. 1-based inclusive on the
 * reference's plus strand for both strands (Global Constraint 3), which the
 * caption under the list states in words -- a bare pair of integers would be
 * indistinguishable from a 0-based half-open range.
 */
const describeSite = (site: BindingSite) =>
  `${site.segment}: ${format(site.start)}–${format(site.end)} (${site.strand} strand)`;

const describeMismatches = (site: BindingSite) =>
  site.mismatches === 1
    ? '1 mismatch against the reference'
    : `${site.mismatches} mismatches against the reference`;

interface OligoBindingRowProps {
  oligo: OligoInput;
  role: OligoRole | null;
  resolution: Resolution;
  /** The site committed to the store for this oligo, if any. */
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
      </div>

      {located !== null && located !== undefined && (
        <>
          <p className="font-mono text-sm text-slate-900">{describeSite(located)}</p>
          <p className="text-sm text-slate-600">{describeMismatches(located)}</p>
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
 * `Continue` stays disabled until every oligo has a chosen site *and* every
 * degenerate one has been confirmed, so no later step can run on a site the
 * user never agreed to.
 *
 * Resolution scans the whole reference twice per oligo (once per strand), so
 * it is memoised on the oligo list and the reference and never re-run for a
 * re-render caused by a click. The resulting resolutions are written into the
 * store from an effect rather than during render, because later steps read
 * them from there.
 *
 * Confirmations are held locally, keyed by oligo id *and* sequence: the ids
 * from `parseOligoText` are positional (`oligo-0`), so a different oligo can
 * inherit the id of one the user already confirmed. Pairing the id with the
 * sequence makes the key change whenever the content does, and an identical
 * sequence at the same id resolves to exactly the same site, so reusing the
 * confirmation there is sound.
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

  const confirmKey = (oligo: OligoInput) => `${oligo.id} ${oligo.sequence}`;
  const isConfirmed = (oligo: OligoInput) => confirmations[confirmKey(oligo)] === true;

  const handleConfirm = (oligo: OligoInput, resolution: Resolution, confirmed: boolean) => {
    setConfirmations((current) => ({ ...current, [confirmKey(oligo)]: confirmed }));
    const site = chosenSites[oligo.id] ?? resolution.chosen;
    if (confirmed && site !== null && site !== undefined) chooseSite(oligo.id, site);
  };

  const canContinue =
    resolved.length > 0 &&
    resolved.every(
      ({ oligo, resolution }) =>
        chosenSites[oligo.id] !== undefined &&
        (resolution.status !== 'highly-degenerate' || isConfirmed(oligo)),
    );

  const siteForRole = (role: OligoRole): BindingSite | undefined => {
    const match = oligos.find((oligo) => (roles[oligo.id] ?? oligo.role) === role);
    return match === undefined ? undefined : chosenSites[match.id];
  };
  const forward = siteForRole('forward');
  const reverse = siteForRole('reverse');
  const probe = siteForRole('probe');
  // Missing roles simply mean there is nothing to check yet.
  const geometry: GeometryCheck | null =
    forward !== undefined && reverse !== undefined
      ? checkAssayGeometry({ forward, reverse, probe })
      : null;

  // One map per segment that actually carries a chosen site: influenza
  // references have eight segments, and empty bars for the other seven would
  // be noise.
  const sitesBySegment = new Map<string, GenomeMapSite[]>();
  for (const oligo of oligos) {
    const site = chosenSites[oligo.id];
    if (site === undefined) continue;
    const entry: GenomeMapSite = {
      label: oligo.name,
      start: site.start,
      end: site.end,
      strand: site.strand,
    };
    const existing = sitesBySegment.get(site.segment);
    if (existing === undefined) sitesBySegment.set(site.segment, [entry]);
    else existing.push(entry);
  }
  const segmentLength = (name: string) =>
    reference.segments.find((segment) => segment.name === name)?.sequence.length ?? 0;

  return (
    <section aria-labelledby="binding-resolution-heading" className="flex flex-col gap-4">
      <h2 id="binding-resolution-heading" className="text-xl font-semibold">
        Step 2: Check the binding sites
      </h2>
      <p className="text-sm text-slate-700">
        {`Each oligo was located on the bundled ${pathogen.label} reference (snapshot of ${referenceFetchedAt(pathogenId)}). Positions are 1-based and inclusive, and are always counted along the reference itself, whichever strand the oligo binds.`}
      </p>

      {oligos.length === 0 ? (
        <p className="text-sm text-slate-700">No oligos yet. Go back to step 1 and add some.</p>
      ) : (
        <ul aria-label="Binding sites" className="flex flex-col gap-3">
          {resolved.map(({ oligo, resolution }) => (
            <OligoBindingRow
              key={oligo.id}
              oligo={oligo}
              role={roles[oligo.id] ?? oligo.role}
              resolution={resolution}
              chosen={chosenSites[oligo.id]}
              confirmed={isConfirmed(oligo)}
              onChoose={(site) => chooseSite(oligo.id, site)}
              onConfirm={(confirmed) => handleConfirm(oligo, resolution, confirmed)}
            />
          ))}
        </ul>
      )}

      {geometry !== null && (
        <section aria-labelledby="assay-geometry-heading" className="flex flex-col gap-1">
          <h3 id="assay-geometry-heading" className="text-base font-semibold">
            Assay geometry
          </h3>
          {geometry.ampliconLength !== null && (
            <p className="text-sm text-slate-700">{`Amplicon: ${format(geometry.ampliconLength)} nt`}</p>
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

      <section aria-labelledby="genome-map-heading" className="flex flex-col gap-3">
        <h3 id="genome-map-heading" className="text-base font-semibold">
          Genome map
        </h3>
        {sitesBySegment.size === 0 ? (
          <p className="text-sm text-slate-700">The map appears once a site has been chosen.</p>
        ) : (
          [...sitesBySegment.entries()].map(([segment, sites]) => (
            <GenomeMap
              key={segment}
              segmentLabel={pathogen.segmentLabels[segment] ?? segment}
              segmentLength={segmentLength(segment)}
              sites={sites}
            />
          ))
        )}
      </section>

      <button
        type="button"
        disabled={!canContinue}
        className="self-start rounded bg-slate-900 px-4 py-2 text-white disabled:bg-slate-300"
      >
        Continue
      </button>
    </section>
  );
}
