import { QuizParseError } from "./errors";
import type { AnswerOption, ParsedQuiz, QuestionState } from "./types";

/** `#question(` at the start of a line -- the only place a question may start
 * (SPEC.md §3.2, part 3). */
const QUESTION_START_RE = /^#question[ \t]*\(/gm;
const TEMPLATE_IMPORT_RE = /^#import\s+"[^"]*quiz\.typ"\s*:\s*\*$/;
const TEMPLATE_SHOW_RE = /^#show\s*:\s*quiz$/;
const NAMED_ARG_RE = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/;
const CORRECT_RE = /^"([A-D])"$/;

const ARG_NAMES = ["correct", "prompt", "options", "answer-area-fraction"];

/** Parse and validate a quiz source file per SPEC.md §3.2/§3.4. Throws
 * {@link QuizParseError} (with all issues found) if the quiz is invalid. */
export function parseQuiz(source: string): ParsedQuiz {
  const starts = [...source.matchAll(QUESTION_START_RE)];
  if (starts.length === 0) {
    throw new QuizParseError([
      "No questions found (expected at least one `#question(...)` call at the start of a line)",
    ]);
  }

  const issues: string[] = [];
  const preamble = parsePreamble(source.slice(0, starts[0].index), issues);

  const questions: QuestionState[] = [];
  let cursor = starts[0].index;
  starts.forEach((match, i) => {
    const label = `Question ${i + 1}`;
    const start = match.index;
    // A `#question(` inside the previous call's brackets belongs to that
    // call's source, not to a new question.
    if (start < cursor) return;

    const between = source.slice(cursor, start);
    if (i > 0 && stripComments(between).trim().length > 0) {
      issues.push(`${label}: unexpected content before the question: ${JSON.stringify(between.trim().slice(0, 40))}`);
    }

    const open = start + match[0].length - 1;
    const close = findMatchingBracket(source, open);
    if (close === -1) {
      issues.push(`${label}: unterminated \`#question(...)\` call (unbalanced brackets)`);
      cursor = source.length;
      return;
    }
    cursor = close + 1;

    try {
      questions.push(parseQuestionArgs(source.slice(open + 1, close), label, i + 1, preamble));
    } catch (error) {
      if (error instanceof QuizParseError) {
        issues.push(...error.issues);
      } else {
        throw error;
      }
    }
  });

  const tail = stripComments(source.slice(cursor)).trim();
  if (tail.length > 0) {
    issues.push(`Unexpected content after the last question: ${JSON.stringify(tail.slice(0, 40))}`);
  }

  if (issues.length > 0) {
    throw new QuizParseError(issues);
  }

  return { preamble, questions };
}

/** Checks the two verbatim template-header lines (SPEC.md §3.2, part 1) and
 * drops them: what remains is the author's own imports and macros, which is
 * what gets prepended to every snippet the browser compiles (§3.4). The
 * header itself is layout-only and would fight the snippet page setup. */
function parsePreamble(preambleSource: string, issues: string[]): string {
  const lines = preambleSource.split(/\r?\n/);
  const significant = lines
    .map((text, index) => ({ text: text.trim(), index }))
    .filter(({ text }) => text.length > 0 && !text.startsWith("//"));

  const [importLine, showLine] = significant;
  const hasHeader =
    importLine !== undefined &&
    showLine !== undefined &&
    TEMPLATE_IMPORT_RE.test(importLine.text) &&
    TEMPLATE_SHOW_RE.test(showLine.text);

  if (!hasHeader) {
    issues.push(
      'Missing template header: a quiz file must start with `#import "quiz.typ": *` followed by `#show: quiz`',
    );
    return preambleSource.trim();
  }

  const dropped = new Set([importLine.index, showLine.index]);
  return lines
    .filter((_, index) => !dropped.has(index))
    .join("\n")
    .trim();
}

function parseQuestionArgs(argSource: string, label: string, position: number, preamble: string): QuestionState {
  const issues: string[] = [];
  const args = new Map<string, string>();

  for (const part of splitTopLevel(argSource)) {
    const match = NAMED_ARG_RE.exec(part);
    if (!match) {
      issues.push(
        `${label}: positional argument ${JSON.stringify(part.trim().slice(0, 30))} (all arguments must be named)`,
      );
      continue;
    }
    const [, name, value] = match;
    if (!ARG_NAMES.includes(name)) {
      issues.push(`${label}: unrecognized argument '${name}' (expected one of ${ARG_NAMES.join(", ")})`);
      continue;
    }
    args.set(name, value.trim());
  }

  let correctIndex = -1;
  const correct = CORRECT_RE.exec(args.get("correct") ?? "");
  if (!correct) {
    issues.push(`${label}: 'correct' missing or not one of "A"-"D" (got ${JSON.stringify(args.get("correct") ?? "")})`);
  } else {
    correctIndex = correct[1].charCodeAt(0) - "A".charCodeAt(0);
  }

  const promptTypst = contentBlockInner(args.get("prompt"));
  if (promptTypst === null) {
    issues.push(`${label}: 'prompt' missing or not a content block [...]`);
  }

  const options: AnswerOption[] = [];
  const optionBlocks = arrayItems(args.get("options"));
  if (optionBlocks === null) {
    issues.push(`${label}: 'options' missing or not a list of content blocks ([...], [...], [...], [...])`);
  } else if (optionBlocks.length !== 4) {
    issues.push(`${label}: expected exactly 4 options, found ${optionBlocks.length}`);
  } else {
    optionBlocks.forEach((block, i) => {
      const typst = contentBlockInner(block);
      if (typst === null) {
        issues.push(`${label}, option ${"ABCD"[i]}: not a content block [...]`);
      } else {
        options.push({ typst: withPreamble(preamble, typst) });
      }
    });
  }

  let answerAreaFraction = 0.5;
  const rawFraction = args.get("answer-area-fraction");
  if (rawFraction !== undefined) {
    const parsed = Number(rawFraction);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      issues.push(`${label}: 'answer-area-fraction' must be a number in (0, 1), got ${JSON.stringify(rawFraction)}`);
    } else {
      answerAreaFraction = parsed;
    }
  }

  if (issues.length > 0) {
    throw new QuizParseError(issues);
  }

  return {
    id: `q${position}`,
    promptTypst: withPreamble(preamble, promptTypst as string),
    options,
    correctIndex,
    answerAreaFraction,
  };
}

function withPreamble(preamble: string, snippet: string): string {
  return preamble.length > 0 ? `${preamble}\n${snippet}` : snippet;
}

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Index of the bracket closing the one at `openIndex`, or -1 if unbalanced.
 *
 * Brackets can't be counted blindly: `"` opens a string literal in Typst code
 * but is a plain character in markup, so the scanner tracks which kind of
 * bracket it is currently inside (`[` = markup, `(`/`{` = code). */
function findMatchingBracket(source: string, openIndex: number): number {
  const stack = [source[openIndex]];
  let i = openIndex + 1;

  while (i < source.length) {
    const skipped = skipTrivia(source, i, stack[stack.length - 1] === "[");
    if (skipped === -1) return -1;
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const ch = source[i];
    if (ch in CLOSERS) {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (ch !== CLOSERS[stack[stack.length - 1]]) return -1;
      stack.pop();
      if (stack.length === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Split a bracket body on the commas that are not nested inside brackets,
 * strings or comments. Empty parts (e.g. from a trailing comma) are dropped. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  const stack: string[] = [];
  let start = 0;
  let i = 0;

  while (i < body.length) {
    const skipped = skipTrivia(body, i, stack[stack.length - 1] === "[");
    if (skipped === -1) break;
    if (skipped !== i) {
      i = skipped;
      continue;
    }

    const ch = body[i];
    if (ch in CLOSERS) {
      stack.push(ch);
    } else if (ch === ")" || ch === "]" || ch === "}") {
      stack.pop();
    } else if (ch === "," && stack.length === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
    i++;
  }

  parts.push(body.slice(start));
  return parts.filter((part) => part.trim().length > 0);
}

/** If `source[i]` starts a comment, an escape or (in code) a string literal,
 * returns the index just past it; otherwise `i` unchanged, or -1 if the
 * construct is never terminated. */
function skipTrivia(source: string, i: number, inMarkup: boolean): number {
  const ch = source[i];

  if (ch === "/" && source[i + 1] === "/") {
    const newline = source.indexOf("\n", i);
    return newline === -1 ? source.length : newline;
  }
  if (ch === "/" && source[i + 1] === "*") {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? -1 : end + 2;
  }
  if (ch === "\\") return i + 2;
  if (ch === '"' && !inMarkup) {
    let j = i + 1;
    while (j < source.length) {
      if (source[j] === "\\") j += 2;
      else if (source[j] === '"') return j + 1;
      else j++;
    }
    return -1;
  }
  return i;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Raw Typst source inside a `[...]` content block, or null if `value` is not
 * exactly one content block. */
function contentBlockInner(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return null;
  if (findMatchingBracket(trimmed, 0) !== trimmed.length - 1) return null;
  return dedent(trimmed.slice(1, -1));
}

/** Elements of an `(a, b, c)` array literal, or null if `value` is not one. */
function arrayItems(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("(")) return null;
  if (findMatchingBracket(trimmed, 0) !== trimmed.length - 1) return null;
  return splitTopLevel(trimmed.slice(1, -1));
}

/** Authors indent multi-line content blocks to match the surrounding call;
 * that indentation is not part of the snippet. */
function dedent(text: string): string {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;

  return lines
    .map((line) => line.slice(common))
    .join("\n")
    .trim();
}
