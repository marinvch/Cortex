import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/tests/**',
        'src/validation/**',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 40,
      },
    },
  },
});
