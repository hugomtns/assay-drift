import { useId } from 'react';
import type { TrendPoint, TrendSeries } from '../../core/analysis/trend';
import { formatCount, formatPercent } from './format';

/**
 * Hand-written SVG, for the same reason as the position profile: this is one
 * polyline, and the one thing that actually matters about it — that a bucket
 * with no computable rate leaves a *hole* rather than a point on the axis — is
 * something most charting libraries make you fight for. Emitting the path
 * ourselves makes the gap the natural outcome instead of a configuration flag.
 */
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PLOT_TOP = 10;
const PLOT_HEIGHT = 100;
const AXIS_Y = PLOT_TOP + PLOT_HEIGHT;
const FOOT_HEIGHT = 22;
const SVG_HEIGHT = AXIS_Y + FOOT_HEIGHT;
const STEP = 40;
/** Most x labels a reader can take before they collide. */
const MAX_X_LABELS = 8;

/** A run of consecutive buckets that all have a rate, i.e. one unbroken line. */
interface Run {
  start: number;
  points: { index: number; fraction: number }[];
}

function runsOf(points: TrendPoint[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  points.forEach((p, index) => {
    if (!p.sufficientData || p.mismatchFraction === null) {
      current = null;
      return;
    }
    if (current === null) {
      current = { start: index, points: [] };
      runs.push(current);
    }
    current.points.push({ index, fraction: p.mismatchFraction });
  });
  return runs;
}

interface TrendChartProps {
  trend: TrendSeries;
}

/**
 * Mismatch rate over time, with the counts behind it.
 *
 * A bucket whose denominator is below MIN_DENOMINATOR has `mismatchFraction:
 * null` and is drawn as a break in the line, never as a point at zero. The two
 * are opposite claims — "no sequences carried a mismatch" versus "too few
 * sequences to say" — and a line that dips to the axis in a thin month is the
 * single most misleading thing this chart could do, because it looks exactly
 * like the good news of a variant receding.
 *
 * The SVG is `aria-hidden` and the numbers are carried by a visually hidden
 * table beside it. That is not a token alt text: it is every bucket, with its
 * mismatch count, its denominator and its rate, in source order — so a screen
 * reader gets strictly more than a sighted reader does from the line, and the
 * thin buckets read "not enough data" in words.
 */
export function TrendChart({ trend }: TrendChartProps) {
  const captionId = useId();
  const { points, granularity } = trend;

  const width = PAD_LEFT + PAD_RIGHT + Math.max(1, points.length - 1) * STEP;
  const x = (index: number) => PAD_LEFT + index * STEP;

  const rates = points
    .map((p) => p.mismatchFraction)
    .filter((f): f is number => f !== null);
  const peak = rates.length > 0 ? Math.max(...rates) : 0;
  // A flat-zero series still needs a scale; 1% keeps the axis label honest and
  // stops a division by zero.
  const yMax = peak > 0 ? peak : 0.01;
  const y = (fraction: number) => PLOT_TOP + PLOT_HEIGHT * (1 - fraction / yMax);

  const runs = runsOf(points);
  const d = runs
    .map((run) =>
      run.points
        .map(
          (pt, k) =>
            `${k === 0 ? 'M' : 'L'} ${x(pt.index).toFixed(2)} ${y(pt.fraction).toFixed(2)}`,
        )
        .join(' '),
    )
    .join(' ');

  const labelEvery = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));

  return (
    <figure aria-labelledby={captionId} className="m-0 flex flex-col gap-2">
      <figcaption id={captionId} className="text-sm text-slate-700">
        {`Mismatch rate by ${granularity}. A break in the line is a ${granularity} with too few assessable sequences to compute a rate, not a ${granularity} with none. Every count is in the table below.`}
      </figcaption>

      <div className="overflow-x-auto">
        <svg
          aria-hidden="true"
          width={width}
          height={SVG_HEIGHT}
          viewBox={`0 0 ${width} ${SVG_HEIGHT}`}
        >
          <line x1={PAD_LEFT} y1={PLOT_TOP} x2={PAD_LEFT} y2={AXIS_Y} stroke="#94a3b8" />
          <line x1={PAD_LEFT} y1={AXIS_Y} x2={width - PAD_RIGHT} y2={AXIS_Y} stroke="#94a3b8" />

          <text x={PAD_LEFT - 6} y={PLOT_TOP + 4} textAnchor="end" fontSize="9" className="fill-slate-600">
            {formatPercent(yMax)}
          </text>
          <text x={PAD_LEFT - 6} y={AXIS_Y + 3} textAnchor="end" fontSize="9" className="fill-slate-600">
            {formatPercent(0)}
          </text>

          {d !== '' && (
            <path d={d} fill="none" stroke="#0f766e" strokeWidth="2" strokeLinejoin="round" />
          )}

          {runs.flatMap((run) =>
            run.points.map((pt) => (
              <circle
                key={`dot-${String(pt.index)}`}
                cx={x(pt.index)}
                cy={y(pt.fraction)}
                r={3}
                className="fill-teal-700"
              />
            )),
          )}

          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`x-${p.bucket}`}
                x={x(i)}
                y={AXIS_Y + 14}
                textAnchor="middle"
                fontSize="9"
                className="fill-slate-600"
              >
                {p.bucket}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <table className="sr-only">
        <caption>{`Mismatch rate by ${granularity}, with the counts it was computed from.`}</caption>
        <thead>
          <tr>
            <th scope="col">{granularity === 'month' ? 'Month' : 'Week beginning'}</th>
            <th scope="col">Sequences with a mismatch</th>
            <th scope="col">Assessable sequences</th>
            <th scope="col">Mismatch rate</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.bucket}>
              <th scope="row">{p.bucket}</th>
              <td>{formatCount(p.nMismatch)}</td>
              <td>{formatCount(p.nFullCoverage)}</td>
              <td>{formatPercent(p.mismatchFraction)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {trend.undatedFullCoverage > 0 && (
        <p className="text-xs text-slate-600">
          {`${formatCount(trend.undatedFullCoverage)} assessable sequences (${formatCount(trend.undatedMismatch)} of them carrying a mismatch) have no usable collection date. They are counted in the headline figure but cannot appear in this trend.`}
        </p>
      )}
    </figure>
  );
}
