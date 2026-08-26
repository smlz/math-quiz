<script setup lang="ts">
import { computed } from "vue";
import type { LeaderboardEntry } from "../api/mathQuizClient";

const props = defineProps<{
  standings: LeaderboardEntry[];
  isLastQuestion: boolean;
  finished: boolean;
}>();

defineEmits<{ continue: [] }>();

// Only the top 5 players are shown, regardless of how many joined.
const topStandings = computed(() => props.standings.slice(0, 5));
</script>

<template>
  <section class="leaderboard">
    <h2>{{ finished ? "Endergebnis" : "Rangliste" }}</h2>
    <ol class="leaderboard__list">
      <li v-for="entry in topStandings" :key="entry.player_id" class="leaderboard__row">
        <span class="leaderboard__rank">{{ entry.rank }}</span>
        <span class="leaderboard__nickname">{{ entry.nickname }}</span>
        <span class="leaderboard__score">{{ entry.score }}</span>
      </li>
    </ol>
    <button v-if="!props.finished" type="button" class="leaderboard__continue" @click="$emit('continue')">
      {{ props.isLastQuestion ? "Quiz beenden" : "Nächste Frage" }}
    </button>
  </section>
</template>

<style scoped>
.leaderboard {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.leaderboard__continue {
  width: 100%;
  margin-top: auto;
}
.leaderboard__list {
  width: 100%;
  max-width: 480px;
  list-style: none;
  padding: 0;
  margin: 1rem 0;
  display: grid;
  gap: 0.4rem;
}
.leaderboard__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid #eee;
  border-radius: 6px;
  text-align: left;
}
.leaderboard__rank {
  font-weight: 700;
  min-width: 1.5rem;
  color: #666;
}
.leaderboard__nickname {
  flex: 1;
}
.leaderboard__score {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
