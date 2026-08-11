import { describe, it, expect } from 'vitest';
import { formatCount, formatPercent } from './format';

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
    expect(formatPercent(null)).toBe('not enough data');
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
