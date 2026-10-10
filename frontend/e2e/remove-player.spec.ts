import { expect, test } from "@playwright/test";

test("host removes a player, who can rejoin under a new name", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const pupil = await (await browser.newContext()).newPage();
  host.on("dialog", (dialog) => dialog.accept());

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = (await host.locator(".host-lobby__pin").textContent())!;

  await pupil.goto(`/?pin=${pin}`);
  await pupil.getByLabel("Nickname").fill("Rude");
  await pupil.getByRole("button", { name: "Beitreten" }).click();
  await expect(pupil.getByRole("heading", { name: "Du bist dabei, Rude!" })).toBeVisible();

  const names = host.locator(".host-lobby__name");
  await expect(names).toHaveText(["Rude"]);
  await host.getByRole("button", { name: "Rude entfernen" }).click();

  // The pupil's device drops its identity and the remembered name...
  await expect(pupil.locator(".player-join__notice")).toContainText("anderen Namen");
  await expect(pupil.getByLabel("Spiel-PIN")).toHaveValue(pin);
  await expect(pupil.getByLabel("Nickname")).toHaveValue("");
  await expect(pupil.getByLabel("Nickname")).toBeEditable();
  // ...and the old id stays out, even though it was retrying its join.
  await host.waitForTimeout(4000);
  await expect(names).toHaveCount(0);

  await pupil.getByLabel("Nickname").fill("Nice");
  await pupil.getByRole("button", { name: "Beitreten" }).click();
  await expect(pupil.getByRole("heading", { name: "Du bist dabei, Nice!" })).toBeVisible();
  await expect(names).toHaveText(["Nice"]);

  // A reload of the host must not forget who was removed.
  await host.reload();
  await expect(names).toHaveText(["Nice"]);
});
