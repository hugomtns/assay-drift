import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import { AttributionTable } from './AttributionTable';
import { HeadlineCard } from './HeadlineCard';
import { InsertionNote } from './InsertionNote';
import { PositionProfile } from './PositionProfile';
import { ResultsPanel } from './ResultsPanel';
import { SeverityBadge } from './SeverityBadge';
import { TrendChart } from './TrendChart';
import { CaveatPanel } from '../CaveatPanel';
import {
  sampleAnalysis,
  sampleResult,
  unassessableAnalysis,
} from '../../core/analysis/test-fixtures';
import type { AnalysisResult } from '../../core/analysis/run';

/**
 * Belt and braces on top of the `require-n-with-percentage` lint rule
 * (Global Constraint 6). The lint rule reads source; this reads the DOM the
 * user actually gets, so a percentage assembled at runtime out of pieces the
 * linter never sees is still caught.
 *
 * The unit of judgement is the **visual unit**, which is the phrase Global
 * Constraint 4 uses: "any number rendered without its denominator in the same
 * visual unit is a bug". For almost every element that unit is the element
 * itself -- a headline `<p>` is quotable, screenshottable and readable on its
 * own, and must therefore carry its own counts. A table cell is the one
 * exception: a screen reader announces it with its column header and its row,
 * a mouse selection takes the whole row, and no one ever quotes a lone `<td>`.
 * So for a cell the unit is the row plus the table's caption.
 *
 * Two things are deliberately out of scope:
 *
 * - Subtrees marked `aria-hidden="true"`. The only ones are the hand-drawn
 *   SVGs, whose axis labels are a *scale* and not a statistic, and every
 *   number they scale is repeated in the visually hidden table beside them.
 * - Nothing else. In particular `aria-label` IS checked, because an accessible
 *   name is the element's text for anyone using a screen reader.
 */

/** e.g. "70,387" or "1,234,567". */
const COMMA_GROUPED = /\d{1,3}(,\d{3})+/;
/**
 * "95.9% (67,520 of 70,387)", "3 of 20" -- a count, the word that names the
 * denominator, and the denominator itself.
 *
 * The digits on both sides are load-bearing. A bare `/\bof\b/` would accept
 * "60% of the sequences", which is the exact sentence this file exists to
 * reject: the word "of" is not a denominator. Every component passes under the
 * strict form, so the loose one bought nothing.
 */
const HAS_OF = /\d[\d,]*\s+of\s+[\d,]+/;

const carriesItsN = (text: string): boolean => COMMA_GROUPED.test(text) || HAS_OF.test(text);

const isHidden = (el: Element): boolean => el.closest('[aria-hidden="true"]') !== null;

/** `textContent` with every `aria-hidden` subtree removed. */
function visibleText(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType !== node.ELEMENT_NODE) return '';
  if ((node as Element).getAttribute('aria-hidden') === 'true') return '';
  let out = '';
  for (const child of node.childNodes) out += visibleText(child);
  return out;
}

/**
 * The text a reader takes in together with this element. Everything is judged
 * on its own text, except a table cell, which is judged on its row and the
 * table's caption as well.
 */
function visualUnit(el: Element): string {
  const own = visibleText(el);
  if (el.tagName !== 'TD' && el.tagName !== 'TH') return own;
  const row = el.closest('tr');
  const caption = el.closest('table')?.querySelector('caption');
  return `${own} ${row ? visibleText(row) : ''} ${caption ? visibleText(caption) : ''}`;
}

interface Offender {
  where: string;
  text: string;
}

function barePercentages(container: HTMLElement): Offender[] {
  const out: Offender[] = [];
  for (const el of container.querySelectorAll('*')) {
    if (isHidden(el)) continue;

    const text = visibleText(el);
    if (text.includes('%') && !carriesItsN(visualUnit(el))) {
      out.push({ where: `<${el.tagName.toLowerCase()}>`, text });
    }

    const label = el.getAttribute('aria-label');
    if (label !== null && label.includes('%') && !carriesItsN(label)) {
      out.push({ where: `<${el.tagName.toLowerCase()} aria-label>`, text: label });
    }
  }
  return out;
}

/** Both oligos, so every null-rate branch renders too. */
const bothOligos: AnalysisResult = {
  ...sampleResult,
  oligos: [sampleAnalysis, unassessableAnalysis],
};

const CASES: Readonly<Array<[string, ReactElement]>> = [
  ['HeadlineCard', <HeadlineCard analysis={sampleAnalysis} />],
  ['HeadlineCard (nothing assessable)', <HeadlineCard analysis={unassessableAnalysis} />],
  ['PositionProfile', <PositionProfile analysis={sampleAnalysis} />],
  ['TrendChart', <TrendChart trend={sampleAnalysis.trend} />],
  ['AttributionTable (lineage)', <AttributionTable attribution={sampleAnalysis.lineage} label="Pango lineage" oligoName={sampleAnalysis.name} />],
  ['AttributionTable (country)', <AttributionTable attribution={sampleAnalysis.country} label="Country" oligoName={sampleAnalysis.name} />],
  [
    'InsertionNote',
    <InsertionNote
      insertions={sampleAnalysis.insertions}
      denominator={sampleAnalysis.metrics.nFullCoverage}
      oligoName={sampleAnalysis.name}
    />,
  ],
  ['SeverityBadge', <SeverityBadge severity={sampleAnalysis.severity} />],
  ['CaveatPanel', <CaveatPanel result={bothOligos} />],
  ['ResultsPanel', <ResultsPanel result={bothOligos} />],
];

describe('no percentage is ever rendered without its N', () => {
  it.each(CASES)('%s', (_name, element) => {
    const { container } = render(element);
    expect(barePercentages(container)).toEqual([]);
  });

  it('the check itself catches a bare percentage', () => {
    // Without this the suite could pass because the detector is broken rather
    // than because the components are clean.
    const { container } = render(<p>95.9%</p>);
    expect(barePercentages(container)).toEqual([{ where: '<p>', text: '95.9%' }]);
  });

  it('a percentage stated with its counts is accepted', () => {
    const { container } = render(<p>95.9% (67,520 of 70,387)</p>);
    expect(barePercentages(container)).toEqual([]);
  });
});
