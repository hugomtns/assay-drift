import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.ts';

// mergeConfig concatenates array fields rather than replacing them, so the
// base config's `exclude: [..., '**/*.live.test.ts']` (added in vitest.config.ts
// to keep `npm test` off the network) would otherwise survive the merge and
// exclude the very files this config's `include` is meant to select. Strip
// that one carried-over pattern after merging so `include` wins as intended.
const merged = mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ['**/node_modules/**', '**/dist/**'],
      include: ['**/*.live.test.ts'],
      testTimeout: 120_000,
    },
  }),
);

if (merged.test?.exclude) {
  merged.test.exclude = merged.test.exclude.filter((pattern: string) => pattern !== '**/*.live.test.ts');
}

export default merged;
