import { expect, test, type Page } from "@playwright/test";

// Full 3-question, 2-player game driven through real browser tabs (SPEC.md
// §12.2 step 6), covering the same host+player UI flow (setup -> lobby ->
// question -> reveal -> leaderboard, three times -> finish) as
// tests/test_math_quiz.py::test_full_multiplayer_two_question_game_e2e,
// extended to the 3rd (Venn diagram) question added to SAMPLE_QUIZ.
//
// Uses the SAMPLE_QUIZ from frontend/src/quiz/sampleQuiz.ts, prefilled by
// default on the host setup screen: Q1 correct_answer is C (index 2), Q2
// correct_answer is B (index 1), Q3 correct_answer is A (index 0).

async function answerOption(page: Page, optionIndex: number) {
  await page.locator(".player-answer-grid__option").nth(optionIndex).click();
}

test("host + 2 players play a full 3-question game", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const boContext = await browser.newContext();
  const host = await hostContext.newPage();
  const ada = await adaContext.newPage();
  const bo = await boContext.newPage();

  await host.goto("/");
  await expect(host.getByRole("heading", { name: "Quiz-Quelltext (Typst)" })).toBeVisible();
  await host.getByRole("button", { name: "Quiz erstellen" }).click();

  const pin = await host.locator(".host-lobby__pin").textContent();
  expect(pin).toMatch(/^\d{6}$/);

  for (const [page, nickname] of [
    [ada, "Ada"],
    [bo, "Bo"],
  ] as const) {
    await page.goto(`/#/join?pin=${pin}`);
    await page.getByLabel("Nickname").fill(nickname);
    await page.getByRole("button", { name: "Beitreten" }).click();
    await expect(page.getByRole("heading", { name: `Du bist dabei, ${nickname}!` })).toBeVisible();
  }

  await expect(host.locator(".host-lobby__count")).toHaveText("2 Spieler:innen beigetreten");
  await host.getByRole("button", { name: "Frage starten" }).click();

  // --- Question 1: Ada picks the correct option (C), Bo picks a wrong one (A). ---
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 2);
  await answerOption(bo, 0);
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();

  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+10 Punkte");
  await expect(ada.locator(".player-answer-grid__mark--correct")).toBeVisible();
  await expect(bo.locator(".player-app__reveal-wrong")).toContainText("+0 Punkte");
  await expect(bo.locator(".player-answer-grid__mark--wrong")).toBeVisible();

  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await expect(host.getByRole("heading", { name: "Rangliste" })).toBeVisible();
  await expect(host.locator(".leaderboard__row").first()).toContainText("Ada");
  await expect(host.locator(".leaderboard__row").first()).toContainText("10");

  await host.getByRole("button", { name: "Nächste Frage" }).click();

  // --- Question 2: both Ada and Bo pick the correct option (B). ---
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 1);
  await answerOption(bo, 1);
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();

  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+10 Punkte");
  await expect(bo.locator(".player-app__reveal-correct")).toContainText("+10 Punkte");

  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await expect(host.getByRole("button", { name: "Nächste Frage" })).toBeVisible();
  await host.getByRole("button", { name: "Nächste Frage" }).click();

  // --- Question 3 (Venn diagram): Ada picks the correct option (A), Bo picks a wrong one (B). ---
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 0);
  await answerOption(bo, 1);
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();

  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+10 Punkte");
  await expect(bo.locator(".player-app__reveal-wrong")).toContainText("+0 Punkte");

  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await expect(host.getByRole("button", { name: "Quiz beenden" })).toBeVisible();

  const rows = host.locator(".leaderboard__row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Ada");
  await expect(rows.first()).toContainText("30");
  await expect(rows.nth(1)).toContainText("Bo");
  await expect(rows.nth(1)).toContainText("10");

  await host.getByRole("button", { name: "Quiz beenden" }).click();
  await expect(host.getByRole("heading", { name: "Endergebnis" })).toBeVisible();
  await expect(ada.getByRole("heading", { name: "Quiz beendet!" })).toBeVisible();
  await expect(ada.getByText("Du hast auf Platz 1 mit 30 Punkten abgeschlossen")).toBeVisible();
  await expect(bo.getByText("Du hast auf Platz 2 mit 10 Punkten abgeschlossen")).toBeVisible();

  await hostContext.close();
  await adaContext.close();
  await boContext.close();
});
