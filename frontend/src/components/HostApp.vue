<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import { answersAtRisk, IDLE_LINK, openHostLink, type HostLink, type LinkStatus } from "../api/hostLink";
import { acquireHostLock, type HostLock } from "../api/hostLock";
import type { HostCredentials, IncomingMessage, Phase, SessionSnapshot } from "../api/quizClient";
import { clearHostSession, loadHostSession, saveHostSession } from "../api/storedSession";
import { addDebugSecret, debugLog, describeError, setDebugContext, startDebugLog } from "../debug/debugLog";
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
import { parseQuiz } from "../quiz/parseQuiz";
import { resolveSource } from "../quiz/remoteSource";
import { loadQuizImages } from "../quiz/typst";
import type { ParsedQuiz } from "../quiz/types";
import { attachSound, playCheer, playFinale, playMusic, settleCheer, stopCheer, stopSound } from "../sound/hostSound";
import DebugExport from "./DebugExport.vue";
import HostLeaderboard from "./HostLeaderboard.vue";
import HostLobby from "./HostLobby.vue";
import HostPlayers from "./HostPlayers.vue";
import HostSetup from "./HostSetup.vue";
import QuestionCard from "./QuestionCard.vue";
import SoundToggle from "./SoundToggle.vue";

// Below this share of the class having answered, a reveal asks first: a click
// that early is more likely a slip than a decision.
const REVEAL_CONFIRM_SHARE = 0.8;

// "setup" is the only state with no session behind it; every other value is
// exactly the phase players are told about.
type Status = "setup" | Phase;

startDebugLog("host");

// The quiz source in the editor (HostSetup.vue), and the `?src=` link it came
// from, if it did. Both are stored with a running session, and come back with
// it after a reload.
const quizSource = ref("");
const quizSrc = ref<string | null>(null);

const pin = ref<string | null>(null);
const hostToken = ref<string | null>(null);
// The quiz being hosted (hostGame.ts); null while the editor is showing.
const game = ref<Game | null>(null);
const status = computed<Status>(() => game.value?.round.phase ?? "setup");
// The connection to the relay while this tab hosts the quiz (hostLink.ts).
// Only one tab hosts a quiz (hostLock.ts): any other stays silent, neither
// broadcasting nor storing anything, so it has no link.
let link: HostLink | null = null;
let hostLock: HostLock | null = null;
const linkStatus = ref<LinkStatus>({ ...IDLE_LINK });
const otherTabHosts = ref(false);
// The number of the latest snapshot sent before this page was reloaded.
let restoredSeq = 0;
// When this page started the current question. An inbox that recovered
// before then has lost none of its answers, which cannot be sent before it.
// 0 after a reload, which leaves every recovery counting.
const questionStartedAt = ref(0);

// The page load each player's latest join came from (PlayerMessage `visit`),
// for the log only. Not stored: after a reload of this page, a pupil whose
// join is still being re-sent gets one line too many, nothing worse.
const visits = new Map<string, number>();
// The teacher's list of all players (HostPlayers.vue).
const playersOpen = ref(false);

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
const revealAtRisk = computed(
  () => answersAtRisk(linkStatus.value, questionStartedAt.value) && !allAnswered.value,
);

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

/** A quiz the editor has checked and created a session for: its lobby opens. */
function hostNewQuiz(quiz: ParsedQuiz, credentials: HostCredentials) {
  pin.value = credentials.pin;
  hostToken.value = credentials.hostToken;
  game.value = newGame(quiz);
  // A pin just handed out: nobody else can hold it.
  void acquireHostLock(credentials.pin, onTabLost).then((lock) => (hostLock = lock));
  startHosting(game.value, credentials);
}

/** Opens the link for `hosted`, which broadcasts it from now on and hands it
 * what its players send. */
function startHosting(hosted: Game, credentials: HostCredentials, seq?: number) {
  link = openHostLink({
    ...credentials,
    seq,
    snapshot: () => buildSnapshot(hosted),
    onMessage: (message) => handleMessage(hosted, message),
    onStatus: (next) => (linkStatus.value = next),
  });
}

/** A player's message: hostGame.ts decides what becomes of it, this logs it
 * and confirms it to the players. */
function handleMessage(hosted: Game, { player_id, payload }: IncomingMessage) {
  const received = receive(hosted, player_id, payload);
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
  link?.broadcastSoon();
}

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

// A running quiz only exists in this browser (the relay stores nothing at
// all), so everything needed to carry on after a reload is mirrored to
// localStorage until the host closes the quiz. That includes the final
// screen, which keeps broadcasting after a reload too.
function persistSession() {
  if (!pin.value || !hostToken.value || !game.value || !link) return;
  saveHostSession({
    pin: pin.value,
    hostToken: hostToken.value,
    quizSource: quizSource.value,
    quizSrc: quizSrc.value ?? undefined,
    ...toStored(game.value),
    seq: link.seq,
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
    quizSrc.value = restored.quizSrc ?? null;
    // Before the current question mounts, so its figures wait for the images.
    void loadQuizImages(restored.quizSource, restoredLocation);
    pin.value = restored.pin;
    hostToken.value = restored.hostToken;
    restoredSeq = restored.seq ?? 0;
    game.value = restoredGame;
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
  if (!game.value || !pin.value || !hostToken.value) return;
  void hostInThisTab(game.value, { pin: pin.value, hostToken: hostToken.value });
});

/** Carries on with a restored session, unless another tab is hosting it. */
async function hostInThisTab(hosted: Game, credentials: HostCredentials) {
  const lock = await acquireHostLock(credentials.pin, onTabLost);
  // Ended while this tab was waiting: there is nothing left to host.
  if (game.value !== hosted) return lock?.release();
  if (!lock) {
    debugLog("quiz open in another tab", { pin: credentials.pin });
    otherTabHosts.value = true;
    stopSound();
    return;
  }
  hostLock = lock;
  startHosting(hosted, credentials, restoredSeq);
  persistSession();
}

/** Another tab has taken the quiz over, so this one stops at once. */
function onTabLost() {
  debugLog("quiz taken over by another tab", { pin: pin.value });
  link?.stop();
  link = null;
  otherTabHosts.value = true;
  playersOpen.value = false;
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
  await link?.broadcastNow();
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
  await link?.broadcastNow();
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
  if (!everyone && answersAtRisk(linkStatus.value, questionStartedAt.value)) {
    const go = window.confirm(
      "Die Verbindung ist gerade unterbrochen. Antworten, die noch unterwegs sind, würden nicht mehr gezählt. Trotzdem die Antwort zeigen?",
    );
    debugLog("reveal during connection trouble", {
      confirmed: go,
      inbox: linkStatus.value.inbox,
      broadcast: linkStatus.value.broadcast,
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
  await link?.broadcastNow();
}

/** Takes a player out of the game, mainly for a rude nickname. */
async function confirmRemove(playerId: string) {
  const current = game.value;
  const nickname = current?.roster.get(playerId);
  if (!current || nickname === undefined) return;
  if (!window.confirm(`«${nickname}» aus dem Quiz entfernen? Die Person kann mit einem anderen Namen neu beitreten.`)) return;
  debugLog("player removed", { player: playerId });
  removePlayer(current, playerId);
  await link?.broadcastNow();
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
  await link?.broadcastNow();
}

/** Leaves the final screen. Only now do the snapshots stop and the pin is
 * released. */
function closeQuiz() {
  debugLog("quiz closed", { pin: pin.value });
  leaveQuiz();
}

/** Host-initiated early abort, available any time a session is running.
 * Unlike a normal finish, this skips the leaderboard entirely and drops the
 * host straight back to the editor -- there is nothing to show a rank for. */
function endQuizNow() {
  if (!game.value) return;
  const unreachable = linkStatus.value.refused || answersAtRisk(linkStatus.value, questionStartedAt.value);
  const question =
    "Quiz jetzt beenden? Alle Spieler:innen werden entfernt." +
    (unreachable ? " Die Verbindung ist gerade unterbrochen, darum erfahren sie vielleicht nichts davon." : "");
  // Confirm canceling as soon as players started to join
  if (playerCount.value > 0 && !window.confirm(question)) return;
  debugLog("quiz aborted", { pin: pin.value, phase: status.value, unreachable });
  // Tells connected players the session is over, so they leave their current
  // screen too.
  leaveQuiz({ phase: "finished", question_index: null, players: [] });
}

/** Ends the session -- telling the players `farewell`, if given -- and goes
 * back to the quiz editor, as if no session had ever been created. The link
 * stops before anything else: a connection that is down must not keep the
 * teacher in the quiz, and with the heartbeat stopped, no snapshot can follow
 * the farewell and bring the session back. */
function leaveQuiz(farewell?: SessionSnapshot) {
  link?.end(farewell);
  link = null;
  hostLock?.release();
  hostLock = null;
  clearHostSession();
  game.value = null;
  pin.value = null;
  hostToken.value = null;
  linkStatus.value = { ...IDLE_LINK };
  questionStartedAt.value = 0;
  visits.clear();
  playersOpen.value = false;
}

onUnmounted(() => {
  link?.stop();
  detachSound?.();
  stopSound();
});
</script>

<template>
  <div class="host-app">
    <p v-if="linkStatus.refused && status !== 'setup'" class="host-app__reconnecting host-app__session-refused">
      Diese Sitzung ist nicht mehr gültig, die Spieler:innen sehen nichts mehr davon. Beende das Quiz und erstelle es
      neu.
    </p>
    <p v-else-if="linkStatus.down && status !== 'setup'" class="host-app__reconnecting">
      Verbindung wird wiederhergestellt …
    </p>

    <!-- Kept alive while a quiz runs, so the editor is as it was left. -->
    <KeepAlive>
      <HostSetup
        v-if="status === 'setup' && !otherTabHosts"
        v-model:source="quizSource"
        v-model:src="quizSrc"
        @created="hostNewQuiz"
      />
    </KeepAlive>

    <template v-if="otherTabHosts">
      <div class="host-app__panel">
        <h2>Dieses Quiz läuft bereits in einem anderen Tab.</h2>
        <p>Schließe diesen Tab, oder führe das Quiz hier weiter. Der andere Tab hält dann an.</p>
        <button type="button" @click="takeOverHere">Hier übernehmen</button>
      </div>
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
</style>
