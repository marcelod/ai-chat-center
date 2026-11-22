import { defineConfig } from 'vitest/config';

// Slow packaging test (runs the full build). Run with `npm run test:build`.
export default defineConfig({
  test: { include: ['test/plugin/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
});
