import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config (Story 1.1).
 *
 * The authoritative AD-1 dependency-boundary gate is **dependency-cruiser**
 * (`pnpm boundaries`), verified to fail CI on a forbidden edge. An
 * `eslint-plugin-boundaries` in-editor layer was trialled but could not be made
 * to classify workspace files reliably on this setup (it was a silent no-op —
 * a `core → apps/hub` violation produced no lint error), so it was removed
 * rather than ship a gate that looks protective but enforces nothing. Revisit
 * only with a config proven to fail on a planted violation.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      // BMAD tooling / agent config — git-ignored, never seen by CI. Ignore locally
      // too so `eslint .` doesn't diverge from CI on a clean checkout.
      '_bmad/**',
      '_bmad-output/**',
      '.claude/**',
      '**/next-env.d.ts',
      '**/*.tsbuildinfo',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/*.config.cjs',
      '**/*.config.js',
      '.dependency-cruiser.cjs',
      'eslint.config.mjs',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // A leading underscore means "declared on purpose, not used" — the standard
      // convention, and the only way to write a mock whose PARAMETER TYPES matter
      // while its body ignores them. `vi.fn(() => …)` gives a mock an empty
      // argument tuple, so `mock.calls[0][0]` becomes a slot the type system says
      // cannot exist; declaring `(_blob: Blob)` is what makes that assertion
      // type-safe. Without this rule the choice is between an unchecked assertion
      // and a lint error, which is not a choice.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  eslintConfigPrettier,
);
