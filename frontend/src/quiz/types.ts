// Types mirroring the pseudo-Python shapes in SPEC.md §6.2, adapted to
// TypeScript/camelCase for the actual (Vue) implementation.

export interface AnswerOption {
  /** Typst source; may contain text, math, and/or a figure (SPEC.md §3.2). */
  typst: string;
}

export interface QuestionState {
  /** e.g. "q1"; derived from 1-based position in the file (SPEC.md §6.2). */
  id: string;
  /** Typst source for the prompt; may contain text, math, and/or a figure. */
  promptTypst: string;
  /** Always exactly 4 answer options, in A/B/C/D order (SPEC.md §3.1). */
  options: AnswerOption[];
  correctIndex: number;
  /** Resolved (0, 1) prompt/answer-grid space split (SPEC.md §3.2), default 0.5. */
  answerAreaFraction: number;
  // Points are a hardcoded 10 per correct answer (SPEC.md §5), not part of
  // this shape.
}

export interface ParsedQuiz {
  questions: QuestionState[];
}
