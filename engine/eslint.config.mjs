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

      // ── Security bans ────────────────────────────────────────────────────
      // Ban string-form exec/execSync (shell injection vector). Only the
      // safe array-args form via spawnSync is permitted in this codebase.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='exec']",
          message: "Use spawnSync with an args array instead of exec() to prevent shell injection.",
        },
        {
          selector: "CallExpression[callee.name='execSync']",
          message: "Use spawnSync with an args array instead of execSync() to prevent shell injection.",
        },
        {
          selector: "CallExpression[callee.object.name='child_process'][callee.property.name='exec']",
          message: "Use spawnSync with an args array instead of child_process.exec() to prevent shell injection.",
        },
        {
          selector: "CallExpression[callee.object.name='child_process'][callee.property.name='execSync']",
          message: "Use spawnSync with an args array instead of child_process.execSync() to prevent shell injection.",
        },
      ],
      // Ban empty catch blocks — they silently swallow errors. Use a
      // comment (/* ignore */) or log the error to opt out explicitly.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  // Allow console.* only in CLI surface and MCP server entry points
  {
    files: [
      'src/cli/**/*.ts',
      'src/generate.ts',
      'src/mcp-server/index.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/cli/**/*.ts',
      'src/generate.ts',
      'src/mcp-server/index.ts',
    ],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
