<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  createSession,
  endSession,
  pointsForReveal,
  publishState,
  rankForScore,
  reportAfterGrace,
  subscribeToMessages,
  HEARTBEAT_MS,
  RelayError,
  type ConnectionStatus,
  type HostCredentials,
  type IncomingMessage,
  type Phase,
  type SessionSnapshot,
} from "../api/quizClient";
import { clearHostSession, loadHostSession, saveHostSession } from "../api/storedSession";
import { addDebugSecret, debugLog, describeError, setDebugContext, startDebugLog } from "../debug/debugLog";
import { QuizParseError } from "../quiz/errors";
import { OPTION_LABELS } from "../quiz/optionStyle";
import { cleanNickname } from "../quiz/nickname";
import { parseQuiz } from "../quiz/parseQuiz";
import { fetchQuizSource, resolveSource, type SourceLocation } from "../quiz/remoteSource";
import { MINIMAL_QUIZ } from "../quiz/sampleQuiz";
import { loadQuizImages, renderTypst } from "../quiz/typst";
import type { LeaderboardEntry, ParsedQuiz, QuestionState } from "../quiz/types";
import { attachSound, playCheer, playFinale, playMusic, settleCheer, stopCheer, stopSound } from "../sound/hostSound";
import AppFooter from "./AppFooter.vue";
import DebugExport from "./DebugExport.vue";
import HostLeaderboard from "./HostLeaderboard.vue";
import HostLobby from "./HostLobby.vue";
import QuestionCard from "./QuestionCard.vue";
import ScreenFrame from "./ScreenFrame.vue";
import SoundToggle from "./SoundToggle.vue";

const PREVIEW_DEBOUNCE_MS = 300;
// Generous for one class, but bounds what a flood of joins from strangers who
// guessed the pin can do to the roster, the projector and every snapshot.
const MAX_PLAYERS = 200;
// Player messages arrive in bursts (a class joining, everyone answering), and
// each snapshot goes out to every player: one per message would be quadratic.
// All messages within this window are confirmed by a single snapshot instead.
const BROADCAST_THROTTLE_MS = 500;
// A failed broadcast is repeated this soon rather than at the next heartbeat,
// so a single lost request heals before it is worth a banner.
const BROADCAST_RETRY_MS = 1000;

// "setup" is the only state with no session behind it; every other value is
// exactly the phase players are told about.
type Status = "setup" | Phase;

startDebugLog("host");

// A `?src=` link (SPEC.md §3.5) replaces the minimal quiz; the editor starts
// empty rather than briefly showing it while the file loads.
const remoteSource = new URLSearchParams(location.search).get("src");
const remoteLoading = ref(false);
const remoteLoaded = ref(false);
const remoteError = ref<string | null>(null);
// Where the quiz in the editor came from, if it came from a link: its images
// are fetched relative to that file (SPEC.md §3.5). It sticks for the whole
// page, edits included, and a resumed session brings its own.
let quizSrc: string | null = null;
let quizLocation: SourceLocation | null = null;

const quizSource = ref(remoteSource ? "" : MINIMAL_QUIZ);
const loadErrors = ref<string[]>([]);
const quiz = ref<ParsedQuiz | null>(null);
// Set while "Quiz erstellen" is busy: first every prompt/option is compiled
// with Typst before the lobby (and its QR code) is shown - the lobby only
// ever appears once this has confirmed the whole document compiles cleanly -
// then the session is created, which can take a while when the backend has
// to cold-start.
const creating = ref<"validating" | "connecting" | null>(null);
const creatingLabel = computed(() =>
  creating.value === "validating"
    ? "Quiz wird geprüft …"
    : "Verbindung zum Server wird aufgebaut …",
);

// Separate from `quiz` so a half-typed draft in the editor never disturbs
// the quiz that was validated for the running session.
const previewQuiz = ref<ParsedQuiz | null>(null);
const previewErrors = ref<string[]>([]);
let previewTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  quizSource,
  (source) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      // Nothing typed (or a link still loading) is not worth an error list.
      if (!source.trim()) {
        previewQuiz.value = null;
        previewErrors.value = [];
        return;
      }
      // Queued ahead of the preview's renders, which therefore see the images.
      void loadQuizImages(source, quizLocation);
      try {
        previewQuiz.value = parseQuiz(source);
        previewErrors.value = [];
      } catch (e) {
        previewQuiz.value = null;
        previewErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
      }
    }, PREVIEW_DEBOUNCE_MS);
  },
  { immediate: true },
);

const pin = ref<string | null>(null);
const hostToken = ref<string | null>(null);
const status = ref<Status>("setup");
// Inbox and broadcasts fail independently, and either one is worth a banner:
// a successful broadcast says nothing about whether messages still arrive.
const inboxConnection = ref<ConnectionStatus>("open");
const broadcastConnection = ref<ConnectionStatus>("open");
const connection = computed<ConnectionStatus>(() =>
  inboxConnection.value === "open" && broadcastConnection.value === "open" ? "open" : "reconnecting",
);
const reportBroadcast = reportAfterGrace((state) => {
  broadcastConnection.value = state;
});

const roster = reactive(new Map<string, string>()); // player_id -> nickname
const scores = reactive(new Map<string, number>()); // player_id -> cumulative score
// The scores as they stood before the current question was revealed, so the
// leaderboard can show what the question changed. Not persisted: after a
// reload the leaderboard simply appears in its final state.
const scoresBeforeReveal = ref<Map<string, number> | null>(null);
// Players the teacher removed (e.g. for a rude nickname). Their ids are
// ignored for the rest of the session; rejoining takes a fresh id.
const removed = reactive(new Set<string>());

const currentQuestionIndex = ref(-1);
// Insertion order is arrival order, which is exactly what decides the 12/11/10
// ladder -- no timestamps needed.
const answers = reactive(new Map<string, number>()); // player_id -> option_index
// Who answered the current question correctly, in arrival order. Frozen at
// reveal so re-broadcasting the same snapshot can never re-score anyone.
const correctOrder = ref<string[]>([]);

let unsubscribe: (() => void) | null = null;
let heartbeat: number | null = null;
let pendingBroadcast: number | null = null;

const lobbyPlayers = computed(() => [...roster].map(([player_id, nickname]) => ({ player_id, nickname })));

const currentQuestion = computed<QuestionState | null>(() =>
  quiz.value && currentQuestionIndex.value >= 0 ? quiz.value.questions[currentQuestionIndex.value] : null,
);

const countsArray = computed<number[]>(() =>
  currentQuestion.value
    ? currentQuestion.value.options.map((_, i) => [...answers.values()].filter((v) => v === i).length)
    : [],
);

const answeredCount = computed(() => answers.size);

const answerButtonLabel = computed(() =>
  roster.size > 0 && answeredCount.value >= roster.size
    ? "Alle haben geantwortet — Antwort zeigen"
    : `Antwort zeigen · ${answeredCount.value} von ${roster.size} beantwortet`,
);

const isLastQuestion = computed(
  () => !!quiz.value && currentQuestionIndex.value === quiz.value.questions.length - 1,
);

const questionProgress = computed(() =>
  quiz.value && currentQuestionIndex.value >= 0
    ? `${currentQuestionIndex.value + 1} / ${quiz.value.questions.length}`
    : "",
);

function rankPlayers(scoreByPlayer: Map<string, number>): LeaderboardEntry[] {
  const entries = [...roster.entries()]
    .map(([player_id, nickname]) => ({ player_id, nickname, score: scoreByPlayer.get(player_id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  // The same rule the players use to work out their own rank.
  const allScores = entries.map((entry) => entry.score);
  return entries.map((entry) => ({ ...entry, rank: rankForScore(allScores, entry.score) }));
}

const standings = computed(() => rankPlayers(scores));
const previousStandings = computed(() => scoresBeforeReveal.value && rankPlayers(scoresBeforeReveal.value));

// Structural parsing alone doesn't catch a Typst syntax/compile error inside
// a prompt or option body - actually compiling every snippet here is the
// only way to guarantee the lobby (and its QR code) is never shown for a
// document that would fail to render mid-game.
async function compileAllTypstSnippets(parsedQuiz: ParsedQuiz): Promise<string[]> {
  const checks: Promise<string | null>[] = [];
  parsedQuiz.questions.forEach((question, qIndex) => {
    checks.push(
      renderTypst(question.promptTypst)
        .then(() => null)
        .catch((e) => `Frage ${qIndex + 1}, Aufgabenstellung: ${e instanceof Error ? e.message : String(e)}`),
    );
    question.options.forEach((option, oIndex) => {
      checks.push(
        renderTypst(option.typst)
          .then(() => null)
          .catch(
            (e) =>
              `Frage ${qIndex + 1}, Option ${OPTION_LABELS[oIndex]}: ${e instanceof Error ? e.message : String(e)}`,
          ),
      );
    });
  });
  const results = await Promise.all(checks);
  return results.filter((r): r is string => r !== null);
}

function createSessionErrorMessage(error: unknown): string {
  // The relay answers 503 when it cannot hand out a pin: every pin is taken,
  // or too many sessions are live. Both clear up on their own.
  if (error instanceof RelayError && error.status === 503) {
    return "Gerade sind alle Spiel-PINs vergeben. Bitte versuche es in ein paar Minuten noch einmal.";
  }
  // 429: this network (usually the whole school) has started too many
  // quizzes in a short time. One more is allowed every minute, so the wait
  // is never longer than that.
  if (error instanceof RelayError && error.status === 429) {
    return "Von diesem Netzwerk aus wurden in kurzer Zeit zu viele Quiz gestartet. Bitte versuche es in etwa einer Minute noch einmal.";
  }
  return "Das Quiz konnte nicht gestartet werden, weil der Server nicht erreichbar ist. Bitte versuche es später noch einmal.";
}

async function loadAndCreateSession() {
  loadErrors.value = [];
  try {
    quiz.value = parseQuiz(quizSource.value);
  } catch (e) {
    quiz.value = null;
    loadErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
    debugLog("quiz rejected", { issues: loadErrors.value.length, first: loadErrors.value[0] });
    return;
  }

  creating.value = "validating";
  // The preview may not have caught up with the last edit yet.
  await loadQuizImages(quizSource.value, quizLocation);
  const typstErrors = await compileAllTypstSnippets(quiz.value);
  if (typstErrors.length) {
    creating.value = null;
    quiz.value = null;
    loadErrors.value = typstErrors;
    debugLog("quiz does not compile", { issues: typstErrors.length, first: typstErrors[0] });
    return;
  }

  let created: HostCredentials;
  creating.value = "connecting";
  try {
    created = await createSession();
  } catch (e) {
    creating.value = null;
    quiz.value = null;
    loadErrors.value = [createSessionErrorMessage(e)];
    debugLog("session not created", { error: describeError(e) });
    return;
  }
  addDebugSecret(created.hostToken);
  debugLog("session created", { pin: created.pin, questions: quiz.value.questions.length });
  creating.value = null;
  pin.value = created.pin;
  hostToken.value = created.hostToken;

  status.value = "lobby";
  connect(created.pin, created.hostToken);
  await broadcast();
}

/** The whole of what players are told, rebuilt from scratch every time.
 *
 * `players` carries a different meaning per phase (see SessionSnapshot):
 * who has joined, who has answered, who was correct and in what order, or
 * the rank order. From the reveal on it also carries everyone's total, so a
 * player's score is always the host's. Nicknames stay here on the host.
 */
function buildSnapshot(): SessionSnapshot {
  const phase = status.value === "setup" ? "lobby" : status.value;
  const players =
    phase === "lobby"
      ? [...roster.keys()]
      : phase === "question"
        ? [...answers.keys()]
        : phase === "reveal"
          ? correctOrder.value
          : standings.value.map((entry) => entry.player_id);

  return {
    phase,
    question_index: currentQuestionIndex.value >= 0 ? currentQuestionIndex.value : null,
    players,
    ...(phase === "reveal" && currentQuestion.value
      ? { correct_index: currentQuestion.value.correctIndex }
      : {}),
    ...(phase === "reveal" || phase === "leaderboard" || phase === "finished"
      ? { scores: Object.fromEntries(standings.value.map((entry) => [entry.player_id, entry.score])) }
      : {}),
    // Tells a removed player's device to drop its identity.
    ...(removed.size ? { removed: [...removed] } : {}),
  };
}

/** Publishes the current snapshot. Called on every change *and* on a timer:
 * the repetition is what lets a player who missed something catch up without
 * the relay having to remember anything. */
async function broadcast() {
  // Whatever a scheduled broadcast was going to confirm is in this one.
  cancelPendingBroadcast();
  if (!pin.value || !hostToken.value || status.value === "setup") return;
  const snapshot = buildSnapshot();
  try {
    await publishState(pin.value, hostToken.value, snapshot);
    // Repeats collapse into one line, so an unchanged heartbeat costs nothing.
    debugLog("broadcast", { phase: snapshot.phase, q: snapshot.question_index, players: snapshot.players.length });
    reportBroadcast("open");
  } catch (e) {
    console.warn("Snapshot broadcast failed", e);
    reportBroadcast("reconnecting");
    scheduleBroadcast(BROADCAST_RETRY_MS);
  }
}

/** Broadcasts within `delayMs`, together with whatever else changes until
 * then. The first message of a burst starts the clock and the later ones
 * ride along, so no sender waits longer than the window. */
function scheduleBroadcast(delayMs = BROADCAST_THROTTLE_MS) {
  if (pendingBroadcast !== null) return;
  pendingBroadcast = window.setTimeout(() => void broadcast(), delayMs);
}

function cancelPendingBroadcast() {
  if (pendingBroadcast === null) return;
  clearTimeout(pendingBroadcast);
  pendingBroadcast = null;
}

/** Anyone who knows (or guesses) the pin can mint a player token and send
 * any JSON object at all, so the payload is untrusted input: only the
 * relay-attributed `player_id` can be relied on. */
function handleMessage({ player_id, payload }: IncomingMessage) {
  // Whatever is ignored is logged with the reason: that is what answers "my
  // answer didn't count".
  const ignore = (reason: string) => debugLog(`${String(payload?.type)} ignored`, { player: player_id, reason });
  if (removed.has(player_id)) return ignore("removed");
  if (payload.type === "join") {
    // The first join wins: retries, and renames from an id already seen, are
    // ignored -- a real player always re-sends the nickname it joined with.
    // Not logged: during a question a player's join stays unconfirmed, and
    // is repeated every few seconds, until its answer lands (see PlayerApp).
    if (roster.has(player_id)) return;
    // A device that cleared its session at the end and joins again would
    // otherwise be listed a second time, with no points and a last place.
    if (status.value === "finished") return ignore("quiz finished");
    if (roster.size >= MAX_PLAYERS) return ignore("roster full");
    if (typeof payload.nickname !== "string") return ignore("no nickname");
    const nickname = cleanNickname(payload.nickname, roster.values());
    if (!nickname) return ignore("unusable nickname");
    roster.set(player_id, nickname);
    if (!scores.has(player_id)) scores.set(player_id, 0);
    debugLog("join", { player: player_id, nickname });
  } else if (payload.type === "answer") {
    if (status.value !== "question" || !currentQuestion.value) return ignore(`phase ${status.value}`);
    if (payload.question_index !== currentQuestionIndex.value) {
      return ignore(`for question ${payload.question_index}, now ${currentQuestionIndex.value}`);
    }
    // Unknown senders are ignored: anyone who knows the pin can mint a token,
    // but only players the host has seen join can score.
    if (!roster.has(player_id)) return ignore("not joined");
    if (answers.has(player_id)) return ignore("already answered");
    const optionIndex = payload.option_index;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= currentQuestion.value.options.length) {
      return ignore("invalid option");
    }
    answers.set(player_id, optionIndex);
    debugLog("answer", { player: player_id, q: currentQuestionIndex.value, option: optionIndex, nth: answers.size });
  } else {
    return ignore("unknown type");
  }
  // Confirm well before the next heartbeat -- and before the sender's retry
  // timer runs out -- so it sees its own message land without re-sending.
  scheduleBroadcast();
}

// The banner, not the raw stream events: those are logged by quizClient.
watch(connection, (state) =>
  debugLog(state === "open" ? "banner hidden" : "banner shown", {
    inbox: inboxConnection.value,
    broadcast: broadcastConnection.value,
  }),
);

// Who is who, for matching a pupil's log to this one. Kept in full rather than
// left to the "join" lines, which a long quiz may push out of the log.
watch(
  () => [pin.value, status.value, currentQuestionIndex.value, [...roster], [...scores], [...removed]],
  () =>
    setDebugContext({
      pin: pin.value,
      phase: status.value,
      question: currentQuestionIndex.value >= 0 ? currentQuestionIndex.value : null,
      questions: quiz.value?.questions.length ?? null,
      players: [...roster].map(([id, nickname]) => `${id} ${nickname} (${scores.get(id) ?? 0})`),
      removed: [...removed],
    }),
  { deep: true, immediate: true },
);

function connect(sessionPin: string, token: string) {
  unsubscribe = subscribeToMessages(sessionPin, token, handleMessage, (state) => {
    inboxConnection.value = state;
  });
  heartbeat = window.setInterval(() => void broadcast(), HEARTBEAT_MS);
}

function disconnect() {
  unsubscribe?.();
  unsubscribe = null;
  cancelPendingBroadcast();
  reportBroadcast.cancel();
  inboxConnection.value = broadcastConnection.value = "open";
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

// A running quiz only exists in this browser (the relay stores nothing at
// all), so everything needed to carry on after a reload is mirrored to
// localStorage until the host closes the quiz. That includes the final
// screen, which keeps broadcasting after a reload too.
function persistSession() {
  if (!pin.value || !hostToken.value || status.value === "setup") return;
  saveHostSession({
    pin: pin.value,
    hostToken: hostToken.value,
    quizSource: quizSource.value,
    quizSrc: quizSrc ?? undefined,
    status: status.value,
    currentQuestionIndex: currentQuestionIndex.value,
    roster: [...roster],
    scores: [...scores],
    answers: [...answers],
    correctOrder: correctOrder.value,
    removed: [...removed],
  });
}

watch(
  () => [
    pin.value,
    hostToken.value,
    status.value,
    currentQuestionIndex.value,
    correctOrder.value,
    [...roster],
    [...scores],
    [...answers],
    [...removed],
  ],
  persistSession,
  { deep: true },
);

// Restored synchronously so a reload never flashes the setup screen; the
// quiz source itself is re-parsed rather than re-validated with Typst, since
// it already compiled cleanly when the session was created.
const restored = loadHostSession();
if (restored?.hostToken) {
  try {
    quiz.value = parseQuiz(restored.quizSource);
    quizSource.value = restored.quizSource;
    if (restored.quizSrc) {
      quizSrc = restored.quizSrc;
      quizLocation = resolveSource(restored.quizSrc);
    }
    // Before the current question mounts, so its figures wait for the images.
    void loadQuizImages(restored.quizSource, quizLocation);
    pin.value = restored.pin;
    hostToken.value = restored.hostToken;
    currentQuestionIndex.value = restored.currentQuestionIndex;
    correctOrder.value = restored.correctOrder;
    for (const [playerId, nickname] of restored.roster) roster.set(playerId, nickname);
    for (const [playerId, score] of restored.scores) scores.set(playerId, score);
    for (const [playerId, optionIndex] of restored.answers) answers.set(playerId, optionIndex);
    for (const playerId of restored.removed ?? []) removed.add(playerId);
    status.value = restored.status as Status;
    addDebugSecret(restored.hostToken);
    debugLog("session restored", {
      pin: restored.pin,
      phase: restored.status,
      q: restored.currentQuestionIndex,
      players: restored.roster.length,
    });
  } catch (e) {
    debugLog("stored session unusable", { error: describeError(e) });
    quiz.value = null;
    clearHostSession();
  }
} else if (restored) {
  clearHostSession();
}

async function loadRemoteSource(src: string) {
  remoteLoading.value = true;
  try {
    const source = await fetchQuizSource(src);
    // Set before the editor changes, so the preview fetches the images.
    quizSrc = src;
    quizLocation = resolveSource(src);
    quizSource.value = source;
    remoteLoaded.value = true;
  } catch (e) {
    remoteError.value = e instanceof Error ? e.message : String(e);
    debugLog("quiz link failed", { src, error: describeError(e) });
  } finally {
    remoteLoading.value = false;
  }
}

// A session resumed after a reload keeps its own quiz; the link only fills
// the editor for a fresh start.
if (remoteSource && !hostToken.value) void loadRemoteSource(remoteSource);

// Only once the teacher has turned the sound on (hostSound.ts). The lobby is
// quiet. The tune starts with the first question, runs to the last
// leaderboard without restarting, and gives way to applause on the final
// screen. A session restored onto the final screen stays quiet: its applause
// has already been had.
watch(
  status,
  (now, before) => {
    // A leaderboard left before its animation is over takes its cheer along.
    stopCheer();
    if (now === "setup") stopSound();
    else if (now === "finished") {
      if (before !== undefined) playFinale();
    } else if (now !== "lobby") playMusic();
  },
  { immediate: true },
);

let detachSound: (() => void) | null = null;

// Nothing to recover from the relay: it never knew anything about this
// session in the first place, so resuming is just reconnecting and
// broadcasting again.
onMounted(() => {
  // After a reload the browser holds the music back until the next click.
  detachSound = attachSound();
  if (!pin.value || !hostToken.value) return;
  connect(pin.value, hostToken.value);
  void broadcast();
});

async function startQuestion(index: number) {
  if (!quiz.value || !pin.value || !hostToken.value) return;

  currentQuestionIndex.value = index;
  answers.clear();
  correctOrder.value = [];
  status.value = "question";
  debugLog("question started", { q: index, players: roster.size });
  await broadcast();
}

async function reveal() {
  if (!quiz.value || status.value !== "question") return;
  const q = quiz.value.questions[currentQuestionIndex.value];

  // Map iteration is insertion order, so this is submission order.
  correctOrder.value = [...answers.entries()]
    .filter(([, optionIndex]) => optionIndex === q.correctIndex)
    .map(([playerId]) => playerId);

  scoresBeforeReveal.value = new Map(scores);
  for (const playerId of roster.keys()) {
    const points = pointsForReveal(correctOrder.value, playerId);
    scores.set(playerId, (scores.get(playerId) ?? 0) + points);
  }

  status.value = "reveal";
  debugLog("revealed", {
    q: currentQuestionIndex.value,
    answers: answers.size,
    players: roster.size,
    correct: correctOrder.value.join(",") || "none",
  });
  await broadcast();
}

/** Takes a player out of the game, mainly for a rude nickname. Their device
 * learns it from the next snapshot and offers to join again under a new name,
 * starting from zero points. */
async function removePlayer(playerId: string) {
  const nickname = roster.get(playerId);
  if (nickname === undefined) return;
  if (!window.confirm(`«${nickname}» aus dem Quiz entfernen? Die Person kann mit einem anderen Namen neu beitreten.`)) return;
  debugLog("player removed", { player: playerId, nickname });
  removed.add(playerId);
  roster.delete(playerId);
  scores.delete(playerId);
  answers.delete(playerId);
  correctOrder.value = correctOrder.value.filter((id) => id !== playerId);
  await broadcast();
}

async function showLeaderboard() {
  debugLog("leaderboard");
  status.value = "leaderboard";
  await broadcast();
}

/** Shows the final standings. The session stays up, heartbeat included, so
 * a phone that slept through this moment still gets its final rank. */
async function finishQuiz() {
  debugLog("finished");
  status.value = "finished";
  await broadcast();
}

/** Leaves the final screen. Only now do the snapshots stop and the pin is
 * released. */
function closeQuiz() {
  if (!pin.value || !hostToken.value) return;
  const [sessionPin, token] = [pin.value, hostToken.value];
  debugLog("quiz closed", { pin: sessionPin });
  // Stopped before the release: a heartbeat arriving after it would claim
  // the pin again.
  disconnect();
  clearHostSession();
  resetToSetup();
  endSession(sessionPin, token).catch((e) => console.warn("Releasing the pin failed", e));
}

// The last question has no next round to show a leaderboard before, so it
// goes straight from reveal to the final screen.
async function afterReveal() {
  if (isLastQuestion.value) {
    await finishQuiz();
  } else {
    await showLeaderboard();
  }
}

async function nextOrFinish() {
  if (!quiz.value) return;
  if (currentQuestionIndex.value + 1 < quiz.value.questions.length) {
    await startQuestion(currentQuestionIndex.value + 1);
  } else {
    await finishQuiz();
  }
}

/** Discards all in-memory session state and returns to the quiz editor, as
 * if no session had ever been created. */
function resetToSetup() {
  status.value = "setup";
  pin.value = null;
  hostToken.value = null;
  quiz.value = null;
  currentQuestionIndex.value = -1;
  correctOrder.value = [];
  roster.clear();
  scores.clear();
  scoresBeforeReveal.value = null;
  answers.clear();
  removed.clear();
}

/** Host-initiated early abort, available any time a session is running.
 * Unlike a normal finish, this skips the leaderboard entirely and drops the
 * host straight back to the editor -- there is nothing to show a rank for. */
async function endQuizNow() {
  if (!pin.value || !hostToken.value) return;
  if (!window.confirm("Quiz jetzt beenden? Alle Spieler:innen werden entfernt.")) return;
  debugLog("quiz aborted", { pin: pin.value, phase: status.value });
  // Tells connected players the session is over so they leave their current
  // screen too, rather than just going silent on them. A snapshot still
  // scheduled must not follow it and bring the session back.
  cancelPendingBroadcast();
  await publishState(pin.value, hostToken.value, { phase: "finished", question_index: null, players: [] });
  clearHostSession();
  try {
    await endSession(pin.value, hostToken.value);
  } finally {
    disconnect();
    resetToSetup();
  }
}

onUnmounted(() => {
  clearTimeout(previewTimer);
  disconnect();
  detachSound?.();
  stopSound();
});
</script>

<template>
  <div class="host-app">
    <p v-if="connection === 'reconnecting' && status !== 'setup'" class="host-app__reconnecting">
      Verbindung wird wiederhergestellt …
    </p>

    <template v-if="status === 'setup'">
      <div class="host-app__setup">
        <div class="host-app__editor">
          <div class="host-app__editor-header">
            <h2>Quiz-Quelltext (Typst)</h2>
            <a class="host-app__docs-link" href="/docs" target="_blank" rel="noopener">Anleitung: Quiz schreiben ↗</a>
          </div>
          <p v-if="remoteSource && (remoteLoading || remoteLoaded || remoteError)" class="host-app__remote">
            <template v-if="remoteLoading">Quiz wird geladen: <code>{{ remoteSource }}</code> …</template>
            <template v-else-if="remoteLoaded">Geladen von <code>{{ remoteSource }}</code></template>
            <span v-else class="host-app__remote-error">{{ remoteError }}</span>
          </p>
          <textarea v-model="quizSource" spellcheck="false" :readonly="remoteLoading"></textarea>
          <ul v-if="loadErrors.length" class="host-app__errors">
            <li v-for="issue in loadErrors" :key="issue">{{ issue }}</li>
          </ul>
          <button
            type="button"
            class="host-app__submit"
            :disabled="creating !== null || remoteLoading"
            :aria-busy="creating !== null"
            @click="loadAndCreateSession"
          >
            <template v-if="creating">
              <span class="host-app__spinner" aria-hidden="true"></span>
              {{ creatingLabel }}
            </template>
            <template v-else>Quiz erstellen</template>
          </button>
        </div>

        <div class="host-app__preview">
          <h2>Vorschau</h2>
          <div class="host-app__preview-list">
            <ul v-if="previewErrors.length" class="host-app__errors">
              <li v-for="issue in previewErrors" :key="issue">{{ issue }}</li>
            </ul>
            <template v-else-if="previewQuiz">
              <section
                v-for="(question, i) in previewQuiz.questions"
                :key="question.id"
                class="host-app__preview-item"
              >
                <h3>Frage {{ i + 1 }} von {{ previewQuiz.questions.length }}</h3>
                <ScreenFrame>
                  <div class="host-app__preview-screen">
                    <QuestionCard :question="question" :reveal-correct="true" />
                  </div>
                </ScreenFrame>
              </section>
            </template>
          </div>
        </div>
      </div>
      <AppFooter />
    </template>

    <template v-else-if="status === 'lobby' && pin">
      <div class="host-app__panel">
        <HostLobby
          :pin="pin"
          :players="lobbyPlayers"
          @start="startQuestion(0)"
          @end="endQuizNow"
          @remove="removePlayer"
        />
      </div>
    </template>

    <template v-else-if="status === 'question' && currentQuestion">
      <QuestionCard :question="currentQuestion" :reveal-correct="false" />
      <button type="button" @click="reveal">{{ answerButtonLabel }}</button>
      <div class="host-app__footer">
        <span class="host-app__progress">{{ questionProgress }}</span>
        <SoundToggle />
        <button type="button" class="host-app__end" @click="endQuizNow">Quiz abbrechen</button>
      </div>
    </template>

    <template v-else-if="status === 'reveal' && currentQuestion">
      <QuestionCard :question="currentQuestion" :reveal-correct="true" :counts="countsArray" />
      <button type="button" @click="afterReveal">{{ isLastQuestion ? "Endergebnis anzeigen" : "Rangliste anzeigen" }}</button>
      <div class="host-app__footer">
        <span class="host-app__progress">{{ questionProgress }}</span>
        <SoundToggle />
        <button type="button" class="host-app__end" @click="endQuizNow">Quiz abbrechen</button>
      </div>
    </template>

    <template v-else-if="status === 'leaderboard'">
      <div class="host-app__panel">
        <HostLeaderboard
          :standings="standings"
          :previous="previousStandings"
          :finished="false"
          @celebrate="playCheer"
          @settled="settleCheer"
        />
      </div>
      <button type="button" @click="nextOrFinish">{{ isLastQuestion ? "Endergebnis anzeigen" : "Nächste Frage" }}</button>
      <div class="host-app__footer">
        <span class="host-app__progress">{{ questionProgress }}</span>
        <SoundToggle />
        <button type="button" class="host-app__end" @click="endQuizNow">Quiz abbrechen</button>
      </div>
    </template>

    <template v-else-if="status === 'finished'">
      <div class="host-app__panel">
        <HostLeaderboard :standings="standings" :previous="previousStandings" :finished="true" />
      </div>
      <button type="button" @click="closeQuiz">Quiz beenden</button>
      <div class="host-app__footer">
        <span class="host-app__progress">{{ questionProgress }}</span>
        <SoundToggle />
        <DebugExport role="host" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.host-app {
  width: 100%;
  height: 100dvh;
  margin: 0;
  padding: 1rem 1rem 0rem 1rem;
  box-sizing: border-box;
  text-align: left;
  display: flex;
  flex-direction: column;
}
.host-app__panel {
  width: 100%;
  max-width: 800px;
  flex: 1;
  min-height: 0;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}
.host-app__reconnecting {
  margin: 0 0 0.5rem;
  padding: 0.4rem 0.75rem;
  background: #b8860b;
  color: #fff;
  font-weight: 600;
  border-radius: 4px;
}
.host-app__end {
  padding: 0.2rem 0.4rem;
  background: none;
  border: none;
  color: #888;
  font-size: 0.8rem;
  line-height: 1.2;
  text-decoration: underline;
  min-height: 1rem;
}
.host-app__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 0.4rem;
}
.host-app__progress {
  margin-right: auto;
  padding: 0.2rem 0.4rem;
  color: #888;
  font-size: 0.8rem;
  line-height: 1.2;
}
.host-app__setup {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.5rem;
  flex: 1;
  min-height: 0;
}
.host-app__editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.host-app__editor-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.host-app__docs-link {
  font-size: 0.9rem;
  white-space: nowrap;
}
.host-app__remote {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  color: #888;
  overflow-wrap: anywhere;
}
.host-app__remote-error {
  color: #b00020;
}
.host-app__submit {
  margin-top: 0.75rem;
}
.host-app__spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 0.5em;
  vertical-align: -0.15em;
  border: 0.15em solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: host-app-spin 0.8s linear infinite;
}
@keyframes host-app-spin {
  to {
    transform: rotate(360deg);
  }
}
.host-app__preview {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.host-app__preview-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.host-app__preview-item {
  margin-bottom: 1.5rem;
}
/* Mirrors `.host-app`'s own layout so the framed preview matches the real
   host screen exactly. */
.host-app__preview-screen {
  width: 100%;
  height: 100%;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.host-app textarea {
  width: 100%;
  flex: 1;
  min-height: 0;
  resize: none;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  box-sizing: border-box;
}
.host-app__errors {
  color: #b00020;
}
</style>
