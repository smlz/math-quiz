// Transport for the stateless relay backend (quiz_relay_api.py).
//
// The relay moves opaque JSON between two roles and knows nothing else. The
// quiz contract lives here instead, as the shape of what the host broadcasts
// (`SessionSnapshot`) and what players send back (`PlayerMessage`).
//
// Reliability comes from idempotent state transfer, not from delivery
// guarantees: the host re-broadcasts a complete snapshot on every change and
// every few seconds regardless, so a dropped frame costs at most one
// heartbeat. Nothing here replays, buffers or acknowledges anything.

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

// First correct answer scores 12, second 11, every further one 10.
const POINTS_BY_CORRECT_RANK = [12, 11];
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

async function postJson<T>(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const startedAt = performance.now();
  const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    debugLog("request failed", { path, error: describeError(e), after: elapsed() });
    throw e;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    debugLog("request rejected", { path, status: response.status, detail, after: elapsed() });
    throw new RelayError(`POST ${path} failed (${response.status}): ${detail}`, response.status);
  }
  if (performance.now() - startedAt > SLOW_REQUEST_MS) debugLog("request slow", { path, after: elapsed() });
  return response.json();
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
  const data = await postJson<{ player_id: string; player_token: string }>(
    `/session/${pin}`,
  );
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
): Promise<{ ok: boolean }> {
  return postJson(`/session/${pin}/state`, snapshot, {
    [HOST_TOKEN_HEADER]: hostToken,
  });
}

export function sendMessage(
  pin: string,
  playerToken: string,
  message: PlayerMessage,
): Promise<{ ok: boolean }> {
  return postJson(`/session/${pin}/message`, message, {
    [PLAYER_TOKEN_HEADER]: playerToken,
  });
}

// Streams

/** Players read the public state stream with the native EventSource, which
 * reconnects on its own -- also every time the relay ends the stream, which
 * is why an error is only reported once it outlasts RECONNECT_GRACE_MS. */
export function subscribeToState(
  pin: string,
  onSnapshot: (snapshot: SessionSnapshot) => void,
  onStatus: (status: ConnectionStatus) => void = () => {},
): () => void {
  const source = new EventSource(`${API_BASE}/session/${pin}/state_stream`);
  const report = reportAfterGrace(onStatus);

  source.addEventListener("state", (event) => {
    report("open");
    onSnapshot(JSON.parse((event as MessageEvent).data));
  });
  source.onopen = () => {
    debugLog("state stream open");
    report("open");
  };
  // The relay ends every stream after a few minutes, so one error per
  // rotation is routine; CONNECTING means the browser is already retrying.
  source.onerror = () => {
    debugLog("state stream error", { readyState: ["connecting", "open", "closed"][source.readyState] });
    report("reconnecting");
  };

  return () => {
    report.cancel();
    source.close();
  };
}

/** A stream the relay ended sooner than this is treated as a failure. */
const STREAM_MIN_LIFETIME_MS = 10_000;

/**
 * The host reads its inbox with `fetch` instead of EventSource, because the
 * stream is host-only and EventSource cannot send an auth header. That costs
 * the automatic reconnect, hence the loop below.
 */
export function subscribeToMessages(
  pin: string,
  hostToken: string,
  onMessage: (message: IncomingMessage) => void,
  onStatus: (status: ConnectionStatus) => void = () => {},
): () => void {
  const controller = new AbortController();
  const report = reportAfterGrace(onStatus);

  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`${API_BASE}/session/${pin}/message_stream`, {
          headers: { [HOST_TOKEN_HEADER]: hostToken, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`message_stream failed (${response.status})`);
        }
        debugLog("message stream open");
        report("open");
        const openedAt = Date.now();
        for await (const frame of readEventStream(response.body)) {
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
        debugLog("message stream failed", { error: describeError(e) });
        report("reconnecting");
        await sleep(1000);
      }
    }
  })();

  return () => {
    report.cancel();
    controller.abort();
  };
}

interface StreamFrame {
  event: string;
  data: string;
}

/** Minimal SSE parser: enough for the frames the relay emits (one `event:`
 * and one `data:` line, plus `:` keep-alive comments). */
async function* readEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
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
