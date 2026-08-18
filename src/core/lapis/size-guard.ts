import { formatCount } from '../format';
import type { LapisEndpoint } from './transport';

/**
 * The point at which a response is large enough to be worth mentioning.
 *
 * A **raw**, decoded byte count, not a compressed one. The reference figure
 * from the plan's Part I is a `nucleotideMutations` query with
 * `minProportion: 0` over SARS-CoV-2 / United Kingdom / one month: 20,844
 * rows, 3.27 MB raw, 438 KB gzipped. So 8 MB is roughly two and a half times
 * the heaviest scope that was actually measured -- comfortably above normal
 * use, and reached only by a scope wide enough that saying so is useful.
 *
 * Comparing a `Content-Length` against this would be comparing the compressed
 * figure against a raw threshold: 438 KB never exceeds 8 MB, so the guard
 * would never fire. See `utf8ByteLength` for what is measured instead.
 */
export const MUTATIONS_SIZE_WARN_BYTES = 8_000_000;

/**
 * The UTF-8 length of a string, in bytes, without allocating a second copy of
 * it.
 *
 * `new TextEncoder().encode(text).length` is the obvious spelling and it is
 * the one this deliberately avoids: it allocates a byte array as large as the
 * text, and the text in question is the single heaviest thing this app holds.
 * On a 3.3 MB payload that is 3.3 MB of garbage produced purely to learn a
 * number. This walks the string instead -- one arithmetic pass, no allocation.
 *
 * `text.length` would have been free, but it counts UTF-16 code units: an
 * accented character in a country name counts one and weighs two, and an emoji
 * counts two and weighs four. The rule below is the UTF-8 encoding rule, and
 * the tests check it against `TextEncoder` on every class of input including
 * lone surrogates, which both encode as one replacement character.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A well-formed surrogate pair: one astral character, four bytes.
        bytes += 4;
        i += 1;
      } else {
        // A lone high surrogate. TextEncoder emits U+FFFD, which is three bytes.
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export interface SizeVerdict {
  ok: boolean;
  message: string | null;
}

const mb = (bytes: number): string => (bytes / 1_000_000).toFixed(1);

/**
 * Whether a response was large enough to be worth telling the user about.
 *
 * **This guard warns and does nothing else.** It does not raise
 * `minProportion`, drop rows, or narrow the scope. A floor on frequency would
 * hide low-frequency alleles, and low-frequency alleles are the entire reason
 * someone opens this tool: a mismatch carried by 0.3 percent of sequences is a
 * finding, not noise. Making the payload smaller by making the answer wrong is
 * not a trade this product gets to make silently.
 *
 * No percentage appears in the message (Global Constraint 6): `src/core/`
 * cannot reach `formatPercent`, and a hand-rolled one here is exactly the
 * mistake `diagnostics.ts` documents. Sizes are stated in MB with the
 * threshold beside them, and the byte count is grouped with `formatCount`.
 */
export function guardResponseSize(bytes: number, endpoint: LapisEndpoint | string): SizeVerdict {
  if (bytes <= MUTATIONS_SIZE_WARN_BYTES) return { ok: true, message: null };
  return {
    ok: false,
    message:
      `The ${endpoint} data for this scope is about ${mb(bytes)} MB once decoded ` +
      `(${formatCount(bytes)} bytes), past the ${mb(MUTATIONS_SIZE_WARN_BYTES)} MB point where ` +
      `this tool starts saying so. Nothing was dropped and no minimum frequency was raised, so ` +
      `every rare mismatch in scope is still counted — but a shorter date range or a single ` +
      `country would make this much lighter to load, especially on a slow connection.`,
  };
}
