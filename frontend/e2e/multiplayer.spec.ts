import { expect, test, type Page } from "@playwright/test";
import { loadMathQuiz } from "./mathQuiz";

// Full 3-question, 2-player game driven through real browser tabs (SPEC.md
// §12.2 step 6), covering the whole host+player UI flow (setup -> lobby ->
// question -> reveal -> leaderboard, three times -> finish).
//
// Uses typst/math-quiz.typ where three questions are needed, otherwise the
// quiz prefilled on the host setup screen (typst/minimal-quiz.typ). In both,
// Q1 correct_answer is C (index 2) and Q2 correct_answer is B (index 1); in the
// math quiz, Q3 correct_answer is A (index 0).

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

  await host.goto("/create");
  await expect(host.getByRole("heading", { name: "Quiz-Quelltext (Typst)" })).toBeVisible();
  await loadMathQuiz(host);
  await host.getByRole("button", { name: "Quiz erstellen" }).click();

  const pin = await host.locator(".host-lobby__pin").textContent();
  expect(pin).toMatch(/^\d{6}$/);

  for (const [page, nickname] of [
    [ada, "Ada"],
    [bo, "Bo"],
  ] as const) {
    await page.goto(`/?pin=${pin}`);
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

  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");
  await expect(ada.locator(".player-answer-grid__mark--correct")).toBeVisible();
  await expect(bo.locator(".player-app__reveal-wrong")).toContainText("+0 Punkte");
  await expect(bo.locator(".player-answer-grid__mark--wrong")).toBeVisible();

  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await expect(host.getByRole("heading", { name: "Rangliste" })).toBeVisible();
  await expect(host.locator(".leaderboard__row").first()).toContainText("Ada");
  await expect(host.locator(".leaderboard__row").first()).toContainText("12");

  await host.getByRole("button", { name: "Nächste Frage" }).click();

  // --- Question 2: both Ada and Bo pick the correct option (B), Ada first. ---
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 1);
  await answerOption(bo, 1);
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();

  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");
  await expect(bo.locator(".player-app__reveal-correct")).toContainText("+11 Punkte");

  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await expect(host.getByRole("button", { name: "Nächste Frage" })).toBeVisible();
  await host.getByRole("button", { name: "Nächste Frage" }).click();

  // --- Question 3 (Venn diagram): Ada picks the correct option (A), Bo picks a wrong one (B). ---
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 0);
  await answerOption(bo, 1);
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();

  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");
  await expect(bo.locator(".player-app__reveal-wrong")).toContainText("+0 Punkte");

  // The last question jumps straight from reveal to the final screen -- no
  // intermediate "Rangliste anzeigen" leaderboard step.
  await host.getByRole("button", { name: "Endergebnis anzeigen" }).click();
  await expect(host.getByRole("heading", { name: "Endergebnis" })).toBeVisible();

  const rows = host.locator(".leaderboard__row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Ada");
  await expect(rows.first()).toContainText("36");
  await expect(rows.nth(1)).toContainText("Bo");
  await expect(rows.nth(1)).toContainText("11");
  await expect(ada.getByRole("heading", { name: "Quiz beendet!" })).toBeVisible();
  await expect(ada.getByText("Du hast auf Platz 1 mit 36 Punkten abgeschlossen")).toBeVisible();
  await expect(bo.getByText("Du hast auf Platz 2 mit 11 Punkten abgeschlossen")).toBeVisible();

  // --- A join after the end is turned away rather than ranked last. ---
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await late.goto(`/?pin=${pin}`);
  await late.getByLabel("Nickname").fill("Cy");
  await late.getByRole("button", { name: "Beitreten" }).click();
  await expect(late.getByRole("heading", { name: "Quiz beendet!" })).toBeVisible();
  await expect(late.getByText(/Du hast auf Platz/)).toHaveCount(0);
  await expect(rows).toHaveCount(2);

  await hostContext.close();
  await adaContext.close();
  await boContext.close();
  await lateContext.close();
});

test("the leaderboard animates from the old standings into the new ones", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const boContext = await browser.newContext();
  const host = await hostContext.newPage();
  const ada = await adaContext.newPage();
  const bo = await boContext.newPage();

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  // Ada joins first, so with everyone on 0 points she is listed above Bo.
  for (const [page, nickname] of [
    [ada, "Ada"],
    [bo, "Bo"],
  ] as const) {
    await page.goto(`/?pin=${pin}`);
    await page.getByLabel("Nickname").fill(nickname);
    await page.getByRole("button", { name: "Beitreten" }).click();
    await expect(page.getByRole("heading", { name: `Du bist dabei, ${nickname}!` })).toBeVisible();
  }
  await expect(host.locator(".host-lobby__count")).toHaveText("2 Spieler:innen beigetreten");
  await host.getByRole("button", { name: "Frage starten" }).click();

  // Only Bo picks the correct option (C) and overtakes Ada.
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 0);
  await answerOption(bo, 2);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();

  // The points won are shown while the score counts up ...
  await expect(host.locator(".leaderboard__gain")).toHaveText("+12");

  // ... and are gone again once the rows have settled in their new order.
  const rows = host.locator(".leaderboard__row");
  await expect(rows.first()).toContainText("Bo");
  await expect(rows.first().locator(".leaderboard__score")).toHaveText("12");
  await expect(rows.nth(1)).toContainText("Ada");
  await expect(rows.nth(1).locator(".leaderboard__rank")).toHaveText("2");
  await expect(rows.nth(1).locator(".leaderboard__trend")).toHaveText("▼1");
  await expect(host.locator(".leaderboard__gain")).toHaveCount(0);

  await hostContext.close();
  await adaContext.close();
  await boContext.close();
});

test("host and player recover from a reload mid-quiz", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const host = await hostContext.newPage();
  let ada = await adaContext.newPage();

  await host.goto("/create");
  await loadMathQuiz(host);
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  await ada.goto(`/?pin=${pin}`);
  await ada.getByLabel("Nickname").fill("Ada");
  await ada.getByRole("button", { name: "Beitreten" }).click();
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toBeVisible();

  await host.getByRole("button", { name: "Frage starten" }).click();
  await answerOption(ada, 2);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");
  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();

  // --- Host reload: the quiz source and scores only exist in this browser. ---
  await host.reload();
  await expect(host.getByRole("heading", { name: "Rangliste" })).toBeVisible();
  await expect(host.locator(".leaderboard__row").first()).toContainText("12");
  await host.getByRole("button", { name: "Nächste Frage" }).click();

  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await answerOption(ada, 1);
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort abgeschickt");

  // --- Player reload: same identity, same score, answer still locked in. ---
  await ada.reload();
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort abgeschickt");
  await expect(ada.locator(".player-app__nickname")).toHaveText("Ada");

  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");
  await expect(ada.locator(".player-app__total-score")).toContainText("24");

  // --- Player reload during the reveal: the question must not count twice. ---
  await ada.reload();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");
  await expect(ada.locator(".player-app__total-score")).toHaveText("Gesamtpunktzahl: 24");

  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  // The reconnect must not have added a second "Ada" to the roster.
  await expect(host.locator(".leaderboard__row")).toHaveCount(1);

  await host.getByRole("button", { name: "Nächste Frage" }).click();
  await answerOption(ada, 0);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");

  // --- Ada's phone is away while the final screen goes up. It only comes
  // back after that broadcast, so the final rank has to reach it with a
  // later heartbeat. ---
  const adaUrl = ada.url();
  await ada.close();
  await host.getByRole("button", { name: "Endergebnis anzeigen" }).click();
  await expect(host.getByRole("heading", { name: "Endergebnis" })).toBeVisible();
  ada = await adaContext.newPage();
  await ada.goto(adaUrl);
  await expect(ada.getByText("Du hast auf Platz 1 mit 36 Punkten abgeschlossen")).toBeVisible({
    timeout: 10_000,
  });
  // The player's credential is useless once it has seen the end ...
  expect(
    await ada.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("math-quiz-player:"))),
  ).toEqual([]);

  // ... the host's only once the teacher closes the final screen.
  expect(await host.evaluate(() => localStorage.getItem("math-quiz-host"))).not.toBeNull();
  await host.getByRole("button", { name: "Quiz beenden" }).click();
  await expect(host.getByRole("button", { name: "Quiz erstellen" })).toBeVisible();
  expect(await host.evaluate(() => localStorage.getItem("math-quiz-host"))).toBeNull();

  await hostContext.close();
  await adaContext.close();
});

test("the reveal confirms a join the question left unconfirmed", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const host = await hostContext.newPage();
  const ada = await adaContext.newPage();

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  await ada.goto(`/?pin=${pin}`);
  await ada.getByLabel("Nickname").fill("Ada");
  await ada.getByRole("button", { name: "Beitreten" }).click();
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toBeVisible();

  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  // After the reload nothing in the question phase confirms the join.
  await ada.reload();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  // A wrong answer keeps Ada off the reveal's list of correct players, so
  // only her total in the reveal can tell her the join landed.
  await answerOption(ada, 0);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(ada.locator(".player-app__reveal-wrong")).toBeVisible();

  let joinsAfterReveal = 0;
  ada.on("request", (request) => {
    if (request.url().endsWith("/message") && request.postDataJSON()?.type === "join") joinsAfterReveal++;
  });
  // Longer than the 2 s re-send interval, with room for one in flight.
  await ada.waitForTimeout(4500);
  expect(joinsAfterReveal).toBeLessThanOrEqual(1);

  await hostContext.close();
  await adaContext.close();
});

test("a lost answer is re-sent while the join is still unconfirmed", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const host = await hostContext.newPage();
  const ada = await adaContext.newPage();

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  await ada.goto(`/?pin=${pin}`);
  await ada.getByLabel("Nickname").fill("Ada");
  await ada.getByRole("button", { name: "Beitreten" }).click();
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toBeVisible();

  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  // A question snapshot lists only who has answered, so after this reload
  // nothing confirms Ada's join until her answer lands -- she keeps
  // re-sending it, and that must not stand in the way of the answer.
  await ada.reload();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  let dropped = false;
  await ada.route("**/session/*/message", async (route) => {
    if (!dropped && route.request().postDataJSON()?.type === "answer") {
      dropped = true;
      await route.abort();
    } else {
      await route.continue();
    }
  });

  await answerOption(ada, 2);
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();
  expect(dropped).toBe(true);

  await hostContext.close();
  await adaContext.close();
});
