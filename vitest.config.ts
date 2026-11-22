import { defineConfig } from 'vitest/config';

export default defineConfig({
  // test/plugin runs the full build; it is covered by `npm run test:build`.
  // testTimeout: generous, so a loaded CI runner (or 8 parallel runs) never times out a test whose
  // result does not depend on time; time-dependent tests poll with their own deadlines.
  test: { include: ['test/**/*.test.ts'], exclude: ['test/plugin/**', '**/node_modules/**'], testTimeout: 30_000 },
});
