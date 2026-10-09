// Per-quiz session persistence in localStorage, so losing the connection (or
// simply reloading the page) resumes the same identity instead of creating a
// second player / abandoning a running quiz.
//
// Entries live for exactly as long as the quiz does: they are written on join
// and removed on `session_finished`. There is deliberately no TTL -- a quiz
// that is never finished keeps its entry so a player can come back to it
// hours later.

const PLAYER_KEY_PREFIX = "math-quiz-player:";
const HOST_KEY = "math-quiz-host";
// The nickname last joined with, prefilled into the next join form.
const NICKNAME_KEY = "math-quiz-nickname";

export interface StoredPlayerSession {
  pin: string;
  playerId: string;
  playerToken: string;
  nickname: string;
  score: number;
  /** The player's own choice. Snapshots only say *that* someone answered,
   * never what, so a reload could not otherwise restore the locked-in pick. */
  selectedIndex: number | null;
  answeredQuestionIndex: number | null;
}

export interface StoredHostSession {
  pin: string;
  hostToken: string;
  quizSource: string;
  status: string;
  currentQuestionIndex: number;
  roster: [string, string][];
  scores: [string, number][];
  /** player_id -> option_index for the current question, in arrival order. */
  answers: [string, number][];
  /** Frozen at reveal, so a reload cannot re-score the same question. */
  correctOrder: string[];
  /** Removed player ids, still ignored after a reload. Absent in entries
   * written before players could be removed. */
  removed?: string[];
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    // Corrupt/unparsable entry is indistinguishable from no entry here.
    localStorage.removeItem(key);
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Private-mode/quota failures must never break the running quiz.
    console.warn("Could not persist session", e);
  }
}

export function loadPlayerSession(pin: string): StoredPlayerSession | null {
  return read<StoredPlayerSession>(PLAYER_KEY_PREFIX + pin);
}

export function savePlayerSession(session: StoredPlayerSession): void {
  write(PLAYER_KEY_PREFIX + session.pin, session);
}

export function clearPlayerSession(pin: string): void {
  localStorage.removeItem(PLAYER_KEY_PREFIX + pin);
}

export function loadHostSession(): StoredHostSession | null {
  return read<StoredHostSession>(HOST_KEY);
}

export function saveHostSession(session: StoredHostSession): void {
  write(HOST_KEY, session);
}

export function clearHostSession(): void {
  localStorage.removeItem(HOST_KEY);
}

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

// Stored as the bare string, not JSON, as it always has been.
export function saveNickname(nickname: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname);
  } catch (e) {
    console.warn("Could not remember nickname", e);
  }
}

export function forgetNickname(): void {
  localStorage.removeItem(NICKNAME_KEY);
}
