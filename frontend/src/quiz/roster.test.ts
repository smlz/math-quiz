import { describe, expect, it } from "vitest";
import { baseNickname, latestPlayedQuestion, mergePlayers, missedLatestQuestion, type RosterState } from "./roster";

function state(overrides: Partial<RosterState> = {}): RosterState {
  return {
    roster: new Map([
      ["old", "Ada"],
      ["new", "Ada (2)"],
      ["bo", "Bo"],
    ]),
    scores: new Map([
      ["old", 20],
      ["new", 0],
      ["bo", 13],
    ]),
    answers: new Map(),
    correctOrder: [],
    lastSeen: new Map([
      ["old", 1],
      ["new", 2],
      ["bo", 2],
    ]),
    removed: new Set(),
    ...overrides,
  };
}

describe("latestPlayedQuestion", () => {
  it("leaves out the question that is still open", () => {
    expect(latestPlayedQuestion("question", 2)).toBe(1);
  });

  it("counts the question once it is revealed", () => {
    expect(latestPlayedQuestion("reveal", 2)).toBe(2);
    expect(latestPlayedQuestion("leaderboard", 2)).toBe(2);
  });

  it("has nothing played in the lobby or during the first question", () => {
    expect(latestPlayedQuestion("lobby", -1)).toBe(-1);
    expect(latestPlayedQuestion("question", 0)).toBe(-1);
  });
});

describe("missedLatestQuestion", () => {
  const lastSeen = new Map([
    ["answered", 2],
    ["stopped", 1],
    ["lobby", -1],
    ["late", 2],
  ]);

  it("spots a player who stopped answering", () => {
    expect(missedLatestQuestion(lastSeen, "stopped", 2)).toBe(true);
    expect(missedLatestQuestion(lastSeen, "lobby", 0)).toBe(true);
  });

  it("leaves out players who answered or only just joined", () => {
    expect(missedLatestQuestion(lastSeen, "answered", 2)).toBe(false);
    expect(missedLatestQuestion(lastSeen, "late", 2)).toBe(false);
  });

  it("marks nobody before the first question is over", () => {
    expect(missedLatestQuestion(lastSeen, "lobby", -1)).toBe(false);
  });
});

describe("baseNickname", () => {
  it("drops the number the host adds to a taken name, and the case", () => {
    expect(baseNickname("Ada (2)")).toBe("ada");
    expect(baseNickname("ada")).toBe("ada");
    expect(baseNickname("Bo (12)")).toBe("bo");
  });

  it("keeps brackets that are part of the name", () => {
    expect(baseNickname("Ada (A)")).toBe("ada (a)");
  });
});

describe("mergePlayers", () => {
  it("adds the points to the target and removes the source for good", () => {
    const s = state();
    mergePlayers(s, "old", "new");
    expect(s.scores.get("new")).toBe(20);
    expect(s.scores.has("old")).toBe(false);
    expect(s.roster.has("old")).toBe(false);
    expect(s.removed.has("old")).toBe(true);
    expect(s.lastSeen.get("new")).toBe(2);
    expect(s.lastSeen.has("old")).toBe(false);
  });

  it("hands an open question's answer over in its place in the arrival order", () => {
    const s = state({
      answers: new Map([
        ["bo", 1],
        ["old", 2],
      ]),
    });
    mergePlayers(s, "old", "new");
    expect([...s.answers]).toEqual([
      ["bo", 1],
      ["new", 2],
    ]);
  });

  it("keeps the target's own answer when both answered", () => {
    const s = state({
      answers: new Map([
        ["old", 2],
        ["new", 0],
      ]),
    });
    mergePlayers(s, "old", "new");
    expect([...s.answers]).toEqual([["new", 0]]);
  });

  it("puts the target in the source's place among the correct answers", () => {
    // Revealed: the old entry was first, and its 13 points are in its score.
    const s = state({
      answers: new Map([
        ["old", 2],
        ["bo", 2],
      ]),
      correctOrder: ["old", "bo"],
      scores: new Map([
        ["old", 33],
        ["new", 0],
        ["bo", 12],
      ]),
    });
    const correctOrder = mergePlayers(s, "old", "new");
    expect(correctOrder).toEqual(["new", "bo"]);
    expect(s.scores.get("new")).toBe(33);
  });

  it("counts a question both answered correctly only once", () => {
    const s = state({
      answers: new Map([
        ["old", 2],
        ["new", 2],
      ]),
      correctOrder: ["old", "new"],
      scores: new Map([
        ["old", 33],
        ["new", 12],
        ["bo", 0],
      ]),
    });
    const correctOrder = mergePlayers(s, "old", "new");
    // 33 - 13 for the question both answered, plus the target's own 12.
    expect(s.scores.get("new")).toBe(32);
    // Nobody else's place, and so nobody's "+N", moves.
    expect(correctOrder).toEqual(["old", "new"]);
  });

  it("merges the standings from before the reveal too", () => {
    const scoresBefore = new Map([
      ["old", 20],
      ["new", 0],
      ["bo", 0],
    ]);
    const s = state({ scoresBefore });
    mergePlayers(s, "old", "new");
    expect([...scoresBefore]).toEqual([
      ["new", 20],
      ["bo", 0],
    ]);
  });

  it("does nothing for the same or an unknown player", () => {
    const s = state();
    mergePlayers(s, "old", "old");
    mergePlayers(s, "gone", "new");
    mergePlayers(s, "old", "gone");
    expect(s.roster.size).toBe(3);
    expect(s.removed.size).toBe(0);
    expect(s.scores.get("old")).toBe(20);
  });
});
