# Math Quiz — Specification

A Kahoot-style live math quiz application. A **host** runs a game on a shared
screen (e.g. projector); **players** join from their own devices using a PIN
or QR code and answer questions in real time.

## 1. Overview

- Host creates/selects a quiz (a static, pre-authored question set) and
  starts a live **session**.
- Question sets are authored as quiz files (one Typst snippet per
  question/answer, see §3), pasted into a textbox.
- Players join the session via a short numeric PIN or by scanning a QR code.
- The player's own device shows **only four plain colored A/B/C/D
  buttons** — no question prompt or answer text/content is ever rendered
  there; the question and options are read off the shared host screen
  (classic Kahoot second-screen pattern). Tapping a button submits
  immediately and disables all four — a player's choice is final, with no
  way to change it.
- The host manually advances through questions; players answer on their own
  device with no fixed time limit — the host reveals the answer manually
  when ready.
- After each question, the host reveals correct answers and an updated
  leaderboard before advancing.
- Sessions are ephemeral (in-memory game state in the host's browser); the
  server only stores game ids and enables communication between all parties.

## 2. Tech stack

| Layer            | Choice                                                             |
|------------------|---------------------------------------------------------------------|
| Backend          | FastAPI (async), following the pattern in `api_async.py`           |
| Database         | SQLAlchemy async engine — Postgres (`asyncpg`) on Heroku, SQLite (`aiosqlite`) for local dev |
| Real-time sync   | Server-Sent Events (SSE), using an `AsyncPubSub`-style pub/sub per session topic |
| Frontend         | Vue 3 (Composition API) + Vite                                     |
| Rendering        | Typst, compiled and rendered to SVG or canvas client-side via `typst.ts` (WASM); question/answer text, math, and figures (e.g. via the `cetz` package) all go through this one pipeline — see `typst-experiments/` for a feasibility POC |
| QR code          | Generated client-side JS on the teacher page |

The api should integrate into the existing `api_async.py` under
`/api/math-quiz/v1/`; Database tables must be prefixed for this app.

## 3. Question authoring

- Questions are authored ahead of time as static **quiz files**, one file
  per quiz.
- A quiz file contains an ordered list of questions (see §3.2). Correct
  answers are worth a hardcoded 12/11/10 points by submission order (§5),
  and each question's prompt/answer-grid space split defaults to an even
  `0.5` (§3.2, overridable per question) — neither is configurable.
- All question content — the prompt and all four answer options — is
  **Typst** source (see §2), rendered client-side via `typst.ts`. Typst
  covers plain text, inline/block math, and figures (e.g. via the `cetz`
  package, per the `typst-experiments/` POC) in one uniform syntax, so
  there is no separate math-vs-figure mechanism.
- There is no external preview tool dependency (`markdown-preview-enhanced`
  is dropped); a quiz is previewed with the standalone quiz preview page
  (§12.2 step 2), which renders questions the same way the host screen
  will (§7 endpoints are unaffected — the preview never talks to a server).

### 3.1 Question types

**Multiple choice is the only supported question type**: exactly 4 options,
always labeled **A/B/C/D**, exactly one correct.

### 3.2 Question schema

A quiz is a single file: an ordered list of questions, each separated by a
`---` horizontal rule. Each question starts with a short YAML-like preface
(plain `key: value` lines, ending at the first blank line) giving
`correct_answer` and, optionally, `answer_area_fraction`, followed by
exactly one prompt fenced block plus exactly four option fenced blocks.
Questions have no title/heading — they're identified purely by their
position in the file. The outer example block below uses 4 backticks so
the nested triple-backtick Typst fences inside it stay valid.

````md
correct_answer: C
answer_area_fraction: 0.65

```typst
What is $x$ if $2x + 3 = 11$?
```

```typst-option
$2$
```

```typst-option
$3$
```

```typst-option
$4$
```

```typst-option
$5$
```

---

correct_answer: B

```typst
Which graph shows $y = x^2$?
```

```typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#canvas({ import draw: *; line((-2,0), (2,0)) })
```

```typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot
#canvas({ import draw: *; plot.plot(size: (3,3), { plot.add(domain: (-2,2), x => x*x) }) })
```

```typst-option
...
```

```typst-option
...
```
````

- **`---`** on its own line separates questions; there is no per-question
  heading/id — questions are identified purely by their position (1st,
  2nd, ...) in the file.
- **Preface**: the `key: value` lines directly after the previous `---`
  (or the start of the file), up to the first blank line. `correct_answer`
  is required and is the letter (`A`–`D`) of the correct option, by
  position among the four option blocks below. `answer_area_fraction` is
  optional (see below). This is the only place per-question metadata
  lives — there is no separate fence attribute or HTML comment.
- **Prompt**: exactly one ` ```typst ` fenced block per question, containing
  that question's Typst source (text, math, and/or a figure, all in one
  snippet).
- **Options**: exactly 4 plain ` ```typst-option ` fenced blocks (see
  §3.1, no attributes), each one option's Typst source (plain text, math,
  and/or a figure). Options are always displayed to players as 4 buttons
  labeled **A/B/C/D**, in the order the fenced blocks appear. Points follow
  the hardcoded 12/11/10 submission-order ladder for every question (§5),
  not configurable, so there is no points override.
- **`answer_area_fraction`** (optional preface key, default `0.5`) is a
  number in `(0, 1)`: the fraction of the host screen's available space
  given to the 2×2 answer grid, remainder to the prompt. `0.5` splits
  evenly; higher values favor a short prompt with dense answers, lower
  values favor a long prompt/figure with short answers.
- Parsing/validation errors (`correct_answer` missing or outside `A`-`D`,
  wrong number of options (must be exactly 4), missing or duplicate prompt
  block, `answer_area_fraction` outside `(0, 1)`, etc.) are surfaced to
  the host when the pasted quiz text is loaded, before a session can be
  created.

## 4. Game flow

### 4.1 Session lifecycle

```
LOBBY -> QUESTION_ACTIVE -> QUESTION_REVEAL -> LEADERBOARD -> (next question or) FINISHED
```

1. **Lobby**: host creates a session for a quiz → server generates a 6-digit
   numeric PIN (unique among active sessions) and a QR code encoding a join
   URL (`https://.../#/join?pin=123456` — routes live in the URL hash so the
   frontend can be served by any static file server without rewrite rules). Players join, choose a nickname,
   appear in the host's lobby view in real time. The usernames are stored in
   localStorage of the client's browsers and reused for later sessions. The
   number of joined users is shown.
2. **Question active**: host clicks "Start question". Server broadcasts the
   question (without the correct answer) to all players and the host
   display. The host screen renders the full prompt/options (§8); the
   **player screen intentionally renders none of that content** — each
   player sees only four plain colored A/B/C/D buttons (§8), since the
   question is meant to be read off the shared host screen. There is no
   time limit — players submit one answer each whenever ready; tapping a
   button submits immediately, disables all four buttons, and outlines the
   tapped button (no way to change the answer afterward). Answers are only
   rejected once the question is no longer active (reveal has started, or
   the wrong question index). The host screen's **"Show answer"** button
   doubles as the live answered-count display, reading e.g. "Show answer ·
   2 of 3 answered" while players are still answering, and switching to
   "All answered — show answer" once every joined player has answered, so
   the host can reveal at any time either way; per-option answer counts are
   tallied live but **not broken down** on the host screen during this
   phase (§8) — only the aggregate answered count — and the per-option
   breakdown is shown once the host reveals the answer (step 3).
3. **Question reveal**: triggered by the host clicking "Show answer".
   Server broadcasts the correct answer, per-option answer counts, and each
   player's own correct/incorrect + points earned. Per-option counts remain
   **host-only**, never shown to players (§8). The player screen now also
   highlights which button was correct: the correct button gets a ring
   highlight (plus a green checkmark if that's also the player's own pick);
   the remaining, incorrect options are shaded/dimmed; and if the player
   picked the wrong one, their own picked button additionally gets an
   outline plus a red-cross marker — alongside the existing
   correct/incorrect text and points earned (§8).
4. **Leaderboard**: host clicks "Show leaderboard". Server broadcasts
   standings for all players, but the UI shows only the **top 5** by
   cumulative score. Players tied on score share the same rank (standard
   competition ranking: e.g. two players tied for 1st are both shown as
   "1.", and the next distinct score is ranked 3rd, not 2nd).
5. Host clicks "Next" to loop back to step 2, or "Finish" after the last
   question to show the final leaderboard and end the session.

Host action are explicit HTTP calls (e.g. `POST /sessions/{host_pin}/advance`);
resulting state changes are pushed to all connected clients via SSE.

### 4.2 Real-time channels (SSE topics)

- Topic per session PIN. Event types: `player_joined`, `question_started`,
  `answer_count_update` (live per-option tally; relayed to all subscribers,
  but the host frontend doesn't render the counts until
  `question_revealed`), `question_revealed`, `leaderboard_updated`,
  `session_finished`.
- Host and player frontends both subscribe to the session's SSE stream and
  react to events; players additionally POST their answers via a normal
  REST call.
- There is a public `pin` used by all users, and a `host_pin` only known to
  the host; the `host_pin` must be supplied to advance the game. `pin` is a
  6-digit numeric code (§4.1); `host_pin` is a separate, high-entropy random
  token (e.g. a 22-character URL-safe value from `secrets.token_urlsafe(16)`)
  so it can't be brute-forced or guessed the way a 6-digit PIN could.
- `player_id`, returned to a player at join time, is likewise a high-entropy
  random value; it doubles as that player's bearer secret for submitting
  answers (no separate "player token" concept), so it must not be shown to
  other players.

## 5. Scoring

- Correct answers are scored by **submission order** within a question: the
  first player to answer correctly gets **12 points**, the second **11
  points**, every further correct answer **10 points**. Wrong answers and
  non-answers score 0. Not configurable per quiz or per question.
- The order comes from the `submitted_at` timestamp the server records per
  answer (§4.2, §12.1); only *correct* answers occupy the 12/11 slots, so a
  fast wrong answer never costs anyone the bonus. Points beyond the first
  two correct answers do not decay further (there is no time limit, §4.1).
- No streak bonus in v1 (can be a future extension).
- Running total kept in-memory per session; final leaderboard shown at
  `FINISHED`.

## 6. Data model

### 6.1 Persisted (Postgres/SQLite via SQLAlchemy async)

- `math_quiz_quiz` — id, pin, host_pin, created_at.

Everything else (sessions, players, questions, live answers, scores) is
**in-memory only**, scoped to the running process, matching the "session-only,
no accounts" requirement. Optionally, a `session_result` table can log final
leaderboards for later review — out of scope for v1 unless requested.

### 6.2 In-memory session state (per PIN)

The authoritative copy of this state lives in the **host's browser** (parsed
from the quiz source at session creation); the server only relays events
and never parses question content. The shapes below describe that client-
side state (host app) as pseudo-Python for readability; the actual
implementation is Vue/TypeScript.

```python
class AnswerOption(NamedTuple):
    typst: str                # Typst source; may contain text, math, and/or a figure

class QuestionState(NamedTuple):
    id: str                  # e.g. "q1"; derived from 1-based position in the file, no heading in the source
    prompt_typst: str        # Typst source; may contain text, math, and/or a figure
    options: list[AnswerOption]  # always exactly 4 answer options, A-D
    correct_index: int
    answer_area_fraction: float  # resolved (0, 1) prompt/answer-grid split, see §3.2
    # points follow the hardcoded 12/11/10 submission-order ladder, not part of this shape (§5)

class AnswerRecord(NamedTuple):
    option_index: int
    submitted_at: datetime
    correct: bool
    points_awarded: int

class PlayerState(NamedTuple):
    player_id: str           # high-entropy; also the player's bearer secret
    nickname: str
    score: int
    answers: dict[str, AnswerRecord]  # question_id -> answer

class SessionState:
    pin: str
    host_pin: str
    questions: list[QuestionState]
    status: Literal["lobby", "question_active", "question_reveal",
                     "leaderboard", "finished"]
    current_question_index: int
    players: dict[str, PlayerState]
```

## 7. API surface (draft)

All paths below are mounted under `/api/math-quiz/v1` (§2). "Session" is used
throughout this spec for the resource identified by `pin`/`host_pin`; there
is no separate persisted "quiz" resource, so paths use `/sessions`
consistently rather than `/quizzes`.

| Method | Path                           | Who     | Purpose                               |
|--------|--------------------------------|---------|---------------------------------------|
| POST   | `/sessions`                    | Host    | Create a session (no body) → returns `{pin, host_pin}` |
| POST   | `/sessions/{pin}/join`         | Player  | Join with nickname → returns `{player_id}` |
| GET    | `/sessions/{pin}/events`       | Both    | SSE stream of session events          |
| POST   | `/sessions/{host_pin}/advance` | Host    | Move to next lifecycle state          |
| POST   | `/sessions/{pin}/answers`      | Player  | Submit answer for current question (body includes `player_id`) |
| GET    | `/sessions/{pin}/state`        | Both    | Snapshot fetch (reconnect fallback)   |

`host_pin` and `player_id` are the only access-control secrets (see §4.2);
there is no separate bearer-token scheme layered on top of them.

## 8. Frontend (Vue 3)

- **Host view**: setup screen with textbox (start quiz button) -> PIN + QR
  code display, live join list, question display (with Typst rendering, and
  no separate question-number label/heading; prompt and 2×2 answer grid
  sized per that question's `answer_area_fraction`, §3.2; per-option
  answer-count bars **hidden until reveal**, so the host doesn't see the
  count breakdown while the question is still active; the **"Show
  answer"** button doubles as the live answered-count display — e.g. "Show
  answer · 2 of 3 answered", switching to "All answered — show answer"
  once everyone has answered — letting the host reveal at any time), reveal
  screen (correct answer hig, tied scores share the same rank), "Next"
 + counts shown, plus a **"Show
  leaderboard"** button to advance), leaderboard (**top 5 players only**,
  ranked by cumulative score), "Next" control.
- **Player view**: join screen (PIN entry or QR scan → prefilled PIN),
  nickname entry (first-time), then an answer UI of **exactly four plain
  colored A/B/C/D buttons and nothing else** — no question prompt, no
  option text/math/figures are ever rendered on the player device (that
  content is read off the shared host screen, §4.1). The player's nickname
  is pinned at the top of the screen at all times; directly below it,
  instructional status text (e.g. "Please answer now!", "Answer submitted
  — waiting for reveal…", "Correct! +N pts") appears above the answer
  buttons, which are **square** (2×2 grid, width-driven) and anchored to
  the bottom edge of the screen (no fixed/narrow button column) so they're
  easy to tap on a phone. Tapping a button submits the answer immediately, disables all
  four buttons, dims the three non-tapped buttons, and outlines the tapped
  button while waiting — there is no way to change the answer afterward.
  On reveal, the player additionally sees: a ring highlight on the correct
  button (plus a large green checkmark if it's also their own pick), the
  remaining incorrect options shaded/dimmed, and — if their own pick was
  wrong — an outline plus a large red-cross marker on their picked button,
  alongside their own correct/incorrect text and points earned above the
  grid. Per-option answer counts remain **host-only**, never shown to
  players (§4.1).
- **Answer button layout** (both host and player screens): always exactly
  4 buttons arranged in a fixed **2×2 grid**, always labeled **A**
  (top-left), **B** (top-right), **C** (bottom-left), **D** (bottom-right).
  Each label has a fixed, distinct color regardless of question content,
  matching the classic Kahoot-style scheme so players learn the layout once
  and never need to re-read labels under time pressure:
  | Label | Color              | Hex       |
  |-------|--------------------|-----------|
  | A     | raspberry red      | `#EF476F` |
  | B     | teal blue          | `#118AB2` |
  | C     | warm gold          | `#C79B33` |
  | D     | mint green         | `#06D6A0` |

  Colors are on the button background with white label text. On the **host
  screen**, each option's Typst content (§3) is additionally rendered
  inside a white box with black text, inset within the colored button with
  visible padding so the option's color still shows around it; the A/B/C/D
  label itself stays directly on the colored background, unaffected. The
  player's buttons show only the label letter, never option content
  (§4.1). The color/label mapping never changes between questions or
  sessions.
- Shared composables for SSE subscription and reconnect/backoff handling.

## 9. Non-functional requirements

- Small-scale deployment: single Heroku dyno, single event loop process
  (no multi-worker pub/sub fan-out needed), Postgres for the `math_quiz_quiz`
  table.
- No authentication/accounts; `host_pin` and `player_id` are high-entropy
  secrets scoped to a single session, not tied to user identities (§4.2).
- Reasonable input validation: nickname length/charset, answer payload
  shape, rejecting answers for the wrong question index or once that
  question is no longer active.

## 10. Out of scope for v1 (future extensions)

- Admin UI for authoring/editing quizzes.
- Randomly generated question generators.
- Non-multiple-choice question types (numeric free-entry, expression/
  equation free-entry) and CAS-based expression equivalence checking (e.g.
  via SymPy) — multiple choice with exactly 4 options is the only supported
  question type (§3.1).
- Persistent player accounts / cross-session history / streak bonuses.
- Configurable scoring values (the 12/11/10 submission-order ladder is
  hardcoded, §5).
- Continuous timing-based scoring (points scaling with the exact answer
  time, Kahoot-style). The only speed component is the fixed 12/11/10
  bonus for the first two correct answers (§5); there is still no
  per-question time limit.
- Horizontal scaling (multi-worker/multi-dyno pub/sub via Redis or Postgres
  LISTEN/NOTIFY).

## 11. Open questions / decisions deferred

- Exact `typst.ts` rendering performance/limits in-browser for complex
  `cetz` figures (may need a fallback pre-rendered SVG path for heavy
  diagrams).
- `typst.ts` fetches `@preview` packages (e.g. `cetz`) and WASM modules from
  `packages.typst.org`/a CDN at render time (per the `typst-experiments/`
  POC) — no offline/self-hosted fallback is specified yet for v1.

## 12. Implementation strategy

### 12.1 Resolve the relay contract first

The spec says the server "only stores game ids and enables communication"
(§1) while the host's browser owns all game state. Before writing any code,
pin down exactly what crosses the wire, since §7's endpoints are otherwise
ambiguous about it:

- **`POST /sessions`**: mints `{pin, host_pin}` and stores a bare row in
  `math_quiz_quiz` (id, pin, host_pin, created_at — §6.1). The server
  never sees or parses the quiz source at all — it isn't sent to the
  server, only pasted into the host's browser (§1, §3). If the host
  refreshes mid-game, both the quiz and all runtime state (current
  question, scores) are lost and they must start a new session — an
  accepted v1 limitation, not something to solve now.
- **`POST /sessions/{host_pin}/advance`**: a generic *publish* endpoint, not
  a server-side state machine. Body is `{event_type, data}`; the host's Vue
  store computes the next lifecycle state and the outgoing payload (e.g. the
  next `question_started` with question data minus the correct answer), and
  the server just validates `host_pin` and republishes to that `pin`'s SSE
  topic. The server never needs to understand quiz content to do this.
- **`POST /sessions/{pin}/answers`**: body is `{player_id, question_index,
  option_index}`. The server validates `player_id` against its roster and
  that the question is still active (current index, not yet revealed), but
  treats `option_index` as an opaque bucket — it can still
  maintain a live `{0: n, 1: n, ...}` tally per question purely by counting
  submissions per index, without ever knowing which index is correct. That
  tally is what powers the `answer_count_update` event; correctness itself
  is only known to the host (it has the parsed quiz) and is computed
  client-side when the host reveals the answer. The `answer_count_update`
  event also carries the submitting `player_id`, its `option_index` and the
  server-recorded `submitted_at` timestamp, which is what lets the host
  rank the correct answers for the 12/11/10 ladder (§5).
- Per-player correctness/points are therefore also computed **client-side by
  the host**, not the server — the host publishes them as part of the
  `question_revealed` event data, keyed by `player_id`.

### 12.2 Build order

Build bottom-up in independently testable vertical slices, tackling the
stateless parsing logic before the stateful real-time game loop:

1. **Quiz source parser (frontend, pure logic, no server)** — a
   `parseQuiz(source) -> QuestionState[]` function (§6.2 shapes) covering
   `---`-separated question splitting, the `correct_answer`/
   `answer_area_fraction` preface, and the `typst`/`typst-option` fenced
   blocks (§3.2). Unit-test the validation errors from §3.2 directly (wrong
   option count, missing/out-of-range `correct_answer`, missing/duplicate
   prompt block, out-of-range `answer_area_fraction`) before touching the UI.
2. **Standalone quiz preview page** — renders a parsed quiz using
   `typst.ts` (client-side WASM compiler + renderer, §2) and no backend at
   all; this is the sole/official preview mechanism (replacing the
   previously-used `markdown-preview-enhanced` external tool). Lets quiz
   authoring/rendering be verified in isolation, and doubles as the host's
   "load quiz" step.
3. **Backend relay skeleton** — `math_quiz_quiz` table/migration, the
   `AsyncPubSub`-style per-pin topic (reusing the pattern in
   `api_async.py`), and the five endpoints from §7 with the contract from
   §12.1. No question/scoring logic here — just create/join/publish/relay/
   tally, all provable with integration tests that never construct a real
   quiz (arbitrary JSON event payloads are enough).
4. **Host app**: quiz load (step 2) → create session → lobby (roster via
   `player_joined` events, PIN/QR display) → question loop driving `advance`
   calls → reveal (using the live tally from step 3 + locally-known correct
   answers) → leaderboard → finish.
5. **Player app**: join (PIN entry/QR, nickname from localStorage per §4.1)
   → waiting/question/answer screens → feedback/score, wired to the same
   SSE stream and the `/answers` endpoint.
6. **End-to-end pass**: run a full game with 2+ simulated player tabs,
   verifying late-answer rejection (once a question is no longer active)
   and scoring math (§5) match between host-computed values and what
   players see.
7. **Hardening**: input validation at every endpoint (nickname
   length/charset, PIN/host_pin/player_id shape checks, rejecting
   answers/advances for the wrong `pin`/`host_pin`/question index — OWASP-
   relevant since these are the only access-control secrets), reconnect/
   backoff for dropped SSE streams (`Last-Event-ID` replay, matching the
   existing `AsyncPubSub` behavior), keep-alive tuning.
8. **Deploy**: extend the existing Heroku app/`Procfile`, run the
   `math_quiz_quiz` migration against the shared Postgres instance, verify
   SQLite fallback still works for local dev.

### 12.3 Testing strategy

- Parser (step 1): unit tests, no I/O.
- Relay (step 3): integration tests against the FastAPI app (httpx
  `AsyncClient`) exercising create/join/advance/answer/SSE without any real
  quiz content.
- Host/player apps (steps 4–5): component tests for the state machine
  transitions (§4.1) and scoring calculation (§5) in isolation from
  rendering.
- Step 6 is the main manual/E2E pass; automate the happy path afterwards if
  time allows (e.g. Playwright driving one host tab + two player tabs).
