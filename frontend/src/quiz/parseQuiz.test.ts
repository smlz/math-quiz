import { describe, expect, it } from "vitest";
import { parseQuiz } from "./parseQuiz";
import { QuizParseError } from "./errors";

const HEADER = `#import "quiz.typ": *
#show: quiz
`;

const VALID_QUIZ = `${HEADER}
#import "@preview/cetz:0.5.2": canvas, draw
#import "@preview/cetz-plot:0.1.4": plot

#let graph(body) = canvas(length: 1cm, body)

#question(
  correct: "C",
  prompt: [
    What is $x$ if $2x + 3 = 11$?
  ],
  options: (
    [$2$],
    [$3$],
    [$4$],
    [$5$],
  ),
)

#question(
  correct: "B",
  answer-area-fraction: 0.35,
  prompt: [Which graph shows $y = x^2$?],
  options: (
    [#graph({ draw.line((-2, 0), (2, 0)) })],
    [#graph({ plot.plot(size: (3, 3), { plot.add(domain: (-2, 2), x => x * x) }) })],
    [...],
    [...],
  ),
)
`;

describe("parseQuiz", () => {
  it("parses the SPEC.md §3.2 example quiz", () => {
    const quiz = parseQuiz(VALID_QUIZ);

    expect(quiz.questions).toHaveLength(2);
    expect(quiz.preamble).toContain('#import "@preview/cetz:0.5.2"');
    // The template header is layout-only and must not reach a snippet (§3.4).
    expect(quiz.preamble).not.toContain("#show: quiz");

    const [q1, q2] = quiz.questions;

    expect(q1.id).toBe("q1");
    expect(q1.promptTypst).toContain("2x + 3 = 11");
    expect(q1.correctIndex).toBe(2);
    expect(q1.answerAreaFraction).toBe(0.5); // default, no override

    expect(q2.id).toBe("q2");
    expect(q2.correctIndex).toBe(1);
    expect(q2.options[1].typst).toContain("x * x");
    expect(q2.answerAreaFraction).toBe(0.35); // per-question override
  });

  it("prepends the preamble to every snippet so author macros resolve", () => {
    const [q1] = parseQuiz(VALID_QUIZ).questions;

    expect(q1.promptTypst.startsWith('#import "@preview/cetz:0.5.2"')).toBe(true);
    expect(q1.promptTypst.endsWith("What is $x$ if $2x + 3 = 11$?")).toBe(true);
    expect(q1.options.map((o) => o.typst.split("\n").at(-1))).toEqual(["$2$", "$3$", "$4$", "$5$"]);
  });

  it("rejects a file without the template header", () => {
    const quiz = VALID_QUIZ.replace(HEADER, "");
    expect(() => parseQuiz(quiz)).toThrow(/Missing template header/);
  });

  it("rejects a question with a missing correct", () => {
    const quiz = VALID_QUIZ.replace('correct: "C",', "");
    expect(() => parseQuiz(quiz)).toThrow(QuizParseError);
    try {
      parseQuiz(quiz);
    } catch (error) {
      expect((error as QuizParseError).issues.join()).toMatch(/'correct' missing/);
    }
  });

  it("rejects a correct outside A-D", () => {
    const quiz = VALID_QUIZ.replace('correct: "C"', 'correct: "E"');
    expect(() => parseQuiz(quiz)).toThrow(/'correct' missing or not one of "A"-"D"/);
  });

  it("rejects an unrecognized argument", () => {
    const quiz = VALID_QUIZ.replace('correct: "C",', 'correct: "C",\n  points: 20,');
    expect(() => parseQuiz(quiz)).toThrow(/unrecognized argument 'points'/);
  });

  it("rejects an answer-area-fraction outside (0, 1)", () => {
    const quiz = VALID_QUIZ.replace("answer-area-fraction: 0.35", "answer-area-fraction: 1.5");
    expect(() => parseQuiz(quiz)).toThrow(/answer-area-fraction.*\(0, 1\)/);
  });

  it("rejects a question without a prompt", () => {
    const quiz = `${HEADER}
#question(
  correct: "A",
  options: ([1], [2], [3], [4]),
)
`;
    expect(() => parseQuiz(quiz)).toThrow(/'prompt' missing or not a content block/);
  });

  it("rejects a question with fewer than 4 options", () => {
    const quiz = `${HEADER}
#question(
  correct: "A",
  prompt: [Only one option?],
  options: ([1],),
)
`;
    expect(() => parseQuiz(quiz)).toThrow(/expected exactly 4 options, found 1/);
  });

  it("rejects a question with more than 4 options", () => {
    const quiz = VALID_QUIZ.replace("    [$5$],\n", "    [$5$],\n    [$6$],\n");
    expect(() => parseQuiz(quiz)).toThrow(/expected exactly 4 options, found 5/);
  });

  it("reports an unterminated #question(...) call", () => {
    const quiz = `${HEADER}
#question(
  correct: "A",
  prompt: [Missing a closing paren],
  options: ([1], [2], [3], [4]),
`;
    expect(() => parseQuiz(quiz)).toThrow(/unterminated/);
  });

  it("rejects stray content between questions", () => {
    const quiz = VALID_QUIZ.replace("\n#question(\n  correct: \"B\"", "\nSome stray text\n\n#question(\n  correct: \"B\"");
    expect(() => parseQuiz(quiz)).toThrow(/unexpected content before the question/);
  });

  it("keeps commas, brackets and quotes inside content blocks", () => {
    const quiz = `${HEADER}
#question(
  correct: "A",
  prompt: [A set: ${"$"}{ 1, 2, 3 }${"$"}, and a "quote" (with parens).],
  options: ([a, b], [\\[not a block\\]], [#text(fill: rgb("#ff0000"))[red, bold]], [d]),
)
`;
    const [q1] = parseQuiz(quiz).questions;

    expect(q1.promptTypst).toBe('A set: ${ 1, 2, 3 }$, and a "quote" (with parens).');
    expect(q1.options.map((o) => o.typst)).toEqual([
      "a, b",
      "\\[not a block\\]",
      '#text(fill: rgb("#ff0000"))[red, bold]',
      "d",
    ]);
  });
});
