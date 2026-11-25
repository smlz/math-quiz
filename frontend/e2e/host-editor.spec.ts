import { expect, test, type Page } from "./fixtures";

// The editor saves nothing, so leaving it with edits asks first. A running
// quiz stores its own source and needs no such question.

/** Counts the browser's "leave page?" prompts, letting each one through. */
function countPrompts(page: Page): () => number {
  let prompts = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "beforeunload") prompts++;
    await dialog.accept();
  });
  return () => prompts;
}

/** Adds a comment at the end of the quiz in the editor, typed as a person would:
 * the browser only asks pages the user has interacted with. */
async function editQuiz(page: Page) {
  await page.locator(".typst-editor__input").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n// geändert\n");
}

test("leaving the editor asks first, but only once it holds edits", async ({ page }) => {
  const prompts = countPrompts(page);
  await page.goto("/create");
  await page.locator(".typst-editor__input").click();
  await page.reload();
  expect(prompts()).toBe(0);

  await editQuiz(page);
  await page.reload();
  expect(prompts()).toBe(1);
});

test("a running quiz reloads without asking", async ({ page }) => {
  const prompts = countPrompts(page);
  await page.goto("/create");
  await editQuiz(page);
  await page.getByRole("button", { name: "Quiz erstellen" }).click();
  await expect(page.locator(".host-lobby__pin")).toBeVisible();

  await page.reload();
  await expect(page.locator(".host-lobby__pin")).toBeVisible();
  expect(prompts()).toBe(0);
});
