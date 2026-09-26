<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import {
  createSession,
  endSession,
  pointsForReveal,
  publishState,
  subscribeToMessages,
  HEARTBEAT_MS,
  type ConnectionStatus,
  type IncomingMessage,
  type Phase,
  type SessionSnapshot,
} from "../api/quizClient";
import { clearHostSession, loadHostSession, saveHostSession } from "../api/storedSession";
import { QuizParseError } from "../quiz/errors";
import { OPTION_LABELS } from "../quiz/optionStyle";
import { parseQuiz } from "../quiz/parseQuiz";
import { SAMPLE_QUIZ } from "../quiz/sampleQuiz";
import { renderTypst } from "../quiz/typst";
import type { LeaderboardEntry, ParsedQuiz, QuestionState } from "../quiz/types";
import HostLeaderboard from "./HostLeaderboard.vue";
import HostLobby from "./HostLobby.vue";
import QuestionCard from "./QuestionCard.vue";
import ScreenFrame from "./ScreenFrame.vue";

const PREVIEW_DEBOUNCE_MS = 300;

// "setup" is the only state with no session behind it; every other value is
// exactly the phase players are told about.
type Status = "setup" | Phase;

const quizSource = ref(SAMPLE_QUIZ);
const loadErrors = ref<string[]>([]);
const quiz = ref<ParsedQuiz | null>(null);
// True while every prompt/option is being compiled with Typst before the
// lobby (and its QR code) is shown - the lobby only ever appears once this
// has confirmed the whole document compiles cleanly.
const validating = ref(false);

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
const connection = ref<ConnectionStatus>("open");

const roster = reactive(new Map<string, string>()); // player_id -> nickname
const scores = reactive(new Map<string, number>()); // player_id -> cumulative score

const currentQuestionIndex = ref(-1);
// Insertion order is arrival order, which is exactly what decides the 12/11/10
// ladder -- no timestamps needed.
const answers = reactive(new Map<string, number>()); // player_id -> option_index
// Who answered the current question correctly, in arrival order. Frozen at
// reveal so re-broadcasting the same snapshot can never re-score anyone.
const correctOrder = ref<string[]>([]);

let unsubscribe: (() => void) | null = null;
let heartbeat: number | null = null;

const nicknames = computed(() => [...roster.values()]);

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

const standings = computed<LeaderboardEntry[]>(() => {
  const sorted = [...roster.entries()]
    .map(([player_id, nickname]) => ({ player_id, nickname, score: scores.get(player_id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  // Standard competition ranking: ties share a rank, next rank skips ahead.
  let rank = 0;
  return sorted.map((entry, i) => {
    if (i === 0 || entry.score !== sorted[i - 1].score) rank = i + 1;
    return { ...entry, rank };
  });
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

async function loadAndCreateSession() {
  loadErrors.value = [];
  try {
    quiz.value = parseQuiz(quizSource.value);
  } catch (e) {
    quiz.value = null;
    loadErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
    return;
  }

  validating.value = true;
  const typstErrors = await compileAllTypstSnippets(quiz.value);
  validating.value = false;
  if (typstErrors.length) {
    quiz.value = null;
    loadErrors.value = typstErrors;
    return;
  }

  const created = await createSession();
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
 * the rank order. Nicknames and scores stay here on the host.
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
  };
}

/** Publishes the current snapshot. Called on every change *and* on a timer:
 * the repetition is what lets a player who missed something catch up without
 * the relay having to remember anything. */
async function broadcast() {
  if (!pin.value || !hostToken.value || status.value === "setup") return;
  try {
    await publishState(pin.value, hostToken.value, buildSnapshot());
    connection.value = "open";
  } catch (e) {
    console.warn("Snapshot broadcast failed", e);
    connection.value = "reconnecting";
  }
}

function handleMessage({ player_id, payload }: IncomingMessage) {
  if (payload.type === "join") {
    if (roster.get(player_id) === payload.nickname) return; // a join retry
    roster.set(player_id, payload.nickname);
    if (!scores.has(player_id)) scores.set(player_id, 0);
  } else {
    if (status.value !== "question") return;
    if (payload.question_index !== currentQuestionIndex.value) return;
    // Unknown senders are ignored: anyone who knows the pin can mint a token,
    // but only players the host has seen join can score.
    if (!roster.has(player_id) || answers.has(player_id)) return;
    answers.set(player_id, payload.option_index);
  }
  // Answer immediately rather than at the next heartbeat, so the sender sees
  // its own message land without a visible delay.
  void broadcast();
}

function connect(sessionPin: string, token: string) {
  unsubscribe = subscribeToMessages(sessionPin, token, handleMessage, (state) => {
    connection.value = state;
  });
  heartbeat = window.setInterval(() => void broadcast(), HEARTBEAT_MS);
}

function disconnect() {
  unsubscribe?.();
  unsubscribe = null;
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

// A running quiz only exists in this browser (the relay stores nothing at
// all), so everything needed to carry on after a reload is mirrored to
// localStorage until the quiz is finished.
function persistSession() {
  if (!pin.value || !hostToken.value || status.value === "setup" || status.value === "finished") return;
  saveHostSession({
    pin: pin.value,
    hostToken: hostToken.value,
    quizSource: quizSource.value,
    status: status.value,
    currentQuestionIndex: currentQuestionIndex.value,
    roster: [...roster],
    scores: [...scores],
    answers: [...answers],
    correctOrder: correctOrder.value,
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
    pin.value = restored.pin;
    hostToken.value = restored.hostToken;
    currentQuestionIndex.value = restored.currentQuestionIndex;
    correctOrder.value = restored.correctOrder;
    for (const [playerId, nickname] of restored.roster) roster.set(playerId, nickname);
    for (const [playerId, score] of restored.scores) scores.set(playerId, score);
    for (const [playerId, optionIndex] of restored.answers) answers.set(playerId, optionIndex);
    status.value = restored.status as Status;
  } catch {
    quiz.value = null;
    clearHostSession();
  }
} else if (restored) {
  clearHostSession();
}

// Nothing to recover from the relay: it never knew anything about this
// session in the first place, so resuming is just reconnecting and
// broadcasting again.
onMounted(() => {
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
  await broadcast();
}

async function reveal() {
  if (!quiz.value || status.value !== "question") return;
  const q = quiz.value.questions[currentQuestionIndex.value];

  // Map iteration is insertion order, so this is submission order.
  correctOrder.value = [...answers.entries()]
    .filter(([, optionIndex]) => optionIndex === q.correctIndex)
    .map(([playerId]) => playerId);

  for (const playerId of roster.keys()) {
    const points = pointsForReveal(correctOrder.value, playerId);
    scores.set(playerId, (scores.get(playerId) ?? 0) + points);
  }

  status.value = "reveal";
  await broadcast();
}

async function showLeaderboard() {
  status.value = "leaderboard";
  await broadcast();
}

async function nextOrFinish() {
  if (!quiz.value) return;
  if (currentQuestionIndex.value + 1 < quiz.value.questions.length) {
    await startQuestion(currentQuestionIndex.value + 1);
  } else {
    status.value = "finished";
    await broadcast();
    if (pin.value && hostToken.value) await endSession(pin.value, hostToken.value);
    clearHostSession();
    disconnect();
  }
}

onUnmounted(() => {
  clearTimeout(previewTimer);
  disconnect();
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
            <!-- Hash-only href so it stays correct under the GitHub Pages
                 subpath (see HostLobby's BASE_URL handling). -->
            <a class="host-app__docs-link" href="#/docs" target="_blank" rel="noopener">Anleitung: Quiz schreiben ↗</a>
          </div>
          <textarea v-model="quizSource" spellcheck="false"></textarea>
          <ul v-if="loadErrors.length" class="host-app__errors">
            <li v-for="issue in loadErrors" :key="issue">{{ issue }}</li>
          </ul>
          <button type="button" class="host-app__submit" :disabled="validating" @click="loadAndCreateSession">
            {{ validating ? "Wird geprüft …" : "Quiz erstellen" }}
          </button>
        </div>

        <div class="host-app__preview">
          <h2>Vorschau</h2>
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
    </template>

    <template v-else-if="status === 'lobby' && pin">
      <div class="host-app__panel">
        <HostLobby :pin="pin" :nicknames="nicknames" @start="startQuestion(0)" />
      </div>
    </template>

    <template v-else-if="status === 'question' && currentQuestion">
      <QuestionCard :question="currentQuestion" :reveal-correct="false" />
      <button type="button" @click="reveal">{{ answerButtonLabel }}</button>
    </template>

    <template v-else-if="status === 'reveal' && currentQuestion">
      <QuestionCard :question="currentQuestion" :reveal-correct="true" :counts="countsArray" />
      <button type="button" @click="showLeaderboard">Rangliste anzeigen</button>
    </template>

    <template v-else-if="status === 'leaderboard'">
      <div class="host-app__panel">
        <HostLeaderboard :standings="standings" :finished="false" />
      </div>
      <button type="button" @click="nextOrFinish">{{ isLastQuestion ? "Quiz beenden" : "Nächste Frage" }}</button>
    </template>

    <template v-else-if="status === 'finished'">
      <div class="host-app__panel">
        <HostLeaderboard :standings="standings" :finished="true" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.host-app {
  width: 100%;
  height: 100dvh;
  margin: 0;
  padding: 1rem;
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
.host-app__submit {
  margin-top: 0.75rem;
}
.host-app__preview {
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
