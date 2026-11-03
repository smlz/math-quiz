import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNewerSnapshot,
  rankForScore,
  reportAfterGrace,
  revealOutcome,
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
