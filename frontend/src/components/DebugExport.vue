<script setup lang="ts">
import { nextTick, ref } from "vue";
import { flushDebugLog, formatDebugLog, type DebugRole } from "../debug/debugLog";

const props = defineProps<{ role: DebugRole }>();

// Phones offer their share sheet (mail, messengers, ...); desktops mostly don't.
const canShare = typeof navigator.share === "function";
const copied = ref(false);
// Shown when the browser refuses to copy, so the text can be copied by hand.
const manualText = ref<string | null>(null);
const manualField = ref<HTMLTextAreaElement | null>(null);

function exportText(): string {
  flushDebugLog();
  return formatDebugLog(props.role);
}

function fileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `quiz-diagnose-${props.role}-${stamp}.txt`;
}

async function copy() {
  const text = exportText();
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    setTimeout(() => (copied.value = false), 3000);
  } catch {
    manualText.value = text;
    await nextTick();
    manualField.value?.select();
  }
}

async function share() {
  const text = exportText();
  const file = new File([text], fileName(), { type: "text/plain" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: "Quiz-Diagnose", files: [file] });
    } else {
      await navigator.share({ title: "Quiz-Diagnose", text });
    }
  } catch (e) {
    // Closing the share sheet is not an error worth showing.
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      manualText.value = text;
    }
  }
}
</script>

<template>
  <span class="debug-export">
    <button type="button" class="debug-export__button" @click="copy">
      {{ copied ? "Diagnose kopiert ✓" : "Diagnose kopieren" }}
    </button>
    <button v-if="canShare" type="button" class="debug-export__button" @click="share">Diagnose teilen</button>
    <textarea
      v-if="manualText !== null"
      ref="manualField"
      class="debug-export__manual"
      readonly
      :value="manualText"
      aria-label="Diagnose zum Kopieren"
      @focus="manualField?.select()"
    ></textarea>
  </span>
</template>

<style scoped>
.debug-export {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
}
/* As unobtrusive as the host's "Quiz abbrechen". */
.debug-export__button {
  padding: 0.2rem 0.4rem;
  background: none;
  border: none;
  color: #888;
  font-size: 0.8rem;
  line-height: 1.2;
  text-decoration: underline;
  min-height: 1rem;
  cursor: pointer;
}
.debug-export__manual {
  flex-basis: 100%;
  height: 8rem;
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
}
</style>
