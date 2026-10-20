import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDebugSecret,
  clearDebugLog,
  debugLog,
  flushDebugLog,
  formatDebugLog,
  hasDebugLog,
  resetDebugLogForTests,
  setDebugContext,
  startDebugLog,
} from "./debugLog";

// Just enough of a browser for the log: storage, and somewhere to hang the
// event listeners it installs.
function stubBrowser() {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  const target = { addEventListener: () => {} };
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
    debugLog("join", { player: "p1", nickname: "Ada Lovelace" });

    expect(logLines("host").slice(1)).toEqual([
      "10:00:00.000 broadcast phase=lobby players=2 ×3 until 10:00:10.000",
      '10:00:10.000 join player=p1 nickname="Ada Lovelace"',
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

  it("keeps only the newest entries", () => {
    stubBrowser();
    startDebugLog("host");
    for (let i = 0; i < 3100; i++) debugLog("event", { i });

    const lines = logLines("host");
    expect(lines).toHaveLength(3000);
    expect(lines.at(-1)).toMatch(/event i=3099$/);
  });
});
