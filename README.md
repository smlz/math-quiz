# Math Quiz

[![Test](https://github.com/smlz/math-quiz/actions/workflows/test.yml/badge.svg)](https://github.com/smlz/math-quiz/actions/workflows/test.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A live quiz app for maths lessons. A **host** runs the game on a shared screen
(projector); **players** join from their own devices with a 6-digit PIN or by
scanning a QR code.

Question prompts and answer options are authored as **Typst** source and
compiled to SVG in the browser via [typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
(WASM) — plain text, math and figures (`cetz`) all use the same syntax.
Player devices only ever show four coloured A/B/C/D buttons; the question
itself is read off the host screen.

The full design is documented in [SPEC.md](SPEC.md); the quiz file format is
described in [§3](SPEC.md#3-question-authoring).

This app is mostly vibe coded. Use at your own risk!

## Architecture

| Part | Location | Notes |
|------|----------|-------|
| Backend | [quiz_relay_api.py](quiz_relay_api.py) | FastAPI. A stateless message relay under `/api/v1`: it mints session PINs and signed tokens, then fans opaque JSON between two SSE streams. It stores nothing — not the quiz, not the answers, not even the list of sessions — so a restart costs a few seconds of reconnect rather than the game. See [SPEC.md](SPEC.md). |
| Frontend | [frontend/](frontend) | Vue 3 (Composition API) + Vite + TypeScript. Hash routes: `#/join` mounts the player app, anything else the host app — so any static file server can host it without SPA rewrite rules. The host setup screen shows a live side-by-side preview of the quiz. All quiz state lives in the host's browser tab. |
| Database | none | Deliberately. The host re-broadcasts a full state snapshot every few seconds, so anyone who missed something catches up from the host instead of from stored history. |

## Prerequisites

- Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/)
- Node.js (with npm)

## Running in dev mode

Two processes, in two terminals, both needed.

**1. Backend** (from the repo root, serves on `http://127.0.0.1:8000`):

```powershell
uv sync
uv run fastapi dev
```

Set `SERVER_SECRET` in production so tokens minted before a restart stay
valid; without it a random one is generated per process, which is what you
want locally and in tests.

Browsers may only call the relay from an allowlisted origin: the deployed
frontend (`https://quiz.smlz.ch`) plus the local Vite dev/preview origins.
Set `ALLOWED_ORIGINS` (comma-separated) to replace that list, e.g. for a
staging deployment.

**2. Frontend** (from `frontend/`, serves on `http://127.0.0.1:5173`):

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to the backend, so open only the Vite URL in the browser.
The host screen is at `/`, players join at `/#/join` (the lobby's QR code
links there with the PIN prefilled).

## Building

```powershell
cd frontend
npm run build      # type-checks with vue-tsc, then bundles to frontend/dist
npm run preview    # serve the production bundle locally
```

The backend needs no build step; deploy it with `uv run fastapi deploy`, or
with any ASGI server, e.g. `uvicorn quiz_relay_api:app`.

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) deploys on every
push to `main`, but only after the full test suite
([.github/workflows/test.yml](.github/workflows/test.yml)) passes: the frontend
goes to GitHub Pages and the backend to FastAPI Cloud (via the
`FASTAPI_CLOUD_TOKEN` / `FASTAPI_CLOUD_APP_ID` repository secrets).
[frontend/public/CNAME](frontend/public/CNAME) keeps the `quiz.smlz.ch` custom
domain attached to each deployment.

## Running tests

**Backend** (pytest, from the repo root):

```powershell
uv run pytest -v
```

**Frontend unit tests** (Vitest — quiz-file parser):

```powershell
cd frontend
npm test
```

**Browser end-to-end test** (Playwright — drives a full multiplayer game with
one host and two player contexts):

```powershell
cd frontend
npx playwright install chromium   # once
npm run test:e2e
```

The Playwright config starts both the backend and the Vite dev server itself,
using a separate `e2e-test.db`, so no servers need to be running beforehand.

All three suites run automatically on every push and pull request via
[.github/workflows/test.yml](.github/workflows/test.yml). [Dependabot](.github/dependabot.yml)
opens a pull request weekly for outdated backend (uv), frontend (npm) and
GitHub Actions dependencies, which then run through the same CI checks.

## License

GPLv3 — see [LICENSE](LICENSE).
