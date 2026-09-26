import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
// Served from the root of https://quiz.smlz.ch, so the default base ('/')
// is correct in both dev and production.
export default defineConfig({
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
})
