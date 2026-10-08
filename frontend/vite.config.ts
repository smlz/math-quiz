import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { TYPST_SCRIPT_URL } from './src/quiz/typstAssets.ts'

/**
 * Adds a Content-Security-Policy <meta> to the built index.html (GitHub Pages
 * cannot send headers). Defence in depth behind the SVG sanitizer: no
 * injected or inline script runs -- `javascript:` URLs included -- except the
 * page's own inline scripts, allowed by hash. connect-src has to stay open to
 * any https origin, because a quiz may be fetched from any `?src=` URL.
 * Build-only, so Vite's dev server and HMR are unaffected.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Hashed from the final HTML, so editing an inline script can never
        // leave a stale hash behind.
        const inlineScriptHashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          ([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
        )
        const policy = [
          "default-src 'self'",
          // typst.ts needs 'unsafe-eval': its wasm-bindgen glue lets the WASM
          // build JS functions with `new Function`, and Typst never compiles
          // without it. That still blocks what this policy is for -- inline
          // scripts and `javascript:` URLs need 'unsafe-inline', which stays
          // off.
          `script-src 'self' ${TYPST_SCRIPT_URL} 'unsafe-eval' ${inlineScriptHashes.join(' ')}`,
          // Typst SVG and Vue's style bindings use inline style attributes.
          "style-src 'self' 'unsafe-inline'",
          // The lobby's QR code is a data: URL; Typst images are data: URIs.
          "img-src 'self' data: blob:",
          "connect-src 'self' https:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ')
        return [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
        ]
      },
    },
  }
}

// https://vite.dev/config/
// Served from the root of https://quiz.smlz.ch, so the default base ('/')
// is correct in both dev and production.
export default defineConfig({
  plugins: [vue(), contentSecurityPolicy()],
  server: {
    fs: {
      // `typst/` (the quiz template and example quiz) lives at the repo root
      // and is imported with `?raw`, so the dev server must be able to read it.
      allow: ['..'],
    },
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
