// Thin REST + SSE client for the backend relay (SPEC.md §7, §12.1). The
// server treats question content/option indices as opaque; all quiz-shape
// typing here (`QuestionState`, ...) exists purely for the host app's own
// client-side bookkeeping, not because the server validates it.

const API_BASE = "https://messenger-api-26-a2f528d8ba18.herokuapp.com/api/math-quiz/v1";

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Request to ${url} failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

export interface CreateSessionResponse {
  pin: string;
  host_pin: string;
}

// The quiz source is never sent to the server (SPEC.md §1/§12.1) -- the
// host's browser is the sole authority on question content.
export function createSession(): Promise<CreateSessionResponse> {
  return postJson(`${API_BASE}/sessions`);
}

export interface JoinResponse {
  player_id: string;
}

export function joinSession(pin: string, nickname: string): Promise<JoinResponse> {
  return postJson(`${API_BASE}/sessions/${pin}/join`, { nickname });
}

export function advanceSession(hostPin: string, eventType: string, data: unknown): Promise<{ ok: boolean }> {
  return postJson(`${API_BASE}/sessions/${hostPin}/advance`, { event_type: eventType, data });
}

export function submitAnswer(
  pin: string,
  playerId: string,
  questionIndex: number,
  optionIndex: number,
): Promise<{ ok: boolean }> {
  return postJson(`${API_BASE}/sessions/${pin}/answers`, {
    player_id: playerId,
    question_index: questionIndex,
    option_index: optionIndex,
  });
}

export interface SessionStateSnapshot {
  pin: string;
  players: { player_id: string; nickname: string }[];
  current_question_index: number | null;
  tally: Record<string, number>;
}

export async function fetchSessionState(pin: string): Promise<SessionStateSnapshot> {
  const resp = await fetch(`${API_BASE}/sessions/${pin}/state`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch session state (${resp.status})`);
  }
  return resp.json();
}

// Event payload shapes published/consumed over SSE (§4.2). These describe
// the wire contract the host/player apps agree on; the server itself never
// inspects `data` beyond what §12.1 spells out (tally bookkeeping).

export interface PlayerJoinedData {
  player_id: string;
  nickname: string;
  player_count: number;
}

// Trimmed to just the index: players never render prompt/option content
// (SPEC.md §4.1/§8), and the host already has the full quiz parsed
// locally, so there's no reason to relay it through the server at all.
export interface QuestionStartedData {
  question_index: number;
}

export interface AnswerCountUpdateData {
  question_index: number;
  counts: Record<number, number>;
  player_id: string;
  option_index: number;
  submitted_at: string; // ISO timestamp
}

export interface PlayerResult {
  option_index: number | null;
  correct: boolean;
  points_awarded: number;
}

export interface QuestionRevealedData {
  question_index: number;
  correct_index: number;
  counts: Record<number, number>;
  results: Record<string, PlayerResult>;
}

export interface LeaderboardEntry {
  player_id: string;
  nickname: string;
  score: number;
  // Standard competition ranking: tied scores share the same rank, and the
  // next distinct score skips ahead accordingly (e.g. 1, 1, 3).
  rank: number;
}

export interface LeaderboardUpdatedData {
  standings: LeaderboardEntry[];
}

export type SessionEventMap = {
  player_joined: PlayerJoinedData;
  question_started: QuestionStartedData;
  answer_count_update: AnswerCountUpdateData;
  question_revealed: QuestionRevealedData;
  leaderboard_updated: LeaderboardUpdatedData;
  session_finished: Record<string, never>;
};

export type SessionEventType = keyof SessionEventMap;

/** Discriminated union so callers can `switch (event.type)` and get a
 * narrowed `event.data` type. */
export type SessionEvent = {
  [K in SessionEventType]: { type: K; data: SessionEventMap[K] };
}[SessionEventType];

const SESSION_EVENT_TYPES: SessionEventType[] = [
  "player_joined",
  "question_started",
  "answer_count_update",
  "question_revealed",
  "leaderboard_updated",
  "session_finished",
];

/**
 * Subscribes to a session's SSE stream, invoking `onEvent` for every named
 * event. Returns an unsubscribe function. Reconnect/backoff hardening is
 * deferred to SPEC.md §12.2 step 7; the browser's native `EventSource`
 * already retries on drop and resends `Last-Event-ID` for us.
 */
export function subscribeToSession(
  pin: string,
  onEvent: (event: SessionEvent) => void,
  onError?: (event: Event) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/sessions/${pin}/events`);

  const listeners = SESSION_EVENT_TYPES.map((type) => {
    const listener = (event: MessageEvent) => {
      onEvent({ type, data: JSON.parse(event.data) } as SessionEvent);
    };
    source.addEventListener(type, listener);
    return { type, listener };
  });

  if (onError) source.onerror = onError;

  return () => {
    for (const { type, listener } of listeners) {
      source.removeEventListener(type, listener);
    }
    source.close();
  };
}
