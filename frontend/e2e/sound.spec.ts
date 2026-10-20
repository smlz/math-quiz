import { expect, test, type Page } from "@playwright/test";

// What the host screen plays and when (src/sound/hostSound.ts). Headless
// Chromium has no speakers, so the Web Audio calls themselves are recorded:
// every audio context created, every clip started (by its file name), and
// every stop scheduled.

declare global {
  interface Window {
    soundLog: string[];
    /** What else happened to the audio, printed when the test fails. */
    soundDiagnostics: string[];
    /** The state of the page's audio context, once there is one. */
    soundState?: () => AudioContextState;
  }
}

function recordSound() {
  window.soundLog = [];
  window.soundDiagnostics = [];
  // The first of each choice: the tune "Happy Vibes", then the cheer "woohoo",
  // and as the next one, never the same, "class".
  Math.random = () => 0;
  const Context = window.AudioContext;
  window.AudioContext = class extends Context {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      window.soundLog.push("context");
      window.soundState = () => this.state;
      window.soundDiagnostics.push(`context ${this.state}`);
      this.addEventListener("statechange", () => window.soundDiagnostics.push(`context ${this.state}`));
    }
  };

  // Clips are told apart by the file they came from: their decoded length
  // differs between browsers' MP3 decoders. The name follows the download
  // into its bytes and from there into the decoded buffer.
  const clipNames = new WeakMap<object, string>();
  const originalFetch = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    const name = /\/audio\/([\w-]+)\.mp3$/.exec(url)?.[1];
    if (name) {
      const arrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => {
        const data = await arrayBuffer();
        clipNames.set(data, name);
        return data;
      };
    }
    return response;
  };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
    // Looked up first: decoding detaches the bytes.
    const name = clipNames.get(data) ?? "?";
    return decode.call(this, data).then(
      (buffer) => {
        clipNames.set(buffer, name);
        window.soundDiagnostics.push(`decoded ${name} ${buffer.duration.toFixed(2)}s`);
        return buffer;
      },
      (error) => {
        window.soundDiagnostics.push(`decoding ${name} failed: ${error}`);
        throw error;
      },
    );
  } as typeof decode;

  const { start, stop } = AudioBufferSourceNode.prototype;
  const describe = (source: AudioBufferSourceNode) =>
    `${(source.buffer && clipNames.get(source.buffer)) ?? "?"}${source.loop ? " loop" : ""}`;
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

let hostPage: Page | null = null;
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus || !hostPage) return;
  const diagnostics = await hostPage.evaluate(() => window.soundDiagnostics).catch((e) => [String(e)]);
  console.log(`sound diagnostics (${testInfo.project.name}):\n  ${diagnostics.join("\n  ")}`);
  console.log(`sound log: ${JSON.stringify(await soundLog(hostPage).catch(() => null))}`);
});

test("the host plays a tune through the quiz, cheers for the leaderboard and applause at the end", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const host = await hostContext.newPage();
  const player = await playerContext.newPage();
  hostPage = host;
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

  // Cheers and applause wait for the audio context to run, which takes an
  // audio output. A machine without one -- Firefox on the Linux CI runner --
  // can't show any of this, so the test is skipped there, not failed.
  const running = await expect
    .poll(() => host.evaluate(() => window.soundState?.()), { timeout: 5000 })
    .toBe("running")
    .then(
      () => true,
      () => false,
    );
  if (!running) {
    const diagnostics = await host.evaluate(() => window.soundDiagnostics ?? []);
    console.log(`sound diagnostics (skipped): ${diagnostics.join(", ") || "no audio context at all"}`);
    await hostContext.close();
    await playerContext.close();
  }
  test.skip(!running, "The audio context never starts here: no audio output.");

  // The lobby is quiet; the music starts with the first question.
  expect(await soundLog(host)).toEqual(["context"]);
  await host.getByRole("button", { name: "Frage starten" }).click();
  await expect.poll(() => soundLog(host)).toEqual(["context", "start music-happy-vibes loop"]);

  // The sample quiz: C, B, A are correct. The tune plays on without restarting.
  const count = async (event: string) => (await soundLog(host)).filter((e) => e === event).length;
  for (const [question, correct] of [2, 1, 0].entries()) {
    await expect(player.locator(".player-answer-grid__option")).toHaveCount(4);
    await player.locator(".player-answer-grid__option").nth(correct).click();
    await host.getByRole("button", { name: "Alle haben geantwortet — Antwort zeigen" }).click();
    if (question === 0) {
      // The shortest cheer is cut off as soon as the animation is over ...
      await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
      await expect.poll(() => count("start cheer-woohoo")).toBe(1);
      await expect(host.locator(".leaderboard__gain")).toHaveCount(0);
      await expect.poll(() => count("stop cheer-woohoo")).toBe(1);
      await host.getByRole("button", { name: "Nächste Frage" }).click();
    } else if (question === 1) {
      // ... a different, longer one plays on, until the next question starts.
      await host.getByRole("button", { name: "Rangliste anzeigen" }).click();
      await expect.poll(() => count("start cheer-class")).toBe(1);
      await expect(host.locator(".leaderboard__gain")).toHaveCount(0);
      expect(await count("stop cheer-class")).toBe(0);
      await host.getByRole("button", { name: "Nächste Frage" }).click();
      await expect.poll(() => count("stop cheer-class")).toBe(1);
    }
  }
  await host.getByRole("button", { name: "Endergebnis anzeigen" }).click();

  // The final screen: the tune fades out under 20 s of applause, no cheer.
  await expect.poll(() => soundLog(host)).toEqual([
    "context",
    "start music-happy-vibes loop",
    "start cheer-woohoo",
    "stop cheer-woohoo",
    "start cheer-class",
    "stop cheer-class",
    "stop music-happy-vibes loop",
    "start final-applause",
  ]);

  // Turning the sound off silences the applause at once.
  await toggle.click();
  await expect(toggle).toHaveText("🔇 Ton aus");
  await expect.poll(() => count("stop final-applause")).toBe(1);

  // Players' devices never touch audio.
  expect(await soundLog(player)).toEqual([]);

  await hostContext.close();
  await playerContext.close();
});
