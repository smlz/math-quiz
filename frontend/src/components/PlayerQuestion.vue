<script setup lang="ts">
import PlayerAnswerGrid from "./PlayerAnswerGrid.vue";

defineProps<{
  selectedIndex: number | null;
}>();

defineEmits<{ answer: [optionIndex: number] }>();
</script>

<template>
  <section class="player-question">
    <!-- No prompt/option content is ever rendered here (SPEC.md §4.1/§8) --
         the question is read off the shared host screen. -->
    <PlayerAnswerGrid
      :selected-index="selectedIndex"
      :correct-index="null"
      :disabled="selectedIndex !== null"
      @select="(i) => $emit('answer', i)"
    />
  </section>
</template>

<style scoped>
.player-question {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>
