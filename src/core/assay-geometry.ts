import type { BindingSite } from './binding';

export const MIN_AMPLICON = 50;
export const MAX_AMPLICON = 300;

export interface GeometryInput {
  forward: BindingSite;
  reverse: BindingSite;
  probe?: BindingSite | undefined;
}

export interface GeometryCheck {
  ok: boolean;
  ampliconLength: number | null;
  problems: string[];
}

export function checkAssayGeometry({ forward, reverse, probe }: GeometryInput): GeometryCheck {
  const problems: string[] = [];

  if (forward.segment !== reverse.segment) {
    problems.push(
      `Forward and reverse primers must bind the same segment (found ${forward.segment} and ${reverse.segment}).`,
    );
  }
  if (forward.strand !== 'plus') problems.push('The forward primer should bind the plus strand.');
  if (reverse.strand !== 'minus') problems.push('The reverse primer should bind the minus strand.');

  let ampliconLength: number | null = null;
  if (forward.segment === reverse.segment) {
    if (reverse.end <= forward.start) {
      problems.push('The reverse primer must sit downstream of the forward primer.');
    } else {
      ampliconLength = reverse.end - forward.start + 1;
      if (ampliconLength < MIN_AMPLICON) {
        problems.push(`Amplicon is ${ampliconLength} nt; expected at least ${MIN_AMPLICON} nt.`);
      } else if (ampliconLength > MAX_AMPLICON) {
        problems.push(`Amplicon is ${ampliconLength} nt; expected at most ${MAX_AMPLICON} nt.`);
      }
    }
  }

  if (probe) {
    if (probe.segment !== forward.segment) {
      problems.push('The probe must bind the same segment as the primers.');
    } else if (probe.start <= forward.end || probe.end >= reverse.start) {
      problems.push('The probe must lie between the primers and must not overlap them.');
    }
  }

  return { ok: problems.length === 0, ampliconLength, problems };
}
