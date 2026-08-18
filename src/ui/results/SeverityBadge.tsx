import { SEVERITY_DISCLAIMER } from '../../core/analysis/constants';
import type { OligoRole } from '../../core/oligo-input';
import type { Severity, SeverityLevel } from '../../core/analysis/severity';
// The four words live one module over because the live region that announces
// a finished run says the same word, and two copies would be two things to
// keep true.
import { SEVERITY_LABELS } from './severity-labels';

/**
 * Colour is never the only cue (WCAG 1.4.1): every level carries its word and
 * a distinct outline shape, so the badge survives greyscale printing and every
 * form of colour blindness. The shapes are deliberately the conventional ones
 * — circle, triangle, octagon — and the unknown level is a dashed circle,
 * which reads as "outline of a thing we do not have" rather than as a fourth
 * severity between the other three.
 */
const LEVEL_STYLES: Readonly<Record<SeverityLevel, string>> = {
  green: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  amber: 'border-amber-700 bg-amber-50 text-amber-900',
  red: 'border-red-700 bg-red-50 text-red-900',
  unknown: 'border-slate-500 bg-slate-100 text-slate-800',
};

function LevelIcon({ level }: { level: SeverityLevel }) {
  const shape =
    level === 'green' ? (
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
    ) : level === 'amber' ? (
      <path
        d="M8 1.5 L15 14.5 L1 14.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    ) : level === 'red' ? (
      <path
        d="M5.2 1.5 H10.8 L14.5 5.2 V10.8 L10.8 14.5 H5.2 L1.5 10.8 V5.2 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    ) : (
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="3 2.5"
      />
    );

  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      {shape}
    </svg>
  );
}

interface SeverityBadgeProps {
  severity: Severity;
  role: OligoRole;
}

/**
 * The heuristic's verdict, with everything needed to discount it.
 *
 * The disclaimer is rendered unconditionally and never behind a disclosure:
 * the badge is the most quotable thing on the page, and a caveat that has to
 * be opened is a caveat that will not be read alongside the word it qualifies.
 *
 * The reasons are shown in full rather than summarised. They are the only
 * account of *why* a level was reached, and a reader who disagrees with the
 * weighting needs to see which positions drove it.
 *
 * No wording here forecasts what an assay will do. `scoreSeverity` counts
 * mismatches and weights them by position; it models neither hybridisation nor
 * amplification, so the badge says what to look at, never what will happen.
 */
export function SeverityBadge({ severity, role }: SeverityBadgeProps) {
  const weighting =
    role === 'probe'
      ? 'Positions are weighted uniformly for a probe.'
      : 'Positions within the terminal three bases of the 3′ end are weighted more heavily.';

  return (
    <div className="flex flex-col gap-2">
      <p
        className={`flex w-fit items-center gap-2 rounded border px-3 py-1 text-sm font-semibold ${LEVEL_STYLES[severity.level]}`}
      >
        <LevelIcon level={severity.level} />
        <span>{SEVERITY_LABELS[severity.level]}</span>
      </p>

      {severity.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-slate-700">
          {severity.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-600">{weighting}</p>
      <p className="text-xs text-slate-600">{SEVERITY_DISCLAIMER}</p>
    </div>
  );
}
