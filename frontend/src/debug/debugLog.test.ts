import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDebugSecret,
  clearDebugLog,
  debugLog,
  describeException,
  flushDebugLog,
  formatDebugLog,
  hasDebugLog,
  reportException,
  resetDebugLogForTests,
  setDebugContext,
  startDebugLog,
} from "./debugLog";

/** The event listeners the log installed, by event type. */
let listeners: Record<string, (event: unknown) => void> = {};

// Just enough of a browser for the log: storage, and somewhere to hang the
// event listeners it installs.
function stubBrowser() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  listeners = {};
  const target = { addEventListener: (type: string, listener: (event: unknown) => void) => (listeners[type] = listener) };
  vi.stubGlobal("window", { ...target, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 });
  vi.stubGlobal("document", { ...target, visibilityState: "visible" });
  vi.stubGlobal("location", { origin: "https://quiz.example", pathname: "/" });
  vi.stubGlobal("navigator", { userAgent: "test", language: "de-CH", onLine: true });
  return storage;
}

/** The log lines proper, without the header. */
function logLines(role: "host" | "player"): string[] {
  const text = formatDebugLog(role);
  return text.slice(text.indexOf("log (")).split("\n").slice(1).filter((line) => !line.startsWith("--"));
}

describe("debugLog", () => {
  const { warn, error } = console;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 10, 0, 0));
  });

  afterEach(() => {
    resetDebugLogForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.assign(console, { warn, error });
  });

  it("collapses the same event logged back to back into one line with a count", () => {
    stubBrowser();
    startDebugLog("host");
    debugLog("broadcast", { phase: "lobby", players: 2 });
    vi.advanceTimersByTime(5000);
    debugLog("broadcast", { phase: "lobby", players: 2 });
    vi.advanceTimersByTime(5000);
    debugLog("broadcast", { phase: "lobby", players: 2 });
    debugLog("request failed", { path: "/api/v1/session", error: "TypeError: Failed to fetch" });

    expect(logLines("host").slice(1)).toEqual([
      "10:00:00.000 broadcast phase=lobby players=2 ×3 until 10:00:10.000",
      '10:00:10.000 request failed path=/api/v1/session error="TypeError: Failed to fetch"',
    ]);
  });

  it("never lets a registered secret into the log, the context or the export", () => {
    const storage = stubBrowser();
    startDebugLog("player");
    addDebugSecret("tok-123");
    debugLog("request failed", { detail: "bad token tok-123" });
    setDebugContext({ token: "tok-123", pin: "123456" });
    flushDebugLog();

    expect(formatDebugLog("player")).not.toContain("tok-123");
    expect(formatDebugLog("player")).toContain("pin: 123456");
    expect([...storage.values()].join()).not.toContain("tok-123");
  });

  it("survives a reload and drops what is more than a day old", () => {
    stubBrowser();
    startDebugLog("player");
    debugLog("old");
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    debugLog("recent");
    flushDebugLog();

    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    resetDebugLogForTests();
    startDebugLog("player");

    const lines = logLines("player").map((line) => line.slice(13));
    expect(lines).not.toContain("old");
    expect(lines).toContain("recent");
    expect(lines.at(-1)).toMatch(/^page load /);
  });

  it("reads another role's log from storage and can delete it", () => {
    stubBrowser();
    startDebugLog("host");
    debugLog("session created", { pin: "123456" });
    flushDebugLog();
    resetDebugLogForTests();
    startDebugLog("player");

    expect(hasDebugLog("host")).toBe(true);
    expect(formatDebugLog("host")).toContain("session created pin=123456");
    clearDebugLog("host");
    expect(hasDebugLog("host")).toBe(false);
  });

  it("describes an exception by where it was thrown, in either engine's stack format", () => {
    stubBrowser();
    const chromium = new TypeError("x is undefined");
    chromium.stack = [
      "TypeError: x is undefined",
      "    at render (https://quiz.example/assets/index-abc.js:1:200)",
      "    at https://cdn.example/typst.js:5:6",
    ].join("\n");
    const firefox = new TypeError("x is undefined");
    firefox.stack = "render@https://quiz.example/assets/index-abc.js:1:200\n@https://cdn.example/typst.js:5:6\n";

    expect(describeException(chromium)).toBe(
      "TypeError: x is undefined @ render (/assets/index-abc.js:1:200) < https://cdn.example/typst.js:5:6",
    );
    expect(describeException(firefox)).toBe(
      "TypeError: x is undefined @ render@/assets/index-abc.js:1:200 < @https://cdn.example/typst.js:5:6",
    );
    expect(describeException("plain")).toBe("plain");
  });

  it("logs uncaught errors and unhandled rejections with their stack", () => {
    stubBrowser();
    startDebugLog("host");
    const error = new Error("boom");
    error.stack = "Error: boom\n    at tick (https://quiz.example/assets/index-abc.js:1:2)";
    listeners.error({ error, message: "Uncaught Error: boom" });
    listeners.unhandledrejection({ reason: error });
    listeners.error({ error: null, message: "Script error.", filename: "", lineno: 0, colno: 0 });

    expect(logLines("host").slice(1).map((line) => line.slice(13))).toEqual([
      'uncaught error error="Error: boom @ tick (/assets/index-abc.js:1:2)"',
      'unhandled rejection reason="Error: boom @ tick (/assets/index-abc.js:1:2)"',
      'uncaught error message="Script error." at=:0:0',
    ]);
  });

  it("logs a reported exception once and still prints it", () => {
    stubBrowser();
    const printed = vi.fn();
    console.error = printed;
    startDebugLog("host");
    const error = new Error("boom");
    error.stack = "";
    reportException("vue error", error, { component: "HostApp", info: "mounted hook" });

    expect(printed).toHaveBeenCalledExactlyOnceWith(error);
    expect(logLines("host").slice(1).map((line) => line.slice(13))).toEqual([
      'vue error component=HostApp info="mounted hook" error="Error: boom"',
    ]);
  });

  it("keeps only the newest entries", () => {
    stubBrowser();
    startDebugLog("host");
    for (let i = 0; i < 3100; i++) debugLog("event", { i });

    const lines = logLines("host");
    expect(lines).toHaveLength(3000);
    expect(lines.at(-1)).toMatch(/event i=3099$/);
  });
});
