import { describe, expect, it } from "vitest";
import type { PlayerMessage } from "../api/quizClient";
import {
  afterReveal,
  answerCounts,
  buildSnapshot,
  fromStored,
  isRevealed,
  mergePlayer,
  newGame,
  nextQuestion,
  playerRows,
  receive,
  removePlayer,
  reveal,
  toStored,
  type Game,
} from "./hostGame";
import type { ParsedQuiz } from "./types";

/** A quiz whose questions have these correct options. */
function quiz(...correct: number[]): ParsedQuiz {
  return {
    preamble: "",
    questions: correct.map((correctIndex, i) => ({
      id: `q${i + 1}`,
      promptTypst: `Frage ${i + 1}`,
      options: ["A", "B", "C", "D"].map((typst) => ({ typst })),
      correctIndex,
      answerAreaFraction: 0.5,
    })),
  };
}

const join = (nickname: unknown): PlayerMessage => ({ type: "join", nickname }) as PlayerMessage;
const answer = (question_index: unknown, option_index: unknown): PlayerMessage =>
  ({ type: "answer", question_index, option_index }) as PlayerMessage;

/** A game with these players joined in the lobby. */
function lobby(players: string[], questions = quiz(1, 2, 3)): Game {
  const game = newGame(questions);
  for (const id of players) expect(receive(game, id, join(id.toUpperCase()))).toBe("taken");
  return game;
}

/** A game on its first question, answered with these options in this order. */
function answered(picks: [string, number][], questions = quiz(1, 2, 3)): Game {
  const game = lobby(
    picks.map(([id]) => id),
    questions,
  );
  nextQuestion(game);
  for (const [id, option] of picks) expect(receive(game, id, answer(0, option))).toBe("taken");
  return game;
}

describe("phases", () => {
  it("goes through every question and ends on the final screen", () => {
    const game = lobby(["ada"], quiz(1, 2));
    const phases = [game.round.phase];
    const steps = [nextQuestion, reveal, afterReveal, nextQuestion, reveal, afterReveal];
    for (const step of steps) {
      expect(step(game)).toBe(true);
      phases.push(game.round.phase);
    }
    expect(phases).toEqual(["lobby", "question", "reveal", "leaderboard", "question", "reveal", "finished"]);
  });

  it("ignores a step from the wrong phase", () => {
    const game = lobby(["ada"]);
    expect(reveal(game)).toBe(false);
    expect(afterReveal(game)).toBe(false);
    nextQuestion(game);
    expect(nextQuestion(game)).toBe(false);
    expect(afterReveal(game)).toBe(false);
    expect(game.round).toEqual({ phase: "question", index: 0, answers: new Map() });
    reveal(game);
    expect(reveal(game)).toBe(false);
    expect(nextQuestion(game)).toBe(false);
    expect(game.round.phase).toBe("reveal");
  });

  it("starts every question without the answers to the one before", () => {
    const game = answered([["ada", 1]]);
    reveal(game);
    afterReveal(game);
    nextQuestion(game);
    expect(game.round).toEqual({ phase: "question", index: 1, answers: new Map() });
  });
});

describe("reveal", () => {
  it("scores right answers by arrival, 13 down to 10", () => {
    const game = answered([
      ["ada", 1],
      ["bo", 0],
      ["cy", 1],
      ["di", 1],
      ["ed", 1],
      ["fay", 1],
    ]);
    reveal(game);
    expect(game.round).toMatchObject({ correctOrder: ["ada", "cy", "di", "ed", "fay"] });
    expect(Object.fromEntries(game.scores)).toEqual({ ada: 13, bo: 0, cy: 12, di: 11, ed: 10, fay: 10 });
  });

  it("keeps the scores from before, for the leaderboard", () => {
    const game = answered([["ada", 1]]);
    game.scores.set("ada", 5);
    reveal(game);
    expect(game.round).toMatchObject({ scoresBefore: new Map([["ada", 5]]) });
    expect(game.scores.get("ada")).toBe(18);
  });

  it("counts the picks per option", () => {
    const game = answered([
      ["ada", 1],
      ["bo", 3],
      ["cy", 1],
    ]);
    expect(answerCounts(game)).toEqual([0, 2, 0, 1]);
    expect(answerCounts(newGame(quiz(0)))).toEqual([]);
  });
});

describe("receive", () => {
  it("takes the first join and repeats nothing for the later ones", () => {
    const game = lobby(["ada"]);
    expect(receive(game, "ada", join("Someone else"))).toBe("repeat");
    expect(game.roster.get("ada")).toBe("ADA");
  });

  it("notes a repeated join as a sign of life", () => {
    const game = answered([["ada", 1]]);
    reveal(game);
    afterReveal(game);
    nextQuestion(game);
    expect(game.lastSeen.get("ada")).toBe(0);
    receive(game, "ada", join("ADA"));
    expect(game.lastSeen.get("ada")).toBe(1);
  });

  it("numbers a nickname that is taken, and turns away one that is not usable", () => {
    const game = lobby(["ada"]);
    expect(receive(game, "other", join("ada"))).toBe("taken");
    expect(game.roster.get("other")).toBe("ada (2)");
    expect(receive(game, "x", join("​"))).toEqual({ ignored: "unusable nickname" });
    expect(receive(game, "y", join(42))).toEqual({ ignored: "no nickname" });
  });

  it("turns away joins once the quiz is finished", () => {
    const game = answered([["ada", 1]], quiz(1));
    reveal(game);
    afterReveal(game);
    expect(game.round.phase).toBe("finished");
    expect(receive(game, "late", join("Late"))).toEqual({ ignored: "quiz finished" });
  });

  it("turns away joins once the roster is full", () => {
    const game = newGame(quiz(0));
    for (let i = 0; i < 200; i++) receive(game, `p${i}`, join(`P${i}`));
    expect(receive(game, "one-more", join("One more"))).toEqual({ ignored: "roster full" });
  });

  it("ignores removed players for good", () => {
    const game = lobby(["ada"]);
    removePlayer(game, "ada");
    expect(receive(game, "ada", join("Ada"))).toEqual({ ignored: "removed" });
  });

  it("takes one valid answer per player to the open question", () => {
    const game = lobby(["ada", "bo"]);
    expect(receive(game, "ada", answer(0, 1))).toEqual({ ignored: "phase lobby" });
    nextQuestion(game);
    expect(receive(game, "ada", answer(1, 1))).toEqual({ ignored: "for question 1, now 0" });
    expect(receive(game, "stranger", answer(0, 1))).toEqual({ ignored: "not joined" });
    expect(receive(game, "ada", answer(0, 4))).toEqual({ ignored: "invalid option" });
    expect(receive(game, "ada", answer(0, 1.5))).toEqual({ ignored: "invalid option" });
    expect(receive(game, "ada", answer(0, "1"))).toEqual({ ignored: "invalid option" });
    expect(receive(game, "ada", answer(0, 1))).toBe("taken");
    expect(receive(game, "ada", answer(0, 2))).toEqual({ ignored: "already answered" });
    expect(receive(game, "bo", { type: "rename" } as unknown as PlayerMessage)).toEqual({ ignored: "unknown type" });
    expect(game.round).toMatchObject({ answers: new Map([["ada", 1]]) });
    expect(game.lastSeen.get("ada")).toBe(0);
  });
});

describe("players", () => {
  it("removes a player with their answer, but leaves the correct order", () => {
    const game = answered([
      ["ada", 1],
      ["bo", 1],
    ]);
    reveal(game);
    expect(removePlayer(game, "ada")).toBe(true);
    expect(removePlayer(game, "ada")).toBe(false);
    expect(game.round).toMatchObject({ answers: new Map([["bo", 1]]), correctOrder: ["ada", "bo"] });
    expect(game.scores.has("ada")).toBe(false);
    expect(game.removed.has("ada")).toBe(true);
  });

  it("merges a duplicate into the entry its pupil plays on now", () => {
    const game = answered([["old", 1]]);
    receive(game, "new", join("Ada"));
    reveal(game);
    expect(mergePlayer(game, "old", "new")).toBe(true);
    expect(game.round).toMatchObject({ correctOrder: ["new"], answers: new Map([["new", 1]]) });
    expect(game.scores.get("new")).toBe(13);
    expect(game.removed.has("old")).toBe(true);
    expect(mergePlayer(game, "old", "new")).toBe(false);
  });

  it("lists who missed the latest question", () => {
    const game = answered([["ada", 1]]);
    receive(game, "bo", join("Bo"));
    reveal(game);
    expect(playerRows(game)).toEqual([
      { player_id: "ada", nickname: "ADA", score: 13, lastSeen: 0, missedLatest: false },
      { player_id: "bo", nickname: "Bo", score: 0, lastSeen: 0, missedLatest: false },
    ]);
    afterReveal(game);
    nextQuestion(game);
    reveal(game);
    expect(playerRows(game).map((row) => row.missedLatest)).toEqual([true, true]);
  });
});

describe("buildSnapshot", () => {
  it("lists who joined in the lobby, and who answered during a question", () => {
    const game = lobby(["ada", "bo"]);
    removePlayer(game, "bo");
    expect(buildSnapshot(game)).toEqual({ phase: "lobby", question_index: null, players: ["ada"], removed: ["bo"] });
    nextQuestion(game);
    expect(buildSnapshot(game).players).toEqual([]);
    receive(game, "ada", answer(0, 3));
    expect(buildSnapshot(game)).toEqual({ phase: "question", question_index: 0, players: ["ada"], removed: ["bo"] });
  });

  it("tells the answer, who was right, who answered and every score at the reveal", () => {
    const game = answered([
      ["ada", 0],
      ["bo", 1],
    ]);
    receive(game, "cy", join("Cy"));
    reveal(game);
    expect(buildSnapshot(game)).toEqual({
      phase: "reveal",
      question_index: 0,
      players: ["bo"],
      correct_index: 1,
      answered: ["ada", "bo"],
      scores: { ada: 0, bo: 13, cy: 0 },
    });
  });

  it("lists everyone in rank order on the leaderboard and the final screen", () => {
    const game = answered(
      [
        ["ada", 0],
        ["bo", 1],
      ],
      quiz(1, 1),
    );
    reveal(game);
    afterReveal(game);
    expect(buildSnapshot(game)).toEqual({
      phase: "leaderboard",
      question_index: 0,
      players: ["bo", "ada"],
      scores: { bo: 13, ada: 0 },
    });
    nextQuestion(game);
    reveal(game);
    afterReveal(game);
    expect(buildSnapshot(game)).toMatchObject({ phase: "finished", question_index: 1, players: ["bo", "ada"] });
  });
});

describe("toStored and fromStored", () => {
  it("bring back every phase, all but the leaderboard's animation", () => {
    const game = answered([
      ["ada", 1],
      ["bo", 2],
    ]);
    for (const step of [() => true, () => reveal(game), () => afterReveal(game)]) {
      step();
      const restored = fromStored(game.quiz, JSON.parse(JSON.stringify(toStored(game))));
      if (isRevealed(game.round)) game.round.scoresBefore = null;
      expect(restored).toEqual(game);
    }
  });

  it("brings back the lobby", () => {
    const game = lobby(["ada"]);
    expect(fromStored(game.quiz, toStored(game))).toEqual(game);
  });

  it("counts everyone as present from an entry that predates lastSeen", () => {
    const stored = { ...toStored(answered([["ada", 1]])), lastSeen: undefined };
    expect(fromStored(quiz(1, 2, 3), stored).lastSeen).toEqual(new Map([["ada", 0]]));
  });

  it("rejects an entry that does not fit its quiz", () => {
    const stored = toStored(answered([["ada", 1]]));
    expect(() => fromStored(quiz(1, 2, 3), { ...stored, status: "setup" })).toThrow("unknown phase");
    expect(() => fromStored(quiz(1, 2, 3), { ...stored, currentQuestionIndex: 3 })).toThrow("no question 3");
    expect(() => fromStored(quiz(1, 2, 3), { ...stored, currentQuestionIndex: -1 })).toThrow("no question -1");
  });
});
