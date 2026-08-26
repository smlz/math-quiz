<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { submitAnswer, subscribeToSession, type LeaderboardEntry } from "../api/mathQuizClient";
import PlayerAnswerGrid from "./PlayerAnswerGrid.vue";
import PlayerJoin from "./PlayerJoin.vue";
import PlayerQuestion from "./PlayerQuestion.vue";

type Status = "join" | "lobby" | "question_active" | "question_reveal" | "leaderboard" | "finished";

const status = ref<Status>("join");
const pin = ref<string | null>(null);
const playerId = ref<string | null>(null);
const nickname = ref<string | null>(null);

const currentQuestionIndex = ref<number | null>(null);
const selectedIndex = ref<number | null>(null);
const lastResult = ref<{ correct: boolean; pointsAwarded: number } | null>(null);
const revealCorrectIndex = ref<number | null>(null);
const myScore = ref(0);
const standings = ref<LeaderboardEntry[]>([]);

let unsubscribe: (() => void) | null = null;

const myRank = computed(() => {
  const entry = standings.value.find((e) => e.player_id === playerId.value);
  return entry ? entry.rank : null;
});

// Only the top 5 players are shown in the list, regardless of how many joined.
const topStandings = computed(() => standings.value.slice(0, 5));

// Non-gameplay states (no answer grid) get their content vertically centered,
// except leaderboard, which aligns to the top (bottom stays reserved/empty,
// matching the host's button-anchored-to-bottom layout).
const isCenteredState = computed(() => status.value === "lobby" || status.value === "finished");

function onJoined(joinedPin: string, joinedPlayerId: string, joinedNickname: string) {
  pin.value = joinedPin;
  playerId.value = joinedPlayerId;
  nickname.value = joinedNickname;
  status.value = "lobby";

  unsubscribe = subscribeToSession(joinedPin, (event) => {
    switch (event.type) {
      case "question_started":
        currentQuestionIndex.value = event.data.question_index;
        selectedIndex.value = null;
        lastResult.value = null;
        revealCorrectIndex.value = null;
        status.value = "question_active";
        break;
      case "question_revealed": {
        const result = event.data.results[playerId.value!];
        if (result) {
          lastResult.value = { correct: result.correct, pointsAwarded: result.points_awarded };
          myScore.value += result.points_awarded;
        }
        revealCorrectIndex.value = event.data.correct_index;
        status.value = "question_reveal";
        break;
      }
      case "leaderboard_updated":
        standings.value = event.data.standings;
        status.value = "leaderboard";
        break;
      case "session_finished":
        status.value = "finished";
        unsubscribe?.();
        unsubscribe = null;
        break;
      default:
        // player_joined / answer_count_update are host-facing bookkeeping only.
        break;
    }
  });
}

async function answer(optionIndex: number) {
  if (!pin.value || !playerId.value || currentQuestionIndex.value === null || selectedIndex.value !== null) return;
  selectedIndex.value = optionIndex; // optimistic; reveal is authoritative regardless
  try {
    await submitAnswer(pin.value, playerId.value, currentQuestionIndex.value, optionIndex);
  } catch (e) {
    console.error("Failed to submit answer", e);
  }
}

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="player-app">
    <PlayerJoin v-if="status === 'join'" @joined="onJoined" />

    <template v-else>
      <header class="player-app__header">
        <p class="player-app__nickname">{{ nickname }}</p>
      </header>

      <main class="player-app__main" :class="{ 'player-app__main--center': isCenteredState }">
        <div v-if="status === 'lobby'" class="player-app__panel">
          <h2>Du bist dabei, {{ nickname }}!</h2>
          <p>Warte, bis das Quiz startet…</p>
        </div>

        <template v-else-if="status === 'question_active'">
          <p class="player-app__instruction">
            {{ selectedIndex !== null ? "Antwort abgeschickt — warte auf Auflösung…" : "Jetzt antworten!" }}
          </p>
          <PlayerQuestion :selected-index="selectedIndex" @answer="answer" />
        </template>

        <template v-else-if="status === 'question_reveal'">
          <h2 v-if="lastResult?.correct" class="player-app__instruction player-app__reveal-correct">
            Richtig! +{{ lastResult.pointsAwarded }} Punkte
          </h2>
          <h2 v-else class="player-app__instruction player-app__reveal-wrong">Falsch. +0 Punkte</h2>
          <p class="player-app__total-score">Gesamtpunktzahl: {{ myScore }}</p>
          <PlayerAnswerGrid
            :selected-index="selectedIndex"
            :correct-index="revealCorrectIndex"
            :disabled="true"
          />
        </template>

        <div v-else-if="status === 'leaderboard'" class="player-app__panel player-app__panel--top">
          <h2>Rangliste</h2>
          <p v-if="myRank">Du bist auf Platz {{ myRank }} mit {{ myScore }} Punkten</p>
          <ol class="player-app__standings">
            <li
              v-for="entry in topStandings"
              :key="entry.player_id"
              :class="{ 'player-app__me': entry.player_id === playerId }"
            >
              {{ entry.nickname }} — {{ entry.score }}
            </li>
          </ol>
        </div>

        <div v-else-if="status === 'finished'" class="player-app__panel">
          <h2>Quiz beendet!</h2>
          <p v-if="myRank">Du hast auf Platz {{ myRank }} mit {{ myScore }} Punkten abgeschlossen</p>
        </div>
      </main>
    </template>
  </div>
</template>

<style scoped>
.player-app {
  width: 100%;
  height: 100dvh;
  margin: 0;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  text-align: center;
}
.player-app__header {
  flex: 0 0 auto;
}
.player-app__nickname {
  margin: 0 0 0.5rem;
  font-weight: 700;
  color: #444;
}
.player-app__main {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
}
.player-app__main--center {
  justify-content: center;
  align-items: center;
}
.player-app__panel {
  width: 100%;
  max-width: 480px;
  margin: auto;
}
.player-app__panel--top {
  margin: 0 auto;
}
.player-app__instruction {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}
.player-app__reveal-correct {
  color: #1a7a1a;
}
.player-app__reveal-wrong {
  color: #c00000;
}
.player-app__total-score {
  margin: 0 0 0.75rem;
  color: #444;
}
.player-app__standings {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.4rem;
  text-align: left;
}
.player-app__standings li {
  padding: 0.4rem 0.8rem;
  border: 1px solid #eee;
  border-radius: 6px;
}
.player-app__me {
  border-color: #1565c0 !important;
  background: #e3f2fd;
  font-weight: 600;
}
</style>
