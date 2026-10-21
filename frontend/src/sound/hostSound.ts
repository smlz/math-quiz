// Sound for the projector only: a tune looping from the first question to the
// last leaderboard, a cheer while a leaderboard moves, and applause for the
// final standings. Off until the teacher turns it on; while it is off, nothing
// is loaded and no audio context exists. Players' devices never play or load
// any of it -- nothing here runs until the host screen calls in. The clips
// live in public/audio/ (see CREDITS.md there).
import { ref } from "vue";
import { debugLog, describeError } from "../debug/debugLog";

const clip = (name: string) => `${import.meta.env.BASE_URL}audio/${name}.mp3`;

// One tune per quiz, picked at random among those this browser hasn't played
// yet, so every one comes up within as many quizzes as there are tunes.
const MUSIC = ["music-happy-vibes", "music-happy-beat", "music-happy-adventure", "music-c64-happy-loop"];

interface Cheer {
  url: string;
  /** Faded out when the leaderboard animation is over. The others are barely
   * longer than the animation and play to their end. */
  untilSettled: boolean;
}

// One cheer per leaderboard, picked at random, never the same twice in a row.
const CHEERS: Cheer[] = [
  { url: clip("cheer-woohoo"), untilSettled: true },
  { url: clip("cheer-class"), untilSettled: false },
  { url: clip("cheer-small-crowd"), untilSettled: false },
];

const APPLAUSE = clip("final-applause");

// The clips are levelled against each other (music at -18 LUFS, cheers at
// -22, the applause at -14), so these only set the overall balance.
const MUSIC_VOLUME = 0.2;
const EFFECT_VOLUME = 1;
// Seconds.
const STOP_FADE = 0.4;
const FINALE_FADE = 2.5;
// Below this a sample counts as silence when finding a loop's ends (-60 dBFS).
const SILENCE = 1e-3;

const SOUND_KEY = "math-quiz-sound";
const PLAYED_KEY = "math-quiz-music-played";

/** Whether the teacher has turned the sound on. Off by default, since a
 * projector suddenly playing music is a surprise nobody wants mid-lesson.
 * Remembered in this browser, so it stays on for the next quiz. */
export const soundOn = ref(readSoundOn());

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
// This quiz's tune, picked when first needed and forgotten when the quiz ends.
let musicUrl: string | null = null;
let music: Voice | null = null;
// The quiz is at a point that has music -- whether or not it is playing yet.
let musicWanted = false;
const effects = new Set<Voice>();
let lastCheer: Cheer | null = null;
let cheer: { playing: Promise<Voice | null>; untilSettled: boolean } | null = null;

function readSoundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

/** The audio context, or null while the sound is off. Created on first use;
 * browsers only let it play after the page has been clicked, so one created
 * before that (e.g. after a reload mid-quiz) stays suspended until
 * `attachSound`'s listeners resume it. */
function audio(): AudioContext | null {
  if (!soundOn.value) return null;
  if (!context) {
    if (typeof AudioContext === "undefined") return null;
    context = new AudioContext();
    // Fetched up front, so the first cheer isn't late by a download.
    for (const url of [...CHEERS.map((c) => c.url), APPLAUSE]) void load(url);
  }
  return context;
}

function load(url: string): Promise<AudioBuffer | null> {
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context!.decodeAudioData(data))
      .catch((e) => {
        // A quiz without sound is still a quiz.
        debugLog("sound not loaded", { url, error: describeError(e) });
        return null;
      });
    buffers.set(url, buffer);
  }
  return buffer;
}

/** The next tune from a shuffled round of all of them: one at random among
 * those not `played` yet, and once all have been, a new round begins (not
 * with the tune that ended the last one). Returns the tune and the round so
 * far. */
export function nextTune(tunes: readonly string[], played: readonly string[]): [string, string[]] {
  const known = played.filter((tune) => tunes.includes(tune));
  const fresh = tunes.filter((tune) => !known.includes(tune));
  if (fresh.length) {
    const tune = pickAtRandom(fresh);
    return [tune, [...known, tune]];
  }
  const tune = pickAtRandom(tunes, known.at(-1));
  return [tune, [tune]];
}

function pickMusic(): string {
  let played: string[] = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? "[]");
    if (Array.isArray(stored)) played = stored.filter((tune): tune is string => typeof tune === "string");
  } catch {
    // Unreadable or no storage: a fresh round.
  }
  const [tune, round] = nextTune(MUSIC, played);
  try {
    localStorage.setItem(PLAYED_KEY, JSON.stringify(round));
  } catch {
    // Private mode: the round is forgotten, the pick is still random.
  }
  debugLog("music", { tune });
  return clip(tune);
}

/** One of `items` at random, other than `not` (when there is a choice). */
export function pickAtRandom<T>(items: readonly T[], not?: T | null): T {
  const choices = items.length > 1 ? items.filter((item) => item !== not) : items;
  return choices[Math.floor(Math.random() * choices.length)];
}

/** Where the sound starts and ends, in seconds. MP3 pads both ends with
 * silence (by an amount that depends on the encoder), which a loop would
 * otherwise play as a gap at every turn. */
export function audibleRange(
  buffer: Pick<AudioBuffer, "numberOfChannels" | "sampleRate" | "length" | "getChannelData">,
): [number, number] {
  let first = buffer.length;
  let last = -1;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < first; i++) {
      if (Math.abs(data[i]) > SILENCE) {
        first = i;
        break;
      }
    }
    for (let i = data.length - 1; i > last; i--) {
      if (Math.abs(data[i]) > SILENCE) {
        last = i;
        break;
      }
    }
  }
  if (last < first) return [0, buffer.length / buffer.sampleRate];
  return [first / buffer.sampleRate, (last + 1) / buffer.sampleRate];
}

function play(ctx: AudioContext, buffer: AudioBuffer, volume: number, loop: boolean, fadeInSeconds = 0): Voice {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(fadeInSeconds ? 0 : volume, ctx.currentTime);
  if (fadeInSeconds) gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeInSeconds);
  source.connect(gain).connect(ctx.destination);
  if (loop) {
    source.loop = true;
    [source.loopStart, source.loopEnd] = audibleRange(buffer);
  }
  source.start(0, source.loopStart);
  return { source, gain };
}

function fadeOut(voice: Voice, seconds: number) {
  const now = context!.currentTime;
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
  voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
  voice.source.stop(now + seconds);
}

function startMusic() {
  const ctx = audio();
  if (!musicWanted || music || !ctx) return;
  const url = (musicUrl ??= pickMusic());
  void load(url).then((buffer) => {
    // Stopped or turned off while loading, or a second call got here first.
    if (!buffer || !musicWanted || music || !soundOn.value || url !== musicUrl) return;
    music = play(ctx, buffer, MUSIC_VOLUME, true);
  });
}

function silenceMusic(fadeSeconds: number) {
  if (!music) return;
  fadeOut(music, fadeSeconds);
  music = null;
}

/** Starts this quiz's tune, unless it is already playing. */
export function playMusic() {
  musicWanted = true;
  startMusic();
}

export function stopMusic(fadeSeconds = STOP_FADE) {
  musicWanted = false;
  silenceMusic(fadeSeconds);
}

async function playEffect(url: string, fadeInSeconds = 0): Promise<Voice | null> {
  const ctx = audio();
  if (!ctx) return null;
  const buffer = await load(url);
  // A context still waiting for its first click would save the effect up
  // and play it then, long after the moment it was for.
  if (!buffer || ctx.state !== "running" || !soundOn.value) return null;
  const voice = play(ctx, buffer, EFFECT_VOLUME, false, fadeInSeconds);
  effects.add(voice);
  voice.source.onended = () => effects.delete(voice);
  return voice;
}

/** A little clapping and cheering for a leaderboard where someone has just
 * scored. */
export function playCheer() {
  stopCheer();
  if (!audio()) return;
  lastCheer = pickAtRandom(CHEERS, lastCheer);
  cheer = { playing: playEffect(lastCheer.url), untilSettled: lastCheer.untilSettled };
}

/** The leaderboard animation is over: a cheer meant to last just as long
 * fades out. */
export function settleCheer() {
  if (cheer?.untilSettled) stopCheer();
}

/** Fades out the cheer, whichever it is, e.g. when the next question starts. */
export function stopCheer() {
  const playing = cheer?.playing;
  cheer = null;
  void playing?.then((voice) => voice && fadeOut(voice, STOP_FADE));
}

/** The end of the quiz: the tune crossfades into roaring applause. */
export function playFinale() {
  stopMusic(FINALE_FADE);
  void playEffect(APPLAUSE, FINALE_FADE);
}

function silenceEffects() {
  stopCheer();
  for (const voice of effects) fadeOut(voice, STOP_FADE);
  effects.clear();
}

/** Silences everything when a quiz is over, e.g. closed mid-applause. The
 * next quiz picks its own tune. */
export function stopSound() {
  stopMusic();
  silenceEffects();
  musicUrl = null;
}

export function toggleSound() {
  soundOn.value = !soundOn.value;
  try {
    localStorage.setItem(SOUND_KEY, soundOn.value ? "on" : "off");
  } catch {
    // Private mode: for this page only.
  }
  if (soundOn.value) {
    // Called from a click, so the context may start right away.
    startMusic();
  } else {
    silenceMusic(STOP_FADE);
    silenceEffects();
  }
  debugLog(soundOn.value ? "sound on" : "sound off");
}

/** Lets the host page's clicks and key presses unlock audio, which browsers
 * allow only in response to one. Returns the function that detaches again. */
export function attachSound(): () => void {
  const unlock = () => {
    const ctx = audio();
    if (ctx && ctx.state !== "running") void ctx.resume();
  };
  const events = ["pointerdown", "keydown"] as const;
  for (const event of events) window.addEventListener(event, unlock, true);
  return () => {
    for (const event of events) window.removeEventListener(event, unlock, true);
  };
}
