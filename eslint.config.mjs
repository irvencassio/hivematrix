import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', 'dist/', 'video/', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.{mjs,mts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Lean initial rule set: correctness signal only, no style churn.
      // skipStrings=false is the default we want, but regexes legitimately
      // contain zero-width chars (e.g. the hidden-unicode scanner in skills/scan.ts).
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
