// Roster bookkeeping on the host that goes beyond joining and answering:
// noticing who has stopped playing, and folding a duplicate entry into the
// one its pupil plays on now.
//
// A pupil can end up in the roster twice -- a second device, or a QR scanner
// that opened the link in its own browser with its own storage. Nothing
// links the two ids, so the teacher has to; these functions do the sums.

import { pointsForReveal } from "../api/quizClient";

/** The question index a player was last heard from at: their latest answer,
 * or when they joined (-1 in the lobby). */
export type LastSeen = Map<string, number>;

/** The latest question that is over and could have been answered, or -1. While
 * a question is open it is the one before, since anyone may still answer. */
export function latestPlayedQuestion(phase: string, currentQuestionIndex: number): number {
  return phase === "question" ? currentQuestionIndex - 1 : currentQuestionIndex;
}

/** Whether a player has nothing to show for the latest question played, which
 * is how an abandoned duplicate looks. A pupil who skipped one question looks
 * the same, so this is a hint for the teacher, nothing more. */
export function missedLatestQuestion(lastSeen: LastSeen, playerId: string, latestPlayed: number): boolean {
  return latestPlayed >= 0 && (lastSeen.get(playerId) ?? -1) < latestPlayed;
}

/** One player as the teacher's list of players shows them (HostPlayers.vue). */
export interface PlayerRow {
  player_id: string;
  nickname: string;
  score: number;
  /** Question index of the latest answer or join, -1 for the lobby. */
  lastSeen: number;
  /** Nothing to show for the latest question played. */
  missedLatest: boolean;
}

/** "Ada (2)" and "ada" both belong with "Ada": the host numbers a nickname
 * that is already taken, ignoring case (see cleanNickname). */
export function baseNickname(nickname: string): string {
  return nickname.replace(/ \(\d+\)$/u, "").toLocaleLowerCase();
}

export interface RosterState {
  roster: Map<string, string>;
  scores: Map<string, number>;
  /** The current question's answers, in arrival order. */
  answers: Map<string, number>;
  /** Who answered the current question correctly, in arrival order, once it
   * has been revealed; empty before. */
  correctOrder: string[];
  lastSeen: LastSeen;
  removed: Set<string>;
  /** The scores before the current question was revealed, if kept. */
  scoresBefore?: Map<string, number> | null;
}

/** Folds the player `sourceId` into `targetId`: the target gets the source's
 * points and, if it has none of its own, its answer to the current question;
 * the source is removed for good. Returns the new correct order, which the
 * caller stores -- the maps are changed in place.
 *
 * Positions in the correct order never shift: every player derives the
 * points just won from their own place in it, and those points are already
 * in the scores. */
export function mergePlayers(state: RosterState, sourceId: string, targetId: string): string[] {
  const { roster, scores, answers, lastSeen, removed, scoresBefore } = state;
  let correctOrder = state.correctOrder;
  if (sourceId === targetId || !roster.has(sourceId) || !roster.has(targetId)) return correctOrder;

  // Both right on the same question is one pupil answering twice: that
  // question counts once, with the target's own points.
  const counted =
    correctOrder.includes(sourceId) && correctOrder.includes(targetId) ? pointsForReveal(correctOrder, sourceId) : 0;
  scores.set(targetId, (scores.get(targetId) ?? 0) + (scores.get(sourceId) ?? 0) - counted);
  if (scoresBefore) {
    scoresBefore.set(targetId, (scoresBefore.get(targetId) ?? 0) + (scoresBefore.get(sourceId) ?? 0));
    scoresBefore.delete(sourceId);
  }

  if (answers.has(sourceId) && !answers.has(targetId)) {
    // Taken over in place, so the arrival order stays as it was.
    const entries = [...answers].map(([id, option]): [string, number] => [id === sourceId ? targetId : id, option]);
    answers.clear();
    for (const [id, option] of entries) answers.set(id, option);
    if (!correctOrder.includes(targetId)) {
      correctOrder = correctOrder.map((id) => (id === sourceId ? targetId : id));
    }
  }
  answers.delete(sourceId);

  lastSeen.set(targetId, Math.max(lastSeen.get(targetId) ?? -1, lastSeen.get(sourceId) ?? -1));
  lastSeen.delete(sourceId);
  removed.add(sourceId);
  roster.delete(sourceId);
  scores.delete(sourceId);
  return correctOrder;
}
