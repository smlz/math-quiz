<script setup lang="ts">
import { OPTION_COLORS, OPTION_LABELS, OPTION_TEXT_COLORS } from "../quiz/optionStyle";

const props = defineProps<{
  selectedIndex: number | null;
  /** null while the question is still active (not yet revealed). */
  correctIndex: number | null;
  disabled: boolean;
}>();

const emit = defineEmits<{ select: [optionIndex: number] }>();

function onClick(i: number) {
  if (props.disabled) return;
  emit("select", i);
}
</script>

<template>
  <div class="player-answer-grid">
    <button
      v-for="(_, i) in OPTION_LABELS"
      :key="i"
      type="button"
      class="player-answer-grid__option"
      :style="{ background: OPTION_COLORS[i], color: OPTION_TEXT_COLORS[i] }"
      :disabled="disabled"
      :class="{
        // Active phase: outline just the player's own tentative pick.
        'player-answer-grid__option--selected': correctIndex === null && selectedIndex === i,
        // Reveal phase: dim everything but the correct option, ring it,
        // and mark the player's own pick as right/wrong (SPEC.md §4.1/§8).
        // Waiting phase (answered, not yet revealed): dim every other option
        // so it's clear only the tapped one was submitted.
        'player-answer-grid__option--dimmed':
          (correctIndex !== null && i !== correctIndex) ||
          (correctIndex === null && disabled && selectedIndex !== i),
        'player-answer-grid__option--correct': correctIndex !== null && i === correctIndex,
        'player-answer-grid__option--wrong-pick':
          correctIndex !== null && selectedIndex === i && i !== correctIndex,
      }"
      @click="onClick(i)"
    >
      {{ OPTION_LABELS[i] }}
      <span v-if="correctIndex !== null && i === correctIndex && selectedIndex === i" class="player-answer-grid__mark player-answer-grid__mark--correct">✓</span>
      <span v-if="correctIndex !== null && selectedIndex === i && i !== correctIndex" class="player-answer-grid__mark player-answer-grid__mark--wrong">✗</span>
    </button>
  </div>
</template>

<style scoped>
.player-answer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0.6rem;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 100%;
  /* Push the (square) grid down to the bottom of its flex-column container. */
  margin-top: auto;
}
.player-answer-grid__option {
  position: relative;
  border: none;
  border-radius: 10px;
  font-size: 2rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s;
}
.player-answer-grid__option:disabled {
  cursor: default;
}
.player-answer-grid__option--selected {
  outline: 4px solid #1a1a1a;
  outline-offset: 3px;
}
.player-answer-grid__option--dimmed {
  opacity: 0.45;
}
.player-answer-grid__option--correct {
  outline: 5px solid #ffd600;
  outline-offset: 3px;
}
.player-answer-grid__option--wrong-pick {
  outline: 4px solid #1a1a1a;
  outline-offset: 3px;
}
.player-answer-grid__mark {
  position: absolute;
  bottom: 0.5rem;
  right: 0.75rem;
  font-size: 3rem;
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.35);
}
.player-answer-grid__mark--correct {
  color: #1a7a1a;
}
.player-answer-grid__mark--wrong {
  color: #c00000;
}
</style>
