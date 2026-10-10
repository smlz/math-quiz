import { expect, test } from "@playwright/test";

// Players get the site root, the host lives at /create (SPEC.md §8).

test("the join page links to the host page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Einem Quiz beitreten" })).toBeVisible();

  await page.getByRole("link", { name: "Eigenes Quiz erstellen" }).click();
  await expect(page).toHaveURL("/create");
  await expect(page.getByRole("button", { name: "Quiz erstellen" })).toBeVisible();
});

test("a join link from the QR code hides the way to the host page", async ({ page }) => {
  await page.goto("/?pin=123456");
  await expect(page.getByLabel("Spiel-PIN")).toHaveValue("123456");
  await expect(page.getByRole("link", { name: "Eigenes Quiz erstellen" })).toHaveCount(0);
});

test("the players' privacy link stays on the site and loads nothing from third parties", async ({ page, context }) => {
  await page.goto("/?pin=123456");
  const origin = new URL(page.url()).origin;

  const [about] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Datenschutz" }).click(),
  ]);
  const foreign: string[] = [];
  about.on("request", (request) => {
    if (new URL(request.url()).origin !== origin) foreign.push(request.url());
  });
  await about.reload({ waitUntil: "networkidle" });

  await expect(about).toHaveURL("/about");
  await expect(about.getByRole("heading", { name: "Datenschutz & Grenzen" })).toBeVisible();
  expect(foreign).toEqual([]);
});
