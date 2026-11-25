<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import {
  createSession,
  endSession,
  publishState,
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
import { acquireHostLock, type HostLock } from "../api/hostLock";
import { clearHostSession, loadHostSession, saveHostSession } from "../api/storedSession";
import { addDebugSecret, debugLog, describeError, setDebugContext, startDebugLog } from "../debug/debugLog";
import { QuizParseError } from "../quiz/errors";
import {
  afterReveal,
  answerCounts,
  buildSnapshot,
  currentQuestion,
  fromStored,
  isLastQuestion,
  isRevealed,
  mergePlayer,
  newGame,
  nextQuestion,
  playerRows,
  questionIndex,
  receive,
  removePlayer,
  reveal,
  standings,
  toStored,
  type Game,
} from "../quiz/hostGame";
import { OPTION_LABELS } from "../quiz/optionStyle";
import { parseQuiz } from "../quiz/parseQuiz";
import { fetchQuizSource, resolveSource, type SourceLocation } from "../quiz/remoteSource";
import { MINIMAL_QUIZ } from "../quiz/sampleQuiz";
import { loadQuizImages, renderTypst } from "../quiz/typst";
import type { ParsedQuiz } from "../quiz/types";
import { attachSound, playCheer, playFinale, playMusic, settleCheer, stopCheer, stopSound } from "../sound/hostSound";
import AppFooter from "./AppFooter.vue";
import DebugExport from "./DebugExport.vue";
import HostLeaderboard from "./HostLeaderboard.vue";
import HostLobby from "./HostLobby.vue";
import HostPlayers from "./HostPlayers.vue";
import QuestionCard from "./QuestionCard.vue";
import ScreenFrame from "./ScreenFrame.vue";
import SoundToggle from "./SoundToggle.vue";
import TypstEditor from "./TypstEditor.vue";

const PREVIEW_DEBOUNCE_MS = 300;
// Player messages arrive in bursts (a class joining, everyone answering), and
// each snapshot goes out to every player: one per message would be quadratic.
// All messages within this window are confirmed by a single snapshot instead.
const BROADCAST_THROTTLE_MS = 500;
// A failed broadcast is repeated this soon rather than at the next heartbeat,
// so a single lost request heals before it is worth a banner.
const BROADCAST_RETRY_MS = 1000;
// After the inbox comes back, answers sent while it was down still have to
// arrive: players re-send every 2 s until they see their answer land
// (PlayerApp's RETRY_MS). Until then a reveal would miss them.
const SETTLE_AFTER_RECONNECT_MS = 3000;
// A broadcast that takes this long has not failed yet, but the connection
// that carries the answers is in trouble too.
const SLOW_BROADCAST_MS = 2000;
// Below this share of the class having answered, a reveal asks first: a click
// that early is more likely a slip than a decision.
const REVEAL_CONFIRM_SHARE = 0.8;

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

// Separate from the game so a half-typed draft in the editor never disturbs
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
// The quiz being hosted (hostGame.ts); null while the editor is showing.
const game = ref<Game | null>(null);
const status = computed<Status>(() => game.value?.round.phase ?? "setup");
// Inbox and broadcasts fail independently, and either one is worth a banner:
// a successful broadcast says nothing about whether messages still arrive.
const inboxConnection = ref<ConnectionStatus>("open");
const broadcastConnection = ref<ConnectionStatus>("open");
const connection = computed<ConnectionStatus>(() =>
  inboxConnection.value === "open" && broadcastConnection.value === "open" ? "open" : "reconnecting",
);
const reportInbox = reportAfterGrace((state) => {
  inboxConnection.value = state;
});
const reportBroadcast = reportAfterGrace((state) => {
  broadcastConnection.value = state;
});
// The same two as they are right now, without the banner's grace period:
// the reveal must not wait five seconds to learn that answers cannot arrive.
const inboxLive = ref<ConnectionStatus>("open");
const broadcastLive = ref<ConnectionStatus>("open");
// Only the inbox's recovery counts: answers come in through it alone, so a
// broadcast that failed and recovered (during a leaderboard, say) has lost
// none of them.
const inboxReconnectedAt = ref(0);
// When this page started the current question. An inbox that recovered
// before then has lost none of its answers, which cannot be sent before it.
// 0 after a reload, which leaves every recovery counting.
const questionStartedAt = ref(0);
// When the broadcast now under way started, if one is.
const broadcastStartedAt = ref<number | null>(null);
// Ticks while a session runs, so the "connection" state below follows time.
const clock = ref(Date.now());
let clockTimer: number | null = null;

function setInboxLive(state: ConnectionStatus) {
  if (state === "open" && inboxLive.value !== "open") inboxReconnectedAt.value = Date.now();
  inboxLive.value = state;
  reportInbox(state);
}

function setBroadcastLive(state: ConnectionStatus) {
  broadcastLive.value = state;
  reportBroadcast(state);
}

/** Whether answers on their way may not reach this page right now: a stream
 * or a broadcast is failing or stuck, or the inbox only just recovered while
 * the current question was open. */
function connectionTroubleAt(now: number): boolean {
  return (
    inboxLive.value !== "open" ||
    broadcastLive.value !== "open" ||
    (inboxReconnectedAt.value > questionStartedAt.value &&
      now - inboxReconnectedAt.value < SETTLE_AFTER_RECONNECT_MS) ||
    (broadcastStartedAt.value !== null && now - broadcastStartedAt.value > SLOW_BROADCAST_MS)
  );
}
const connectionTrouble = computed(() => connectionTroubleAt(clock.value));
// The relay refused the host token: it has expired, a day after the quiz was
// created, or the pin has gone to another session. Retrying cannot change
// that, but a reload tries again, so a false alarm costs little.
const sessionRefused = ref(false);
// Only one tab hosts a quiz (hostLock.ts). This one stays silent, neither
// broadcasting nor storing anything, until it knows that it is that tab.
let hostsHere = true;
let hostLock: HostLock | null = null;
const otherTabHosts = ref(false);

// The page load each player's latest join came from (PlayerMessage `visit`),
// for the log only. Not stored: after a reload of this page, a pupil whose
// join is still being re-sent gets one line too many, nothing worse.
const visits = new Map<string, number>();
// The teacher's list of all players (HostPlayers.vue).
const playersOpen = ref(false);

let unsubscribe: (() => void) | null = null;
let heartbeat: number | null = null;
let pendingBroadcast: number | null = null;
// The broadcast under way, if any. There is only ever one: on a stalled
// connection, more would pile up and then all arrive at once, the oldest last.
let broadcasting: AbortController | null = null;
let broadcastAgain = false;
// The number of the latest snapshot (SessionSnapshot.seq). Based on the clock,
// so that it keeps growing across a reload of this page, and on the previous
// number, so that it does so even if the clock is set back.
let lastSeq = 0;

function nextSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Date.now());
  return lastSeq;
}

const playerCount = computed(() => game.value?.roster.size ?? 0);
const lobbyPlayers = computed(() =>
  [...(game.value?.roster ?? [])].map(([player_id, nickname]) => ({ player_id, nickname })),
);
const question = computed(() => game.value && currentQuestion(game.value));
const counts = computed(() => (game.value ? answerCounts(game.value) : []));
const answeredCount = computed(() => {
  const round = game.value?.round;
  return round?.phase === "question" ? round.answers.size : 0;
});

const allAnswered = computed(() => playerCount.value > 0 && answeredCount.value >= playerCount.value);
// Answers still on their way could be lost by revealing now.
const revealAtRisk = computed(() => connectionTrouble.value && !allAnswered.value);

const answerButtonLabel = computed(() =>
  allAnswered.value
    ? "Alle haben geantwortet — Antwort zeigen"
    : `Antwort zeigen · ${answeredCount.value} von ${playerCount.value} beantwortet` +
      (revealAtRisk.value ? " · Verbindung unterbrochen" : ""),
);

const players = computed(() => (game.value ? playerRows(game.value) : []));
const onLastQuestion = computed(() => !!game.value && isLastQuestion(game.value));

const questionProgress = computed(() => {
  const current = game.value;
  return current && questionIndex(current) >= 0
    ? `${questionIndex(current) + 1} / ${current.quiz.questions.length}`
    : "";
});

const ranking = computed(() => (game.value ? standings(game.value) : []));
// What the question just revealed changed, for the leaderboard to show.
const previousRanking = computed(() => {
  const current = game.value;
  if (!current || !isRevealed(current.round) || !current.round.scoresBefore) return null;
  return standings(current, current.round.scoresBefore);
});

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
  let quiz: ParsedQuiz;
  try {
    quiz = parseQuiz(quizSource.value);
  } catch (e) {
    loadErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
    debugLog("quiz rejected", { issues: loadErrors.value.length, first: loadErrors.value[0] });
    return;
  }

  creating.value = "validating";
  // The preview may not have caught up with the last edit yet.
  await loadQuizImages(quizSource.value, quizLocation);
  const typstErrors = await compileAllTypstSnippets(quiz);
  if (typstErrors.length) {
    creating.value = null;
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
    loadErrors.value = [createSessionErrorMessage(e)];
    debugLog("session not created", { error: describeError(e) });
    return;
  }
  addDebugSecret(created.hostToken);
  debugLog("session created", { pin: created.pin, questions: quiz.questions.length });
  creating.value = null;
  pin.value = created.pin;
  hostToken.value = created.hostToken;
  game.value = newGame(quiz);

  // A pin just handed out: nobody else can hold it.
  void acquireHostLock(created.pin, onTabLost).then((lock) => (hostLock = lock));
  connect(created.pin, created.hostToken);
  await broadcast();
}

/** Publishes the current snapshot. Called on every change *and* on a timer:
 * the repetition is what lets a player who missed something catch up without
 * the relay having to remember anything. */
async function broadcast() {
  // Whatever a scheduled broadcast was going to confirm is in this one.
  cancelPendingBroadcast();
  if (!pin.value || !hostToken.value || !game.value || sessionRefused.value || !hostsHere) return;
  // A change made meanwhile goes out as soon as this broadcast is done, in
  // the snapshot built then.
  if (broadcasting) {
    broadcastAgain = true;
    return;
  }
  const controller = new AbortController();
  broadcasting = controller;
  broadcastStartedAt.value = Date.now();
  const snapshot = { ...buildSnapshot(game.value), seq: nextSeq() };
  try {
    await publishState(pin.value, hostToken.value, snapshot, controller.signal);
    // Repeats collapse into one line, so an unchanged heartbeat costs nothing.
    debugLog("broadcast", { phase: snapshot.phase, q: snapshot.question_index, players: snapshot.players.length });
    setBroadcastLive("open");
  } catch (e) {
    // Canceled because the session is over: nothing to retry.
    if (controller.signal.aborted) return;
    if (e instanceof RelayError && e.status === 403) {
      stopAfterRefusal();
      return;
    }
    console.warn("Snapshot broadcast failed", e);
    setBroadcastLive("reconnecting");
    scheduleBroadcast(BROADCAST_RETRY_MS);
  } finally {
    if (broadcasting === controller) {
      broadcasting = null;
      broadcastStartedAt.value = null;
    }
  }
  if (broadcastAgain) {
    broadcastAgain = false;
    void broadcast();
  }
}

/** Drops the broadcast under way, so that it cannot arrive after whatever
 * comes next -- the end of the session, say. */
function cancelBroadcast() {
  broadcasting?.abort();
  broadcasting = null;
  broadcastStartedAt.value = null;
  broadcastAgain = false;
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

/** A player's message: hostGame.ts decides what becomes of it, this logs it
 * and confirms it to the players. */
function handleMessage({ player_id, payload }: IncomingMessage) {
  if (!game.value) return;
  const received = receive(game.value, player_id, payload);
  // Whatever is ignored is logged with the reason: that is what answers "my
  // answer didn't count". For an answer, also what it was, so a late one can
  // be told right from wrong -- numbers only, the payload is untrusted.
  if (typeof received === "object") {
    const loggable = (value: unknown) => (typeof value === "number" ? value : typeof value);
    debugLog(`${String(payload?.type)} ignored`, {
      player: player_id,
      reason: received.ignored,
      ...(payload?.type === "answer"
        ? { q: loggable(payload.question_index), option: loggable(payload.option_index) }
        : {}),
    });
    return;
  }
  if (payload.type === "join") {
    const cameBack = typeof payload.visit === "number" && visits.get(player_id) !== payload.visit;
    if (typeof payload.visit === "number") visits.set(player_id, payload.visit);
    if (received === "repeat") {
      // Logged once per page load rather than per join: during a question a
      // join stays unconfirmed, and is repeated every few seconds, until the
      // player's answer lands (see PlayerApp). Nothing to confirm either.
      if (cameBack) debugLog("rejoin", { player: player_id });
      return;
    }
    debugLog("join", { player: player_id });
  } else {
    debugLog("answer", {
      player: player_id,
      q: payload.question_index,
      option: payload.option_index,
      nth: answeredCount.value,
    });
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
watchEffect(() => {
  const current = game.value;
  setDebugContext({
    pin: pin.value,
    phase: status.value,
    question: current && questionIndex(current) >= 0 ? questionIndex(current) : null,
    questions: current?.quiz.questions.length ?? null,
    players: current ? [...current.roster.keys()].map((id) => `${id} (${current.scores.get(id) ?? 0})`) : [],
    removed: current ? [...current.removed] : [],
  });
});

function connect(sessionPin: string, token: string) {
  // Not connected until the stream says so. Its first opening counts as a
  // recovery: after a reload, answers sent meanwhile still have to arrive.
  inboxLive.value = "reconnecting";
  unsubscribe = subscribeToMessages(sessionPin, token, handleMessage, setInboxLive, stopAfterRefusal);
  heartbeat = window.setInterval(() => void broadcast(), HEARTBEAT_MS);
  clockTimer = window.setInterval(() => (clock.value = Date.now()), 500);
}

function stopAfterRefusal() {
  if (sessionRefused.value) return;
  debugLog("session refused", { pin: pin.value });
  sessionRefused.value = true;
  disconnect();
}

function disconnect() {
  unsubscribe?.();
  unsubscribe = null;
  cancelPendingBroadcast();
  cancelBroadcast();
  reportInbox.cancel();
  reportBroadcast.cancel();
  inboxConnection.value = broadcastConnection.value = "open";
  inboxLive.value = broadcastLive.value = "open";
  inboxReconnectedAt.value = 0;
  questionStartedAt.value = 0;
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (clockTimer !== null) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

// A running quiz only exists in this browser (the relay stores nothing at
// all), so everything needed to carry on after a reload is mirrored to
// localStorage until the host closes the quiz. That includes the final
// screen, which keeps broadcasting after a reload too.
function persistSession() {
  if (!pin.value || !hostToken.value || !game.value || !hostsHere) return;
  saveHostSession({
    pin: pin.value,
    hostToken: hostToken.value,
    quizSource: quizSource.value,
    quizSrc: quizSrc ?? undefined,
    ...toStored(game.value),
    seq: lastSeq,
  });
}

watch(() => game.value && toStored(game.value), persistSession);

// Restored synchronously so a reload never flashes the setup screen; the
// quiz source itself is re-parsed rather than re-validated with Typst, since
// it already compiled cleanly when the session was created.
const restored = loadHostSession();
if (restored?.hostToken) {
  try {
    const restoredGame = fromStored(parseQuiz(restored.quizSource), restored);
    const restoredLocation = restored.quizSrc ? resolveSource(restored.quizSrc) : null;
    quizSource.value = restored.quizSource;
    if (restored.quizSrc) {
      quizSrc = restored.quizSrc;
      quizLocation = restoredLocation;
    }
    // Before the current question mounts, so its figures wait for the images.
    void loadQuizImages(restored.quizSource, quizLocation);
    pin.value = restored.pin;
    hostToken.value = restored.hostToken;
    lastSeq = restored.seq ?? 0;
    game.value = restoredGame;
    hostsHere = false;
    addDebugSecret(restored.hostToken);
    debugLog("session restored", {
      pin: restored.pin,
      phase: restored.status,
      q: restored.currentQuestionIndex,
      players: restored.roster.length,
    });
  } catch (e) {
    debugLog("stored session unusable", { error: describeError(e) });
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
  void hostInThisTab(pin.value, hostToken.value);
});

/** Carries on with a restored session, unless another tab is hosting it. */
async function hostInThisTab(sessionPin: string, token: string) {
  const lock = await acquireHostLock(sessionPin, onTabLost);
  if (!lock) {
    debugLog("quiz open in another tab", { pin: sessionPin });
    otherTabHosts.value = true;
    stopSound();
    return;
  }
  hostLock = lock;
  hostsHere = true;
  persistSession();
  connect(sessionPin, token);
  void broadcast();
}

/** Another tab has taken the quiz over, so this one stops at once. */
function onTabLost() {
  debugLog("quiz taken over by another tab", { pin: pin.value });
  hostsHere = false;
  otherTabHosts.value = true;
  playersOpen.value = false;
  disconnect();
  stopSound();
}

/** The state to carry on from is what the other tab stored last, so this page
 * is loaded anew once the other tab has stopped. */
async function takeOverHere() {
  if (!pin.value) return;
  debugLog("taking the quiz over", { pin: pin.value });
  await acquireHostLock(pin.value, () => {}, true);
  location.reload();
}

/** "Frage starten" and "Nächste Frage". */
async function startNextQuestion() {
  const current = game.value;
  if (!current || !nextQuestion(current)) return;
  if (current.round.phase === "question") {
    questionStartedAt.value = Date.now();
    debugLog("question started", { q: current.round.index, players: current.roster.size });
  } else {
    debugLog("finished");
  }
  await broadcast();
}

/** "Antwort zeigen". */
async function revealAnswer() {
  const current = game.value;
  if (!current || !mayReveal(current) || !reveal(current)) return;
  const { round } = current;
  if (isRevealed(round)) {
    debugLog("revealed", {
      q: round.index,
      answers: round.answers.size,
      players: current.roster.size,
      correct: round.correctOrder.join(",") || "none",
    });
  }
  await broadcast();
}

/** Whether to go ahead with a reveal: at once when everyone has answered;
 * before that, only once the teacher has confirmed it while answers cannot
 * reach this page, or while few of them are in. */
function mayReveal(current: Game): boolean {
  if (current.round.phase !== "question") return false;
  const answered = current.round.answers.size;
  const joined = current.roster.size;
  const everyone = joined > 0 && answered >= joined;
  // While answers cannot reach this page, revealing would score the ones
  // still on their way as no answer at all. It stays the teacher's call.
  if (!everyone && connectionTroubleAt(Date.now())) {
    const go = window.confirm(
      "Die Verbindung ist gerade unterbrochen. Antworten, die noch unterwegs sind, würden nicht mehr gezählt. Trotzdem die Antwort zeigen?",
    );
    debugLog("reveal during connection trouble", {
      confirmed: go,
      inbox: inboxLive.value,
      broadcast: broadcastLive.value,
    });
    return go;
  }
  if (answered < REVEAL_CONFIRM_SHARE * joined) {
    const go = window.confirm(`Erst ${answered} von ${joined} haben geantwortet. Trotzdem die Antwort zeigen?`);
    debugLog("early reveal", { confirmed: go, answers: answered, players: joined });
    return go;
  }
  return true;
}

/** "Rangliste anzeigen", or "Endergebnis anzeigen" after the last question. */
async function showStandings() {
  const current = game.value;
  if (!current || !afterReveal(current)) return;
  // Shows the final standings. The session stays up, heartbeat included, so
  // a phone that slept through this moment still gets its final rank.
  debugLog(current.round.phase === "finished" ? "finished" : "leaderboard");
  await broadcast();
}

/** Takes a player out of the game, mainly for a rude nickname. */
async function confirmRemove(playerId: string) {
  const current = game.value;
  const nickname = current?.roster.get(playerId);
  if (!current || nickname === undefined) return;
  if (!window.confirm(`«${nickname}» aus dem Quiz entfernen? Die Person kann mit einem anderen Namen neu beitreten.`)) return;
  debugLog("player removed", { player: playerId });
  removePlayer(current, playerId);
  await broadcast();
}

/** Folds a duplicate entry into the one its pupil plays on now. */
async function confirmMerge(sourceId: string, targetId: string) {
  const current = game.value;
  const source = current?.roster.get(sourceId);
  const target = current?.roster.get(targetId);
  if (!current || source === undefined || target === undefined || sourceId === targetId) return;
  const points = current.scores.get(sourceId) ?? 0;
  if (
    !window.confirm(
      `«${source}» mit «${target}» zusammenführen? «${target}» erhält die ${points} Punkte von «${source}», und «${source}» wird entfernt.`,
    )
  )
    return;
  debugLog("players merged", { from: sourceId, into: targetId, points });
  mergePlayer(current, sourceId, targetId);
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

/** Discards all in-memory session state and returns to the quiz editor, as
 * if no session had ever been created. */
function resetToSetup() {
  game.value = null;
  pin.value = null;
  hostToken.value = null;
  visits.clear();
  playersOpen.value = false;
  sessionRefused.value = false;
  hostLock?.release();
  hostLock = null;
}

/** Host-initiated early abort, available any time a session is running.
 * Unlike a normal finish, this skips the leaderboard entirely and drops the
 * host straight back to the editor -- there is nothing to show a rank for. */
function endQuizNow() {
  if (!pin.value || !hostToken.value) return;
  const refused = sessionRefused.value;
  const unreachable = refused || connectionTroubleAt(Date.now());
  const question =
    "Quiz jetzt beenden? Alle Spieler:innen werden entfernt." +
    (unreachable ? " Die Verbindung ist gerade unterbrochen, darum erfahren sie vielleicht nichts davon." : "");
  // Confirm canceling as soon as players started to join
  if (playerCount.value > 0 && !window.confirm(question)) return;
  debugLog("quiz aborted", { pin: pin.value, phase: status.value, unreachable });
  const [sessionPin, token] = [pin.value, hostToken.value];
  const farewell: SessionSnapshot = { phase: "finished", question_index: null, players: [], seq: nextSeq() };
  // All of this comes first: a connection that is down must not keep the
  // teacher in the quiz, and with the heartbeat stopped, no snapshot can
  // follow the farewell and bring the session back.
  disconnect();
  clearHostSession();
  resetToSetup();
  // A refused token would be refused again.
  if (!refused) void sayFarewell(sessionPin, token, farewell);
}

/** Tells connected players the session is over so they leave their current
 * screen too, then releases the pin -- in that order, as a snapshot arriving
 * after the release would claim the pin again. Best effort: a pupil this does
 * not reach is told that the teacher has no connection, and a pin the relay
 * never hears about expires by itself. */
async function sayFarewell(sessionPin: string, token: string, farewell: SessionSnapshot) {
  try {
    await publishState(sessionPin, token, farewell);
  } catch (e) {
    debugLog("farewell failed", { error: describeError(e) });
  }
  await endSession(sessionPin, token).catch((e) => console.warn("Releasing the pin failed", e));
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
    <p v-if="sessionRefused && status !== 'setup'" class="host-app__reconnecting host-app__session-refused">
      Diese Sitzung ist nicht mehr gültig, die Spieler:innen sehen nichts mehr davon. Beende das Quiz und erstelle es
      neu.
    </p>
    <p v-else-if="connection === 'reconnecting' && status !== 'setup'" class="host-app__reconnecting">
      Verbindung wird wiederhergestellt …
    </p>

    <template v-if="otherTabHosts">
      <div class="host-app__panel">
        <h2>Dieses Quiz läuft bereits in einem anderen Tab.</h2>
        <p>Schließe diesen Tab, oder führe das Quiz hier weiter. Der andere Tab hält dann an.</p>
        <button type="button" @click="takeOverHere">Hier übernehmen</button>
      </div>
    </template>

    <template v-else-if="status === 'setup'">
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
          <TypstEditor v-model="quizSource" class="host-app__source" :readonly="remoteLoading" />
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
          @start="startNextQuestion"
          @end="endQuizNow"
          @remove="confirmRemove"
        />
      </div>
    </template>

    <template v-else-if="status === 'question' && question">
      <QuestionCard :question="question" :reveal-correct="false" />
      <button type="button" :class="{ 'host-app__reveal--at-risk': revealAtRisk }" @click="revealAnswer">
        {{ answerButtonLabel }}
      </button>
      <div class="host-app__footer">
        <div class="host-app__footer-side">
          <SoundToggle />
          <button type="button" class="host-app__end" @click="playersOpen = true">Spieler:innen ({{ playerCount }})</button>
        </div>
        <span class="host-app__progress">{{ questionProgress }}</span>
        <div class="host-app__footer-side host-app__footer-side--end">
          <button type="button" class="host-app__end" @click="endQuizNow">Quiz abbrechen</button>
        </div>
      </div>
    </template>

    <template v-else-if="status === 'reveal' && question">
      <QuestionCard :question="question" :reveal-correct="true" :counts="counts" />
      <button type="button" @click="showStandings">{{ onLastQuestion ? "Endergebnis anzeigen" : "Rangliste anzeigen" }}</button>
      <div class="host-app__footer">
        <div class="host-app__footer-side">
          <SoundToggle />
          <button type="button" class="host-app__end" @click="playersOpen = true">Spieler:innen ({{ playerCount }})</button>
        </div>
        <span class="host-app__progress">{{ questionProgress }}</span>
        <div class="host-app__footer-side host-app__footer-side--end">
          <button type="button" class="host-app__end" @click="endQuizNow">Quiz abbrechen</button>
        </div>
      </div>
    </template>

    <template v-else-if="status === 'leaderboard'">
      <div class="host-app__panel">
        <HostLeaderboard
          :standings="ranking"
          :previous="previousRanking"
          :finished="false"
          @celebrate="playCheer"
          @settled="settleCheer"
        />
      </div>
      <button type="button" @click="startNextQuestion">{{ onLastQuestion ? "Endergebnis anzeigen" : "Nächste Frage" }}</button>
      <div class="host-app__footer">
        <div class="host-app__footer-side">
          <SoundToggle />
          <button type="button" class="host-app__end" @click="playersOpen = true">Spieler:innen ({{ playerCount }})</button>
        </div>
        <span class="host-app__progress">{{ questionProgress }}</span>
        <div class="host-app__footer-side host-app__footer-side--end">
          <button type="button" class="host-app__end" @click="endQuizNow">Quiz abbrechen</button>
        </div>
      </div>
    </template>

    <template v-else-if="status === 'finished'">
      <div class="host-app__panel">
        <HostLeaderboard :standings="ranking" :previous="previousRanking" :finished="true" />
      </div>
      <button type="button" @click="closeQuiz">Quiz beenden</button>
      <div class="host-app__footer">
        <div class="host-app__footer-side">
          <SoundToggle />
          <button type="button" class="host-app__end" @click="playersOpen = true">Spieler:innen ({{ playerCount }})</button>
        </div>
        <span class="host-app__progress">{{ questionProgress }}</span>
        <div class="host-app__footer-side host-app__footer-side--end">
          <DebugExport role="host" />
        </div>
      </div>
    </template>

    <HostPlayers
      v-if="
        playersOpen &&
        (status === 'question' || status === 'reveal' || status === 'leaderboard' || status === 'finished')
      "
      :players="players"
      @close="playersOpen = false"
      @remove="confirmRemove"
      @merge="confirmMerge"
    />
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
.host-app__reveal--at-risk {
  background: #b8860b;
  color: #fff;
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
/* Three columns -- controls left, question counter centered, "Quiz
   abbrechen" right -- with equal side columns so the counter stays centered
   on the screen whatever the sides hold. */
.host-app__footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  margin-top: 0.4rem;
}
.host-app__footer-side {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.host-app__footer-side--end {
  justify-content: flex-end;
}
.host-app__progress {
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
.host-app__source {
  flex: 1;
  min-height: 0;
}
.host-app__errors {
  color: #b00020;
}
</style>
