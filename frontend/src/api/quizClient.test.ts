import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNewerSnapshot,
  rankForScore,
  reportAfterGrace,
  revealOutcome,
  SILENT_AFTER_MS,
  subscribeToState,
  type ConnectionStatus,
  type SessionSnapshot,
} from "./quizClient";

describe("rankForScore", () => {
  const scores = [36, 22, 22, 10, 0];

  it("ranks the top score first", () => {
    expect(rankForScore(scores, 36)).toBe(1);
  });

  it("gives tied players the same rank and skips the next one", () => {
    expect(rankForScore(scores, 22)).toBe(2);
    expect(rankForScore(scores, 10)).toBe(4);
  });

  it("ranks everyone first when all are tied", () => {
    expect(rankForScore([10, 10, 10], 10)).toBe(1);
  });
});

describe("isNewerSnapshot", () => {
  const snapshot = (seq?: number): SessionSnapshot => ({ phase: "lobby", question_index: null, players: [], seq });

  it("takes only a snapshot numbered above the last one applied", () => {
    expect(isNewerSnapshot(snapshot(11), 10)).toBe(true);
    expect(isNewerSnapshot(snapshot(10), 10)).toBe(false);
    expect(isNewerSnapshot(snapshot(9), 10)).toBe(false);
  });

  it("takes an unnumbered snapshot from an older host page", () => {
    expect(isNewerSnapshot(snapshot(), 10)).toBe(true);
  });
});

describe("revealOutcome", () => {
  const reveal = (players: string[], answered?: string[]): SessionSnapshot => ({
    phase: "reveal",
    question_index: 0,
    players,
    correct_index: 2,
    answered,
  });

  it("is correct for a player on the list of correct answers", () => {
    expect(revealOutcome(reveal(["ada"], ["ada"]), "ada", 2)).toBe("correct");
  });

  it("is wrong for an answer the host got", () => {
    expect(revealOutcome(reveal([], ["ada"]), "ada", 0)).toBe("wrong");
    // Even if this device has forgotten its pick.
    expect(revealOutcome(reveal([], ["ada"]), "ada", null)).toBe("wrong");
  });

  it("is lost for a pick the host never got, right or wrong", () => {
    expect(revealOutcome(reveal([], []), "ada", 2)).toBe("lost");
    expect(revealOutcome(reveal([], []), "ada", 0)).toBe("lost");
  });

  it("is none without a pick", () => {
    expect(revealOutcome(reveal([], []), "ada", null)).toBe("none");
  });

  it("only calls a right pick lost when the host does not say who answered", () => {
    expect(revealOutcome(reveal([]), "ada", 2)).toBe("lost");
    expect(revealOutcome(reveal([]), "ada", 0)).toBe("wrong");
    expect(revealOutcome(reveal([]), "ada", null)).toBe("none");
  });
});

/** Stands in for the browser's EventSource, which Node does not have. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: { data: string }) => void)[]>();

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) });
  }

  fail(readyState: number) {
    this.readyState = readyState;
    this.onerror?.();
  }
}

describe("subscribeToState", () => {
  let snapshots: SessionSnapshot[];
  let pings: number;
  let statuses: ConnectionStatus[];
  let stop: () => void;
  const latest = () => FakeEventSource.instances.at(-1)!;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    snapshots = [];
    pings = 0;
    statuses = [];
    stop = subscribeToState("123456", {
      snapshot: (snapshot) => snapshots.push(snapshot),
      status: (status) => statuses.push(status),
      ping: () => pings++,
    });
    latest().open();
  });

  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("passes snapshots and pings on", () => {
    latest().emit("state", { phase: "lobby", question_index: null, players: [] });
    latest().emit("ping", {});
    expect(snapshots).toHaveLength(1);
    expect(pings).toBe(1);
  });

  it("leaves a dropped connection to the browser's own reconnect", () => {
    latest().fail(0);
    vi.advanceTimersByTime(3000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("opens a new stream once the browser has given up on one", () => {
    // An HTTP error, say: EventSource never tries again by itself.
    latest().fail(2);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    latest().open();
    latest().emit("ping", {});
    expect(statuses.at(-1)).toBe("open");
  });

  it("waits longer after every failure in a row", () => {
    latest().fail(2);
    vi.advanceTimersByTime(1000);
    latest().fail(2);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  it("replaces a stream that carries nothing, not even pings", () => {
    vi.advanceTimersByTime(SILENT_AFTER_MS + 1000);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("keeps a stream that the relay's pings show to be alive", () => {
    for (let second = 0; second < 30; second += 5) {
      vi.advanceTimersByTime(5000);
      latest().emit("ping", {});
    }
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("stops for good when unsubscribed", () => {
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});

describe("reportAfterGrace", () => {
  let seen: ConnectionStatus[];
  const record = (status: ConnectionStatus) => seen.push(status);

  beforeEach(() => {
    seen = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes open on at once", () => {
    reportAfterGrace(record, 5000)("open");
    expect(seen).toEqual(["open"]);
  });

  it("keeps quiet about an outage that heals within the grace period", () => {
    const report = reportAfterGrace(record, 5000);
    report("reconnecting");
    vi.advanceTimersByTime(4999);
    report("open");
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual(["open"]);
  });

  it("reports an outage that outlasts the grace period", () => {
    const report = reportAfterGrace(record, 5000);
    report("reconnecting");
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual(["reconnecting"]);
  });

  it("counts the grace period from the first failure, not the latest", () => {
    // A reconnect loop fails again every second; that must not postpone the
    // banner forever.
    const report = reportAfterGrace(record, 5000);
    for (let i = 0; i < 5; i++) {
      report("reconnecting");
      vi.advanceTimersByTime(1000);
    }
    expect(seen).toEqual(["reconnecting"]);
  });

  it("forgets a pending outage when cancelled", () => {
    const report = reportAfterGrace(record, 5000);
    report("reconnecting");
    report.cancel();
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual([]);
  });
});
