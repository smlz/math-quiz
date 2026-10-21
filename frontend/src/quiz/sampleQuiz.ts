// The minimal quiz and the blank template are the real files in `typst/` at
// the repo root, imported verbatim: what the app prefills is exactly what an
// author gets when they download them and compile them locally (SPEC.md §3.3).
import minimalQuiz from "../../../typst/minimal-quiz.typ?raw";
import quizTemplate from "../../../typst/quiz.typ?raw";

/** `typst/minimal-quiz.typ` -- prefills the host's "load quiz" screen and is
 * offered as the starter file to download. */
export const MINIMAL_QUIZ = minimalQuiz;

/** `typst/quiz.typ` -- the template every quiz file imports (SPEC.md §3.2). */
export const QUIZ_TEMPLATE = quizTemplate;
