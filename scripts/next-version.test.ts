import { describe, it, expect } from 'vitest';
import { classify, bump } from './next-version';

/**
 * The rules that decide what a deployed artefact gets to call itself.
 *
 * Worth testing rather than eyeballing: the version ends up in the methods
 * paragraph users paste into documents, so a misclassification does not just
 * produce an ugly number, it produces two different builds that claim to be the
 * same one.
 */
describe('classify', () => {
  it('treats a bare feat as a minor', () => {
    expect(classify(['feat: add a thing', 'chore: tidy'], '').level).toBe('minor');
  });

  it('treats a scoped feat as a minor', () => {
    expect(classify(['feat(ui): add a thing'], '').level).toBe('minor');
  });

  it('treats anything else as a patch', () => {
    const subjects = ['fix: a bug', 'docs: a word', 'perf: faster', 'chore: bump', 'test: cover'];
    expect(classify(subjects, '').level).toBe('patch');
  });

  it('treats a bang as a major, scoped or not', () => {
    expect(classify(['feat!: drop a thing'], '').level).toBe('major');
    expect(classify(['fix(core)!: change a signature'], '').level).toBe('major');
  });

  it('treats a BREAKING CHANGE trailer as a major even without a bang', () => {
    expect(classify(['fix: something'], 'BREAKING CHANGE: the API moved').level).toBe('major');
  });

  it('lets the highest bump win regardless of commit order', () => {
    // A patch listed first must not shadow a feature listed later.
    expect(classify(['chore: tidy', 'feat: add a thing'], '').level).toBe('minor');
    expect(classify(['feat: add a thing', 'fix!: break a thing'], '').level).toBe('major');
  });

  it('does not mistake prose for a breaking marker', () => {
    // "BREAKING CHANGE" has to start a line to count; a mention inside a
    // sentence is someone describing one, not declaring one.
    expect(classify(['fix: a bug'], 'This avoids a BREAKING CHANGE: none here').level).toBe('patch');
    expect(classify(['fix: not a feature, despite the word feat'], '').level).toBe('patch');
  });
});

describe('bump', () => {
  it('increments the right component and resets the ones below it', () => {
    expect(bump('1.4.2', 'patch')).toBe('1.4.3');
    expect(bump('1.4.2', 'minor')).toBe('1.5.0');
    expect(bump('1.4.2', 'major')).toBe('2.0.0');
  });

  it('refuses a version that is not semver rather than inventing one', () => {
    expect(() => bump('1.0', 'patch')).toThrow(/not a semver/);
    expect(() => bump('v1.0.0', 'patch')).toThrow(/not a semver/);
  });
});
