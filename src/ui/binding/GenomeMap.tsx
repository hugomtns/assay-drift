import { formatCount } from '../format';

export interface GenomeMapSite {
  /** Short name shown to the user, normally the oligo's name. */
  label: string;
  /** 1-based inclusive position on the segment's plus strand. */
  start: number;
  /** 1-based inclusive position on the segment's plus strand. */
  end: number;
  strand: 'plus' | 'minus';
}

interface GenomeMapProps {
  /** Human label for the segment, e.g. "Genome" or "HA (segment 4)". */
  segmentLabel: string;
  segmentLength: number;
  sites: readonly GenomeMapSite[];
}

/**
 * One segment drawn as a horizontal bar with a tick per binding site, so the
 * user can see at a glance where an assay sits and how the primers and probe
 * relate to each other.
 *
 * The bar is purely proportional: a 22 nt primer is 0.07% of a 29,903 nt
 * genome, which rounds to nothing on screen, so each tick carries a 3px
 * minimum width. That makes the ticks *not* to scale at this zoom -- they are
 * a locator, not a measurement -- which is why every tick also carries its
 * exact coordinates in its accessible name and tooltip rather than relying on
 * the drawing. Nothing here is the source of truth for a position; the
 * coordinate line in `BindingResolution` is.
 *
 * Strand is drawn, not written: plus-strand ticks sit on the top half of the
 * bar, minus-strand ticks on the bottom half, each in its own colour. The
 * words live in the tick's accessible name and tooltip and in the per-oligo
 * coordinate line above the map, so the strand is never conveyed by colour
 * alone.
 *
 * Purely presentational: it holds no state and reads no store, so the same
 * component serves a single-segment coronavirus genome and any one of the
 * eight influenza segments. The caller decides which segments to draw.
 */
export function GenomeMap({ segmentLabel, segmentLength, sites }: GenomeMapProps) {
  // Guard the percentage maths against a zero/unknown length.
  const span = Math.max(segmentLength, 1);

  return (
    <figure className="flex flex-col gap-1" aria-label={`Binding-site map for ${segmentLabel}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-slate-900">{segmentLabel}</span>
        <span className="text-slate-600">{formatCount(segmentLength)} nt</span>
      </figcaption>

      <div className="relative h-6 w-full rounded bg-slate-200">
        {sites.map((site) => {
          const left = ((site.start - 1) / span) * 100;
          const width = ((site.end - site.start + 1) / span) * 100;
          // One line: assistive technology reads it as a single name, and the
          // coordinates stay next to the label they belong to.
          const description = `${site.label}: ${formatCount(site.start)}–${formatCount(site.end)} (${site.strand} strand)`;
          return (
            <div
              key={`${site.label}\0${site.start}\0${site.end}\0${site.strand}`}
              role="img"
              aria-label={description}
              title={description}
              className={`absolute h-3 rounded-sm ${
                site.strand === 'plus' ? 'top-0 bg-sky-600' : 'bottom-0 bg-amber-600'
              }`}
              style={{ left: `${left}%`, width: `${width}%`, minWidth: '3px' }}
            />
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        Positions are 1-based and inclusive; each tick is labelled with its oligo and coordinates.
      </p>
    </figure>
  );
}
