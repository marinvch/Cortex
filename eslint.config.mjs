// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'bundle/**',
      'node_modules/**',
      'eslint.config.mjs',
      '*.js',
    ],
  },
  {
    files: ['src/**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    rules: {
      // Prefer const over let where reassignment never occurs
      'prefer-const': 'warn',
      // Disallow unused variables (TypeScript-aware)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Warn on explicit `any`; prefer `unknown` for unknown shapes
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow non-null assertions (useful in generator outputs)
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Disallow switch fallthrough bugs
      'no-fallthrough': 'error',
    },
  },
);
