import { expect, test, type Page } from "@playwright/test";

// The diagnostic log is recorded on every device and leaves it only by hand,
// via /debug (see src/debug/debugLog.ts). A pupil's log and the teacher's
// have to fit together -- the same player id in both -- and neither may
// carry a token.

/** Opens /debug next to the quiz tab and returns the log shown for `title`.
 * The quiz tab writes its log with a short delay; /debug follows along. */
async function readDebugPage(page: Page, title: string, expected: string[]): Promise<string> {
  const debug = await page.context().newPage();
  // Shows up in the test output, should the page itself break.
  debug.on("pageerror", (error) => console.log(`[/debug pageerror] ${error.message}`));
  debug.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.log(`[/debug ${message.type()}] ${message.text()}`);
  });
  await debug.goto("/debug");
  // A plain assertion rather than a retried block: a failure then shows the
  // text that was there, or that the section was missing altogether.
  const log = debug.locator("section", { has: debug.getByRole("heading", { name: title }) }).locator("pre");
  for (const part of expected) await expect(log).toContainText(part, { timeout: 10_000 });
  const text = (await log.textContent()) ?? "";
  await debug.close();
  return text;
}

test("host and player each keep a log that matches the other's and holds no token", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const host = await hostContext.newPage();
  const ada = await adaContext.newPage();

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = (await host.locator(".host-lobby__pin").textContent())!;

  await ada.goto(`/?pin=${pin}`);
  await ada.getByLabel("Nickname").fill("Ada");
  await ada.getByRole("button", { name: "Beitreten" }).click();
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toBeVisible();

  await host.getByRole("button", { name: "Frage starten" }).click();
  await ada.locator(".player-answer-grid__option").nth(2).click();
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+12 Punkte");

  const { playerId, playerToken } = await ada.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    `math-quiz-player:${pin}`,
  );
  const { hostToken } = await host.evaluate(() => JSON.parse(localStorage.getItem("math-quiz-host")!));

  const playerLog = await readDebugPage(ada, "Als Spieler:in", [
    `pin: ${pin}`,
    `player: ${playerId}`,
    "send type=answer question_index=0 option_index=2",
    "snapshot phase=reveal q=0 listed=true players=1 score=12",
  ]);
  const hostLog = await readDebugPage(host, "Als Lehrperson", [
    `session created pin=${pin}`,
    `join player=${playerId} nickname=Ada`,
    `answer player=${playerId} q=0 option=2 nth=1`,
    `revealed q=0 answers=1 players=1 correct=${playerId}`,
  ]);

  expect(playerLog).not.toContain(playerToken);
  expect(hostLog).not.toContain(hostToken);

  await hostContext.close();
  await adaContext.close();
});

test("a pupil finds the copy button on the final screen", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const adaContext = await browser.newContext();
  const host = await hostContext.newPage();
  const ada = await adaContext.newPage();
  host.on("dialog", (dialog) => dialog.accept());

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  await ada.goto(`/?pin=${pin}`);
  await ada.getByLabel("Nickname").fill("Ada");
  await ada.getByRole("button", { name: "Beitreten" }).click();
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toBeVisible();

  await host.getByRole("button", { name: "Quiz abbrechen" }).click();
  await expect(ada.getByRole("heading", { name: "Quiz beendet!" })).toBeVisible();
  await expect(ada.getByRole("button", { name: "Diagnose kopieren" })).toBeVisible();

  // The quiz is over, so the log is all that is left of it on the phone.
  const playerLog = await readDebugPage(ada, "Als Spieler:in", ["snapshot phase=finished", "quiz over"]);
  expect(playerLog).toContain(`pin: ${pin}`);

  await hostContext.close();
  await adaContext.close();
});
