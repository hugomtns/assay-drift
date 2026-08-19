import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Requirement 5 of Task 6.2: the severity palette meets WCAG AA against its
 * own background, asserted as a computed number rather than judged by eye.
 *
 * This lives under `tests/` rather than `src/` for two reasons. `src/` is
 * typechecked with `types: ["vite/client"]` and has no Node globals, and this
 * file has to read two real files off disk. And `axe-core` cannot do this job:
 * jsdom performs no layout and resolves none of the Tailwind build, so axe's
 * `color-contrast` rule disables itself there. It does not pass, it does not
 * run. The only honest way to check contrast in this project is to compute it.
 *
 * Nothing here is a hardcoded hex. Both halves of every pair are read from the
 * files that actually decide them:
 *
 *  - which utility classes the badge uses, from `SeverityBadge.tsx`;
 *  - what colour each utility is, from `tailwindcss/theme.css`.
 *
 * A table of hexes typed into this file would keep passing after a Tailwind
 * upgrade silently changed the colour that ships, which is the entire failure
 * this test exists to catch.
 */

/** WCAG 2.2 SC 1.4.3, normal-weight text below 18.66px bold / 24px regular. */
const AA_NORMAL_TEXT = 4.5;

const repoFile = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), ...parts), 'utf8');

// ---------------------------------------------------------------------------
// oklch -> sRGB
// ---------------------------------------------------------------------------

interface Rgb {
  /** 0-255, integers: what a display is actually asked for. */
  r: number;
  g: number;
  b: number;
}

/** `oklch(37.8% 0.077 168.94)` -> its three components. Percent on L only. */
function parseOklch(value: string): { l: number; c: number; h: number } {
  const match = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (match === null) throw new Error(`Not an oklch() colour: ${value}`);
  return {
    l: Number(match[1]) / 100,
    c: Number(match[2]),
    h: Number(match[3]),
  };
}

/**
 * OKLab -> linear sRGB. The two matrices are from Björn Ottosson's original
 * definition (the inverse LMS' step, then LMS -> linear sRGB).
 */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear-light channel -> sRGB-encoded channel (IEC 61966-2-1). */
const gammaEncode = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/** The inverse, which is also WCAG 2.x's own definition of channel linearisation. */
const gammaDecode = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * An `oklch()` string as the 8-bit sRGB triple a display is asked for, plus
 * the same colour *without* the gamut clamp.
 *
 * Tailwind 4's palette is stated in `oklch` to three significant figures, and
 * a few of those round to a hair outside sRGB -- `emerald-900` comes out at
 * linear R = -0.00087, `amber-50` at linear R = 1.0015. A browser with no
 * wider gamut to render into clamps, so `rgb` is what ships. `unclamped` is
 * kept so the test can prove the AA verdict does not hinge on the clamp
 * rather than simply asserting that no clamp happened, which is not true here
 * and never will be for a palette written this way.
 */
function oklchToSrgb(value: string): { rgb: Rgb; unclamped: Rgb } {
  const { l, c, h } = parseOklch(value);
  const rad = (h * Math.PI) / 180;
  const linear = oklabToLinearSrgb(l, c * Math.cos(rad), c * Math.sin(rad));
  const encoded = linear.map((x) => (x < 0 ? -gammaEncode(-x) : gammaEncode(x)));
  const [r, g, b] = encoded.map((x) => Math.round(clamp01(x) * 255));
  const [ur, ug, ub] = encoded.map((x) => x * 255);
  return {
    rgb: { r: r as number, g: g as number, b: b as number },
    unclamped: { r: ur as number, g: ug as number, b: ub as number },
  };
}

const hex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

/**
 * WCAG 2.x relative luminance, from the 8-bit sRGB triple.
 *
 * Channels are not clamped here, so the same function can be applied to the
 * unclamped triple above; `gammaDecode` is odd-extended for that case, which
 * keeps it monotonic below zero.
 */
function relativeLuminance({ r, g, b }: Rgb): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const x = v / 255;
    return x < 0 ? -gammaDecode(-x) : gammaDecode(x);
  }) as [number, number, number];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// The two sources of truth
// ---------------------------------------------------------------------------

const THEME_CSS = repoFile('node_modules', 'tailwindcss', 'theme.css');
const INDEX_CSS = repoFile('src', 'index.css');

const VISUAL_TOKENS = [
  'canvas',
  'surface',
  'ink',
  'muted-ink',
  'border',
  'accent',
  'focus',
  'success',
  'warning',
  'danger',
] as const;

/** `emerald-900` -> the `oklch(...)` Tailwind will emit for it. */
function tailwindColor(token: string): string {
  const match = new RegExp(`--color-${token}:\\s*([^;]+);`).exec(THEME_CSS);
  if (match === null) {
    throw new Error(`tailwindcss/theme.css defines no --color-${token}`);
  }
  return (match[1] as string).trim();
}

const BADGE_SOURCE = repoFile('src', 'ui', 'results', 'SeverityBadge.tsx');

/**
 * The `LEVEL_STYLES` map, read out of the component rather than restated here.
 * A level added or a colour changed in the badge shows up in this test without
 * anyone remembering to update it.
 */
function badgeStyles(): Map<string, string> {
  const block = /const LEVEL_STYLES[^{]*\{([\s\S]*?)\n\};/.exec(BADGE_SOURCE);
  if (block === null) throw new Error('Could not find LEVEL_STYLES in SeverityBadge.tsx');
  const out = new Map<string, string>();
  for (const entry of (block[1] as string).matchAll(/(\w+):\s*'([^']+)'/g)) {
    out.set(entry[1] as string, entry[2] as string);
  }
  if (out.size === 0) throw new Error('LEVEL_STYLES parsed to nothing');
  return out;
}

/** `text-emerald-900` inside a class string -> `emerald-900`. */
function utilityToken(classes: string, prefix: 'text' | 'bg' | 'border'): string {
  const match = new RegExp(`(?:^|\\s)${prefix}-([a-z]+-\\d+)(?:\\s|$)`).exec(classes);
  if (match === null) throw new Error(`No ${prefix}-* utility in "${classes}"`);
  return match[1] as string;
}

// ---------------------------------------------------------------------------

describe('the oklch -> sRGB converter, before any ratio it produces is trusted', () => {
  it('turns the reference red into #ff0000', () => {
    // The canonical sRGB-red round trip: oklch(62.8% 0.2577 29.23) is #ff0000.
    expect(hex(oklchToSrgb('oklch(62.8% 0.2577 29.23)').rgb)).toBe('#ff0000');
  });

  it('turns oklch(100% 0 0) into white', () => {
    expect(hex(oklchToSrgb('oklch(100% 0 0)').rgb)).toBe('#ffffff');
  });

  it('turns oklch(0% 0 0) into black', () => {
    expect(hex(oklchToSrgb('oklch(0% 0 0)').rgb)).toBe('#000000');
  });

  it('gives white on black the WCAG maximum of 21:1', () => {
    const ratio = contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    expect(ratio).toBeCloseTo(21, 6);
  });

  it('gives a colour against itself exactly 1:1', () => {
    const emerald = oklchToSrgb(tailwindColor('emerald-900')).rgb;
    expect(contrastRatio(emerald, emerald)).toBeCloseTo(1, 12);
  });
});

describe('severity badge colour contrast (WCAG AA, 4.5:1)', () => {
  const styles = badgeStyles();

  it.each([...styles.keys()])('%s meets AA for normal text', (level) => {
    const classes = styles.get(level) as string;
    const fgToken = utilityToken(classes, 'text');
    const bgToken = utilityToken(classes, 'bg');
    const fg = oklchToSrgb(tailwindColor(fgToken));
    const bg = oklchToSrgb(tailwindColor(bgToken));
    const ratio = contrastRatio(fg.rgb, bg.rgb);
    const unclamped = contrastRatio(fg.unclamped, bg.unclamped);

    // Printed, not just asserted: the measured number is the result, and a
    // bare green tick tells a reviewer nothing about how much headroom there is.
    console.log(
      `${level.padEnd(8)} ${fgToken} ${hex(fg.rgb)} on ${bgToken} ${hex(bg.rgb)} = ` +
        `${ratio.toFixed(2)}:1 (unclamped ${unclamped.toFixed(2)}:1)`,
    );

    // The verdict must not hinge on the sRGB clamp. Both the colour that ships
    // and the colour Tailwind's oklch literally names have to clear the bar.
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(unclamped).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('covers every severity level the badge can render', () => {
    // If a fifth level is added, it must arrive with a colour pair that has
    // been measured, not one that was never looked at.
    expect([...styles.keys()].sort()).toEqual(['amber', 'green', 'red', 'unknown']);
  });
});

describe('global visual-system tokens', () => {
  it('defines the named OKLCH roles used by the application shell', () => {
    for (const token of VISUAL_TOKENS) {
      expect(INDEX_CSS).toMatch(
        new RegExp(`--color-${token}:\\s*oklch\\(\\s*[\\d.]+%\\s+[\\d.]+\\s+[\\d.]+\\s*\\)`),
      );
    }
  });

  it('applies the canvas, ink, selection, and visible keyboard focus globally', () => {
    expect(INDEX_CSS).toMatch(/body\s*\{[\s\S]*background-color:\s*var\(--color-canvas\)/);
    expect(INDEX_CSS).toMatch(/body\s*\{[\s\S]*color:\s*var\(--color-ink\)/);
    expect(INDEX_CSS).toMatch(/::selection\s*\{[\s\S]*background-color:\s*var\(--color-accent\)/);
    expect(INDEX_CSS).toMatch(/:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--color-focus\)/);
  });
});
