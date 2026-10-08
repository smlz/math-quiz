import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Where the browser loads typst.ts from (see src/quiz/typst.ts), derived from
 * the `@myriaddreamin/*` devDependencies. They are never bundled -- they are
 * in package.json only so their exact versions are pinned by the lockfile and
 * bumped by Dependabot like any other dependency.
 *
 * Every URL carries the installed version (an unversioned jsdelivr URL
 * serves whatever was published last), and the script's integrity hash is
 * computed from the installed file: jsdelivr serves the npm tarball's files
 * byte for byte, so the browser runs exactly what npm verified against the
 * lockfile. A version bump updates URLs and hash together, with nothing to
 * recompute by hand.
 */
function typstTsAssets() {
  const packageDir = (name: string) => new URL(`./node_modules/@myriaddreamin/${name}/`, import.meta.url)
  const installedFile = (name: string, path: string) => {
    const file = new URL(path, packageDir(name))
    // Fail the build, not the classroom, if a release moves its files.
    if (!existsSync(file)) throw new Error(`@myriaddreamin/${name} has no ${path} -- did its layout change?`)
    return file
  }
  const cdnUrl = (name: string, path: string) => {
    installedFile(name, path)
    const { version } = JSON.parse(readFileSync(new URL('package.json', packageDir(name)), 'utf8'))
    return `https://cdn.jsdelivr.net/npm/@myriaddreamin/${name}@${version}/${path}`
  }

  const script = 'dist/esm/contrib/all-in-one-lite.bundle.js'
  return {
    scriptUrl: cdnUrl('typst.ts', script),
    scriptIntegrity: `sha384-${createHash('sha384').update(readFileSync(installedFile('typst.ts', script))).digest('base64')}`,
    // The WASM is fetched by the script itself, which offers no integrity
    // option; the pinned version is what keeps it matched to the script.
    compilerWasmUrl: cdnUrl('typst-ts-web-compiler', 'pkg/typst_ts_web_compiler_bg.wasm'),
    rendererWasmUrl: cdnUrl('typst-ts-renderer', 'pkg/typst_ts_renderer_bg.wasm'),
  }
}

const typstTs = typstTsAssets()

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
          `script-src 'self' ${typstTs.scriptUrl} 'unsafe-eval' ${inlineScriptHashes.join(' ')}`,
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
  define: {
    __TYPST_TS__: JSON.stringify(typstTs),
  },
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
