import { expect, test, type Page } from "@playwright/test";

// What the host screen plays and when (src/sound/hostSound.ts). Headless
// Chromium has no speakers, so the Web Audio calls themselves are recorded:
// every audio context created, every clip started (by its length), and every
// stop scheduled.

declare global {
  interface Window {
    soundLog: string[];
  }
}

function recordSound() {
  window.soundLog = [];
  // The first of each choice: the tune "Happy Vibes" (45.5 s), then the cheer
  // "woohoo" (4.5 s), and as the next one, never the same, "class" (5.8 s once decoded).
  Math.random = () => 0;
  const Context = window.AudioContext;
  window.AudioContext = class extends Context {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      window.soundLog.push("context");
    }
  };
  const { start, stop } = AudioBufferSourceNode.prototype;
  const describe = (source: AudioBufferSourceNode) =>
    `${(source.buffer?.duration ?? 0).toFixed(1)}s${source.loop ? " loop" : ""}`;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.soundLog.push(`start ${describe(this)}`);
    return start.apply(this, args);
  };
  AudioBufferSourceNode.prototype.stop = function (...args) {
    window.soundLog.push(`stop ${describe(this)}`);
    return stop.apply(this, args);
  };
}

const soundLog = (page: Page) => page.evaluate(() => window.soundLog);

test("the host plays a tune through the quiz, cheers for the leaderboard and applause at the end", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const host = await hostContext.newPage();
  const player = await playerContext.newPage();
  await host.addInitScript(recordSound);
  await player.addInitScript(recordSound);

  await host.goto("/create");
  await host.getByRole("button", { name: "Quiz erstellen" }).click();
  const pin = await host.locator(".host-lobby__pin").textContent();

  await player.goto(`/?pin=${pin}`);
  await player.getByLabel("Nickname").fill("Ada");
  await player.getByRole("button", { name: "Beitreten" }).click();
  await expect(host.locator(".host-lobby__count")).toHaveText("1 Spieler:innen beigetreten");

  // Sound is off until the teacher turns it on: until then not even an audio
  // context exists.
  const toggle = host.getByRole("button", { name: "Ton" });
  await expect(toggle).toHaveText("🔇 Ton aus");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await soundLog(host)).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveText("🔊 Ton an");

  // The lobby is quiet; the music starts with the first question.
  expect(await soundLog(host)).toEqual(["context"]);
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect.poll(() => soundLog(host)).toEqual(["context", "start 45.5s loop"]);

  // The sample quiz: C, B, A are correct. The tune plays on without restarting.
  const count = async (event: string) => (await soundLog(host)).filter((e) => e === event).length;
  for (const [question, correct] of [2, 1, 0].entries()) {
    await expect(player.locator(".player-answer-grid__option")).toHaveCount(4);
    await player.locator(".player-answer-grid__option").nth(correct).click();
    await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
    if (question === 0) {
      // The shortest cheer is cut off as soon as the animation is over ...
      await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
      await expect.poll(() => count("start 4.5s")).toBe(1);
      await expect(host.locator(".leaderboard__gain")).toHaveCount(0);
      await expect.poll(() => count("stop 4.5s")).toBe(1);
      await host.getByRole("button", { name: "Nächste Frage" }).click();
    } else if (question === 1) {
      // ... a different, longer one plays on, until the next question starts.
      await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
      await expect.poll(() => count("start 5.8s")).toBe(1);
      await expect(host.locator(".leaderboard__gain")).toHaveCount(0);
      expect(await count("stop 5.8s")).toBe(0);
      await host.getByRole("button", { name: "Nächste Frage" }).click();
      await expect.poll(() => count("stop 5.8s")).toBe(1);
    }
  }
  await host.getByRole("button", { name: "Endergebnis anzeigen" }).click();

  // The final screen: the tune fades out under 20 s of applause, no cheer.
  await expect.poll(() => soundLog(host)).toEqual([
    "context",
    "start 45.5s loop",
    "start 4.5s",
    "stop 4.5s",
    "start 5.8s",
    "stop 5.8s",
    "stop 45.5s loop",
    "start 20.4s",
  ]);

  // Turning the sound off silences the applause at once.
  await toggle.click();
  await expect(toggle).toHaveText("🔇 Ton aus");
  await expect.poll(() => count("stop 20.4s")).toBe(1);

  // Players' devices never touch audio.
  expect(await soundLog(player)).toEqual([]);

  await hostContext.close();
  await playerContext.close();
});
