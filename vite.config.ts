import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: {
    // Playwright owns e2e/*.spec.ts — keep vitest from also collecting them.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
