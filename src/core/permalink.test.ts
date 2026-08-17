import { describe, it, expect } from 'vitest';
import { decodePermalink, encodePermalink, type PermalinkState } from './permalink';
// Imports below this line support the suites at the foot of the file; the two
// above and the fixture below are transcribed from the plan unchanged.
import { MAX_PERMALINK_LENGTH, PERMALINK_PREFIX } from './permalink';
import libraryRaw from '../data/assays/library.json';
import { parseLibrary, verifyAssay } from '../data/assays/schema';

const state: PermalinkState = {
  pathogenId: 'sars-cov-2',
  oligos: [{ name: 'N1-F', role: 'forward', sequence: 'TACATGTCTCTGGGACCAATGG' }],
  sites: { 'N1-F': { segment: 'main', strand: 'plus', start: 21765 } },
  scope: { dateFrom: '2021-02-01', dateTo: '2021-03-01', countries: ['United Kingdom'], lineages: [] },
};

describe('permalink', () => {
  it('round-trips', () => {
    expect(decodePermalink(encodePermalink(state))).toEqual(state);
  });
  it('starts with a readable prefix', () => {
    expect(encodePermalink(state).startsWith('#q=')).toBe(true);
  });
  it('preserves the chosen binding site so an ambiguous case reproduces exactly', () => {
    expect(decodePermalink(encodePermalink(state))!.sites['N1-F']!.start).toBe(21765);
  });
  it('returns null for junk rather than throwing', () => {
    expect(decodePermalink('#q=not-json')).toBeNull();
    expect(decodePermalink('')).toBeNull();
    expect(decodePermalink('#q=' + encodeURIComponent('{"pathogenId":"ebola"}'))).toBeNull();
  });
  it('rejects an oversized payload instead of producing an unusable link', () => {
    const huge: PermalinkState = {
      ...state,
      oligos: Array.from({ length: 200 }, (_, i) => ({
        name: `o${i}`, role: 'forward' as const, sequence: 'ACGT'.repeat(10),
      })),
    };
    expect(() => encodePermalink(huge)).toThrow(/too large/i);
  });
});

// ---------------------------------------------------------------------------
// Added beyond the plan's five. The block above is transcribed verbatim and is
// the only part of the file the plan wrote; everything below covers the
// amendment that a decoded permalink is untrusted input. The plan's own junk
// test sends `{"pathogenId":"ebola"}`, which is rejected for four reasons at
// once (unknown id, no oligos, no sites, no scope) and so proves none of them
// individually. These change exactly one field of an otherwise valid payload
// at a time, which is the only way to know which check is actually holding.
// ---------------------------------------------------------------------------

/** A link carrying whatever object it is handed, however wrong. */
const link = (payload: unknown): string =>
  PERMALINK_PREFIX + encodeURIComponent(JSON.stringify(payload));

/** The valid fixture as a mutable plain object, for one-field corruption. */
const asJson = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(state)) as Record<string, unknown>;

const withOligo = (patch: Record<string, unknown>): string => {
  const payload = asJson();
  payload['oligos'] = [{ ...(state.oligos[0] as object), ...patch }];
  return link(payload);
};

const withSite = (patch: Record<string, unknown>): string => {
  const payload = asJson();
  payload['sites'] = { 'N1-F': { ...(state.sites['N1-F'] as object), ...patch } };
  return link(payload);
};

const withScope = (patch: Record<string, unknown>): string => {
  const payload = asJson();
  payload['scope'] = { ...state.scope, ...patch };
  return link(payload);
};

describe('permalink is a readable link, not an opaque blob', () => {
  it('carries the sequence in plain text so a recipient can see what it asks for', () => {
    const hash = encodePermalink(state);
    // Not base64, not compressed: the pathogen, the sequence and the dates are
    // all legible in the URL before anyone decides to open it.
    expect(hash).toContain('TACATGTCTCTGGGACCAATGG');
    expect(hash).toContain('sars-cov-2');
    expect(hash).toContain('2021-02-01');
  });

  it('round-trips through a real browser hash without losing anything', () => {
    // `encodeURIComponent` escapes `{`, `"` and `,`; the browser hands the hash
    // back exactly as written, so this is the shape decode really receives.
    const url = new URL(`https://example.test/${encodePermalink(state)}`);
    expect(decodePermalink(url.hash)).toEqual(state);
  });
});

describe('permalink rejects a hostile pathogen, role or sequence', () => {
  it('rejects an unknown pathogen id in an otherwise perfect payload', () => {
    const payload = asJson();
    payload['pathogenId'] = 'ebola';
    expect(decodePermalink(link(payload))).toBeNull();
    // ...and the same payload with a known id is fine, so the id is what did it.
    payload['pathogenId'] = 'h5n1';
    expect(decodePermalink(link(payload))?.pathogenId).toBe('h5n1');
  });

  it('rejects a role outside forward | reverse | probe', () => {
    expect(decodePermalink(withOligo({ role: 'primer' }))).toBeNull();
    expect(decodePermalink(withOligo({ role: null }))).toBeNull();
    expect(decodePermalink(withOligo({ role: 'probe' }))?.oligos[0]?.role).toBe('probe');
  });

  it('refuses to let a link inject an arbitrary string into a genomic query', () => {
    // A non-IUPAC character. Without this check the string would travel
    // straight into an `advancedQuery`.
    expect(decodePermalink(withOligo({ sequence: 'TACATGTCTCTGGGACCAATG*' }))).toBeNull();
    expect(decodePermalink(withOligo({ sequence: 'DROP TABLE sequences' }))).toBeNull();
    expect(decodePermalink(withOligo({ sequence: 42 }))).toBeNull();
  });

  it('rejects a sequence the paste box would itself have rejected for length', () => {
    expect(decodePermalink(withOligo({ sequence: 'ACGTACGTACG' }))).toBeNull();
    expect(decodePermalink(withOligo({ sequence: 'ACGT'.repeat(16) }))).toBeNull();
  });

  it('rejects a sequence that is merely repairable rather than repairing it', () => {
    // Lower case and embedded whitespace both normalise cleanly, which is
    // exactly why they must not be accepted here: silently rewriting a field
    // means the link the sender reads is not the analysis the reader runs.
    expect(decodePermalink(withOligo({ sequence: 'tacatgtctctgggaccaatgg' }))).toBeNull();
    expect(decodePermalink(withOligo({ sequence: 'TACATGTCT CTGGGACCAATGG' }))).toBeNull();
  });

  it('rejects an empty oligo list, so a link cannot decode to an empty analysis', () => {
    const payload = asJson();
    payload['oligos'] = [];
    payload['sites'] = {};
    expect(decodePermalink(link(payload))).toBeNull();
  });
});

describe('permalink rejects a hostile binding site', () => {
  it('rejects a strand that is not plus or minus', () => {
    expect(decodePermalink(withSite({ strand: 'both' }))).toBeNull();
    expect(decodePermalink(withSite({ strand: '+' }))).toBeNull();
    expect(decodePermalink(withSite({ strand: 'minus' }))?.sites['N1-F']?.strand).toBe('minus');
  });

  it('rejects a start that is not a positive integer', () => {
    for (const start of [0, -1, 1.5, '21765', null, Number.NaN]) {
      expect(decodePermalink(withSite({ start }))).toBeNull();
    }
  });

  it('rejects an empty segment name', () => {
    expect(decodePermalink(withSite({ segment: '' }))).toBeNull();
  });

  it('rejects an oligo with no site rather than silently dropping it', () => {
    // The dangerous shape: `analysisOligos` skips an oligo with no site, so a
    // two-oligo link would quietly run as a one-oligo analysis and still
    // present itself as a faithful reproduction.
    const payload = asJson();
    payload['sites'] = {};
    expect(decodePermalink(link(payload))).toBeNull();
  });

  it('rejects a site that belongs to no oligo', () => {
    const payload = asJson();
    payload['sites'] = {
      'N1-F': state.sites['N1-F'] as object,
      'N1-R': { segment: 'main', strand: 'minus', start: 21800 },
    };
    expect(decodePermalink(link(payload))).toBeNull();
  });

  it('rejects duplicate oligo names, which would make the site map ambiguous', () => {
    const payload = asJson();
    const first = state.oligos[0] as object;
    payload['oligos'] = [first, { ...first }];
    expect(decodePermalink(link(payload))).toBeNull();
    expect(() =>
      encodePermalink({ ...state, oligos: [state.oligos[0]!, { ...state.oligos[0]! }] }),
    ).toThrow(/share a name/i);
  });
});

describe('permalink rejects a hostile scope', () => {
  it('rejects a date that is not ISO yyyy-mm-dd', () => {
    expect(decodePermalink(withScope({ dateFrom: '01/02/2021' }))).toBeNull();
    expect(decodePermalink(withScope({ dateFrom: '2021-2-1' }))).toBeNull();
    expect(decodePermalink(withScope({ dateTo: '' }))).toBeNull();
    expect(decodePermalink(withScope({ dateTo: 20210301 }))).toBeNull();
  });

  it('rejects a date with the right shape that is not a real day', () => {
    expect(decodePermalink(withScope({ dateFrom: '2021-02-31' }))).toBeNull();
    expect(decodePermalink(withScope({ dateFrom: '2021-13-01' }))).toBeNull();
    // The leap day that does exist still passes, so this is not just arithmetic.
    expect(decodePermalink(withScope({ dateFrom: '2020-02-29' }))?.scope.dateFrom)
      .toBe('2020-02-29');
  });

  it('rejects an inverted range, which "Run analysis" would refuse anyway', () => {
    expect(decodePermalink(withScope({ dateFrom: '2021-03-02' }))).toBeNull();
    // Equal ends are a single day, not an inversion.
    expect(decodePermalink(withScope({ dateFrom: '2021-03-01' }))?.scope.dateFrom)
      .toBe('2021-03-01');
  });

  it('rejects filter lists that are not arrays of non-empty strings', () => {
    expect(decodePermalink(withScope({ countries: 'United Kingdom' }))).toBeNull();
    expect(decodePermalink(withScope({ countries: [''] }))).toBeNull();
    expect(decodePermalink(withScope({ lineages: [null] }))).toBeNull();
    expect(decodePermalink(withScope({ lineages: [{}] }))).toBeNull();
  });
});

describe('permalink rejects anything it does not understand', () => {
  it('rejects unknown keys rather than ignoring them', () => {
    const payload = asJson();
    payload['runOnLoad'] = true;
    expect(decodePermalink(link(payload))).toBeNull();
    expect(decodePermalink(withOligo({ label: 'x' }))).toBeNull();
    expect(decodePermalink(withSite({ end: 21786 }))).toBeNull();
    expect(decodePermalink(withScope({ hosts: [] }))).toBeNull();
  });

  it('rejects a hash that is not a permalink at all', () => {
    expect(decodePermalink('#')).toBeNull();
    expect(decodePermalink('#other=1')).toBeNull();
    expect(decodePermalink('q=' + encodeURIComponent(JSON.stringify(state)))).toBeNull();
  });

  it('refuses an over-long hash before it parses it', () => {
    const overLong = PERMALINK_PREFIX + 'A'.repeat(MAX_PERMALINK_LENGTH);
    expect(overLong.length).toBeGreaterThan(MAX_PERMALINK_LENGTH);
    expect(decodePermalink(overLong)).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    const hostile = [
      '', '#q=', '#q=%', '#q=%E0%A4%A', '#q=null', '#q=true', '#q=[]', '#q=%22string%22',
      '#q=' + encodeURIComponent('{"pathogenId":'),
      '#q=' + encodeURIComponent(JSON.stringify([state])),
      '#q=' + encodeURIComponent(JSON.stringify({ ...state, oligos: 'not-an-array' })),
      '#q=' + encodeURIComponent(JSON.stringify({ ...state, sites: [] })),
      '#q=' + encodeURIComponent(JSON.stringify({ ...state, scope: null })),
      '#q=' + encodeURIComponent('{"__proto__":{"polluted":true}}'),
    ];
    for (const hash of hostile) {
      expect(() => decodePermalink(hash)).not.toThrow();
      expect(decodePermalink(hash)).toBeNull();
    }
  });
});

// The amendment's reality check, kept as a test rather than a one-off
// measurement so the limit cannot drift away from the flagship example.
describe('permalink size limit against the real bundled assay', () => {
  const cdcN1 = parseLibrary(libraryRaw).assays.find((a) => a.id === 'cdc-2019-ncov-n1')!;

  // Sites come from the library's own verification pass, so no coordinate and
  // no sequence is transcribed here (Global Constraint 2).
  const realState: PermalinkState = {
    pathogenId: cdcN1.pathogenId,
    oligos: cdcN1.oligos.map((o) => ({ name: o.name, role: o.role, sequence: o.sequence })),
    sites: Object.fromEntries(
      verifyAssay(cdcN1).resolved.map((r) => [
        r.name,
        { segment: r.segment, strand: r.strand, start: r.start },
      ]),
    ),
    scope: { dateFrom: '2020-01-01', dateTo: '2026-08-17', countries: [], lineages: [] },
  };

  it('encodes the CDC N1 assay well inside the limit and round-trips it', () => {
    const hash = encodePermalink(realState);
    expect(hash.length).toBeLessThan(MAX_PERMALINK_LENGTH / 2);
    expect(decodePermalink(hash)).toEqual(realState);
  });

  it('still fits once a realistic set of filters is added', () => {
    const filtered: PermalinkState = {
      ...realState,
      scope: {
        ...realState.scope,
        countries: ['United Kingdom', 'United States', 'Germany'],
        lineages: ['BA.2.86', 'XBB.1.5'],
      },
    };
    expect(encodePermalink(filtered).length).toBeLessThan(MAX_PERMALINK_LENGTH);
  });
});
