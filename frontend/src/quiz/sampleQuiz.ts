// The sample quiz and the blank template are the real files in `typst/` at the
// repo root, imported verbatim: what the app prefills is exactly what an
// author gets when they download them and compile them locally (SPEC.md §3.3).
import exampleQuiz from "../../../typst/example-quiz.typ?raw";
import quizTemplate from "../../../typst/quiz.typ?raw";

/** Prefills the host's "load quiz" screen. */
export const SAMPLE_QUIZ = exampleQuiz;

/** `typst/quiz.typ` -- the template every quiz file imports (SPEC.md §3.2). */
export const QUIZ_TEMPLATE = quizTemplate;

/** Minimal, immediately compilable starter file offered as a download. */
export const STARTER_QUIZ = `#import "quiz.typ": *
#show: quiz

#question(
  correct: "A",
  answer-area-fraction: 0.5,
  prompt: [
    Hier steht die Aufgabenstellung.
  ],
  options: (
    [Antwort A],
    [Antwort B],
    [Antwort C],
    [Antwort D],
  ),
)
`;

