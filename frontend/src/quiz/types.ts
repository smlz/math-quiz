// Types mirroring the pseudo-Python shapes in SPEC.md §6.2, adapted to
// TypeScript/camelCase for the actual (Vue) implementation.

export interface AnswerOption {
  /** Renderable Typst source: the quiz's preamble followed by this option's
   * content block (SPEC.md §3.4). */
  typst: string;
}

export interface QuestionState {
  /** e.g. "q1"; derived from 1-based position in the file (SPEC.md §6.2). */
  id: string;
  /** Renderable Typst source for the prompt, preamble included (§3.4). */
  promptTypst: string;
  /** Always exactly 4 answer options, in A/B/C/D order (SPEC.md §3.1). */
  options: AnswerOption[];
  correctIndex: number;
  /** Resolved (0, 1) prompt/answer-grid space split (SPEC.md §3.2), default 0.5. */
  answerAreaFraction: number;
  // Points follow the hardcoded 12/11/10 submission-order ladder (SPEC.md
  // §5), not part of this shape.
}

export interface ParsedQuiz {
  /** The author's own imports and macros, without the template header
   * (SPEC.md §3.4). Already baked into every snippet above; kept here so the
   * host can show/round-trip it. */
  preamble: string;
  questions: QuestionState[];
}

/** Host screen only. Scores and nicknames never cross the wire: the relay
 * broadcasts bare player ids, and the host is the only party that knows who
 * they belong to. */
export interface LeaderboardEntry {
  player_id: string;
  nickname: string;
  score: number;
  /** Standard competition ranking: ties share a rank, the next one skips. */
  rank: number;
}
