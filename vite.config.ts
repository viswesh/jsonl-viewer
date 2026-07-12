import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: {
    // Playwright owns e2e/*.spec.ts — exclude them from vitest, but keep
    // vitest's own defaults (node_modules, dist, .git, …) so it doesn't walk
    // the git dir.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
