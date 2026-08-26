import { describe, expect, it } from "vitest";
import { parseQuiz } from "./parseQuiz";
import { QuizParseError } from "./errors";

const VALID_QUIZ = `correct_answer: C

\`\`\`typst
What is $x$ if $2x + 3 = 11$?
\`\`\`

\`\`\`typst-option
$2$
\`\`\`

\`\`\`typst-option
$3$
\`\`\`

\`\`\`typst-option
$4$
\`\`\`

\`\`\`typst-option
$5$
\`\`\`

---

correct_answer: B
answer_area_fraction: 0.35

\`\`\`typst
Which graph shows $y = x^2$?
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#canvas({ import draw: *; line((-2,0), (2,0)) })
\`\`\`

\`\`\`typst-option
#import "@preview/cetz:0.5.2": canvas, draw
#canvas({ import draw: *; plot.plot(size: (3,3), { plot.add(domain: (-2,2), x => x*x) }) })
\`\`\`

\`\`\`typst-option
...
\`\`\`

\`\`\`typst-option
...
\`\`\`
`;

describe("parseQuiz", () => {
  it("parses the SPEC.md §3.2 example quiz", () => {
    const quiz = parseQuiz(VALID_QUIZ);

    expect(quiz.questions).toHaveLength(2);

    const [q1, q2] = quiz.questions;

    expect(q1.id).toBe("q1");
    expect(q1.promptTypst).toContain("2x + 3 = 11");
    expect(q1.options.map((o) => o.typst)).toEqual(["$2$", "$3$", "$4$", "$5$"]);
    expect(q1.correctIndex).toBe(2);
    expect(q1.answerAreaFraction).toBe(0.5); // default, no override

    expect(q2.id).toBe("q2");
    expect(q2.correctIndex).toBe(1);
    expect(q2.options[1].typst).toContain("x*x");
    expect(q2.answerAreaFraction).toBe(0.35); // per-question override
  });

  it("rejects a question with a missing correct_answer", () => {
    const quiz = VALID_QUIZ.replace("correct_answer: C", "");
    expect(() => parseQuiz(quiz)).toThrow(QuizParseError);
    try {
      parseQuiz(quiz);
    } catch (error) {
      expect((error as QuizParseError).issues.join()).toMatch(/correct_answer.*missing/);
    }
  });

  it("rejects a correct_answer outside A-D", () => {
    const quiz = VALID_QUIZ.replace("correct_answer: C", "correct_answer: E");
    expect(() => parseQuiz(quiz)).toThrow(/not one of A-D/);
  });

  it("rejects an unrecognized preface key", () => {
    const quiz = VALID_QUIZ.replace("correct_answer: C", "correct_answer: C\nfoo: bar");
    expect(() => parseQuiz(quiz)).toThrow(/unrecognized preface key 'foo'/);
  });

  it("rejects an answer_area_fraction outside (0, 1)", () => {
    const quiz = VALID_QUIZ.replace("answer_area_fraction: 0.35", "answer_area_fraction: 1.5");
    expect(() => parseQuiz(quiz)).toThrow(/answer_area_fraction.*\(0, 1\)/);
  });

  it("rejects a quiz missing a prompt block", () => {
    const quiz = `correct_answer: A

\`\`\`typst-option
1
\`\`\`

\`\`\`typst-option
2
\`\`\`

\`\`\`typst-option
3
\`\`\`

\`\`\`typst-option
4
\`\`\`
`;
    expect(() => parseQuiz(quiz)).toThrow(/expected exactly one prompt block, found 0/);
  });

  it("rejects a question with fewer than 4 options", () => {
    const quiz = `correct_answer: A

\`\`\`typst
Only one option?
\`\`\`

\`\`\`typst-option
1
\`\`\`
`;
    expect(() => parseQuiz(quiz)).toThrow(/expected exactly 4 options, found 1/);
  });

  it("rejects a question with more than 4 options", () => {
    const quiz = VALID_QUIZ.replace(
      "```typst-option\n$5$\n```",
      "```typst-option\n$5$\n```\n\n```typst-option\n$6$\n```",
    );
    expect(() => parseQuiz(quiz)).toThrow(/expected exactly 4 options, found 5/);
  });
});
