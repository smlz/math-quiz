import { defineConfig, devices } from "@playwright/test";

// Browser-driven e2e test (SPEC.md §12.2 step 6): boots the real FastAPI
// backend and the Vite dev server (which proxies /api to it, see
// vite.config.ts) and drives one host tab + player tabs against them.
export default defineConfig({
  testDir: "./e2e",
  // The host setup screen now compiles every prompt/option with Typst
  // before entering the lobby (SPEC.md §4.1 "preview" gating the QR code) -
  // in a cold browser context this means fetching typst.ts's WASM
  // compiler/renderer plus several distinct @preview packages (cetz,
  // cetz-plot, cetz-venn) fresh over the network, which needs more headroom
  // than the previous 120s budget.
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: {
    // typst.ts fetches its WASM compiler/renderer (and any @preview
    // packages) from a CDN on first use (SPEC.md §11), which can be slow.
    timeout: 20_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // A dedicated sqlite file keeps this from touching the local dev DB
      // (messenger.db); the in-memory session/roster state in math_quiz.py
      // always starts empty on process boot regardless.
      command: "uv run uvicorn api_async:app --host 127.0.0.1 --port 3000",
      cwd: "..",
      url: "http://127.0.0.1:3000/",
      env: { DATABASE_URL: "sqlite+aiosqlite:///./e2e-test.db" },
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
      command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
      cwd: ".",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
