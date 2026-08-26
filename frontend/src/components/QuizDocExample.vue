<script setup lang="ts">
import { computed, ref } from "vue";
import { QuizParseError } from "../quiz/errors";
import { parseQuiz } from "../quiz/parseQuiz";
import QuestionCard from "./QuestionCard.vue";
import ScreenFrame from "./ScreenFrame.vue";

const props = withDefaults(
  defineProps<{
    source: string;
    caption?: string;
    showSource?: boolean;
  }>(),
  { showSource: true },
);

const parsed = computed(() => {
  try {
    return { question: parseQuiz(props.source).questions[0], issues: [] as string[] };
  } catch (e) {
    return { question: null, issues: e instanceof QuizParseError ? e.issues : [String(e)] };
  }
});

const copied = ref(false);

async function copySource() {
  try {
    await navigator.clipboard.writeText(props.source);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="doc-example" :class="{ 'doc-example--single': !props.showSource }">
    <div v-if="props.showSource" class="doc-example__source">
      <div class="doc-example__toolbar">
        <span class="doc-example__toolbar-title">Quelltext</span>
        <button type="button" class="doc-example__copy" @click="copySource">
          {{ copied ? "Kopiert!" : "Kopieren" }}
        </button>
      </div>
      <pre class="doc-example__code">{{ props.source }}</pre>
    </div>

    <figure class="doc-example__render">
      <ScreenFrame>
        <!-- Mirrors `.host-app`'s own padding/layout so this looks exactly
             like the real projector screen. -->
        <div class="doc-example__screen">
          <QuestionCard v-if="parsed.question" :question="parsed.question" :reveal-correct="true" />
        </div>
      </ScreenFrame>
      <figcaption v-if="props.caption" class="doc-example__caption">{{ props.caption }}</figcaption>
      <ul v-if="parsed.issues.length" class="doc-example__errors">
        <li v-for="issue in parsed.issues" :key="issue">{{ issue }}</li>
      </ul>
    </figure>
  </div>
</template>

<style scoped>
.doc-example {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
  margin: 1rem 0 2rem;
}
.doc-example--single {
  grid-template-columns: minmax(0, 1fr);
}
@media (max-width: 900px) {
  .doc-example {
    grid-template-columns: minmax(0, 1fr);
  }
}
.doc-example__source {
  min-width: 0;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  overflow: hidden;
}
.doc-example__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0.25rem 0.25rem 0.75rem;
  background: var(--code-bg, #1f2028);
  border-bottom: 1px solid var(--border, #333);
}
.doc-example__toolbar-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.doc-example__copy {
  min-height: 2rem;
  padding: 0.25rem 0.75rem;
  font-size: 0.8rem;
}
.doc-example__code {
  margin: 0;
  padding: 0.75rem;
  max-height: 26rem;
  overflow: auto;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre;
  background: var(--code-bg, #1f2028);
  color: var(--text-h, #f3f4f6);
}
.doc-example__render {
  margin: 0;
  min-width: 0;
}
.doc-example__screen {
  width: 100%;
  height: 100%;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.doc-example__caption {
  margin-top: 0.5rem;
  font-size: 0.85rem;
}
.doc-example__errors {
  color: #b00020;
  font-size: 0.85rem;
}
</style>
