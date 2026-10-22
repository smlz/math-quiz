// A diagnostic log that never leaves the device on its own.
//
// Both roles record what happened to them -- requests that failed, streams
// that dropped, snapshots received, messages accepted or ignored, the page
// going to sleep -- so that when something went wrong in class, a pupil (or
// the teacher) can copy it and send it along. Nothing is ever uploaded: the
// only way out is a button press, see DebugExport.vue and /debug.
//
// An export may end up in a public bug report, so it identifies devices only
// by the random player ids and never names anyone: no nickname may be logged,
// not even the player's own.
//
// The log is mirrored to localStorage per role, because the moment something
// goes wrong is usually followed by a reload, and because the session entries
// in storedSession.ts are deleted exactly when a quiz ends. It is a ring
// buffer, and entries older than a day are dropped when a page starts.

export type DebugRole = "host" | "player";

interface Entry {
  /** Epoch ms of the first occurrence. */
  t: number;
  text: string;
  /** How often the same text was logged back to back, if more than once. */
  n?: number;
  /** Epoch ms of the last repeat. */
  last?: number;
}

interface StoredLog {
  /** 1 still carried nicknames, so such logs are dropped rather than read. */
  v: 2;
  /** Whatever the app last said about itself: pin, own id, roster, ... */
  context: Record<string, unknown>;
  entries: Entry[];
}

const KEY_PREFIX = "math-quiz-debug:";
const MAX_ENTRIES = 3000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSIST_DELAY_MS = 1000;
const STACK_FRAMES = 6;

declare const __SOURCE_VERSION__: { commit: string | null; tag: string | null };
export const APP_VERSION =
  [__SOURCE_VERSION__.tag, __SOURCE_VERSION__.commit?.slice(0, 7)].filter(Boolean).join(", ") || "unknown";

let role: DebugRole | null = null;
let log: StoredLog = emptyLog();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const secrets = new Set<string>();
// The console as it was before startDebugLog wrapped it, so that a reported
// exception is printed without being logged a second time.
let printError: (...args: unknown[]) => void = (...args) => console.error(...args);

function emptyLog(): StoredLog {
  return { v: 2, context: {}, entries: [] };
}

function storageKey(forRole: DebugRole): string {
  return KEY_PREFIX + forRole;
}

/** True for the localStorage key of any role's log, e.g. in a `storage`
 * event from the quiz tab. */
export function isDebugLogKey(key: string | null): boolean {
  return key === null || key.startsWith(KEY_PREFIX);
}

/** Starts recording for this page. Picks up what an earlier page load of the
 * same role left behind, and listens to the browser events that explain most
 * trouble on phones: sleeping, losing the network, crashing. */
export function startDebugLog(pageRole: DebugRole): void {
  if (role !== null) return;
  role = pageRole;
  const cutoff = Date.now() - MAX_AGE_MS;
  const stored = readStoredLog(pageRole);
  // Anything logged before this call (module setup) is kept, after the old.
  const early = log.entries;
  log = stored ?? emptyLog();
  log.entries = [...log.entries.filter((entry) => (entry.last ?? entry.t) >= cutoff), ...early];

  const navigation = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  debugLog("page load", { type: navigation?.type ?? "?", path: location.pathname, version: APP_VERSION });

  document.addEventListener("visibilitychange", () => {
    debugLog("visibility", { state: document.visibilityState });
    if (document.visibilityState === "hidden") flushDebugLog();
  });
  window.addEventListener("pagehide", (event) => {
    debugLog("pagehide", { persisted: event.persisted });
    flushDebugLog();
  });
  window.addEventListener("pageshow", (event) => {
    // A page restored from the back/forward cache never "loads" again.
    if (event.persisted) debugLog("pageshow from bfcache");
  });
  window.addEventListener("online", () => debugLog("network online"));
  window.addEventListener("offline", () => debugLog("network offline"));
  window.addEventListener("error", (event) => {
    // A script from another origin (typst.ts) only ever says "Script error.".
    debugLog(
      "uncaught error",
      event.error
        ? { error: describeException(event.error) }
        : { message: event.message, at: `${event.filename}:${event.lineno}:${event.colno}` },
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    debugLog("unhandled rejection", { reason: describeException(event.reason) });
  });
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    if (level === "error") printError = original;
    console[level] = (...args: unknown[]) => {
      debugLog(`console.${level}`, { message: args.map(describeError).join(" ") });
      original(...args);
    };
  }
}

/** Never lets `value` into the log, e.g. a token: it would let whoever reads
 * the log act as this device for the rest of the quiz. */
export function addDebugSecret(value: string | null | undefined): void {
  if (value) secrets.add(value);
}

function redact(text: string): string {
  let result = text;
  for (const secret of secrets) result = result.split(secret).join("‹redacted›");
  return result;
}

/** Records one event. The same text logged back to back -- a heartbeat, an
 * unchanged snapshot, a stream failing the same way -- becomes one line with
 * a count, so an hour of routine stays a handful of lines. */
export function debugLog(event: string, details?: Record<string, unknown>): void {
  const text = redact(details ? `${event} ${formatDetails(details)}` : event);
  const now = Date.now();
  const previous = log.entries.at(-1);
  if (previous && previous.text === text) {
    previous.n = (previous.n ?? 1) + 1;
    previous.last = now;
  } else {
    log.entries.push({ t: now, text });
    if (log.entries.length > MAX_ENTRIES) log.entries.splice(0, log.entries.length - MAX_ENTRIES);
  }
  schedulePersist();
}

/** Replaces what the export says about the current session. Kept apart from
 * the entries so it is complete even after the ring buffer dropped the join
 * that first mentioned someone. */
export function setDebugContext(context: Record<string, unknown>): void {
  log.context = JSON.parse(redact(JSON.stringify(context)));
  schedulePersist();
}

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => {
      const text = value === undefined || value === null ? "-" : typeof value === "string" ? value : JSON.stringify(value);
      return `${key}=${/[\s"=]/.test(text) || text === "" ? JSON.stringify(text) : text}`;
    })
    .join(" ");
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Like describeError, followed by the innermost frames of where it was
 * thrown -- for exceptions, not for the failures the app expects. Frames on
 * this site are shortened to their path. */
export function describeException(error: unknown): string {
  const description = describeError(error);
  if (!(error instanceof Error) || !error.stack) return description;
  // Chromium starts the stack with the error itself, Firefox and Safari don't.
  const header = String(error);
  const stack = error.stack.startsWith(header) ? error.stack.slice(header.length) : error.stack;
  const frames = stack
    .split("\n")
    .map((line) => line.trim().replace(/^at /, "").split(location.origin).join(""))
    .filter(Boolean)
    .slice(0, STACK_FRAMES);
  return frames.length ? `${description} @ ${frames.join(" < ")}` : description;
}

/** Logs an exception that something caught on the app's behalf (Vue, for
 * one) and prints it as it would otherwise have been. */
export function reportException(event: string, error: unknown, details?: Record<string, unknown>): void {
  debugLog(event, { ...details, error: describeException(error) });
  printError(error);
}

function schedulePersist(): void {
  if (role === null || persistTimer !== null) return;
  persistTimer = setTimeout(flushDebugLog, PERSIST_DELAY_MS);
}

/** Writes the log to localStorage now rather than after the usual delay. */
export function flushDebugLog(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  if (role === null) return;
  try {
    localStorage.setItem(storageKey(role), JSON.stringify(log));
  } catch {
    // Private mode or a full quota: the log still lives in memory.
  }
}

function readStoredLog(forRole: DebugRole): StoredLog | null {
  try {
    const raw = localStorage.getItem(storageKey(forRole));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as StoredLog;
    return parsed?.v === 2 && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}

/** True when there is anything to export for `forRole` on this device. */
export function hasDebugLog(forRole: DebugRole): boolean {
  return currentLog(forRole).entries.length > 0;
}

/** This page's own log as it stands, or the one stored by another page. */
function currentLog(forRole: DebugRole): StoredLog {
  if (forRole === role) return log;
  return readStoredLog(forRole) ?? emptyLog();
}

/** Deletes the log of `forRole` on this device. */
export function clearDebugLog(forRole: DebugRole): void {
  if (forRole === role) log = emptyLog();
  try {
    localStorage.removeItem(storageKey(forRole));
  } catch {
    // Nothing stored that could be removed.
  }
}

const ROLE_LABELS: Record<DebugRole, string> = { host: "host (teacher)", player: "player" };

/** The log as plain text, ready to paste into an email. */
export function formatDebugLog(forRole: DebugRole): string {
  const { context, entries } = currentLog(forRole);
  const now = new Date();
  const lines = [
    `Math quiz diagnostics -- ${ROLE_LABELS[forRole]}`,
    `exported: ${formatDate(now)} ${formatTime(now.getTime())} (${Intl.DateTimeFormat().resolvedOptions().timeZone}, UTC${formatOffset(now)})`,
    `version: ${APP_VERSION}`,
    `page: ${location.origin}${location.pathname}`,
    `browser: ${navigator.userAgent}`,
    `screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x, language ${navigator.language}, ${navigator.onLine ? "online" : "offline"}`,
  ];
  for (const [key, value] of Object.entries(context)) {
    lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  lines.push("", `log (${entries.length} entries):`);

  let day = "";
  for (const entry of entries) {
    const entryDay = formatDate(new Date(entry.t));
    if (entryDay !== day) {
      day = entryDay;
      lines.push(`-- ${day}`);
    }
    const repeats = entry.n ? ` ×${entry.n} until ${formatTime(entry.last ?? entry.t)}` : "";
    lines.push(`${formatTime(entry.t)} ${entry.text}${repeats}`);
  }
  return redact(lines.join("\n"));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function formatOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** Test hook: forgets everything, as if the page had just loaded. */
export function resetDebugLogForTests(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
  role = null;
  log = emptyLog();
  secrets.clear();
  printError = (...args) => console.error(...args);
}
