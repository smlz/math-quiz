<script setup lang="ts">
import { computed, ref } from "vue";
import { highlightTypst } from "../quiz/highlightTypst";

// A plain textarea with transparent text over a highlighted copy of the same
// text. Typing, selection, undo and `fill()` in tests all stay the browser's
// own. The two layers line up only while they share every metric that
// affects layout: font, padding, wrapping and scrollbar gutter.

const source = defineModel<string>({ required: true });
defineProps<{ readonly?: boolean }>();

// `highlightTypst` escapes all source text, so this is safe for v-html. The
// extra newline gives a trailing empty line the same height it has in the
// textarea.
const highlighted = computed(() => highlightTypst(source.value) + "\n");

const backdrop = ref<HTMLPreElement | null>(null);

function syncScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement;
  if (!backdrop.value) return;
  backdrop.value.scrollTop = textarea.scrollTop;
  backdrop.value.scrollLeft = textarea.scrollLeft;
}
</script>

<template>
  <div class="typst-editor">
    <pre ref="backdrop" class="typst-editor__highlight" aria-hidden="true" v-html="highlighted"></pre>
    <textarea
      v-model="source"
      class="typst-editor__input"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      :readonly="readonly"
      @scroll="syncScroll"
    ></textarea>
  </div>
</template>

<style scoped>
.typst-editor {
  --tok-comment: #6a737d;
  --tok-string: #0a6b2f;
  --tok-keyword: #c92a3a;
  --tok-constant: #005cc5;
  --tok-function: #6f42c1;
  --tok-key: #b35400;
  --tok-math: #0b7285;
  --tok-label: #8a6d00;

  position: relative;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .typst-editor {
    --tok-comment: #8b949e;
    --tok-string: #7ee787;
    --tok-keyword: #ff7b72;
    --tok-constant: #79c0ff;
    --tok-function: #d2a8ff;
    --tok-key: #ffa657;
    --tok-math: #56d4dd;
    --tok-label: #e3b341;
  }
}
.typst-editor:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.typst-editor__highlight,
.typst-editor__input {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0.5rem;
  border: 0;
  box-sizing: border-box;
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  letter-spacing: normal;
  text-align: left;
  tab-size: 4;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
  scrollbar-gutter: stable;
}
.typst-editor__highlight {
  overflow: hidden;
  color: var(--text-h);
  pointer-events: none;
}
.typst-editor__input {
  overflow-y: auto;
  /* An elastic bounce at either end would move the textarea's text but not
     the highlighted copy, which is only ever set to a clamped scrollTop. */
  overscroll-behavior: none;
  resize: none;
  color: transparent;
  caret-color: var(--text-h);
  background: transparent;
  outline: none;
}
.typst-editor__input::selection {
  color: transparent;
  background: var(--accent-bg);
}

/* Colour only: bold or italic could change glyph widths and pull the two
   layers apart. */
.typst-editor :deep(.tok-comment) {
  color: var(--tok-comment);
}
.typst-editor :deep(.tok-string),
.typst-editor :deep(.tok-raw) {
  color: var(--tok-string);
}
.typst-editor :deep(.tok-keyword),
.typst-editor :deep(.tok-heading) {
  color: var(--tok-keyword);
}
.typst-editor :deep(.tok-constant),
.typst-editor :deep(.tok-escape) {
  color: var(--tok-constant);
}
.typst-editor :deep(.tok-function),
.typst-editor :deep(.tok-math-function) {
  color: var(--tok-function);
}
.typst-editor :deep(.tok-key) {
  color: var(--tok-key);
}
.typst-editor :deep(.tok-math),
.typst-editor :deep(.tok-math-delimiter),
.typst-editor :deep(.tok-math-operator) {
  color: var(--tok-math);
}
.typst-editor :deep(.tok-label) {
  color: var(--tok-label);
}
</style>
