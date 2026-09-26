import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Deployed to https://smlz.github.io/math-quiz/, so production assets live
  // under that subpath; the dev server stays at the root.
  base: command === 'build' ? '/math-quiz/' : '/',
  plugins: [vue()],
  server: {
    // Relay API calls to the local backend during dev; the backend serves the
    // same `/api/v1` paths, so nothing is rewritten. In production the
    // frontend targets the deployed relay directly.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'node',
    // e2e/ holds Playwright specs (run via `npm run test:e2e`), which use a
    // different test API and aren't valid vitest test files.
    exclude: ['e2e/**', 'node_modules/**'],
  },
}))
