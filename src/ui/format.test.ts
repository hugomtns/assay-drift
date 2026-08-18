import { describe, it, expect } from 'vitest';
import { formatCount, formatPercent, formatRate } from './format';

describe('formatCount', () => {
  it('groups thousands with a comma', () => {
    expect(formatCount(67520)).toBe('67,520');
    expect(formatCount(1998)).toBe('1,998');
  });

  it('leaves numbers below a thousand ungrouped', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('pins the locale so the separator does not depend on the host', () => {
    // A machine whose default locale is de-DE would render '67.520' from a
    // bare toLocaleString(); CI must agree with this dev box.
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('formatPercent', () => {
  it('says so when there is no rate, rather than showing zero', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('renders one decimal place with a percent suffix', () => {
    expect(formatPercent(67520 / 70387)).toBe('95.9%');
    expect(formatPercent(1998 / 46667)).toBe('4.3%');
    expect(formatPercent(0.9576)).toBe('95.8%');
    expect(formatPercent(1)).toBe('100.0%');
  });

  it('renders an exact zero as zero', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('never rounds a small but non-zero rate down to 0.0%', () => {
    expect(formatPercent(0.0001)).toBe('<0.1%');
  });
});

// ---------------------------------------------------------------------------
// Transcribed verbatim from implementation.md lines 6750-6773 (Task 6.1), with
// only the `describe` name kept as the plan wrote it. The two blocks above are
// the pre-existing tests and are deliberately retained: they carry the reasons
// for the `<0.1%` threshold and for the explicit 'en-US' locale, neither of
// which the plan's block covers.
// ---------------------------------------------------------------------------
describe('formatting', () => {
  it('groups thousands', () => {
    expect(formatCount(70387)).toBe('70,387');
  });
  it('shows one decimal place', () => {
    expect(formatPercent(0.9593)).toBe('95.9%');
    expect(formatPercent(0.0647)).toBe('6.5%');
  });
  it('distinguishes "very small" from "none"', () => {
    expect(formatPercent(0.0000672)).toBe('<0.1%');
    expect(formatPercent(0)).toBe('0.0%');
  });
  it('renders an em dash for an unavailable rate', () => {
    expect(formatPercent(null)).toBe('—');
  });
  it('always pairs a rate with its absolute numbers', () => {
    expect(formatRate({ fraction: 0.9593, numerator: 67520, denominator: 70387 }))
      .toBe('95.9% (67,520 of 70,387)');
  });
  it('omits the percentage but keeps the numbers when the rate is unavailable', () => {
    expect(formatRate({ fraction: null, numerator: 0, denominator: 0 }))
      .toBe('— (0 of 0)');
  });
});

describe('formatRate', () => {
  it('is the only renderer that can never print a bare percentage', () => {
    // Every branch carries both absolute numbers, including the hedged one.
    expect(formatRate({ fraction: 0.00007, numerator: 3, denominator: 44669 }))
      .toBe('<0.1% (3 of 44,669)');
    expect(formatRate({ fraction: 0, numerator: 0, denominator: 70387 }))
      .toBe('0.0% (0 of 70,387)');
  });
});
