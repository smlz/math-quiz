import { expect, test, type APIRequestContext } from "@playwright/test";

// Anyone who knows (or guesses) a pin can mint a player token and send the
// host arbitrary JSON, bypassing the player UI entirely. These tests talk to
// the relay directly (through Vite's /api proxy) to play that stranger.

async function mintPlayer(request: APIRequestContext, pin: string): Promise<string> {
  const response = await request.post(`/api/v1/session/${pin}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).player_token;
}

async function send(request: APIRequestContext, pin: string, token: string, payload: unknown) {
  const response = await request.post(`/api/v1/session/${pin}/message`, {
    headers: { "X-Player-Token": token },
    data: payload,
  });
  expect(response.ok()).toBe(true);
}

test("a quiz cannot smuggle script into the rendered SVG", async ({ page }) => {
  // typst.ts carries a link's URL through verbatim, and the SVG is mounted
  // with v-html: a `?src=` quiz could otherwise plant a javascript: link.
  await page.goto("/create");
  await page.locator("textarea").fill(`#import "quiz.typ": *
#show: quiz

#question(
  correct: "A",
  prompt: [
    #link("javascript:alert(document.domain)")[evil]
    #link("https://example.com")[fine]
  ],
  options: ([A], [B], [C], [D]),
)
`);

  const prompt = page.locator(".host-app__preview .typst-figure__canvas svg").first();
  await expect(prompt).toBeVisible();
  const found = await prompt.evaluate((svg) => ({
    hrefs: Array.from(svg.querySelectorAll("a")).map(
      (a) => a.getAttribute("href") ?? a.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    ),
    scripts: svg.querySelectorAll("script").length,
  }));
  expect(found.hrefs).toContain("https://example.com");
  expect(found.hrefs.filter((href) => href?.toLowerCase().includes("javascript"))).toEqual([]);
  expect(found.scripts).toBe(0);
});

test("host ignores or trims hostile player messages", async ({ page: host, request }) => {
  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = (await host.locator(".host-lobby__pin").textContent())!;

  const long = await mintPlayer(request, pin);
  const bogus = await mintPlayer(request, pin);
  const sentinel = await mintPlayer(request, pin);
  const twin = await mintPlayer(request, pin);

  await send(request, pin, bogus, { type: "join", nickname: { toString: "no" } });
  await send(request, pin, bogus, { type: "join", nickname: "   " });
  await send(request, pin, long, { type: "join", nickname: "X".repeat(500) });
  await send(request, pin, long, { type: "join", nickname: "Renamed" });
  // The host handles messages in order, so once this one shows up every
  // message before it has been dealt with.
  await send(request, pin, sentinel, { type: "join", nickname: "Zed" });
  // A look-alike of a name already taken gets numbered instead.
  await send(request, pin, twin, { type: "join", nickname: String.fromCodePoint(0x202e) + "zed" + String.fromCodePoint(0x200b) });

  const names = host.locator(".host-lobby__name");
  await expect(names).toHaveText(["X".repeat(30), "Zed", "zed (2)"]);

  await host.getByRole("button", { name: "Frage starten" }).click();
  await send(request, pin, long, { type: "answer", question_index: 0, option_index: 7 });
  await send(request, pin, long, { type: "answer", question_index: 0, option_index: "0" });
  await send(request, pin, bogus, { type: "answer", question_index: 0, option_index: 0 });
  await send(request, pin, sentinel, { type: "answer", question_index: 0, option_index: 0 });

  await expect(host.getByRole("button", { name: /Antwort zeigen · 1 von 3 beantwortet/ })).toBeVisible();
});

test("a join link never joins without a tap", async ({ browser }) => {
  // Anyone can send a pupil a /?pin=... link; with a nickname remembered
  // from an earlier quiz, opening it must not hand that name to the session.
  const host = await (await browser.newContext()).newPage();
  const player = await (await browser.newContext()).newPage();
  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  await player.goto("/");
  await player.evaluate(() => localStorage.setItem("math-quiz-nickname", "Ada"));
  await player.goto(`/?pin=${pin}`);
  await expect(player.getByLabel("Nickname")).toHaveValue("Ada");
  await player.waitForTimeout(3000);
  await expect(host.locator(".host-lobby__count")).toHaveText("0 Spieler:innen beigetreten");

  await player.getByRole("button", { name: "Beitreten" }).click();
  await expect(host.locator(".host-lobby__count")).toHaveText("1 Spieler:innen beigetreten");
});
