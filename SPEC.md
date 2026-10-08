# Math Quiz — Specification

A live math quiz application. A **host** runs a game on a shared
screen (e.g. projector); **players** join from their own devices using a PIN
or QR code and answer questions in real time.

## 1. Overview

- Host creates/selects a quiz (a static, pre-authored question set) and
  starts a live **session**.
- Question sets are authored as plain Typst documents with standard Typst
  tooling (see §3), then pasted into a textbox.
- Players join the session via a short numeric PIN or by scanning a QR code.
- The player's own device shows **only four plain colored A/B/C/D
  buttons** — no question prompt or answer text/content is ever rendered
  there; the question and options are read off the shared host screen
  (second-screen pattern). Tapping a button submits immediately and disables
  all four — a player's choice is final, with no way to change it.
- The host manually advances through questions; players answer on their own
  device with no fixed time limit — the host reveals the answer manually
  when ready.
- After each question, the host reveals correct answers and an updated
  leaderboard before advancing.
- Sessions are ephemeral and the game state lives in the host's browser; the
  backend is a stateless relay that stores nothing at all — not the quiz,
  not the answers, not even a list of live sessions.

## 2. Tech stack

| Layer            | Choice                                                             |
|------------------|---------------------------------------------------------------------|
| Backend          | FastAPI (async), a single stateless module: `quiz_relay_api.py`     |
| Database         | None. See §6.                                                      |
| Real-time sync   | Server-Sent Events (SSE): two streams per session, see §4.2         |
| Frontend         | Vue 3 (Composition API) + Vite                                     |
| Rendering        | Typst: the quiz file itself is a Typst document (§3.2), compiled and rendered to SVG or canvas client-side via `typst.ts` (WASM); question/answer text, math, and figures (e.g. via the `cetz` package) all go through this one pipeline |
| QR code          | Generated client-side JS on the teacher page |
| Hosting          | Backend on FastAPI Cloud, frontend on GitHub Pages under the custom domain `https://quiz.smlz.ch` (served from the site root, so Vite's `base` stays `/`) |

The relay is its own app, mounted under `/api/v1` on its own deployment; it
shares no code with any other project. General requirements for the relay,
independent of the quiz use case, are in Appendix A.

## 3. Question authoring

- Questions are authored ahead of time as static **quiz files**: one `.typ`
  file per quiz, which is itself a valid Typst document (§3.2) — not
  Markdown, and not a container format with Typst embedded in it.
- A quiz file contains an ordered list of questions (see §3.2). Correct
  answers are worth a hardcoded 12/11/10 points by submission order (§5),
  and each question's prompt/answer-grid space split defaults to an even
  `0.5` (§3.2, overridable per question) — neither is configurable.
- All question content — the prompt and all four answer options — is **Typst**
  source (see §2), rendered client-side via `typst.ts`. Typst covers plain
  text, inline/block math, and figures (e.g. via the `cetz` package) in one
  uniform syntax, so there is no separate math-vs-figure mechanism.
- Because the quiz file is a normal Typst document, authoring uses ordinary
  Typst tooling — the `typst` CLI, or VS Code with a Typst extension
  (Tinymist) giving syntax highlighting, diagnostics and live preview. No
  project-specific editor plugin, and no external preview tool
  (`markdown-preview-enhanced` is dropped), is required.
- **Compiling the quiz file is the preview** (§3.3): it yields one 16:9
  page per question, laid out like the host screen and with the correct
  answer highlighted. The in-app preview page (§12.2 step 2) renders the
  same layout from the same file and likewise never talks to a server (§7
  endpoints are unaffected).

### 3.1 Question types

**Multiple choice is the only supported question type**: exactly 4 options,
always labeled **A/B/C/D**, exactly one correct.

### 3.2 Quiz file structure

A quiz is a single `.typ` file whose structure is **fixed** and has exactly
three parts, in this order:

1. **Template header** — two lines, verbatim, before anything else:
   `#import "quiz.typ": *` followed by `#show: quiz`.
2. **Preamble** — optional further `#import`s and `#let` macros. Everything
   from the template header up to the first `#question(` belongs here.
3. **Questions** — one or more top-level `#question(...)` calls, each
   starting at the beginning of a line. Questions have no title/heading —
   they're identified purely by their position (1st, 2nd, ...) in the file.

`quiz.typ` is the template shipped in `typst/` of this repository; a quiz
file sits next to it (or imports it by relative path). The template is what
turns the same file into a printable/projectable document (§3.3), and it is
the only project-specific thing an author has to import.

```typst
#import "quiz.typ": *
#show: quiz

#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot

#let graph(body) = canvas(length: 1cm, body)

#question(
  correct: "C",
  answer-area-fraction: 0.65,
  prompt: [
    What is $x$ if $2x + 3 = 11$?
  ],
  options: (
    [$x = 2$],
    [$x = 3$],
    [$x = 4$],
    [$x = 5$],
  ),
)

#question(
  correct: "B",
  prompt: [
    Which graph shows $y = x^2$?
  ],
  options: (
    [#graph(draw.line((-2, 0), (2, 0)))],
    [#graph(plot.plot(size: (3, 3), { plot.add(domain: (-2, 2), x => x * x) }))],
    [...],
    [...],
  ),
)
```

The `#question` arguments are all named, and there are only four of them:

| Argument | Required | Meaning |
|----------|----------|---------|
| `correct` | yes | `"A"`–`"D"`: which option is correct, by position in `options` |
| `prompt` | yes | a content block `[...]` — the question's Typst source (text, math, and/or a figure) |
| `options` | yes | an array of **exactly 4** content blocks `[...]`, displayed as the A/B/C/D buttons in that order (§3.1) |
| `answer-area-fraction` | no, default `0.5` | a number in `(0, 1)` |

- **`answer-area-fraction`** is the fraction of the available space given to
  the 2×2 answer grid, remainder to the prompt. `0.5` splits evenly; higher
  values favor a short prompt with dense answers, lower values favor a long
  prompt/figure with short answers. It applies identically to the host
  screen and to the compiled document (§3.3).
- Points follow the hardcoded 12/11/10 submission-order ladder for every
  question (§5), not configurable, so there is no points override.
- Parsing/validation errors (`correct` missing or outside `A`–`D`, wrong
  number of options, `answer-area-fraction` outside `(0, 1)`, a `prompt` or
  option that isn't a content block, content outside the three parts above,
  etc.) are surfaced to the host when the pasted quiz text is loaded, before
  a session can be created. The template repeats the same checks as Typst
  `assert`s, so a malformed quiz also fails to compile (§3.3) rather than
  producing a wrong-looking page.

### 3.3 Compiling a quiz file

Running `typst compile my-quiz.typ` (or hitting preview in VS Code) renders
the quiz as a document with **one 16:9 page per question**, showing the
prompt above the 2×2 A/B/C/D answer grid in the fixed option colors of §8,
split per `answer-area-fraction`, with the **correct option highlighted**
(gold ring, the other three dimmed) — the same design as the host screen's
reveal state. The page is 1280pt × 720pt, so one Typst point maps to one
CSS pixel of the host screen's canonical 1280×720 canvas.

This makes the quiz file self-sufficient: it can be proof-read, printed or
projected with no app and no server involved. The app's docs page (`/docs`)
offers `quiz.typ` and a minimal starter quiz as downloads.

### 3.4 How the app reads a quiz file

The app does **not** run the template's page layout; it re-renders each
snippet into its own HTML element (§8). So it splits the file rather than
compiling it whole:

- Everything before the first top-level `#question(` is kept verbatim as the
  **preamble**, and is prepended to every snippet the app compiles. Author
  macros and `@preview` imports therefore work unchanged inside prompts and
  options.
- The two template-header lines are **checked and then dropped** from that
  preamble. They only exist to set up the 16:9 page (§3.3), which would fight
  the auto-sized page each snippet is compiled on, and nothing inside a
  prompt or option may depend on the template's exports.
- Each `#question(...)` call is extracted by scanning balanced brackets, and
  its named arguments are read off: `correct` and `answer-area-fraction` as
  literals, `prompt` and each `options` entry as the raw Typst source inside
  their `[...]` content block.

### 3.5 Loading a quiz file from a link

Instead of pasting, the host page can be opened as `/?src=<source>`; the
file is then fetched and put into the editor, where it is validated and
started exactly like pasted text. A link only fills the editor on a fresh
start — a session resumed after a reload (§4.3) keeps its own quiz.

The fetch runs in the browser, so the server must send CORS headers. That
rules out the forges' `/raw/` web URLs on Codeberg and GitLab, so
shortcuts map to endpoints that do:

| `src`                          | Fetched from |
|--------------------------------|--------------|
| `https://…`                    | as given (only `https:`) |
| `gh:owner/repo[@ref]/path`     | `raw.githubusercontent.com/owner/repo/<ref or HEAD>/path` |
| `cb:owner/repo[@ref]/path`     | `codeberg.org/api/v1/repos/owner/repo/raw/path[?ref=ref]` |
| `gl:owner/repo[@ref]/path`     | `gitlab.com/api/v4/projects/owner%2Frepo/repository/files/<path>/raw?ref=<ref or HEAD>` |

Without `@ref` the default branch is used. A ref can't contain `/`, and
GitLab subgroups aren't expressible as a shortcut.

## 4. Game flow

### 4.1 Session lifecycle

```
LOBBY -> QUESTION -> REVEAL -> LEADERBOARD -> (next question or) FINISHED
```

1. **Lobby**: host creates a session → the relay mints a 6-digit numeric PIN
   and the host renders a QR code encoding a join URL
   (`https://.../join?pin=123456` — a `404.html` redirect trick makes real
   paths like this work on GitHub Pages, which has no server-side rewrites).
   Players join and choose a nickname, which reaches the host as an ordinary
   message; they appear in the host's lobby view, and see themselves
   confirmed in the next snapshot. Nicknames are stored in the client's
   localStorage and reused for later sessions: the join form comes prefilled,
   but joining always takes a tap, so a `/join?pin=...` link alone can never
   hand a nickname to a session. The number of joined players is shown.
2. **Question active**: host clicks "Start question" and broadcasts a
   snapshot with the new question index. The host screen renders the full
   prompt/options (§8); the **player screen intentionally renders none of
   that content** — each player sees only four plain colored A/B/C/D buttons
   (§8), since the question is meant to be read off the shared host screen.
   There is no time limit — players submit one answer each whenever ready;
   tapping a button submits immediately, disables all four buttons, and
   outlines the tapped button (no way to change the answer afterward). The
   host ignores answers for a question that is no longer current. The host
   screen's **"Show answer"** button doubles as the live answered-count
   display, reading e.g. "Show answer · 2 of 3 answered" while players are
   still answering, and switching to "All answered — show answer" once every
   joined player has answered, so the host can reveal at any time either
   way; per-option answer counts are **not broken down** on the host screen
   during this phase (§8) — only the aggregate answered count — and the
   per-option breakdown appears once the host reveals (step 3).
3. **Question reveal**: triggered by the host clicking "Show answer". The
   host broadcasts the correct option index and the list of players who
   answered correctly, in arrival order. Per-option counts are computed and
   shown **host-side only**, never sent to players (§8). The player screen
   now also highlights which button was correct: the correct button gets a
   ring highlight (plus a green checkmark if that's also the player's own
   pick); the remaining, incorrect options are shaded/dimmed; and if the
   player picked the wrong one, their own picked button additionally gets an
   outline plus a red-cross marker — alongside the correct/incorrect text
   and points earned (§8).
4. **Leaderboard**: host clicks "Show leaderboard" and broadcasts the
   players in rank order. The host screen shows the **top 5** by cumulative
   score with nicknames and points; each player sees only their own rank,
   derived from their position in that list. Players tied on score share the
   same rank on the host screen (standard competition ranking: two players
   tied for 1st are both shown as "1.", and the next distinct score is
   ranked 3rd, not 2nd).
5. Host clicks "Next" to loop back to step 2, or "Finish" after the last
   question to show the final leaderboard and end the session.

Host actions are explicit HTTP calls that publish a new state snapshot
(`POST /api/v1/session/{pin}/state`); players see the change on their SSE
stream.

### 4.2 Real-time channels

Each session has exactly two SSE streams, and the relay never parses what
travels on either:

- **`/api/v1/session/{pin}/state_stream`** — host to all players. Carries one
  event type, `state`, whose payload is a complete snapshot (§6.2).
  **Public**: knowing the `pin` is what grants access, because the browser's
  native `EventSource` cannot send an auth header and a token in the query
  string would leak into access logs. Acceptable because every event on it is
  broadcast to all participants anyway.
- **`/api/v1/session/{pin}/message_stream`** — players to the host. Carries
  one event type, `message`, whose payload is `{player_id, payload}`. **Host
  only**, so one player can never read another's messages; the host reads it
  with `fetch` + `ReadableStream`, which *can* send a header.

Identity:

- There is a public `pin` (6 digits, §4.1) and a `host_token` known only to
  the host. Both are minted by the relay but **not stored**: every token is
  an HMAC of a server secret, so it can be verified after the process has
  forgotten everything (§6).
- The `host_token` has the form `<session_id>.<expires>.<signature>`. Pins
  are short and get reused, so a token signed over the pin alone would also
  unlock every later session that draws the same pin — and anyone could
  harvest such tokens for all pins just by creating sessions. The random
  `session_id` ties the token to one session (the relay remembers which
  session currently holds each live pin, §7), and the expiry (24 h) bounds
  how long any token is of use.
- Each player gets a `player_token` of the form `<player_id>.<signature>`,
  returned only to its owner. Because the id travels inside the token, the
  relay recovers who is speaking from the token alone.
- **Every path is addressed by the public `pin`; identity is proved by a
  token in a request header** (`X-Host-Token` / `X-Player-Token`), never by
  the URL — secrets in paths leak into browser history, referrers and proxy/
  server access logs. The sending player is identified by their token rather
  than by anything in the request body, so one player cannot send a message
  as another.

### 4.3 Reliability and reconnecting

Phones lock, networks switch, tabs get reloaded, and the backend can be
restarted or scaled to zero between two questions. Rather than making the
relay durable, **reliability comes from idempotent state transfer**:

- The host re-broadcasts a full snapshot on **every change and every 5
  seconds regardless**. A player that missed something catches up on the
  next heartbeat; nothing has to be replayed, so there is no replay log and
  no `Last-Event-ID` handling anywhere.
- A player re-sends a message every 2 seconds until it **observes its own
  effect** in a snapshot — its id appearing in the roster after a `join`, or
  in the answered list after an `answer`. The host dedupes by `player_id`.
  This is at-least-once delivery with the host as the durable store.
- A dropped message therefore costs at most one heartbeat of latency, never
  correctness.

What each side keeps locally:

- **Player**: `{player_id, player_token, nickname, score, selectedIndex,
  answeredQuestionIndex}` in localStorage under `math-quiz-player:{pin}`.
  Because tokens are signed rather than stored server-side, resuming needs
  **no request at all**. The player's own choice is kept here because a
  snapshot only says *that* someone answered, never what.
- **Host**: quiz source, `pin`/`host_token`, phase, roster, scores, the
  current question's answers and the frozen correct-order list, under
  `math-quiz-host`. Resuming is just reconnecting and broadcasting again —
  there is nothing on the server to re-fetch. The quiz source is only
  re-parsed, not re-validated with Typst, since it already compiled cleanly
  when the session was created.
- Both entries are removed when the quiz finishes. There is deliberately no
  TTL: a quiz that is never formally finished keeps its entry so it can
  still be resumed later.
- Failures are made **visible** rather than healed silently: both roles show
  a "reconnecting" banner (the host when a publish fails or its stream
  drops, the player after three missed heartbeats), so it is known whether
  this happens in practice.

## 5. Scoring

- Correct answers are scored by **submission order** within a question: the
  first player to answer correctly gets **12 points**, the second **11
  points**, every further correct answer **10 points**. Wrong answers and
  non-answers score 0. Not configurable per quiz or per question.
- The order is simply the order the host received the answers in; only
  *correct* answers occupy the 12/11 slots, so a fast wrong answer never
  costs anyone the bonus. Points beyond the first two correct answers do not
  decay further (there is no time limit, §4.1).
- At reveal the host publishes the correct answerers **in that order**, so
  points are a pure function of a player's position in that list. Host and
  player run the identical function, so their totals cannot drift, and no
  timestamp ever has to cross the wire.
- No streak bonus in v1 (can be a future extension).
- Running totals are kept by the host; the final leaderboard is shown at
  `FINISHED`.

## 6. Data model

### 6.1 Persisted

**Nothing.** There is no database and no server-side session registry. The
relay holds only the set of currently connected SSE subscribers per topic,
which is connection bookkeeping rather than state, and which disappears the
moment the last subscriber leaves, plus an in-memory map from the pins
currently in use to the session holding them (see §7).

This is what makes a restart or a scale-to-zero cold start survivable: a
valid token is the only thing needed to keep using a session, so a
freshly-started replica happily serves a session it has no record of ever
minting. Verification needs a stable `SERVER_SECRET` env var; without one a
random secret is generated per process, which is the right behaviour locally
and in tests.

### 6.2 State

The authoritative copy lives in the **host's browser** (parsed from the quiz
source at session creation). The shapes below are pseudo-Python for
readability; the implementation is Vue/TypeScript.

```python
class AnswerOption(NamedTuple):
    typst: str                # Typst source; may contain text, math, and/or a figure

class QuestionState(NamedTuple):
    id: str                  # e.g. "q1"; derived from 1-based position in the file
    prompt_typst: str        # Typst source; may contain text, math, and/or a figure
    options: list[AnswerOption]  # always exactly 4 answer options, A-D
    correct_index: int
    answer_area_fraction: float  # resolved (0, 1) prompt/answer-grid split, see §3.2

class HostState:
    pin: str
    host_token: str
    preamble: str            # template header + author imports/macros (§3.4),
                             # prepended to every snippet before compiling
    questions: list[QuestionState]
    phase: Literal["lobby", "question", "reveal", "leaderboard", "finished"]
    current_question_index: int
    roster: dict[str, str]        # player_id -> nickname
    scores: dict[str, int]        # player_id -> cumulative score
    answers: dict[str, int]       # player_id -> option_index, in arrival order
    correct_order: list[str]      # frozen at reveal, so re-broadcasting cannot re-score
```

**The snapshot** is what the host publishes, and it is deliberately tiny —
nicknames and scores never cross the wire at all:

```python
class SessionSnapshot(TypedDict):
    phase: Literal["lobby", "question", "reveal", "leaderboard", "finished"]
    question_index: int | None
    players: list[str]        # meaning depends on phase, see below
    correct_index: NotRequired[int]   # reveal only
```

`players` carries a different meaning per phase, which is what keeps it this
small:

| phase | `players` is | the player derives |
|-------|--------------|--------------------|
| `lobby` | everyone who has joined | "my join landed" |
| `question` | everyone who has answered | "my answer landed" |
| `reveal` | who was correct, in arrival order | correct? → am I in it; points → my index (§5) |
| `leaderboard` | everyone, in rank order | my rank → my index |
| `finished` | everyone, in rank order | my final rank |

`correct_index` appears **only** in the `reveal` phase, and what any given
player chose is never broadcast at all — so nobody watching the public
stream can see other people's answers before the reveal.

Player messages travel the other way:

```python
PlayerMessage = (
    {"type": "join", "nickname": str}
    | {"type": "answer", "question_index": int, "option_index": int}
)
```

## 7. API surface

Seven endpoints, mounted under `/api/v1` on the relay deployment. None of them
inspects a payload. A `GET /` health check sits outside the prefix.

| Method | Path                                    | Who    | Auth header      | Purpose |
|--------|-----------------------------------------|--------|------------------|---------|
| POST   | `/api/v1/session`                       | Host   | —                | Mint `{pin, host_token}` (no body) |
| DELETE | `/api/v1/session/{pin}`                 | Host   | `X-Host-Token`   | Release the pin when the quiz finishes |
| POST   | `/api/v1/session/{pin}`                 | Player | —                | Mint `{player_id, player_token}` (no body — the nickname is an ordinary message) |
| GET    | `/api/v1/session/{pin}/state_stream`    | Player | — (see §4.2)     | SSE: host → all players |
| GET    | `/api/v1/session/{pin}/message_stream`  | Host   | `X-Host-Token`   | SSE: players → host |
| POST   | `/api/v1/session/{pin}/state`           | Host   | `X-Host-Token`   | Publish a snapshot |
| POST   | `/api/v1/session/{pin}/message`         | Player | `X-Player-Token` | Send a message, tagged by the relay with the sender's `player_id` |

`host_token` and `player_token` are the only access-control secrets (§4.2);
there is no separate bearer-token scheme layered on top. A missing or wrong
token is a `403`; a malformed one is rejected with `422` before any work
happens.

Because nothing is stored, there is no "unknown session" error: a request
carrying a valid token for a pin is served whether or not this process ever
minted it. Pins, however, **are** checked for collisions: the relay keeps an
in-memory map from each pin currently in use to the session holding it, and
re-draws until it finds a pin that is neither held nor still has anyone
connected to it, so two live hosts can never share a topic. Both the number
of draws and the number of live sessions (100 000, a tenth of the pin space)
are capped; past either, creating a session fails with `503` rather than
redrawing forever, which would block the event loop and stall every running
session. A host token is
only accepted for the session that currently holds its pin; after a restart
the map is empty, and the first valid, unexpired host token seen for a pin
claims it again. `DELETE /api/v1/session/{pin}` releases the pin when the
quiz finishes; a host that never finishes simply leaves its pin reserved
until the token expires or the next restart, deployment or scale-to-zero
purges the whole map.

## 8. Frontend (Vue 3)

- **Host view**: setup screen with textbox (start quiz button) -> PIN + QR
  code display, live join list, question display (with Typst rendering, and
  no separate question-number label/heading; prompt and 2×2 answer grid
  sized per that question's `answer-area-fraction`, §3.2; per-option
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
  so players learn the layout once and never need to re-read labels under
  time pressure:
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
- Shared SSE client (`frontend/src/api/quizClient.ts`) holding the snapshot
  and message contracts, the heartbeat/staleness constants, and the scoring
  function both roles run.

## 9. Non-functional requirements

- Class-sized: up to ~25 players, sessions of 5–10 minutes.
- Deployed on FastAPI Cloud with the replica maximum pinned to **1**. The
  tally and the subscriber set are per-process, so a second replica would
  split a session in half. Scale-to-zero cannot be disabled on the Hobby
  plan, which is precisely why the design tolerates a cold start: the 5 s
  host heartbeat also keeps the replica warm for the life of a session.
- `SERVER_SECRET` must be set in production, or tokens minted before a
  restart stop verifying (§6.1).
- No authentication/accounts; `host_token` and `player_token` are secrets
  scoped to a single session, not tied to user identities (§4.2).
- **Content-Security-Policy**: the production build carries a CSP `<meta>`
  (GitHub Pages cannot send headers; see `contentSecurityPolicy()` in
  `frontend/vite.config.ts`). Scripts may come only from the site itself,
  the pinned typst.ts bundle and the page's own inline scripts by hash, so
  injected markup and `javascript:` URLs cannot run. `'unsafe-eval'` is
  required by typst.ts's WASM glue; `connect-src` allows any `https:` origin
  because a quiz may be fetched from any `?src=` URL.
- **CORS is an allowlist, not `*`**: the deployed frontend
  (`https://quiz.smlz.ch`) plus the local Vite dev and preview origins
  (`http://localhost:5173` / `http://127.0.0.1:5173` and the `:4173`
  preview pair, both spellings because Windows resolves `localhost` to
  either loopback). `ALLOWED_ORIGINS` (comma-separated) replaces the list
  for a staging deployment. Only the methods and headers actually used are
  allowed, and credentialed requests are not — identity travels in
  `X-Host-Token` / `X-Player-Token`, never in a cookie, so nothing is
  attached to a cross-site request automatically. This is defence in depth
  rather than access control: the pin and tokens are what actually protect
  a session (§4.2), since a non-browser client ignores CORS entirely.
- Reasonable input validation: PIN and token shape are checked before any
  work happens. Request bodies are capped at 64 KiB (`413` beyond that).
  Payloads are otherwise opaque and are not validated by the relay — the
  host ignores messages from senders it has not seen join, and answers for
  the wrong question index. Since anyone who knows the pin can mint a token
  and send any JSON object, the host treats every payload as untrusted: a
  nickname must be a string and is trimmed to 30 characters, an id that has
  joined cannot rename itself, `option_index` must be an integer within the
  question's options, and the roster is capped at 200 players.
- Accepted risks, given 25 pupils in one room: anyone who knows the pin can
  read the state stream and mint a player token, so a determined student
  could spam the host's inbox. There is no rate limiting.

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
- Continuous timing-based scoring (points scaling with the exact answer time).
  The only speed component is the fixed 12/11/10 bonus for the first two
  correct answers (§5); there is still no per-question time limit.
- Horizontal scaling (multi-replica fan-out via Redis or Postgres
  LISTEN/NOTIFY).
- Delivery guaranteed *across* a backend restart without client
  involvement. That would need a durable log; the host's snapshots make it
  unnecessary (§4.3).
- Presence/disconnect detection: the host cannot tell a player who left from
  one who is merely slow, and does not try to.
- Non-idempotent one-shot effects (a countdown sound, a one-time
  animation). Everything broadcast is state, which is what makes repeating
  it harmless.

## 11. Open questions / decisions deferred

- Exact `typst.ts` rendering performance/limits in-browser for complex
  `cetz` figures (may need a fallback pre-rendered SVG path for heavy
  diagrams).
- `typst.ts` fetches `@preview` packages (e.g. `cetz`) and WASM modules from
  `packages.typst.org`/a CDN at render time — no offline/self-hosted fallback
  is specified yet for v1. The typst.ts script and WASM URLs are pinned to
  an exact version, and the script carries a Subresource Integrity hash, so
  a new or tampered release on the CDN cannot run on the site. Both are
  derived at build time from the `@myriaddreamin/*` devDependencies
  (`typstTsAssets()` in `frontend/vite.config.ts`), so Dependabot proposes
  typst.ts upgrades like any other dependency.

## 12. Implementation strategy

### 12.1 The relay contract

The relay knows two roles, two directions and nothing else. Everything below
follows from one decision: **since the host holds all state and the backend
holds none, message durability is the wrong thing to invest in.** The
invariant worth having is that any client can be brought fully up to date
from the host at any moment, using only the current state and never the
message history.

- **`POST /api/v1/session`** mints `{pin, host_token}` and stores nothing
  but the pin and its session id, in the in-memory live-session map that
  keeps two hosts from drawing the same pin (§7); `DELETE /api/v1/session/{pin}` gives it
  back when the quiz finishes. The quiz source is never sent to the server
  at all — it is only pasted into the host's browser (§1, §3) — so the host
  mirrors its own state to localStorage to survive a refresh (§4.3).
- **`POST /api/v1/session/{pin}/state`** is a publish endpoint, not a state
  machine. The host computes the next phase and the whole outgoing snapshot;
  the relay checks `X-Host-Token` and republishes verbatim.
- **`POST /api/v1/session/{pin}/message`** is the same in reverse. The relay
  resolves the sender from `X-Player-Token`, never from the body, and tags
  the republished message with that `player_id`.
- Correctness and points are computed **client-side**: the host knows the
  correct answer because it parsed the quiz, and the player derives its own
  points from its position in the reveal snapshot's list (§5). The relay
  never learns which option is correct, and never counts anything.

### 12.2 Build order

Build bottom-up in independently testable vertical slices, tackling the
stateless parsing logic before the stateful real-time game loop:

0. **Quiz template (`typst/quiz.typ`)** — the `quiz` show rule and the
   `question` function, plus their `assert`s (§3.2). Verifiable on its own
   with `typst compile` on an example quiz: one 1280pt × 720pt page per
   question, correct option highlighted (§3.3).
1. **Quiz source parser (frontend, pure logic, no server)** — a
   `parseQuiz(source) -> {preamble, questions}` function (§6.2 shapes)
   covering the fixed three-part file structure, balanced-bracket
   extraction of each `#question(...)` call, and its named arguments
   (§3.4). Unit-test the validation errors from §3.2 directly (wrong option
   count, missing/out-of-range `correct`, non-content-block prompt,
   out-of-range `answer-area-fraction`) before touching the UI.
2. **Standalone quiz preview page** — renders a parsed quiz using
   `typst.ts` (client-side WASM compiler + renderer, §2) and no backend at
   all; this is the in-app preview mechanism, alongside just compiling the
   file (§3.3). Lets quiz authoring/rendering be verified in isolation, and
   doubles as the host's "load quiz" step.
3. **Relay** — the seven endpoints from §7, HMAC tokens, two topics per
   session, no state. Provable with integration tests that never construct a
   real quiz, since arbitrary JSON payloads are enough.
4. **Host app**: quiz load (step 2) → create session → lobby (roster from
   `join` messages, PIN/QR display) → question loop → reveal (using its own
   answer map plus the locally-known correct answer) → leaderboard → finish,
   broadcasting a snapshot on every change and on a 5 s heartbeat.
5. **Player app**: join (PIN entry/QR, nickname from localStorage per §4.1)
   → waiting/question/answer screens → feedback/score, driven purely by
   snapshots, with retry-until-observed for its own messages.
6. **End-to-end pass**: a full game with 2+ real browser tabs, verifying
   that scoring (§5) matches between the host's view and each player's, and
   that both roles survive a reload mid-quiz.
7. **Hardening**: PIN/token shape checks at every endpoint (OWASP-relevant
   since these are the only access-control secrets), the "reconnecting"
   banners, keep-alive tuning.
8. **Deploy**: backend first (`uv run fastapi deploy`, with `SERVER_SECRET`
   set and the replica maximum pinned to 1), then the frontend to GitHub
   Pages, which serves it at `https://quiz.smlz.ch` — in that order, since
   the deployed frontend talks to the deployed backend. The custom domain
   is kept by `frontend/public/CNAME`, which Vite copies into the published
   artifact, and it must appear in the relay's CORS allowlist (§9) or every
   browser request fails at the preflight.

### 12.3 Testing strategy

- Parser (step 1): unit tests, no I/O.
- Relay (step 3): integration tests against the FastAPI app (httpx
  `AsyncClient`). Note that `ASGITransport` buffers the whole response, so
  an endless SSE generator hangs it — stream behaviour is tested against the
  fan-out object directly, and only end-to-end in step 6.
- Host/player apps (steps 4–5): component tests for the phase transitions
  (§4.1) and scoring (§5) in isolation from rendering.
- Step 6 is automated with Playwright driving one host tab plus two player
  tabs. It is the only layer that exercises real SSE, and historically the
  only one that catches reactivity and routing bugs.

## Appendix A — Relay framework (use-case independent)

The relay is deliberately generic: nothing below mentions quizzes. This
appendix is the framework-level view the quiz-specific sections above build
on.

### A.1 Roles and messages

There are two client roles:

- **Host**: receives messages from clients (players) and broadcasts messages
  to all connected clients.
- **Player**: sends messages to the host and receives broadcast messages
  from the host.

Correspondingly there are exactly two message directions: player → host, and
host → all players (broadcast). All participants are present in the same
*physical* location.

Sessions are ephemeral: the host creates a session, players join via QR code
or PIN. The application state is maintained by the host; the backend stores
no state at all (§6.1).

### A.2 Requirements

- Front- and backend are hosted on a publicly accessible server; players
  reach it over the internet.
- Messages are delivered reliably even across network interruptions.
- The host maintains the application state and coordinates the session.
- The backend stays simple — no over-engineering — and runs locally with
  minimal dependencies while remaining easy to deploy publicly.
- Class size up to 25 players (§9).

### A.3 Design decisions

- Backend on FastAPI Cloud with a single replica; frontend on GitHub Pages,
  served under its own domain.
- No database and no server state beyond the live-pin map. Tokens are HMACs
  of a server secret and pub/sub topics are created lazily, so a restart or a
  scale-to-zero cold start needs no recovery endpoint: participants simply
  reconnect and the next state broadcast heals them.
- Reliability by **idempotent state transfer**, not message durability: the
  host broadcasts a full state snapshot on every change and every 5 s;
  players retry a message until they observe its effect in a snapshot, and
  the host dedupes by member id. At-least-once, with the host as the durable
  store. No replay log, no `Last-Event-ID` — a lost message costs at most
  one heartbeat (§4.3).
- Two SSE endpoints per session: a public player stream (host → all) and a
  host-only inbox (players → host). The host reads its inbox via `fetch` +
  `ReadableStream` so the token travels in a header; `EventSource` cannot
  send one (§4.2).
- The backend never parses message payloads; they are opaque JSON.
- Failures are visible: both roles show a "reconnecting" banner rather than
  healing silently, so it is known whether this happens in practice.
- Out of scope: disconnect/presence detection, rate limiting, non-idempotent
  one-shot effects, replay as a latency optimisation (§10).

An earlier proof-of-concept sketch — a multi-threaded `wau` backend using
its built-in publish/subscribe and SSE endpoint, hosted on the local machine
with the QR code pointing at a LAN address — is superseded by the FastAPI
relay above, but the client contract (POST to send, SSE to receive) is
unchanged.
