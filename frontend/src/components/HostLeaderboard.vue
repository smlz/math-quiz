<script setup lang="ts">
import { computed } from "vue";
import type { LeaderboardEntry } from "../quiz/types";

const props = defineProps<{
  standings: LeaderboardEntry[];
  finished: boolean;
}>();

defineEmits<{ remove: [playerId: string] }>();

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
        <!-- Not on the final screen: the game is over by then. -->
        <button
          v-if="!finished"
          type="button"
          class="leaderboard__remove"
          :aria-label="`${entry.nickname} entfernen`"
          :title="`${entry.nickname} entfernen`"
          @click="$emit('remove', entry.player_id)"
        >
          ×
        </button>
      </li>
    </ol>
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
.leaderboard__remove {
  margin-left: 0.4rem;
  padding: 0 0.3rem;
  min-height: 0;
  background: none;
  border: none;
  color: #999;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  /* Unobtrusive on the projector until the teacher points at it. */
  opacity: 0.4;
}
.leaderboard__remove:hover,
.leaderboard__remove:focus-visible {
  opacity: 1;
  color: #b00020;
}
</style>
