// The quiz a host runs, as plain data: who plays, what they answered, what
// they scored, and which phase the quiz is in. No timers, no network, no Vue:
// HostApp.vue does all of that and asks this module for every decision.
//
// The phases, and the only ways between them:
//
//   lobby ──▶ question ──▶ reveal ──▶ leaderboard ──▶ question ──▶ …
//                            │
//                            └──▶ finished          (after the last question)
//
// The functions change the game they are given in place, as mergePlayers
// does, so a reactive game in HostApp re-renders by itself. A step taken from
// the wrong phase -- a second click on a button already on its way out --
// returns false and changes nothing.

import { pointsForReveal, rankForScore, type PlayerMessage, type SessionSnapshot } from "../api/quizClient";
import type { StoredHostSession } from "../api/storedSession";
import { cleanNickname } from "./nickname";
import { latestPlayedQuestion, mergePlayers, missedLatestQuestion, type LastSeen, type PlayerRow } from "./roster";
import type { LeaderboardEntry, ParsedQuiz, QuestionState } from "./types";

// Generous for one class, but bounds what a flood of joins from strangers who
// guessed the pin can do to the roster, the projector and every snapshot.
const MAX_PLAYERS = 200;

export interface Game {
  readonly quiz: ParsedQuiz;
  /** player_id -> nickname, in the order they joined. */
  roster: Map<string, string>;
  /** player_id -> total score. */
  scores: Map<string, number>;
  /** When each player was last heard from, as a question index: their latest
   * answer or join, -1 for the lobby. Shows the teacher who stopped playing. */
  lastSeen: LastSeen;
  /** Players the teacher removed (e.g. for a rude nickname). Their ids are
   * ignored for the rest of the game; rejoining takes a fresh id. */
  removed: Set<string>;
  round: Round;
}

/** What only some phases have lives here, so the others cannot get at it. */
export type Round = Lobby | OpenQuestion | Revealed;

export interface Lobby {
  phase: "lobby";
}

export interface OpenQuestion {
  phase: "question";
  index: number;
  answers: Answers;
}

/** A question whose answer is out, and what follows it until the next one. */
export interface Revealed {
  phase: "reveal" | "leaderboard" | "finished";
  index: number;
  answers: Answers;
  /** Who answered correctly, in arrival order. Frozen at the reveal, so
   * re-broadcasting the same snapshot can never re-score anyone. */
  correctOrder: string[];
  /** The scores before the reveal, so the leaderboard can show what the
   * question changed. Not stored: after a reload it appears settled. */
  scoresBefore: Map<string, number> | null;
}

/** player_id -> option_index. Insertion order is arrival order, which is
 * exactly what decides the 13-to-10 ladder -- no timestamps needed. */
export type Answers = Map<string, number>;

export function newGame(quiz: ParsedQuiz): Game {
  return {
    quiz,
    roster: new Map(),
    scores: new Map(),
    lastSeen: new Map(),
    removed: new Set(),
    round: { phase: "lobby" },
  };
}

export function isRevealed(round: Round): round is Revealed {
  return round.phase === "reveal" || round.phase === "leaderboard" || round.phase === "finished";
}

// ── The teacher's buttons ────────────────────────────────────────────────

/** "Frage starten" in the lobby, "Nächste Frage" on a leaderboard -- or the
 * final screen, should no question be left. */
export function nextQuestion(game: Game): boolean {
  const { round } = game;
  if (round.phase !== "lobby" && round.phase !== "leaderboard") return false;
  const index = round.phase === "lobby" ? 0 : round.index + 1;
  if (round.phase === "leaderboard" && index >= game.quiz.questions.length) {
    game.round = { ...round, phase: "finished" };
  } else {
    game.round = { phase: "question", index, answers: new Map() };
  }
  return true;
}

/** "Antwort zeigen": scores the question. */
export function reveal(game: Game): boolean {
  const { round } = game;
  if (round.phase !== "question") return false;
  const { correctIndex } = game.quiz.questions[round.index];
  const correctOrder = [...round.answers].filter(([, option]) => option === correctIndex).map(([id]) => id);
  const scoresBefore = new Map(game.scores);
  for (const id of game.roster.keys()) {
    game.scores.set(id, (game.scores.get(id) ?? 0) + pointsForReveal(correctOrder, id));
  }
  game.round = { ...round, phase: "reveal", correctOrder, scoresBefore };
  return true;
}

/** "Rangliste anzeigen" -- or, after the last question, which has no next
 * round to rank for, "Endergebnis anzeigen". */
export function afterReveal(game: Game): boolean {
  const { round } = game;
  if (round.phase !== "reveal") return false;
  game.round = { ...round, phase: isLastQuestion(game) ? "finished" : "leaderboard" };
  return true;
}

/** Takes a player out of the game, mainly for a rude nickname. Their device
 * learns it from the next snapshot and offers to join again under a new name,
 * starting from zero points. */
export function removePlayer(game: Game, playerId: string): boolean {
  if (!game.roster.delete(playerId)) return false;
  game.removed.add(playerId);
  game.scores.delete(playerId);
  game.lastSeen.delete(playerId);
  // The correct order stays as it is: everyone derives the points just won
  // from their place in it, and those points are already in the scores.
  if (game.round.phase !== "lobby") game.round.answers.delete(playerId);
  return true;
}

/** Folds a duplicate entry into the one its pupil plays on now (see
 * mergePlayers): the points move over, and the old entry is removed. */
export function mergePlayer(game: Game, sourceId: string, targetId: string): boolean {
  if (sourceId === targetId || !game.roster.has(sourceId) || !game.roster.has(targetId)) return false;
  const { round } = game;
  const revealed = isRevealed(round) ? round : null;
  const correctOrder = mergePlayers(
    {
      roster: game.roster,
      scores: game.scores,
      answers: round.phase === "lobby" ? new Map() : round.answers,
      correctOrder: revealed?.correctOrder ?? [],
      lastSeen: game.lastSeen,
      removed: game.removed,
      scoresBefore: revealed?.scoresBefore,
    },
    sourceId,
    targetId,
  );
  if (revealed) revealed.correctOrder = correctOrder;
  return true;
}

// ── Player messages ──────────────────────────────────────────────────────

/** What became of a player's message: taken (players must hear of it), a
 * repeat of a join already taken (nothing to tell), or ignored, and why. */
export type Received = "taken" | "repeat" | { ignored: string };

/** Anyone who knows (or guesses) the pin can mint a player token and send any
 * JSON object at all, so the message is untrusted input: only the
 * relay-attributed `playerId` can be relied on. */
export function receive(game: Game, playerId: string, message: PlayerMessage): Received {
  if (game.removed.has(playerId)) return { ignored: "removed" };
  if (message.type === "join") return join(game, playerId, message.nickname);
  if (message.type === "answer") return answer(game, playerId, message.question_index, message.option_index);
  return { ignored: "unknown type" };
}

function join(game: Game, playerId: string, nickname: unknown): Received {
  const { roster, lastSeen } = game;
  // The first join wins: retries, and renames from an id already seen, are
  // ignored -- a real player always re-sends the nickname it joined with.
  // A device re-sends its join after a reload, so it is still around.
  if (roster.has(playerId)) {
    lastSeen.set(playerId, Math.max(lastSeen.get(playerId) ?? -1, questionIndex(game)));
    return "repeat";
  }
  // A device that cleared its session at the end and joins again would
  // otherwise be listed a second time, with no points and a last place.
  if (game.round.phase === "finished") return { ignored: "quiz finished" };
  if (roster.size >= MAX_PLAYERS) return { ignored: "roster full" };
  if (typeof nickname !== "string") return { ignored: "no nickname" };
  const cleaned = cleanNickname(nickname, roster.values());
  if (!cleaned) return { ignored: "unusable nickname" };
  roster.set(playerId, cleaned);
  if (!game.scores.has(playerId)) game.scores.set(playerId, 0);
  lastSeen.set(playerId, questionIndex(game));
  return "taken";
}

function answer(game: Game, playerId: string, forQuestion: unknown, option: unknown): Received {
  const { round } = game;
  if (round.phase !== "question") return { ignored: `phase ${round.phase}` };
  if (forQuestion !== round.index) return { ignored: `for question ${String(forQuestion)}, now ${round.index}` };
  // Anyone can mint a token, but only players seen joining can score.
  if (!game.roster.has(playerId)) return { ignored: "not joined" };
  if (round.answers.has(playerId)) return { ignored: "already answered" };
  const options = game.quiz.questions[round.index].options.length;
  if (typeof option !== "number" || !Number.isInteger(option) || option < 0 || option >= options) {
    return { ignored: "invalid option" };
  }
  round.answers.set(playerId, option);
  game.lastSeen.set(playerId, round.index);
  return "taken";
}

// ── What the screens and the players are shown ───────────────────────────

/** The question being played or just played; -1 in the lobby. */
export function questionIndex(game: Game): number {
  return game.round.phase === "lobby" ? -1 : game.round.index;
}

export function currentQuestion(game: Game): QuestionState | null {
  return game.round.phase === "lobby" ? null : game.quiz.questions[game.round.index];
}

export function isLastQuestion(game: Game): boolean {
  return questionIndex(game) === game.quiz.questions.length - 1;
}

/** How many picked each option of the current question. */
export function answerCounts(game: Game): number[] {
  const { round } = game;
  if (round.phase === "lobby") return [];
  const counts = game.quiz.questions[round.index].options.map(() => 0);
  for (const option of round.answers.values()) counts[option]++;
  return counts;
}

/** Everyone, best first, with the scores given (the current ones unless
 * said otherwise). Ties share a rank, by the rule players use for their own. */
export function standings(game: Game, scores: Map<string, number> = game.scores): LeaderboardEntry[] {
  const entries = [...game.roster]
    .map(([player_id, nickname]) => ({ player_id, nickname, score: scores.get(player_id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const allScores = entries.map((entry) => entry.score);
  return entries.map((entry) => ({ ...entry, rank: rankForScore(allScores, entry.score) }));
}

/** The teacher's list of all players (HostPlayers.vue). */
export function playerRows(game: Game): PlayerRow[] {
  const latestPlayed = latestPlayedQuestion(game.round.phase, questionIndex(game));
  return [...game.roster].map(([player_id, nickname]) => ({
    player_id,
    nickname,
    score: game.scores.get(player_id) ?? 0,
    lastSeen: game.lastSeen.get(player_id) ?? -1,
    missedLatest: missedLatestQuestion(game.lastSeen, player_id, latestPlayed),
  }));
}

/** The whole of what players are told, rebuilt from scratch every time. Its
 * number (`seq`) is left to whoever sends it.
 *
 * `players` carries a different meaning per phase (see SessionSnapshot):
 * who has joined, who has answered, who was correct and in what order, or
 * the rank order. From the reveal on it also carries everyone's total, so a
 * player's score is always the host's. Nicknames stay here on the host. */
export function buildSnapshot(game: Game): SessionSnapshot {
  const { round } = game;
  const common = {
    phase: round.phase,
    // Tells a removed player's device to drop its identity.
    ...(game.removed.size ? { removed: [...game.removed] } : {}),
  };
  if (round.phase === "lobby") return { ...common, question_index: null, players: [...game.roster.keys()] };
  if (round.phase === "question") {
    return { ...common, question_index: round.index, players: [...round.answers.keys()] };
  }

  const ranked = standings(game);
  const scores = Object.fromEntries(ranked.map((entry) => [entry.player_id, entry.score]));
  if (round.phase === "reveal") {
    return {
      ...common,
      question_index: round.index,
      players: round.correctOrder,
      correct_index: game.quiz.questions[round.index].correctIndex,
      // So that an answer that never arrived is not taken for a wrong one.
      answered: [...round.answers.keys()],
      scores,
    };
  }
  return { ...common, question_index: round.index, players: ranked.map((entry) => entry.player_id), scores };
}

// ── Surviving a reload ───────────────────────────────────────────────────

/** The game's share of StoredHostSession, in the format it has always had, so
 * that a quiz running during an update carries on after it. */
export type StoredGame = Pick<
  StoredHostSession,
  "status" | "currentQuestionIndex" | "roster" | "scores" | "answers" | "correctOrder" | "removed" | "lastSeen"
>;

export function toStored(game: Game): StoredGame {
  const { round } = game;
  return {
    status: round.phase,
    currentQuestionIndex: questionIndex(game),
    roster: [...game.roster],
    scores: [...game.scores],
    answers: round.phase === "lobby" ? [] : [...round.answers],
    correctOrder: isRevealed(round) ? [...round.correctOrder] : [],
    removed: [...game.removed],
    lastSeen: [...game.lastSeen],
  };
}

/** The game a stored session holds. Throws if the entry does not fit its quiz,
 * which the caller treats like an unreadable entry. */
export function fromStored(quiz: ParsedQuiz, stored: StoredGame): Game {
  const game = newGame(quiz);
  const status = stored.status;
  if (status !== "lobby") {
    const index = stored.currentQuestionIndex;
    if (!Number.isInteger(index) || index < 0 || index >= quiz.questions.length) {
      throw new Error(`no question ${index} in a quiz of ${quiz.questions.length}`);
    }
    const answers: Answers = new Map(stored.answers);
    if (status === "question") {
      game.round = { phase: "question", index, answers };
    } else if (status === "reveal" || status === "leaderboard" || status === "finished") {
      game.round = { phase: status, index, answers, correctOrder: stored.correctOrder, scoresBefore: null };
    } else {
      throw new Error(`unknown phase ${status}`);
    }
  }
  game.roster = new Map(stored.roster);
  game.scores = new Map(stored.scores);
  game.removed = new Set(stored.removed ?? []);
  // Saved before players were tracked: everyone counts as present.
  const seen = new Map(stored.lastSeen ?? []);
  for (const id of game.roster.keys()) game.lastSeen.set(id, seen.get(id) ?? questionIndex(game));
  return game;
}
