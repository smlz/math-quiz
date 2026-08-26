<script setup lang="ts">
import { ref } from "vue";
import { QuizParseError } from "../quiz/errors";
import { parseQuiz } from "../quiz/parseQuiz";
import type { ParsedQuiz } from "../quiz/types";
import QuestionCard from "./QuestionCard.vue";
import ScreenFrame from "./ScreenFrame.vue";

// Written by HostApp.vue's setup screen right before opening this page in a
// new tab - the quiz source itself is never sent to/stored on the server
// (SPEC.md), so a new tab has no other way to get at it.
const PREVIEW_STORAGE_KEY = "math-quiz-preview-source";

const quiz = ref<ParsedQuiz | null>(null);
const errors = ref<string[]>([]);

try {
  const source = sessionStorage.getItem(PREVIEW_STORAGE_KEY) ?? "";
  quiz.value = parseQuiz(source);
} catch (e) {
  errors.value = e instanceof QuizParseError ? e.issues : [String(e)];
}
</script>

<template>
  <div class="quiz-preview-screens">
    <h1>Quiz-Vorschau</h1>

    <ul v-if="errors.length" class="quiz-preview-screens__errors">
      <li v-for="issue in errors" :key="issue">{{ issue }}</li>
    </ul>

    <template v-else-if="quiz">
      <section v-for="(question, i) in quiz.questions" :key="question.id" class="quiz-preview-screens__item">
        <h2>Frage {{ i + 1 }} von {{ quiz.questions.length }}</h2>
        <ScreenFrame>
          <div class="quiz-preview-screens__host-app">
            <QuestionCard :question="question" :reveal-correct="true" />
          </div>
        </ScreenFrame>
      </section>
    </template>
  </div>
</template>

<style scoped>
.quiz-preview-screens {
  max-width: 1000px;
  width: 100%;
  min-width: 0;
  margin: 0 auto;
  padding: 1.5rem;
  box-sizing: border-box;
  text-align: left;
}
.quiz-preview-screens__item {
  margin-bottom: 2.5rem;
}
.quiz-preview-screens__errors {
  color: #b00020;
}
/* Mirrors HostApp.vue's `.host-app` layout so the framed preview matches
   the real host screen exactly (same padding/flex structure). */
.quiz-preview-screens__host-app {
  width: 100%;
  height: 100%;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
</style>
