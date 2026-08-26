import { QuizParseError } from "./errors";
import type { AnswerOption, ParsedQuiz, QuestionState } from "./types";

const SEPARATOR_RE = /^---[ \t]*$/;
const PREFACE_LINE_RE = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*)$/;
const FENCE_RE = /```(typst|typst-option)\r?\n([\s\S]*?)\r?\n```/g;
const CORRECT_ANSWER_RE = /^[A-Da-d]$/;

/** Parse and validate a quiz source file per SPEC.md §3.2. Throws
 * {@link QuizParseError} (with all issues found) if the quiz is invalid. */
export function parseQuiz(source: string): ParsedQuiz {
  const segments = splitIntoSegments(source);
  if (segments.length === 0) {
    throw new QuizParseError(["No questions found (expected at least one question)"]);
  }

  const issues: string[] = [];
  const questions: QuestionState[] = [];
  segments.forEach((segment, i) => {
    const label = `Question ${i + 1}`;
    try {
      questions.push(parseQuestionSegment(segment, label, i + 1));
    } catch (error) {
      if (error instanceof QuizParseError) {
        issues.push(...error.issues);
      } else {
        throw error;
      }
    }
  });

  if (issues.length > 0) {
    throw new QuizParseError(issues);
  }

  return { questions };
}

/** Split the file on lines that are exactly '---' (SPEC.md §3.2). */
function splitIntoSegments(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const segments: string[][] = [[]];
  for (const line of lines) {
    if (SEPARATOR_RE.test(line)) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(line);
    }
  }
  return segments.map((seg) => seg.join("\n")).filter((seg) => seg.trim().length > 0);
}

function parseQuestionSegment(segment: string, label: string, position: number): QuestionState {
  const issues: string[] = [];

  const { prefaceLines, body } = splitPrefaceAndBody(segment);
  const preface = parsePreface(prefaceLines, label, issues);

  const prompts: string[] = [];
  const options: AnswerOption[] = [];
  for (const match of body.matchAll(FENCE_RE)) {
    const [, tag, content] = match;
    if (tag === "typst") {
      prompts.push(content.trim());
    } else {
      options.push({ typst: content.trim() });
    }
  }

  if (prompts.length !== 1) {
    issues.push(`${label}: expected exactly one prompt block, found ${prompts.length}`);
  }
  if (options.length !== 4) {
    issues.push(`${label}: expected exactly 4 options, found ${options.length}`);
  }

  if (issues.length > 0) {
    throw new QuizParseError(issues);
  }

  return {
    id: `q${position}`,
    promptTypst: prompts[0],
    options,
    correctIndex: preface.correctIndex,
    answerAreaFraction: preface.answerAreaFraction,
  };
}

/** Preface lines run from the start of the segment up to the first blank
 * line (SPEC.md §3.2); everything after that blank line is the body. */
function splitPrefaceAndBody(segment: string): { prefaceLines: string[]; body: string } {
  const lines = segment.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;

  const prefaceLines: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === "") break;
    prefaceLines.push(lines[i]);
  }

  return { prefaceLines, body: lines.slice(i + 1).join("\n") };
}

interface Preface {
  correctIndex: number;
  answerAreaFraction: number;
}

const LETTER_TO_INDEX: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };

function parsePreface(prefaceLines: string[], label: string, issues: string[]): Preface {
  const data: Record<string, string> = {};
  for (const line of prefaceLines) {
    const match = PREFACE_LINE_RE.exec(line);
    if (!match) {
      issues.push(`${label}: malformed preface line ${JSON.stringify(line)} (expected 'key: value')`);
      continue;
    }
    const [, key, value] = match;
    data[key] = value.trim();
  }

  const knownKeys = new Set(["correct_answer", "answer_area_fraction"]);
  for (const key of Object.keys(data)) {
    if (!knownKeys.has(key)) {
      issues.push(`${label}: unrecognized preface key '${key}'`);
    }
  }

  let correctIndex = -1;
  const correctAnswer = data.correct_answer;
  if (!correctAnswer || !CORRECT_ANSWER_RE.test(correctAnswer)) {
    issues.push(`${label}: 'correct_answer' missing or not one of A-D (got ${JSON.stringify(correctAnswer ?? "")})`);
  } else {
    correctIndex = LETTER_TO_INDEX[correctAnswer.toLowerCase()];
  }

  let answerAreaFraction = 0.5;
  if (data.answer_area_fraction !== undefined) {
    const parsed = Number(data.answer_area_fraction);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      issues.push(`${label}: 'answer_area_fraction' must be a number in (0, 1), got ${JSON.stringify(data.answer_area_fraction)}`);
    } else {
      answerAreaFraction = parsed;
    }
  }

  return { correctIndex, answerAreaFraction };
}
