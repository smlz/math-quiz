# Math Quiz

[![Test](https://github.com/smlz/math-quiz/actions/workflows/test.yml/badge.svg)](https://github.com/smlz/math-quiz/actions/workflows/test.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

A live quiz app for maths lessons. A **host** runs the game on a shared screen
(projector); **players** join from their own devices with a 6-digit PIN or by
scanning a QR code.

Question prompts and answer options are authored as **Typst** source and
rendered in the browser via [typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
(WASM) — plain text, math and figures (`cetz`) all use the same syntax.
Player devices only ever show four colored A/B/C/D buttons; the question
itself is read off the host screen.

The full design is documented in [SPEC.md](SPEC.md); the quiz file format is
described in [§3](SPEC.md#3-question-authoring).

The app is designed for _simplicity_ and _privacy_. The whole game runs in the
host's browser; the server only passes messages between host and players
without ever reading them. The server stores nothing, and its access logs are
deleted after one day.

Even though carefully designed, this app is mostly vibe coded. Use at your own
risk!

## Architecture

| Part | Location | Notes |
|------|----------|-------|
| Backend | [quiz_relay_api.py](quiz_relay_api.py) | A stateless FastAPI message relay.  It stores nothing, only relays opaque JSON. No database.|
| Frontend | [frontend/](frontend) | Vue 3 (Composition API) + Vite + TypeScript.|

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

**2. Frontend** (from `frontend/`, serves on `http://127.0.0.1:5173`):

```powershell
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to the backend, so open only the Vite URL in the browser.
The host screen is at `/`, players join at `/join` (the lobby's QR code
links there with the PIN prefilled).

## Building

```powershell
cd frontend
npm run build      # type-checks with vue-tsc, then bundles to frontend/dist
npm run preview    # serve the production bundle locally
```

The backend needs no build step; deploy it with `uv run fastapi deploy`, or
with any ASGI server, e.g. `uvicorn quiz_relay_api:app`.

The [deploy workflow](.github/workflows/deploy.yml) deploys on every push to
`main`, after the full [test suite](.github/workflows/test.yml) has passed.

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
so no servers need to be running beforehand.

## License

GPLv3 — see [LICENSE](LICENSE).
