import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import requireNWithPercentage from './eslint-rules/require-n-with-percentage.js';

/**
 * A flat-config plugin is just an object with a `rules` map, so the project's
 * own rules need no package and no build step.
 */
const local = {
  rules: { 'require-n-with-percentage': requireNWithPercentage },
};

export default tseslint.config(
  globalIgnores(['dist', 'coverage', 'storybook-static']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Global Constraint 6, enforced at the only layer that can render one.
    // Test files are excluded: they have to be able to write the bad string in
    // order to assert that the product does not.
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/**/*.test.{ts,tsx}'],
    plugins: { local },
    rules: { 'local/require-n-with-percentage': 'error' },
  },
);
