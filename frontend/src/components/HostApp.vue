<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import {
  advanceSession,
  createSession,
  fetchSessionState,
  subscribeToSession,
  type LeaderboardEntry,
  type PlayerResult,
} from "../api/mathQuizClient";
import { QuizParseError } from "../quiz/errors";
import { OPTION_LABELS } from "../quiz/optionStyle";
import { parseQuiz } from "../quiz/parseQuiz";
import { SAMPLE_QUIZ } from "../quiz/sampleQuiz";
import { renderTypst } from "../quiz/typst";
import type { ParsedQuiz, QuestionState } from "../quiz/types";
import HostLeaderboard from "./HostLeaderboard.vue";
import HostLobby from "./HostLobby.vue";
import QuestionCard from "./QuestionCard.vue";

// Every correct answer is worth a hardcoded 10 points; not configurable
// per quiz or question, and not part of QuestionState (SPEC.md §5/§6.2).
const POINTS_PER_CORRECT_ANSWER = 10;

// Written just before opening "#/preview" in a new tab (window.open copies
// the opener's sessionStorage into the new tab at creation time) - the
// quiz source is never sent to/stored on the server, so this is the only
// way to hand it to that page.
const PREVIEW_STORAGE_KEY = "math-quiz-preview-source";

type Status = "setup" | "lobby" | "question_active" | "question_reveal" | "leaderboard" | "finished";

const quizSource = ref(SAMPLE_QUIZ);
const loadErrors = ref<string[]>([]);
const quiz = ref<ParsedQuiz | null>(null);
// True while every prompt/option is being compiled with Typst before the
// lobby (and its QR code) is shown - the lobby only ever appears once this
// has confirmed the whole document compiles cleanly.
const validating = ref(false);

const pin = ref<string | null>(null);
const hostPin = ref<string | null>(null);
const status = ref<Status>("setup");

const roster = reactive(new Map<string, string>()); // player_id -> nickname
const scores = reactive(new Map<string, number>()); // player_id -> cumulative score

const currentQuestionIndex = ref(-1);
const tally = ref<Record<number, number>>({});
// Reactive: its size drives the live "N of M answered" button label (SPEC.md §8),
// not just read synchronously inside `reveal()`.
const answersForCurrentQuestion = reactive(new Map<string, { optionIndex: number }>());

let unsubscribe: (() => void) | null = null;

const nicknames = computed(() => [...roster.values()]);

const currentQuestion = computed<QuestionState | null>(() =>
  quiz.value && currentQuestionIndex.value >= 0 ? quiz.value.questions[currentQuestionIndex.value] : null,
);

const countsArray = computed<number[]>(() =>
  currentQuestion.value ? currentQuestion.value.options.map((_, i) => tally.value[i] ?? 0) : [],
);

const answeredCount = computed(() => answersForCurrentQuestion.size);

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
  hostPin.value = created.host_pin;

  unsubscribe = subscribeToSession(created.pin, (event) => {
    switch (event.type) {
      case "player_joined":
        roster.set(event.data.player_id, event.data.nickname);
        if (!scores.has(event.data.player_id)) scores.set(event.data.player_id, 0);
        break;
      case "answer_count_update":
        tally.value = event.data.counts;
        answersForCurrentQuestion.set(event.data.player_id, { optionIndex: event.data.option_index });
        break;
      default:
        // question_started/question_revealed/leaderboard_updated/session_finished
        // are authored and applied locally by this host app itself; no need
        // to react to their own echo back over SSE.
        break;
    }
  });

  // Seed the roster in case a player joined between session creation and
  // the SSE subscription above being established.
  const snapshot = await fetchSessionState(created.pin);
  for (const player of snapshot.players) {
    roster.set(player.player_id, player.nickname);
    if (!scores.has(player.player_id)) scores.set(player.player_id, 0);
  }

  status.value = "lobby";
}

function openPreview() {
  loadErrors.value = [];
  try {
    parseQuiz(quizSource.value);
  } catch (e) {
    loadErrors.value = e instanceof QuizParseError ? e.issues : [String(e)];
    return;
  }
  sessionStorage.setItem(PREVIEW_STORAGE_KEY, quizSource.value);
  window.open("#/preview", "_blank");
}

async function startQuestion(index: number) {
  if (!quiz.value || !hostPin.value) return;

  currentQuestionIndex.value = index;
  tally.value = {};
  answersForCurrentQuestion.clear();

  // Trimmed payload: players never render prompt/option content (SPEC.md
  // §4.1/§8), so only the index needs to cross the wire.
  await advanceSession(hostPin.value, "question_started", { question_index: index });
  status.value = "question_active";
}

async function reveal() {
  if (!quiz.value || !hostPin.value || status.value !== "question_active") return;
  status.value = "question_reveal";
  const q = quiz.value.questions[currentQuestionIndex.value];

  const results: Record<string, PlayerResult> = {};
  for (const playerId of roster.keys()) {
    const answer = answersForCurrentQuestion.get(playerId);
    if (!answer) {
      results[playerId] = { option_index: null, correct: false, points_awarded: 0 };
      continue;
    }
    const correct = answer.optionIndex === q.correctIndex;
    const pointsAwarded = correct ? POINTS_PER_CORRECT_ANSWER : 0;
    results[playerId] = { option_index: answer.optionIndex, correct, points_awarded: pointsAwarded };
    scores.set(playerId, (scores.get(playerId) ?? 0) + pointsAwarded);
  }

  await advanceSession(hostPin.value, "question_revealed", {
    question_index: currentQuestionIndex.value,
    correct_index: q.correctIndex,
    counts: tally.value,
    results,
  });
}

async function showLeaderboard() {
  if (!hostPin.value) return;
  await advanceSession(hostPin.value, "leaderboard_updated", { standings: standings.value });
  status.value = "leaderboard";
}

async function nextOrFinish() {
  if (!quiz.value || !hostPin.value) return;
  if (currentQuestionIndex.value + 1 < quiz.value.questions.length) {
    await startQuestion(currentQuestionIndex.value + 1);
  } else {
    await advanceSession(hostPin.value, "session_finished", {});
    status.value = "finished";
    unsubscribe?.();
    unsubscribe = null;
  }
}

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="host-app">
    <template v-if="status === 'setup'">
      <div class="host-app__panel">
        <h2>Quiz-Quelltext (Typst)</h2>
        <textarea v-model="quizSource" rows="20" spellcheck="false"></textarea>
        <ul v-if="loadErrors.length" class="host-app__errors">
          <li v-for="issue in loadErrors" :key="issue">{{ issue }}</li>
        </ul>
        <div class="host-app__setup-actions">
          <button type="button" class="host-app__preview" :disabled="validating" @click="openPreview">
            Vorschau
          </button>
          <button type="button" class="host-app__submit" :disabled="validating" @click="loadAndCreateSession">
            {{ validating ? "Wird geprüft …" : "Quiz erstellen" }}
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="status === 'lobby' && pin">
      <div class="host-app__panel">
        <HostLobby :pin="pin" :nicknames="nicknames" @start="startQuestion(0)" />
      </div>
    </template>

    <template v-else-if="status === 'question_active' && currentQuestion">
      <QuestionCard :question="currentQuestion" :reveal-correct="false" />
      <button type="button" @click="reveal">{{ answerButtonLabel }}</button>
    </template>

    <template v-else-if="status === 'question_reveal' && currentQuestion">
      <QuestionCard :question="currentQuestion" :reveal-correct="true" :counts="countsArray" />
      <button type="button" @click="showLeaderboard">Rangliste anzeigen</button>
    </template>

    <template v-else-if="status === 'leaderboard'">
      <div class="host-app__panel">
        <HostLeaderboard
          :standings="standings"
          :is-last-question="isLastQuestion"
          :finished="false"
          @continue="nextOrFinish"
        />
      </div>
    </template>

    <template v-else-if="status === 'finished'">
      <div class="host-app__panel">
        <HostLeaderboard :standings="standings" :is-last-question="true" :finished="true" />
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
.host-app__setup-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: auto;
}
.host-app__setup-actions .host-app__preview,
.host-app__setup-actions .host-app__submit {
  flex: 1;
}
.host-app textarea {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  box-sizing: border-box;
}
.host-app__errors {
  color: #b00020;
}
</style>
