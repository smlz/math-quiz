# Math Quiz

[![CI](https://github.com/smlz/math-quiz/actions/workflows/ci.yml/badge.svg)](https://github.com/smlz/math-quiz/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

A minimalistic live quiz app (not only) for math lessons, designed for
_simplicity_ and _privacy_. A _host_ runs the game on a shared screen
(projector); _players_ join from their own devices with a 6-digit PIN or by
scanning a QR code.

Question prompts and answer options are authored as _Typst_ source and
rendered in the browser via
[typst.ts](https://github.com/Myriad-Dreamin/typst.ts) — plain text, math and
figures all use the same syntax. Player devices only ever show four colored
A/B/C/D buttons; the question and its answer options are read off the host
screen. There is one question type: multiple choice with exactly four options.

There is no login, no tracking, no ads, no analytics, no telemetry, no
cookies, no social media buttons. Only the host screen loads external scripts
(to render _Typst_); player devices load nothing from third parties. The
server stores no game data; its access logs are deleted after one day.

The full design is documented in [SPEC.md](SPEC.md); the quiz file format is
described in [§3](SPEC.md#3-question-authoring).

Although carefully designed, the app is mostly vibe-coded. Use at your own
risk!

## Architecture

| Part | Location | Notes |
|------|----------|-------|
| Backend | [quiz_relay_api.py](quiz_relay_api.py) | A stateless FastAPI message relay that only passes opaque JSON along. No database.|
| Frontend | [frontend/](frontend) | Vue 3 (Composition API) + Vite + TypeScript.|

## Prerequisites

- Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/)
- Node.js (with npm)

## Running in dev mode

You need two processes running in separate terminals.

**1. Backend** (from the repo root, serves on `http://127.0.0.1:8000`):

```powershell
uv sync
uv run fastapi dev
```

Set `SERVER_SECRET` in production so tokens minted before a restart stay
valid; without it a random one is generated per process, which is what you
want locally and in tests.

**2. Frontend** (from `frontend/`, serves on `http://127.0.0.1:5173`):

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to the backend, so open only the Vite URL in the browser.
Players join at `/` (the lobby's QR code links there with the PIN
prefilled); the host screen is at `/create`.

## Building

```powershell
cd frontend
npm run build      # type-checks with vue-tsc, then bundles to frontend/dist
npm run preview    # serve the production bundle locally
```

The backend needs no build step; deploy it with `uv run fastapi deploy`, or
with any ASGI server, e.g. `uvicorn quiz_relay_api:app`.

The [CI workflow](.github/workflows/ci.yml) runs the full test suite on every
push to `main`. Pushing a version tag (`v` plus the version in
`pyproject.toml`, e.g. `v1.0.8`) also triggers a deploy once the tests pass.

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

This runs Chromium only. CI also runs Firefox and WebKit; to do the same
locally:

```powershell
npx playwright install firefox webkit   # once
npm run test:e2e:all                    # or: npx playwright test --project=webkit
```

The Playwright config starts both the backend and the Vite dev server itself,
so no servers need to be running beforehand.

## License

AGPLv3 — see [LICENSE](LICENSE).

The music and crowd sounds on the host screen are CC0 (public domain), except
“C64 Happy Loop” by Emma Andersson (Emma_MA), which is CC BY 4.0. Their
sources are listed in
[frontend/public/audio/CREDITS.md](frontend/public/audio/CREDITS.md).
