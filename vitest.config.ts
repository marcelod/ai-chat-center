import { defineConfig } from 'vitest/config';

export default defineConfig({
  // test/plugin runs the full build; it is covered by `npm run test:build`.
  test: { include: ['test/**/*.test.ts'], exclude: ['test/plugin/**', '**/node_modules/**'] },
});
