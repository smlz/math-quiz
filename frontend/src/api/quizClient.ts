// Transport for the stateless relay backend (quiz_relay_api.py).
//
// The relay moves opaque JSON between two roles and knows nothing else. The
// quiz contract lives here instead, as the shape of what the host broadcasts
// (`SessionSnapshot`) and what players send back (`PlayerMessage`).
//
// Reliability comes from idempotent state transfer, not from delivery
// guarantees: the host re-broadcasts a complete snapshot on every change and
// every few seconds regardless, so a dropped frame costs at most one
// heartbeat. Nothing here replays, buffers or acknowledges anything. Snapshots
// are numbered, so one that arrives late -- after a stalled connection let a
// backlog through all at once -- is recognized and dropped.

import { debugLog, describeError } from "../debug/debugLog";

// In dev (and therefore in the Playwright e2e run) go through Vite's proxy
// to the local backend; the production build is served from quiz.smlz.ch,
// which has no backend of its own, so it targets the relay directly (that
// origin is on the relay's CORS allowlist, see quiz_relay_api.py).
const API_BASE = import.meta.env.DEV
  ? "/api/v1"
  : "https://quiz-api.fastapicloud.dev/api/v1";

/** How often the host re-sends its snapshot even when nothing changed. */
export const HEARTBEAT_MS = 5000;
/** No snapshot for this long means something is wrong worth showing. */
export const STALE_AFTER_MS = 3 * HEARTBEAT_MS;
/** A connection may be down this long before anyone is told. The relay ends
 * every stream after a few minutes and a failed publish is retried at once,
 * so short outages are routine and heal before this runs out. */
export const RECONNECT_GRACE_MS = 5000;
/** A stream that has carried nothing for this long gets a `ping` from the
 * relay (KEEP_ALIVE_SECONDS in quiz_relay_api.py). */
export const KEEP_ALIVE_MS = 5000;
/** A stream that has carried nothing at all -- no snapshot, no message, no
 * ping -- for this long is presumed dead and opened anew. */
export const SILENT_AFTER_MS = 3 * KEEP_ALIVE_MS;
/** How long a request may take before it is given up as failed. Without a
 * limit, a stalled connection piles up requests that all arrive minutes later
 * at once -- and a failure that never happens is never reported either. */
export const PUBLISH_TIMEOUT_MS = 6000;
export const SEND_TIMEOUT_MS = 8000;
/** Minting an identity may have to wait for a cold start of the relay. */
export const JOIN_TIMEOUT_MS = 15_000;

export const HOST_TOKEN_HEADER = "X-Host-Token";
export const PLAYER_TOKEN_HEADER = "X-Player-Token";

// Wire contract

export type Phase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

/**
 * Everything a player needs to render, in full, every time.
 *
 * `players` carries a different meaning per phase, which is what keeps the
 * snapshot this small -- nicknames never travel at all:
 *
 *   lobby        everyone who has joined      -- "my join landed"
 *   question     everyone who has answered    -- "my answer landed"
 *   reveal       who answered correctly, in submission order
 *   leaderboard  everyone, in rank order
 *   finished     everyone, in rank order
 *
 * A player derives the points it just won from its position in the `reveal`
 * list. Its total and rank come from `scores`, the host's own totals, rather
 * than from a tally of its own: a phone that slept through a reveal, or
 * reloaded during one, would otherwise count it zero times or twice.
 */
export interface SessionSnapshot {
  phase: Phase;
  question_index: number | null;
  players: string[];
  /** Reveal only, so nobody learns the answer early. */
  correct_index?: number;
  /** Reveal, leaderboard and finished: every player's cumulative score,
   * including the question just revealed. Keyed by the random id, so it says
   * nothing about who is who. */
  scores?: Record<string, number>;
  /** Players the host removed from this session (e.g. for a rude nickname).
   * A removed player's device drops its identity and offers to join again
   * under a new name; the host ignores the old id from then on. */
  removed?: string[];
  /** Reveal only: everyone whose answer reached the host, right or wrong, so
   * a player can tell "wrong" from "never arrived". */
  answered?: string[];
  /** Grows with every snapshot the host publishes, across reloads of the
   * host page too. The relay forwards snapshots in the order they reach it,
   * which after a stalled connection is not the order they were sent in. */
  seq?: number;
}

export type PlayerMessage =
  | { type: "join"; nickname: string }
  | { type: "answer"; question_index: number; option_index: number };

/** A player message as the relay delivers it: the sender is attributed by
 * the server from the token, never taken from the body. */
export interface IncomingMessage {
  player_id: string;
  payload: PlayerMessage;
}

// First correct answer scores 13, second 12, third 11, every further one 10.
const POINTS_BY_CORRECT_RANK = [13, 12, 11];
const POINTS_PER_CORRECT_ANSWER = 10;

/** Points a player earned for the question in a `reveal` snapshot, derived
 * purely from their position in the chronological list of correct answers.
 * Host and player run the identical function, so their totals cannot drift. */
export function pointsForReveal(correctPlayerIds: string[], playerId: string): number {
  const rank = correctPlayerIds.indexOf(playerId);
  if (rank === -1) return 0;
  return POINTS_BY_CORRECT_RANK[rank] ?? POINTS_PER_CORRECT_ANSWER;
}

/** Standard competition ranking, as on the host's leaderboard: tied players
 * share a rank and the next score skips ahead (1, 2, 2, 4). */
export function rankForScore(scores: number[], score: number): number {
  return 1 + scores.filter((other) => other > score).length;
}

/** Whether `snapshot` is newer than the last one applied, numbered `lastSeq`.
 * One without a number comes from a host page older than the numbering and
 * is always taken, as it used to be. */
export function isNewerSnapshot(snapshot: SessionSnapshot, lastSeq: number): boolean {
  return typeof snapshot.seq !== "number" || snapshot.seq > lastSeq;
}

/** What a player is told when the answer is revealed. */
export type RevealOutcome = "correct" | "wrong" | "lost" | "none";

/** `lost`: the player picked an option, but the host never got it -- which
 * must not be passed off as a wrong answer. `none`: no pick at all. */
export function revealOutcome(
  snapshot: SessionSnapshot,
  playerId: string,
  selectedIndex: number | null,
): RevealOutcome {
  if (snapshot.players.includes(playerId)) return "correct";
  // From a host that does not send `answered`, only a right pick that is
  // missing from the correct ones is known for certain to have been lost.
  const arrived = snapshot.answered
    ? snapshot.answered.includes(playerId)
    : selectedIndex !== null && selectedIndex !== snapshot.correct_index;
  if (arrived) return "wrong";
  return selectedIndex === null ? "none" : "lost";
}

export type ConnectionStatus = "open" | "reconnecting";

export interface StatusReporter {
  (status: ConnectionStatus): void;
  /** Drops a "reconnecting" that has not been passed on yet. */
  cancel(): void;
}

/** Passes "open" on at once, but "reconnecting" only once it has lasted
 * `graceMs` without an "open" in between. */
export function reportAfterGrace(
  onStatus: (status: ConnectionStatus) => void,
  graceMs = RECONNECT_GRACE_MS,
): StatusReporter {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const report = (status: ConnectionStatus) => {
    if (status === "open") {
      cancel();
      onStatus("open");
    } else if (timer === null) {
      timer = setTimeout(() => onStatus("reconnecting"), graceMs);
    }
  };
  return Object.assign(report, { cancel });
}

// Requests

/** A request slower than this is worth a line in the diagnostic log even when
 * it succeeds. */
const SLOW_REQUEST_MS = 2000;

/** A request the relay answered with an error status. */
export class RelayError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  /** Gives the request up as failed after this long. */
  timeoutMs?: number;
  /** Cancels the request. It then fails without a log line: whoever
   * canceled it no longer cares. */
  signal?: AbortSignal;
}

async function postJson<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const { headers = {}, timeoutMs, signal } = options;
  const startedAt = performance.now();
  const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", cancel);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (!timedOut && !signal?.aborted) debugLog("request failed", { path, error: describeError(e), after: elapsed() });
      throw e;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      debugLog("request rejected", { path, status: response.status, detail, after: elapsed() });
      throw new RelayError(`POST ${path} failed (${response.status}): ${detail}`, response.status);
    }
    if (performance.now() - startedAt > SLOW_REQUEST_MS) debugLog("request slow", { path, after: elapsed() });
    return await response.json();
  } catch (e) {
    // Also while the body was still arriving.
    if (!timedOut) throw e;
    debugLog("request timed out", { path, after: elapsed() });
    throw new Error(`POST ${path} timed out after ${timeoutMs} ms`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export interface HostCredentials {
  pin: string;
  hostToken: string;
}

export async function createSession(): Promise<HostCredentials> {
  const data = await postJson<{ pin: string; host_token: string }>("/session");
  return { pin: data.pin, hostToken: data.host_token };
}

export interface PlayerCredentials {
  playerId: string;
  playerToken: string;
}

export async function joinSession(pin: string): Promise<PlayerCredentials> {
  const data = await postJson<{ player_id: string; player_token: string }>(`/session/${pin}`, undefined, {
    timeoutMs: JOIN_TIMEOUT_MS,
  });
  return { playerId: data.player_id, playerToken: data.player_token };
}

/** Release the pin so it can be handed out again. Best-effort: a pin the
 * relay never hears about is freed by the next restart anyway. */
export async function endSession(pin: string, hostToken: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/session/${pin}`, {
      method: "DELETE",
      headers: { [HOST_TOKEN_HEADER]: hostToken },
    });
    debugLog("session released", { status: response.status });
  } catch (e) {
    debugLog("session release failed", { error: describeError(e) });
    throw e;
  }
}

export function publishState(
  pin: string,
  hostToken: string,
  snapshot: SessionSnapshot,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  return postJson(`/session/${pin}/state`, snapshot, {
    headers: { [HOST_TOKEN_HEADER]: hostToken },
    timeoutMs: PUBLISH_TIMEOUT_MS,
    signal,
  });
}

export function sendMessage(
  pin: string,
  playerToken: string,
  message: PlayerMessage,
): Promise<{ ok: boolean }> {
  return postJson(`/session/${pin}/message`, message, {
    headers: { [PLAYER_TOKEN_HEADER]: playerToken },
    timeoutMs: SEND_TIMEOUT_MS,
  });
}

// Streams

// EventSource.readyState, spelled out so tests can stand in a fake.
const CONNECTING = 0;
const CLOSED = 2;
/** How soon a state stream is opened anew once the browser has given up on
 * it, at first; the wait doubles with every failure in a row, up to the
 * maximum. */
const REOPEN_MIN_MS = 1000;
const REOPEN_MAX_MS = 10_000;
/** How often the state stream checks that it still carries anything. */
const WATCHDOG_MS = 1000;

export interface StateHandlers {
  snapshot: (snapshot: SessionSnapshot) => void;
  /** The connection itself, reported once it has been down for
   * RECONNECT_GRACE_MS. It says nothing about whether the host is there. */
  status?: (status: ConnectionStatus) => void;
  /** A keep-alive from the relay: the connection works, even while the host
   * sends nothing. */
  ping?: () => void;
}

/** Players read the public state stream with the native EventSource. It
 * reconnects on its own after a network error -- also every time the relay
 * ends the stream, which is why an error is only reported once it outlasts
 * RECONNECT_GRACE_MS. Two cases it does not heal are handled here: an HTTP
 * error ends it for good, and a connection that died silently never errors
 * at all, it just stops carrying anything, not even the relay's pings. */
export function subscribeToState(pin: string, handlers: StateHandlers): () => void {
  const report = reportAfterGrace(handlers.status ?? (() => {}));
  let source: EventSource | null = null;
  let lastFrameAt = Date.now();
  let lastCheckAt = Date.now();
  let reopenDelay = REOPEN_MIN_MS;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const alive = () => {
    lastFrameAt = Date.now();
    reopenDelay = REOPEN_MIN_MS;
    report("open");
  };

  function open() {
    reopenTimer = null;
    lastFrameAt = Date.now();
    const current = new EventSource(`${API_BASE}/session/${pin}/state_stream`);
    source = current;
    current.addEventListener("state", (event) => {
      alive();
      handlers.snapshot(JSON.parse((event as MessageEvent).data));
    });
    current.addEventListener("ping", () => {
      alive();
      handlers.ping?.();
    });
    current.onopen = () => {
      debugLog("state stream open");
      // The first frame gets its full time from here on.
      lastFrameAt = Date.now();
      report("open");
    };
    // The relay ends every stream after a few minutes, so one error per
    // rotation is routine; CONNECTING means the browser is already retrying.
    current.onerror = () => {
      debugLog("state stream error", { readyState: ["connecting", "open", "closed"][current.readyState] });
      report("reconnecting");
      if (current.readyState === CLOSED) reopenLater();
    };
  }

  function reopenLater() {
    if (stopped || reopenTimer !== null) return;
    source?.close();
    source = null;
    debugLog("state stream reopens", { in: `${reopenDelay}ms` });
    reopenTimer = setTimeout(open, reopenDelay);
    reopenDelay = Math.min(reopenDelay * 2, REOPEN_MAX_MS);
  }

  const watchdog = setInterval(() => {
    const now = Date.now();
    // A page that was suspended saw nothing because it ran nothing.
    if (now - lastCheckAt > 4 * WATCHDOG_MS) lastFrameAt = now;
    lastCheckAt = now;
    if (!source || now - lastFrameAt <= SILENT_AFTER_MS) return;
    // Open but silent, or stuck connecting: either way nothing gets through.
    debugLog("state stream silent", {
      for: `${now - lastFrameAt}ms`,
      readyState: source.readyState === CONNECTING ? "connecting" : "open",
    });
    report("reconnecting");
    reopenLater();
  }, WATCHDOG_MS);

  open();

  return () => {
    stopped = true;
    clearInterval(watchdog);
    if (reopenTimer !== null) clearTimeout(reopenTimer);
    report.cancel();
    source?.close();
    source = null;
  };
}

/** A stream the relay ended sooner than this is treated as a failure. */
const STREAM_MIN_LIFETIME_MS = 10_000;

/**
 * The host reads its inbox with `fetch` instead of EventSource, because the
 * stream is host-only and EventSource cannot send an auth header. That costs
 * the automatic reconnect, hence the loop below. A connection that carries
 * nothing for SILENT_AFTER_MS -- the relay pings a quiet stream every few
 * seconds -- has died without saying so, and is replaced.
 *
 * `onStatus` hears every change at once, without a grace period: the host
 * holds back the reveal while answers cannot arrive, and applies its own
 * grace period to the banner. `onRefused` hears that the relay refused the
 * host token, which trying again cannot change, so the loop ends there.
 */
export function subscribeToMessages(
  pin: string,
  hostToken: string,
  onMessage: (message: IncomingMessage) => void,
  onStatus: (status: ConnectionStatus) => void = () => {},
  onRefused: () => void = () => {},
): () => void {
  const controller = new AbortController();

  void (async () => {
    while (!controller.signal.aborted) {
      const attempt = new AbortController();
      const cancel = () => attempt.abort();
      controller.signal.addEventListener("abort", cancel);
      let silent = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      // Armed before the request, so a reconnect that hangs is caught too.
      const feed = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          silent = true;
          attempt.abort();
        }, SILENT_AFTER_MS);
      };
      feed();
      try {
        const response = await fetch(`${API_BASE}/session/${pin}/message_stream`, {
          headers: { [HOST_TOKEN_HEADER]: hostToken, Accept: "text/event-stream" },
          signal: attempt.signal,
        });
        if (response.status === 403) {
          debugLog("message stream refused");
          onRefused();
          return;
        }
        if (!response.ok || !response.body) {
          throw new Error(`message_stream failed (${response.status})`);
        }
        debugLog("message stream open");
        onStatus("open");
        feed();
        const openedAt = Date.now();
        for await (const frame of readEventStream(response.body, feed)) {
          if (frame.event === "message") onMessage(JSON.parse(frame.data));
        }
        debugLog("message stream ended", { after: `${Math.round((Date.now() - openedAt) / 1000)}s` });
        // The relay ends the stream every few minutes; that is routine and
        // is picked up again at once. One that ends straight away is not,
        // and must not turn this into a busy loop.
        if (Date.now() - openedAt < STREAM_MIN_LIFETIME_MS) {
          throw new Error("message_stream closed early");
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        debugLog("message stream failed", {
          error: silent ? `nothing received for ${SILENT_AFTER_MS / 1000}s` : describeError(e),
        });
        onStatus("reconnecting");
        await sleep(1000);
      } finally {
        clearTimeout(watchdog);
        controller.signal.removeEventListener("abort", cancel);
      }
    }
  })();

  return () => controller.abort();
}

interface StreamFrame {
  event: string;
  data: string;
}

/** Minimal SSE parser: enough for the frames the relay emits (one `event:`
 * and one `data:` line, plus `:` comments). `onChunk` hears of every chunk
 * that arrives, whole frame or not, as a sign of life. */
async function* readEventStream(
  body: ReadableStream<Uint8Array>,
  onChunk: () => void = () => {},
): AsyncGenerator<StreamFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    onChunk();
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) yield { event, data };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
