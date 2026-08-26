<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from "vue";
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
import ScreenFrame from "./ScreenFrame.vue";

// Correct answers score by submission order: 12 for the first, 11 for the
// second, 10 for every further one (SPEC.md §5/§6.2). Not configurable.
const POINTS_BY_CORRECT_RANK = [12, 11];
const POINTS_PER_CORRECT_ANSWER = 10;

const PREVIEW_DEBOUNCE_MS = 300;

type Status = "setup" | "lobby" | "question_active" | "question_reveal" | "leaderboard" | "finished";

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
const hostPin = ref<string | null>(null);
const status = ref<Status>("setup");

const roster = reactive(new Map<string, string>()); // player_id -> nickname
const scores = reactive(new Map<string, number>()); // player_id -> cumulative score

const currentQuestionIndex = ref(-1);
const tally = ref<Record<number, number>>({});
// Reactive: its size drives the live "N of M answered" button label (SPEC.md §8),
// not just read synchronously inside `reveal()`.
const answersForCurrentQuestion = reactive(new Map<string, { optionIndex: number; submittedAt: number }>());

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
        answersForCurrentQuestion.set(event.data.player_id, {
          optionIndex: event.data.option_index,
          submittedAt: Date.parse(event.data.submitted_at),
        });
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

  // Only correct answers occupy the 12/11 slots (§5); Array.sort is stable,
  // so answers sharing a timestamp keep the order they arrived in.
  const correctRank = new Map<string, number>();
  [...answersForCurrentQuestion.entries()]
    .filter(([, answer]) => answer.optionIndex === q.correctIndex)
    .sort((a, b) => a[1].submittedAt - b[1].submittedAt)
    .forEach(([playerId], i) => correctRank.set(playerId, i));

  const results: Record<string, PlayerResult> = {};
  for (const playerId of roster.keys()) {
    const answer = answersForCurrentQuestion.get(playerId);
    if (!answer) {
      results[playerId] = { option_index: null, correct: false, points_awarded: 0 };
      continue;
    }
    const rank = correctRank.get(playerId);
    const correct = rank !== undefined;
    const pointsAwarded = correct
      ? (POINTS_BY_CORRECT_RANK[rank] ?? POINTS_PER_CORRECT_ANSWER)
      : 0;
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

onUnmounted(() => {
  clearTimeout(previewTimer);
  unsubscribe?.();
});
</script>

<template>
  <div class="host-app">
    <template v-if="status === 'setup'">
      <div class="host-app__setup">
        <div class="host-app__editor">
          <h2>Quiz-Quelltext (Typst)</h2>
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
