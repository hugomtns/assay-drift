import { describe, it, expect } from 'vitest';
import {
  MIN_DENOMINATOR, AMBER_FRACTION, RED_FRACTION, AMBER_SCORE, RED_SCORE,
  UNIT_OF_ANALYSIS, SEVERITY_DISCLAIMER, REGULATORY_STATEMENT,
} from './constants';

describe('analysis constants', () => {
  it('orders the severity thresholds sensibly', () => {
    expect(AMBER_FRACTION).toBeLessThan(RED_FRACTION);
    expect(AMBER_SCORE).toBeLessThan(RED_SCORE);
  });
  it('requires a meaningful denominator', () => {
    expect(MIN_DENOMINATOR).toBeGreaterThanOrEqual(50);
  });
  it('states the unit of analysis in plain language', () => {
    expect(UNIT_OF_ANALYSIS).toMatch(/definite base call at every position/i);
  });
  it('labels the severity indicator as a heuristic', () => {
    expect(SEVERITY_DISCLAIMER).toMatch(/heuristic/i);
    expect(SEVERITY_DISCLAIMER).not.toMatch(/predict(s|ion)\b/i);
  });
  it('states the regulatory position without hedging', () => {
    expect(REGULATORY_STATEMENT).toMatch(/not a diagnostic device/i);
    expect(REGULATORY_STATEMENT).toMatch(/not the same as assay failure/i);
  });
});
