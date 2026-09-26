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

// In dev (and therefore in the Playwright e2e run) go through Vite's proxy
// to the local backend; the production build is served from GitHub Pages,
// which has no backend of its own, so it targets the relay directly (CORS is
// open, see quiz_relay_api.py).
const API_BASE = import.meta.env.DEV
  ? "/api/v1"
  : "https://quiz-api.fastapicloud.dev/api/v1";

/** How often the host re-sends its snapshot even when nothing changed. */
export const HEARTBEAT_MS = 5000;
/** No snapshot for this long means something is wrong worth showing. */
export const STALE_AFTER_MS = 3 * HEARTBEAT_MS;

export const HOST_TOKEN_HEADER = "X-Host-Token";
export const PLAYER_TOKEN_HEADER = "X-Player-Token";

// Wire contract

export type Phase = "lobby" | "question" | "reveal" | "leaderboard" | "finished";

/**
 * Everything a player needs to render, in full, every time.
 *
 * `players` carries a different meaning per phase, which is what keeps the
 * snapshot this small -- nicknames and scores never travel at all:
 *
 *   lobby        everyone who has joined      -- "my join landed"
 *   question     everyone who has answered    -- "my answer landed"
 *   reveal       who answered correctly, in submission order
 *   leaderboard  everyone, in rank order
 *   finished     everyone, in rank order
 *
 * A player derives its own points from its position in the `reveal` list and
 * its own rank from its position in the `leaderboard` one, so the scoring
 * rule lives in a single client-side function. Only the host screen ever
 * shows scores next to names, and the host has those locally.
 */
export interface SessionSnapshot {
  phase: Phase;
  question_index: number | null;
  players: string[];
  /** Reveal only, so nobody learns the answer early. */
  correct_index?: number;
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

export type ConnectionStatus = "open" | "reconnecting";

// Requests

async function postJson<T>(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`POST ${path} failed (${response.status}): ${detail}`);
  }
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
 * reconnects on its own. */
export function subscribeToState(
  pin: string,
  onSnapshot: (snapshot: SessionSnapshot) => void,
  onStatus?: (status: ConnectionStatus) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/session/${pin}/state_stream`);

  source.addEventListener("state", (event) => {
    onStatus?.("open");
    onSnapshot(JSON.parse((event as MessageEvent).data));
  });
  source.onopen = () => onStatus?.("open");
  source.onerror = () => onStatus?.("reconnecting");

  return () => source.close();
}

/**
 * The host reads its inbox with `fetch` instead of EventSource, because the
 * stream is host-only and EventSource cannot send an auth header. That costs
 * the automatic reconnect, hence the loop below.
 */
export function subscribeToMessages(
  pin: string,
  hostToken: string,
  onMessage: (message: IncomingMessage) => void,
  onStatus?: (status: ConnectionStatus) => void,
): () => void {
  const controller = new AbortController();

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
        onStatus?.("open");
        for await (const frame of readEventStream(response.body)) {
          if (frame.event === "message") onMessage(JSON.parse(frame.data));
        }
        throw new Error("message_stream closed");
      } catch {
        if (controller.signal.aborted) return;
        onStatus?.("reconnecting");
        await sleep(1000);
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
