import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // Relay API calls to the FastAPI backend (uvicorn, see api_async.py's
    // `__main__` block) during local dev; production serves both from the
    // same origin, so no proxy is needed there.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'node',
    // e2e/ holds Playwright specs (run via `npm run test:e2e`), which use a
    // different test API and aren't valid vitest test files.
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
