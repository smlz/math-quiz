<script setup lang="ts">
import type { QuestionState } from "../quiz/types";
import { OPTION_COLORS, OPTION_LABELS, OPTION_TEXT_COLORS } from "../quiz/optionStyle";
import TypstFigure from "./TypstFigure.vue";

const props = withDefaults(
  defineProps<{
    question: QuestionState;
    /** Highlight the correct option. Off during `question_active` (host
     * hasn't revealed yet); on for the standalone preview and reveal. */
    revealCorrect?: boolean;
    /** Live per-option submission counts (index-aligned with `options`),
     * shown only once revealed (SPEC.md §4.1/§8). */
    counts?: number[];
  }>(),
  { revealCorrect: true },
);
</script>

<template>
  <section class="question-card">
    <div class="question-card__prompt" :style="{ flexGrow: 1 - question.answerAreaFraction }">
      <TypstFigure :source="question.promptTypst" />
    </div>

    <ol class="question-card__options" :style="{ flexGrow: question.answerAreaFraction }">
      <li
        v-for="(option, i) in question.options"
        :key="i"
        class="question-card__option"
        :style="{ background: OPTION_COLORS[i] }"
        :class="{
          'question-card__option--correct': props.revealCorrect && i === question.correctIndex,
          'question-card__option--dimmed': props.revealCorrect && i !== question.correctIndex,
        }"
      >
        <span class="question-card__option-label" :style="{ color: OPTION_TEXT_COLORS[i] }">{{ OPTION_LABELS[i] }}</span>
        <div class="question-card__option-content">
          <TypstFigure :source="option.typst" />
        </div>
        <span v-if="props.counts" class="question-card__option-count">{{ props.counts[i] ?? 0 }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.question-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  flex: 1;
  min-height: 0;
  width: 100%;
  margin-bottom: 1.5rem;
  text-align: left;
}
.question-card__prompt {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  color: #1a1a1a;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 0.75rem 1rem;
}
.question-card__options {
  flex: 1 1 0;
  min-height: 0;
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 0.5rem;
}
.question-card__option {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0.6rem;
  border-radius: 8px;
  transition: opacity 0.2s;
  min-height: 0;
}
.question-card__option-content {
  background: white;
  color: #1a1a1a;
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}
.question-card__option--correct {
  outline: 3px solid #ffd600;
  outline-offset: 2px;
}
.question-card__option--dimmed {
  opacity: 0.45;
}
.question-card__option-label {
  font-weight: 600;
  margin-bottom: 0.3rem;
}
.question-card__option-count {
  position: absolute;
  right: 0.5rem;
  bottom: 0.5rem;
  font-variant-numeric: tabular-nums;
  color: white;
  font-weight: 700;
  background: rgba(20, 20, 20, 0.85);
  border-radius: 999px;
  padding: 0.1rem 0.7rem;
  font-size: 0.9rem;
}
</style>
