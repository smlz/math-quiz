import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The default quiz on the host setup screen (typst/minimal-quiz.typ) has two
// questions, C and B correct. Tests that need a third question play
// typst/math-quiz.typ instead: C, B and A are correct, the third is a Venn
// diagram.
const MATH_QUIZ = readFileSync(fileURLToPath(new URL("../../typst/math-quiz.typ", import.meta.url)), "utf-8");

/** Replaces the prefilled quiz on the host setup screen with the math quiz. */
export async function loadMathQuiz(host: Page) {
  await host.locator("textarea").fill(MATH_QUIZ);
}
