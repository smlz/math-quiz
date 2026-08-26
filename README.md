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
described in §3.

The app is vibe coded. The backend is quite rough, and I am surprised it works
at all. Use at your own risk!

## Architecture

| Part | Location | Notes |
|------|----------|-------|
| Backend | [api_async.py](api_async.py), [math_quiz.py](math_quiz.py) | FastAPI + SQLAlchemy async. The quiz router is mounted under `/api/math-quiz/v1/`. It is a pure relay: it mints session PINs and fans out events via SSE — it never sees the quiz content or the correct answers. |
| Frontend | [frontend/](frontend) | Vue 3 (Composition API) + Vite + TypeScript. Hash routes: `#/join` mounts the player app, anything else the host app — so any static file server can host it without SPA rewrite rules. The host setup screen shows a live side-by-side preview of the quiz. All quiz state lives in the host's browser tab. |
| Database | SQLite locally (`aiosqlite`), Postgres (`asyncpg`) in production | Only stores session ids/PINs. Configured via the `DATABASE_URL` env var. |

## Prerequisites

- Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/)
- Node.js (with npm)

## Running in dev mode

Two processes, in two terminals, both needed.

**1. Backend** (from the repo root, serves on `http://127.0.0.1:3000`):

```powershell
uv sync
uv run uvicorn api_async:app --host 127.0.0.1 --port 3000 --reload
```

Do not run `python api_async.py` directly — `api_async` and `math_quiz`
import each other, which only resolves when the module is imported normally
(as uvicorn does), not when it is executed as `__main__`.

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

The backend needs no build step; deploy it with any ASGI server, e.g.
`uvicorn api_async:app`.

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
