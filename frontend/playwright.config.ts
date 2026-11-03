import { defineConfig, devices } from "@playwright/test";

// Browser-driven e2e test (SPEC.md §12.2 step 6): boots the real FastAPI
// backend and a production build behind `vite preview` (which proxies /api to
// it, see vite.config.ts) and drives one host tab + player tabs against them.
export default defineConfig({
  testDir: "./e2e",
  // The host setup screen now compiles every prompt/option with Typst
  // before entering the lobby (SPEC.md §4.1 "preview" gating the QR code) -
  // in a cold browser context this means fetching typst.ts's WASM
  // compiler/renderer plus several distinct @preview packages (cetz,
  // cetz-plot, cetz-venn) fresh over the network, which needs more headroom
  // than the previous 120s budget.
  timeout: 240_000,
  // Every test makes its own quiz on its own pin, so they share nothing but
  // the machine. Two at a time left the tests that watch real timers stable
  // on a 4-core laptop; `--workers` tries more.
  fullyParallel: true,
  workers: 2,
  // Once on CI, where a browser engine occasionally crashes outright (WebKit:
  // "internal error"). A test that only passes on its retry is still listed
  // as flaky in the report.
  retries: process.env.CI ? 1 : 0,
  // The summary reporter only writes on GitHub Actions (job summary page).
  reporter: [["list"], ["./e2e/github-summary-reporter.ts"]],
  expect: {
    // typst.ts fetches its WASM compiler/renderer (and any @preview
    // packages) from a CDN on first use (SPEC.md §11), which can be slow -
    // and compiling the cetz example quiz takes over 20s in WebKit/Firefox.
    timeout: 60_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Recording every test is slow, and hardly any of them ever need it. A
    // local run has no retries: add `--trace on` to look into a failure.
    trace: "on-first-retry",
  },
  // Players join on phones, and every iOS browser runs on WebKit. CI runs
  // each project as its own job (see .github/workflows/ci.yml).
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
    {
      // The relay keeps no state anywhere, so each run starts clean with no
      // database or fixture setup at all.
      command: "uv run uvicorn quiz_relay_api:app --host 127.0.0.1 --port 8000",
      cwd: "..",
      url: "http://127.0.0.1:8000/",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Bind explicitly to 127.0.0.1: on Windows, `vite --port ...` alone
      // binds "localhost" which can resolve to the IPv6 loopback (::1),
      // while the url check below only probes 127.0.0.1 (IPv4) -- without
      // --host 127.0.0.1 the health check never sees the server come up.
      //
      // A build rather than the dev server: a page loads one bundle instead of
      // some 70 modules, and it runs under the same Content-Security-Policy as
      // the deployed site. `--mode e2e` keeps it off the live relay.
      command:
        "npx vite build --mode e2e --outDir dist-e2e --emptyOutDir && " +
        "npx vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort",
      cwd: ".",
      url: "http://127.0.0.1:4173",
      // Never reused: a server left running would serve an out-of-date build,
      // and one from `npm run preview` would talk to the live relay.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
