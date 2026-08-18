import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Requirement 6 of Task 6.2: `prefers-reduced-motion` disables any transition.
 *
 * **There is currently nothing to disable.** `src/` contains no `transition`,
 * no `animate-` and no `duration-` utility, so a test asserting "reduced
 * motion stops the animations" would be quantifying over the empty set and
 * would pass forever whatever anyone adds next. The useful version is the one
 * below: assert the *global guard* exists in the stylesheet, so the protection
 * is in place before the first animation is written rather than after.
 *
 * The second test keeps that claim honest -- if motion is ever added to `src/`
 * it fails, and whoever added it has to come back here and replace this file
 * with a real behavioural test.
 *
 * This lives under `tests/` because `src/` is typechecked without Node types,
 * and because a Vite `?raw` import of a `.css` file resolves to the empty
 * string under Vitest: the CSS pipeline claims the module before `?raw` is
 * honoured. `node:fs` is the only way to see what the stylesheet actually says.
 */

const SRC = join(process.cwd(), 'src');
const INDEX_CSS = readFileSync(join(SRC, 'index.css'), 'utf8');

describe('prefers-reduced-motion is honoured globally', () => {
  it('the stylesheet disables animation, transition and smooth scrolling', () => {
    const block = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/.exec(
      INDEX_CSS,
    );
    expect(block, 'src/index.css has no prefers-reduced-motion block').not.toBeNull();
    const body = (block as RegExpExecArray)[1] as string;

    // The universal selector, so nothing has to remember this rule exists.
    expect(body).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after/);
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(body).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it('still describes an app with no motion in it', () => {
    // If this fails, motion has arrived and the guard above needs a real
    // behavioural test behind it rather than a stylesheet grep.
    const sources = listFiles(SRC).filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('index.css'));
    const offenders: string[] = [];
    for (const file of sources) {
      if (file.includes('.test.')) continue;
      const text = readFileSync(file, 'utf8');
      // Comments talk about transitions; utilities and declarations do not
      // appear in prose with a Tailwind prefix or a CSS colon after them.
      if (/\banimate-\[?\w|\btransition(-\w+)?:|\bduration-\d|\btransition\b\s*=|className="[^"]*\btransition\b/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}
