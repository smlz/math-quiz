import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Route,
} from "./fixtures";

// What a classroom does to a quiz: pupils reload, type the pin by hand,
// end up in the roster twice, and the teacher's laptop loses its Wi-Fi.
// The default quiz on the setup screen has two questions, C and B correct.

// Every device gets its own context, closed after the test: an open page
// keeps its streams, and with them connections, busy for the next test.
const contexts: BrowserContext[] = [];

async function newDevice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  return context.newPage();
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

/** `acceptDialogs`: revealing before everyone has answered asks first when
 * the connection looks troubled, and a slow test machine can make a single
 * broadcast look like that. Only the test of that question handles it. */
async function createQuiz(browser: Browser, acceptDialogs = true): Promise<{ host: Page; pin: string }> {
  const host = await newDevice(browser);
  if (acceptDialogs) host.on("dialog", (dialog) => dialog.accept());
  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = (await host.locator(".host-lobby__pin").textContent())!.trim();
  return { host, pin };
}

async function joinByLink(browser: Browser, pin: string, nickname: string): Promise<Page> {
  const page = await newDevice(browser);
  await page.goto(`/?pin=${pin}`);
  await page.getByLabel("Nickname").fill(nickname);
  await page.getByRole("button", { name: "Beitreten" }).click();
  await expect(page.getByRole("heading", { name: `Du bist dabei, ${nickname}!` })).toBeVisible();
  return page;
}

async function answerOption(page: Page, optionIndex: number) {
  await expect(page.locator(".player-answer-grid__option")).toHaveCount(4);
  await page.locator(".player-answer-grid__option").nth(optionIndex).click();
}

/** Publishes a snapshot as the host would, with the host's own token. */
async function publishAsHost(request: APIRequestContext, host: Page, pin: string, snapshot: object) {
  const { hostToken } = await host.evaluate(() => JSON.parse(localStorage.getItem("math-quiz-host")!));
  const response = await request.post(`/api/v1/session/${pin}/state`, {
    headers: { "X-Host-Token": hostToken },
    data: snapshot,
  });
  expect(response.ok()).toBe(true);
}

/** Cuts the host's broadcasts off and waits until one has failed, which stays
 * true until they are let through again. The warning on the reveal button
 * proves less: a slow broadcast on a busy machine shows it for a moment too,
 * and by the next click it may be gone. */
async function loseBroadcasts(host: Page) {
  const failed = host.waitForEvent("requestfailed", (request) => request.url().endsWith("/state"));
  await host.route("**/session/*/state", (route) => route.abort());
  await failed;
}

test("a pin typed by hand survives a reload and a second tab", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);

  // A laptop cannot scan the QR code: the pupil types the pin.
  const ada = await newDevice(browser);
  await ada.goto("/");
  await ada.getByLabel("Spiel-PIN").fill(pin);
  await ada.getByLabel("Nickname").fill("Ada");
  await ada.getByRole("button", { name: "Beitreten" }).click();
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toBeVisible();
  // The address now carries the pin, so a reload knows where to return.
  await expect(ada).toHaveURL(new RegExp(`\\?pin=${pin}$`));

  await host.getByRole("button", { name: "Frage starten" }).click();
  await answerOption(ada, 2);
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort angekommen");

  await ada.reload();
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort angekommen");

  // A fresh tab on the bare address, and the pin typed again: still the
  // same player, with the same answer, not a second "Ada (2)".
  const again = await ada.context().newPage();
  await again.goto("/");
  await again.getByLabel("Spiel-PIN").fill(pin);
  await again.getByRole("button", { name: "Beitreten" }).click();
  await expect(again.locator(".player-app__instruction")).toContainText("Antwort angekommen");
  await expect(again.locator(".player-app__nickname")).toHaveText("Ada");

  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(again.locator(".player-app__reveal-correct")).toContainText("+13 Punkte");
  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await expect(host.locator(".leaderboard__row")).toHaveCount(1);
});

test("an answer that never arrived is not passed off as wrong", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");
  const bo = await joinByLink(browser, pin, "Bo");

  await host.getByRole("button", { name: "Frage starten" }).click();
  // Every answer Ada sends is lost on the way.
  await ada.route("**/session/*/message", async (route) => {
    if (route.request().postDataJSON()?.type === "answer") await route.abort();
    else await route.continue();
  });
  await answerOption(ada, 2);
  await expect(ada.locator(".player-app__instruction")).toHaveText("Antwort wird gesendet …");

  await host.getByRole("button", { name: /Antwort zeigen · 0 von 2 beantwortet/ }).click();
  // Ada's pick was right; she is told it was the connection, not the answer.
  await expect(ada.locator(".player-app__reveal-lost")).toContainText("nicht rechtzeitig angekommen");
  await expect(ada.locator(".player-answer-grid__mark--correct")).toBeVisible();
  // Bo did not answer at all.
  await expect(bo.locator(".player-app__reveal-wrong")).toHaveText("Keine Antwort. +0 Punkte");
});

test("the reveal asks first while answers cannot arrive", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser, false);
  const ada = await joinByLink(browser, pin, "Ada");
  await joinByLink(browser, pin, "Bo");

  await host.getByRole("button", { name: "Frage starten" }).click();
  await answerOption(ada, 2);
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort angekommen");
  const revealButton = host.getByRole("button", { name: /Antwort zeigen · 1 von 2 beantwortet/ });
  await expect(revealButton).toBeVisible();

  // The teacher's laptop loses its connection: every broadcast fails.
  await loseBroadcasts(host);
  await expect(revealButton).toContainText("Verbindung unterbrochen");

  let warning = "";
  host.once("dialog", async (dialog) => {
    warning = dialog.message();
    await dialog.dismiss();
  });
  await revealButton.click();
  await expect.poll(() => warning).toContain("Verbindung");
  // Declined: the question stays open.
  await expect(revealButton).toBeVisible();
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort angekommen");

  // Back online, and once answers have had the moment they need to catch
  // up, the warning is gone and the reveal goes ahead.
  await host.unroute("**/session/*/state");
  await expect(revealButton).not.toContainText("Verbindung unterbrochen", { timeout: 15_000 });
  host.on("dialog", (dialog) => dialog.accept());
  await revealButton.click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+13 Punkte");
});

test("a snapshot that arrives out of date is ignored", async ({ browser, request }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");

  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  // What a stalled connection lets through late: the lobby, long gone.
  await publishAsHost(request, host, pin, { phase: "lobby", question_index: null, players: [], seq: 1 });
  await ada.waitForTimeout(1500);
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toHaveCount(0);

  // The current question still works as before.
  await answerOption(ada, 2);
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort angekommen");
});

test("pupils are told to wait, not reload, when the teacher drops out", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");

  // The host page goes away; the relay keeps pinging Ada's stream.
  await host.close();
  await expect(ada.locator(".player-app__reconnecting--host")).toContainText("nicht neu laden", {
    timeout: 30_000,
  });
});

test("the teacher folds a duplicate entry into the one its pupil plays on", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  // The same pupil twice, e.g. once in the QR scanner's own browser.
  const first = await joinByLink(browser, pin, "Ada");
  const second = await joinByLink(browser, pin, "Ada");
  await expect(host.locator(".host-lobby__name")).toHaveText(["Ada", "Ada (2)"]);

  await host.getByRole("button", { name: "Frage starten" }).click();
  await answerOption(first, 2);
  await host.getByRole("button", { name: /Antwort zeigen · 1 von 2 beantwortet/ }).click();
  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();

  // The pupil now plays on the second entry: the first one's 13 points move.
  await host.getByRole("button", { name: "Spieler:innen (2)" }).click();
  const players = host.getByRole("dialog", { name: "Spieler:innen" });
  await expect(players.locator(".host-players__row")).toHaveCount(2);
  await players.getByRole("combobox", { name: "Punkte von Ada übertragen", exact: true }).selectOption({
    label: "Ada (2)",
  });
  await expect(players.locator(".host-players__row")).toHaveCount(1);
  await players.getByRole("button", { name: "Schließen" }).click();

  const rows = host.locator(".leaderboard__row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Ada (2)");
  await expect(rows.first().locator(".leaderboard__score")).toHaveText("13");
  await expect(second.getByText("Du bist auf Platz 1 mit 13 Punkten")).toBeVisible();
  // The old entry is gone for good; its device offers to join anew.
  await expect(first.locator(".player-join__notice")).toContainText("anderen Namen");
});

test("a reload on the reveal of a skipped question shows no old pick", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");
  const bo = await joinByLink(browser, pin, "Bo");

  await host.getByRole("button", { name: "Frage starten" }).click();
  await answerOption(ada, 2);
  await answerOption(bo, 0);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await host.getByRole("button", { name: "Nächste Frage" }).click();

  // Ada skips the second question.
  await answerOption(bo, 1);
  await host.getByRole("button", { name: /Antwort zeigen · 1 von 2 beantwortet/ }).click();
  await expect(ada.locator(".player-app__reveal-wrong")).toHaveText("Keine Antwort. +0 Punkte");

  await ada.reload();
  await expect(ada.locator(".player-app__reveal-wrong")).toHaveText("Keine Antwort. +0 Punkte");
  await expect(ada.locator(".player-answer-grid__mark")).toHaveCount(0);
  await expect(ada.locator(".player-app__total-score")).toContainText("13");
});

test("a reveal right after a teacher reload asks first", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser, false);
  const ada = await joinByLink(browser, pin, "Ada");
  await joinByLink(browser, pin, "Bo");
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  // The teacher's page goes away, and Ada answers in the gap.
  const context = host.context();
  await host.close();
  await answerOption(ada, 2);

  // Its inbox held back, so that this does not race the stream opening.
  const again = await context.newPage();
  // A closed page lets go of its host lock a moment later, and on a busy
  // machine that can outlast the wait of the page that follows it.
  await again.goto("/");
  await expect.poll(() => again.evaluate(async () => (await navigator.locks.query()).held?.length)).toBe(0);
  const held: Route[] = [];
  let holding = true;
  await again.route("**/session/*/message_stream", (route) => {
    if (holding) held.push(route);
    else return route.fallback();
  });
  await again.goto("/create");
  const revealButton = again.getByRole("button", { name: /Antwort zeigen · 0 von 2 beantwortet/ });
  await expect(revealButton).toContainText("Verbindung unterbrochen");

  let warning = "";
  again.once("dialog", async (dialog) => {
    warning = dialog.message();
    await dialog.dismiss();
  });
  await revealButton.click();
  await expect.poll(() => warning).toContain("Verbindung");

  // Once connected, Ada's next re-send arrives and the warning clears.
  holding = false;
  await Promise.all(held.map((route) => route.abort().catch(() => {})));
  const answered = again.getByRole("button", { name: /Antwort zeigen · 1 von 2 beantwortet/ });
  await expect(answered).toBeVisible();
  await expect(answered).not.toContainText("Verbindung unterbrochen", { timeout: 15_000 });
  again.on("dialog", (dialog) => dialog.accept());
  await answered.click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+13 Punkte");
});

test("the quiz can be canceled while broadcasts fail", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser, false);
  const ada = await joinByLink(browser, pin, "Ada");
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  await loseBroadcasts(host);
  await expect(host.getByRole("button", { name: /Antwort zeigen/ })).toContainText("Verbindung unterbrochen");

  let warning = "";
  host.once("dialog", async (dialog) => {
    warning = dialog.message();
    await dialog.accept();
  });
  await host.getByRole("button", { name: "Quiz abbrechen" }).click();
  await expect(host.getByRole("button", { name: "Quiz erstellen" })).toBeVisible();
  expect(warning).toContain("erfahren sie vielleicht nichts davon");
  expect(await host.evaluate(() => localStorage.getItem("math-quiz-host"))).toBeNull();

  // The farewell never went out, so Ada is told what she can tell.
  await expect(ada.locator(".player-app__reconnecting--host")).toContainText("nicht neu laden", { timeout: 30_000 });
});

test("a refused host token stops the retries and says so", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  await joinByLink(browser, pin, "Ada");
  const refused = host.locator(".host-app__session-refused");

  let attempts = 0;
  const refuse = (route: Route) => {
    attempts++;
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"detail":"Invalid or missing host token"}',
    });
  };
  await host.route("**/session/*/state", refuse);
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(refused).toContainText("nicht mehr gültig");
  const attemptsThen = attempts;
  await host.waitForTimeout(3000);
  expect(attempts).toBe(attemptsThen);

  // A reload tries again, and this time the inbox is what gets refused.
  await host.unroute("**/session/*/state");
  await host.route("**/session/*/message_stream", refuse);
  await host.reload();
  await expect(refused).toContainText("nicht mehr gültig");

  await host.getByRole("button", { name: "Quiz abbrechen" }).click();
  await expect(host.getByRole("button", { name: "Quiz erstellen" })).toBeVisible();
  expect(await host.evaluate(() => localStorage.getItem("math-quiz-host"))).toBeNull();
});

test("a pupil coming back is not told that the quiz has yet to start", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);

  // No teacher, so no heartbeat ends the wait while this looks at it.
  await host.close();
  await ada.reload();
  await expect(ada.getByRole("heading", { name: "Verbinde wieder…" })).toBeVisible();
  await expect(ada.getByText("Warte, bis das Quiz startet")).toHaveCount(0);
  await expect(ada.locator(".player-app__reconnecting--host")).toContainText("nicht neu laden", { timeout: 30_000 });
  await expect(ada.getByRole("heading", { name: "Verbinde wieder…" })).toBeVisible();
});

test("a reload of the final screen keeps the rank", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");

  await host.getByRole("button", { name: "Frage starten" }).click();
  await answerOption(ada, 2);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
  await host.getByRole("button", { name: "Nächste Frage" }).click();
  await answerOption(ada, 1);
  await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await host.getByRole("button", { name: "Endergebnis anzeigen" }).click();

  const rank = ada.getByText("Du hast auf Platz 1 mit 26 Punkten abgeschlossen");
  await expect(rank).toBeVisible();
  await ada.reload();
  await expect(rank).toBeVisible();
  await expect(ada.locator(".player-app__nickname")).toHaveText("Ada");

  // Also once the teacher has closed the quiz: nothing depends on the relay.
  await host.getByRole("button", { name: "Quiz beenden" }).click();
  await expect(host.getByRole("button", { name: "Quiz erstellen" })).toBeVisible();
  await ada.reload();
  await expect(rank).toBeVisible();

  // Only that tab: another one starts over.
  const other = await ada.context().newPage();
  await other.goto(`/?pin=${pin}`);
  await expect(other.getByRole("heading", { name: "Einem Quiz beitreten" })).toBeVisible();
});

test("a second teacher tab stays out of the quiz until it takes over", async ({ browser }) => {
  const { host, pin } = await createQuiz(browser);
  const ada = await joinByLink(browser, pin, "Ada");

  const second = await host.context().newPage();
  await second.goto("/create");
  test.skip(!(await second.evaluate(() => !!navigator.locks)), "this browser has no Web Locks here");
  const notice = (page: Page) => page.getByRole("heading", { name: "Dieses Quiz läuft bereits in einem anderen Tab." });
  await expect(notice(second)).toBeVisible();

  // Longer than a heartbeat: a second host would throw Ada back to the lobby.
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect(ada.locator(".player-answer-grid__option")).toHaveCount(4);
  await ada.waitForTimeout(7000);
  await expect(ada.getByRole("heading", { name: "Du bist dabei, Ada!" })).toHaveCount(0);
  await answerOption(ada, 2);
  await expect(ada.locator(".player-app__instruction")).toContainText("Antwort angekommen");
  await expect(host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" })).toBeVisible();

  // The second tab takes over, with everything the first one knew.
  await second.getByRole("button", { name: "Hier übernehmen" }).click();
  await expect(notice(host)).toBeVisible();
  await second.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
  await expect(ada.locator(".player-app__reveal-correct")).toContainText("+13 Punkte");

  // A reload is no second tab, however soon it comes.
  await second.reload();
  await expect(second.getByRole("button", { name: "Rangliste anzeigen" })).toBeVisible();
  await expect(notice(second)).toHaveCount(0);
});
