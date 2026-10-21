import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A quiz loaded from a link may use images stored next to it (SPEC.md §3.5).
// The "remote" repo is played by intercepted requests to a made-up host.

const ORIGIN = "https://quiz-host.test";
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CIRCLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>`;

const QUIZ = `#import "quiz.typ": *
#show: quiz

#let logo = image("../shared/pixel.png", width: 1cm)

#question(
  correct: "A",
  prompt: [Welche Form? #image("img/kreis.svg", width: 2cm)],
  options: ([Kreis], [Quadrat], [#logo], [Dreieck]),
)
`;

/** Serves `files` (paths below ORIGIN) with CORS headers; anything else is a 404. */
async function serveRepo(page: Page, files: Record<string, { body: string | Buffer; contentType: string }>) {
  const requested: string[] = [];
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    requested.push(path);
    const file = files[path];
    return route.fulfill({
      status: file ? 200 : 404,
      headers: { "Access-Control-Allow-Origin": "*" },
      contentType: file?.contentType ?? "text/plain",
      body: file?.body ?? "Not Found",
    });
  });
  return requested;
}

const imageHrefs = (page: Page, scope: string) =>
  page
    .locator(`${scope} .typst-figure__canvas svg image`)
    .evaluateAll((images) =>
      images.map((image) => image.getAttribute("href") ?? image.getAttributeNS("http://www.w3.org/1999/xlink", "href")),
    );

test("a quiz from a link shows images stored next to it", async ({ page }) => {
  const requested = await serveRepo(page, {
    "/quizzes/formen/quiz.typ": { body: QUIZ, contentType: "text/plain" },
    "/quizzes/formen/img/kreis.svg": { body: CIRCLE_SVG, contentType: "image/svg+xml" },
    "/quizzes/shared/pixel.png": { body: PIXEL_PNG, contentType: "image/png" },
  });

  await page.goto(`/create?src=${encodeURIComponent(`${ORIGIN}/quizzes/formen/quiz.typ`)}`);

  await expect.poll(async () => (await imageHrefs(page, ".host-app__preview")).length).toBe(2);
  for (const href of await imageHrefs(page, ".host-app__preview")) expect(href).toMatch(/^data:image\//);
  await expect(page.locator(".typst-figure__error")).toHaveCount(0);
  expect(requested.filter((path) => !path.endsWith(".typ")).sort()).toEqual([
    "/quizzes/formen/img/kreis.svg",
    "/quizzes/shared/pixel.png",
  ]);
});

test("the image example in typst/ renders in full", async ({ page }) => {
  // The example linked from typst/README.md, served exactly as it lies in the repo.
  const typstDir = fileURLToPath(new URL("../../typst", import.meta.url));
  const files: Record<string, { body: string | Buffer; contentType: string }> = {
    "/typst/quiz-bilder.typ": { body: readFileSync(join(typstDir, "quiz-bilder.typ"), "utf-8"), contentType: "text/plain" },
  };
  for (const name of readdirSync(join(typstDir, "bilder"))) {
    files[`/typst/bilder/${name}`] = { body: readFileSync(join(typstDir, "bilder", name)), contentType: "image/svg+xml" };
  }
  await serveRepo(page, files);

  await page.goto(`/create?src=${encodeURIComponent(`${ORIGIN}/typst/quiz-bilder.typ`)}`);

  await expect.poll(async () => (await imageHrefs(page, ".host-app__preview")).length).toBe(7);
  await expect(page.locator(".typst-figure__error")).toHaveCount(0);
});

test("a missing image says why it is missing", async ({ page }) => {
  await serveRepo(page, { "/quiz.typ": { body: QUIZ.replace("img/kreis.svg", "fehlt.svg"), contentType: "text/plain" } });

  await page.goto(`/create?src=${encodeURIComponent(`${ORIGIN}/quiz.typ`)}`);

  await expect(page.locator(".typst-figure__error").first()).toContainText("HTTP 404");
  await page.getByRole("button", { name: "Quiz erstellen" }).click();
  await expect(page.locator(".host-app__editor .host-app__errors")).toContainText("fehlt.svg");
});

test("a pasted quiz is told that images need a link", async ({ page }) => {
  await page.goto("/create");
  await page.locator("textarea").fill(QUIZ);

  await expect(page.locator(".typst-figure__error").first()).toContainText("per Link");
});

async function joinPlayer(request: APIRequestContext, pin: string, nickname: string) {
  const minted = await request.post(`/api/v1/session/${pin}`);
  const token = (await minted.json()).player_token;
  const joined = await request.post(`/api/v1/session/${pin}/message`, {
    headers: { "X-Player-Token": token },
    data: { type: "join", nickname },
  });
  expect(joined.ok()).toBe(true);
}

test("images survive a host reload mid-quiz", async ({ page, request }) => {
  await serveRepo(page, {
    "/quizzes/formen/quiz.typ": { body: QUIZ, contentType: "text/plain" },
    "/quizzes/formen/img/kreis.svg": { body: CIRCLE_SVG, contentType: "image/svg+xml" },
    "/quizzes/shared/pixel.png": { body: PIXEL_PNG, contentType: "image/png" },
  });
  await page.goto(`/create?src=${encodeURIComponent(`${ORIGIN}/quizzes/formen/quiz.typ`)}`);
  await expect.poll(async () => (await imageHrefs(page, ".host-app__preview")).length).toBe(2);
  await page.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = (await page.locator(".host-lobby__pin").textContent())!;
  await joinPlayer(request, pin, "Ada");
  await page.getByRole("button", { name: "Frage starten" }).click();

  // Without `?src=`: the session itself has to remember where the quiz came from.
  await page.goto("/create");

  await expect.poll(async () => (await imageHrefs(page, ".host-app")).length).toBe(2);
  await expect(page.locator(".typst-figure__error")).toHaveCount(0);
});
