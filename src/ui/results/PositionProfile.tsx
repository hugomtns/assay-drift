import { useId } from 'react';
import { THREE_PRIME_CRITICAL } from '../../core/analysis/constants';
import type { PositionStat } from '../../core/analysis/profile';
import type { OligoAnalysis } from '../../core/analysis/run';
import { formatCount, formatPercent } from '../format';

/**
 * Hand-written SVG rather than a charting library. This is a row of stacked
 * bars with one base above each; a library would cost bundle for layout we do
 * not need, and every accessibility requirement here (a per-bar accessible
 * name, a per-bar tooltip, a bar that is deliberately *absent*) is easier to
 * satisfy by emitting the elements directly.
 *
 * One `<svg>` per column rather than one for the whole row. The row itself is
 * flex-laid HTML, so the bases really are monospace text and the 3′ shading is
 * a background on the column. The reason is `<title>`: SVG has no `title`
 * *attribute*, only a `<title>` *element*, and a `<title>` only names its
 * nearest container. Per-column SVGs give each bar a real tooltip that
 * browsers show and assistive technology can reach; a single SVG for the row
 * could only have had one.
 */
const COLUMN_WIDTH = 14;
const BAR_WIDTH = 10;
const PLOT_HEIGHT = 80;
/** Strip below the axis where a borrowed-denominator flag is drawn. */
const FLAG_AREA = 8;
const SVG_HEIGHT = PLOT_HEIGHT + FLAG_AREA;
const BAR_X = (COLUMN_WIDTH - BAR_WIDTH) / 2;

const AMBIGUOUS_TITLE = 'reference base is ambiguous; this position cannot be assessed';
const INFERRED_TITLE = 'per-position coverage not reported';

/** One stacked segment of a bar, already placed. Units are SVG user units. */
interface Segment {
  key: string;
  /** Distance from the axis down-to-up, i.e. the rect's top edge. */
  y: number;
  height: number;
  className: string;
}

/**
 * The bar's total height encodes `mismatchFraction`, and the stack inside it
 * splits that height between the reported allele classes *in proportion to
 * their counts* — not by their own fractions of the denominator.
 *
 * The distinction matters. `statFor` has a branch in which the oligo does not
 * accept the reference base, and mismatchCount is then derived by subtraction
 * (`denominator - acceptedCount`) rather than summed from allele rows. In that
 * branch `substitutionCount + deletionCount` can be far below `mismatchCount`,
 * so sizing the segments from the allele counts alone would draw a bar much
 * shorter than the rate it is supposed to show. The remainder is drawn as its
 * own neutral segment instead of being quietly dropped.
 */
function segmentsFor(p: PositionStat): Segment[] {
  const total = Math.min(1, Math.max(0, p.mismatchFraction)) * PLOT_HEIGHT;
  if (total <= 0 || p.mismatchCount <= 0) return [];
  const deletion = (p.deletionCount / p.mismatchCount) * total;
  const substitution = (p.substitutionCount / p.mismatchCount) * total;
  const other = Math.max(0, total - deletion - substitution);
  // Stacked from the axis upward, deletions at the bottom. Each segment's top
  // edge is derived from the ones below it rather than from a running
  // accumulator, so nothing here is reassigned mid-render.
  const heights = [
    { key: 'deletion', height: deletion, className: 'fill-purple-700' },
    { key: 'substitution', height: substitution, className: 'fill-rose-600' },
    { key: 'other', height: other, className: 'fill-slate-500' },
  ].filter((s) => s.height > 0);
  return heights.map((s, i) => {
    const below = heights.slice(0, i).reduce((sum, x) => sum + x.height, 0);
    return { ...s, y: PLOT_HEIGHT - below - s.height };
  });
}

function unattributed(p: PositionStat): boolean {
  return !p.referenceIsAmbiguous && p.mismatchCount > p.substitutionCount + p.deletionCount;
}

/** The note column of the hidden table: whatever qualifies this row's numbers. */
function noteFor(p: PositionStat): string {
  if (p.referenceIsAmbiguous) {
    return 'Not assessable: the reference base is ambiguous, so no rate can be computed here.';
  }
  if (p.coverageIsInferred) {
    return 'Per-position coverage not reported; the window denominator is used instead.';
  }
  return '';
}

function titleFor(p: PositionStat): string | null {
  if (p.referenceIsAmbiguous) return AMBIGUOUS_TITLE;
  if (p.coverageIsInferred) return INFERRED_TITLE;
  return null;
}

interface PositionColumnProps {
  stat: PositionStat;
  hatchId: string;
}

function PositionColumn({ stat, hatchId }: PositionColumnProps) {
  const title = titleFor(stat);
  const segments = stat.referenceIsAmbiguous ? [] : segmentsFor(stat);
  const barHeight = segments.reduce((sum, s) => sum + s.height, 0);

  return (
    /*
      `aria-hidden`, not `role="img"` with a per-column label (Task 6.2,
      requirement 3).

      Each column used to be its own labelled image, so the only way to read
      the profile was to arrow through N separate pictures, hearing one full
      sentence each, with no way to compare two positions or reach a total. The
      visually hidden table below now carries exactly the same numbers in a
      form that can be navigated by cell, so leaving the labels in place would
      announce every position twice -- 44 sentences for 22 data points -- and
      the duplicate is strictly the worse of the two.

      The `<title>` stays. It is the mouse tooltip, which browsers render from
      the element regardless of `aria-hidden`, and it is the only place a
      sighted user learns that a bar's denominator was borrowed.
    */
    <svg
      aria-hidden="true"
      width={COLUMN_WIDTH}
      height={SVG_HEIGHT}
      viewBox={`0 0 ${COLUMN_WIDTH} ${SVG_HEIGHT}`}
    >
      {title !== null && <title>{title}</title>}

      {segments.map((s) => (
        <rect
          key={s.key}
          x={BAR_X}
          y={s.y}
          width={BAR_WIDTH}
          height={s.height}
          className={s.className}
        />
      ))}

      {stat.coverageIsInferred && barHeight > 0 && (
        <rect
          x={BAR_X}
          y={PLOT_HEIGHT - barHeight}
          width={BAR_WIDTH}
          height={barHeight}
          fill={`url(#${hatchId})`}
        />
      )}

      {/* A borrowed denominator has to stay visible even when the bar it
          applies to is zero high. */}
      {stat.coverageIsInferred && (
        <>
          <rect
            x={BAR_X}
            y={PLOT_HEIGHT + 2}
            width={BAR_WIDTH}
            height={4}
            className="fill-slate-300"
          />
          <rect
            x={BAR_X}
            y={PLOT_HEIGHT + 2}
            width={BAR_WIDTH}
            height={4}
            fill={`url(#${hatchId})`}
          />
        </>
      )}

      {stat.referenceIsAmbiguous && (
        <circle
          cx={COLUMN_WIDTH / 2}
          cy={PLOT_HEIGHT - 6}
          r={4}
          fill="none"
          stroke="#475569"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
      )}

      <line x1={0} y1={PLOT_HEIGHT} x2={COLUMN_WIDTH} y2={PLOT_HEIGHT} stroke="#94a3b8" />
    </svg>
  );
}

interface LegendItemProps {
  swatch: React.ReactNode;
  label: string;
}

function LegendItem({ swatch, label }: LegendItemProps) {
  return (
    <li className="flex items-center gap-2">
      {swatch}
      <span>{label}</span>
    </li>
  );
}

interface PositionProfileProps {
  analysis: OligoAnalysis;
}

/**
 * Every position of one oligo, 5′ on the left.
 *
 * Three things here are not decoration:
 *
 * - The terminal three 3′ bases are shaded, and *only for primers*. The 3′
 *   weighting in `scoreSeverity` applies to primers alone, so shading a
 *   probe's 3′ end would draw a distinction the analysis does not make. The
 *   probe case says so in words rather than leaving the absence unexplained.
 * - A column whose per-position coverage was not reported is hatched and
 *   titled. Its denominator is the window's, substituted for one LAPIS never
 *   gave us, and a bar drawn from a borrowed denominator should not look
 *   identical to one drawn from a measured one.
 * - A column whose reference base is ambiguous gets no bar and no percentage,
 *   only a hollow "not assessable" mark. See `describe`.
 */
export function PositionProfile({ analysis }: PositionProfileProps) {
  // `useId` returns delimiters (React 19 uses «…») that are legal in an id but
  // not in a `url(#…)` reference, so the generated part is stripped to
  // word characters before it is used as a fragment target.
  const hatchId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const profile: PositionStat[] = analysis.profile;
  const isProbe = analysis.role === 'probe';

  const isTerminal = (p: PositionStat) =>
    !isProbe && p.distanceFrom3Prime <= THREE_PRIME_CRITICAL;

  const anyTerminal = profile.some(isTerminal);
  const anyInferred = profile.some((p) => p.coverageIsInferred);
  const anyAmbiguous = profile.some((p) => p.referenceIsAmbiguous);
  const anyUnattributed = profile.some(unattributed);

  return (
    /*
      Named with the oligo, not just "Per-position mismatch". A results page
      carries one of these per oligo, and three identically named regions in a
      landmark list are three dead ends -- axe's `landmark-unique` flags it and
      it is a genuine navigation failure, not a lint nicety. `aria-label`
      rather than `aria-labelledby` so the visible heading stays as it was;
      the accessible name is the heading plus the thing it is about.
    */
    <section
      aria-label={`Per-position mismatch: ${analysis.name}`}
      className="flex flex-col gap-2"
    >
      <h4 className="text-base font-semibold text-slate-900">Per-position mismatch</h4>
      <p className="text-sm text-slate-700">
        Each bar is the share of assessable sequences carrying a mismatch at that position. Bases
        read 5′ (left) to 3′ (right).
      </p>

      {/*
        One shared hatch definition. SVG fragment references resolve across the
        whole document, so every column can point at this one pattern rather
        than carrying its own copy.
      */}
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <defs>
          {/*
            A hatch rather than a second colour: the flag has to survive being
            printed in greyscale and being read by someone who cannot tell two
            fills apart, and it has to sit on top of whichever fill the segment
            already has.
          */}
          <pattern
            id={hatchId}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke="#0f172a"
              strokeOpacity="0.55"
              strokeWidth="1.5"
            />
          </pattern>
        </defs>
      </svg>

      {/*
        Focusable for the same reason as `TrendChart`'s wrapper: a horizontally
        scrolling region that a keyboard user cannot reach, because everything
        inside it is `aria-hidden`. See that file for why the suite could not
        see this and the deployed site could.
      */}
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="group"
        aria-label={`Per-position mismatch chart for ${analysis.name}, scrollable`}
      >
        <div className="flex w-fit items-start">
          <span className="pr-1 text-[11px] leading-4 text-slate-600">5′</span>
          {profile.map((p) => (
            <div
              key={`${String(p.refPos)}-${String(p.oligoIndex)}`}
              className={`flex flex-col items-center ${isTerminal(p) ? 'bg-amber-100' : ''}`}
              style={{ width: `${String(COLUMN_WIDTH)}px` }}
            >
              <span className="font-mono text-[11px] leading-4 text-slate-900">{p.oligoBase}</span>
              <PositionColumn stat={p} hatchId={hatchId} />
            </div>
          ))}
          <span className="pl-1 text-[11px] leading-4 text-slate-600">3′</span>
        </div>
      </div>

      {/*
        The chart's equivalent for assistive technology (Task 6.2,
        requirement 3), and the reason the columns above are `aria-hidden`.

        Everything the bars encode is here in text: the rate a bar's height
        stands for, both counts it was computed from, and -- in the notes
        column -- the two things the drawing says with a hatch and a hollow
        mark. A table also gives what N separate labelled images could not:
        column headers announced with every cell, and the ability to move
        between positions to compare them.

        `formatPercent` is never called for an ambiguous reference base. That
        position was not queried, so `0.0%` there would state the site is
        conserved somewhere we cannot see at all.
      */}
      <table className="sr-only">
        <caption>
          {`Per-position mismatch for ${analysis.name}, with the counts each rate was computed from. Rows read 5′ to 3′.`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Base in the oligo</th>
            <th scope="col">Sequences with a mismatch</th>
            <th scope="col">Assessable sequences</th>
            <th scope="col">Mismatch rate</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {profile.map((p) => (
            <tr key={`row-${String(p.refPos)}-${String(p.oligoIndex)}`}>
              <th scope="row">{formatCount(p.refPos)}</th>
              <td>{p.oligoBase}</td>
              <td>{p.referenceIsAmbiguous ? 'Not assessable' : formatCount(p.mismatchCount)}</td>
              <td>
                {p.referenceIsAmbiguous ? 'Not assessable' : formatCount(p.effectiveDenominator)}
              </td>
              <td>
                {p.referenceIsAmbiguous ? 'Not assessable' : formatPercent(p.mismatchFraction)}
              </td>
              <td>{noteFor(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {anyTerminal && (
        <p className="text-xs text-amber-900">
          3′ end (shaded): the terminal three bases, which the severity heuristic weights most
          heavily for a primer.
        </p>
      )}

      {isProbe && (
        <p className="text-sm text-slate-700">
          Nothing is shaded for a probe: probe positions are weighted uniformly, and the 3′
          weighting applies to primers only.
        </p>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        <LegendItem
          swatch={<span aria-hidden="true" className="inline-block h-3 w-3 bg-rose-600" />}
          label="Substitution"
        />
        <LegendItem
          swatch={<span aria-hidden="true" className="inline-block h-3 w-3 bg-purple-700" />}
          label="Deletion"
        />
        {anyUnattributed && (
          <LegendItem
            swatch={<span aria-hidden="true" className="inline-block h-3 w-3 bg-slate-500" />}
            label="Mismatch not attributed to a reported allele"
          />
        )}
        {anyInferred && (
          <LegendItem
            swatch={
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 bg-slate-300"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, transparent 0 2px, rgba(15,23,42,0.55) 2px 3px)',
                }}
              />
            }
            label="Per-position coverage not reported (window denominator used)"
          />
        )}
        {anyAmbiguous && (
          <LegendItem
            swatch={
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-slate-600"
              />
            }
            label="Not assessable (reference base is ambiguous)"
          />
        )}
      </ul>
    </section>
  );
}
