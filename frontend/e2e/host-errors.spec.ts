import { expect, test } from "@playwright/test";

// Creating a session can fail after the quiz itself compiled fine; the host
// must say why instead of silently staying on the setup screen.

test("host explains that no pin is free when the relay answers 503", async ({ page }) => {
  await page.route("**/api/v1/session", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"No free pin"}' })
      : route.continue(),
  );
  await page.goto("/create");
  await page.getByRole("button", { name: "Quiz erstellen" }).click();

  await expect(page.locator(".host-app__errors")).toContainText("Gerade sind alle Spiel-PINs vergeben");
  await expect(page.getByRole("button", { name: "Quiz erstellen" })).toBeEnabled();
});

test("host explains that the relay is unreachable", async ({ page }) => {
  await page.route("**/api/v1/session", (route) =>
    route.request().method() === "POST" ? route.abort("connectionrefused") : route.continue(),
  );
  await page.goto("/create");
  await page.getByRole("button", { name: "Quiz erstellen" }).click();

  await expect(page.locator(".host-app__errors")).toContainText("Server nicht erreichbar");
});
