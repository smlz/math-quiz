<script setup lang="ts">
import { ref } from "vue";
import { QuizParseError } from "../quiz/errors";
import { parseQuiz } from "../quiz/parseQuiz";
import { SAMPLE_QUIZ } from "../quiz/sampleQuiz";
import type { ParsedQuiz } from "../quiz/types";
import QuestionCard from "./QuestionCard.vue";

const source = ref(SAMPLE_QUIZ);
const quiz = ref<ParsedQuiz | null>(null);
const errors = ref<string[]>([]);

function load() {
  errors.value = [];
  quiz.value = null;
  try {
    quiz.value = parseQuiz(source.value);
  } catch (e) {
    errors.value = e instanceof QuizParseError ? e.issues : [String(e)];
  }
}

load();
</script>

<template>
  <div class="quiz-preview">
    <div class="quiz-preview__editor">
      <h2>Quiz-Quelltext (Typst)</h2>
      <textarea v-model="source" rows="28" spellcheck="false"></textarea>
      <button type="button" @click="load">Quiz laden</button>
    </div>

    <div class="quiz-preview__result">
      <template v-if="errors.length">
        <h2>Validierungsfehler</h2>
        <ul class="quiz-preview__errors">
          <li v-for="issue in errors" :key="issue">{{ issue }}</li>
        </ul>
      </template>

      <template v-else-if="quiz">
        <QuestionCard v-for="question in quiz.questions" :key="question.id" :question="question" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.quiz-preview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 2rem;
  text-align: left;
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}
.quiz-preview__editor textarea {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  box-sizing: border-box;
}
.quiz-preview__errors {
  color: #b00020;
}
</style>
