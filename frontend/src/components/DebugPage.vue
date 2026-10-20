<script setup lang="ts">
// Reachable at any time, also while a quiz runs in another tab, and also
// when the quiz screen itself is stuck: it only reads what the quiz pages
// stored on this device. Like the about page, it loads nothing from anyone.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { clearDebugLog, formatDebugLog, hasDebugLog, isDebugLogKey, type DebugRole } from "../debug/debugLog";
import DebugExport from "./DebugExport.vue";

const SECTIONS: { role: DebugRole; title: string }[] = [
  { role: "player", title: "Als Spieler:in" },
  { role: "host", title: "Als Lehrperson" },
];

// The quiz tab keeps writing while this page is open: re-read whenever it
// does, and on demand where a browser leaves out the `storage` event.
const version = ref(0);
const onStorage = (event: StorageEvent) => {
  if (isDebugLogKey(event.key)) version.value++;
};
onMounted(() => window.addEventListener("storage", onStorage));
onUnmounted(() => window.removeEventListener("storage", onStorage));
const logs = computed(() => {
  void version.value;
  return SECTIONS.filter(({ role }) => hasDebugLog(role)).map((section) => ({
    ...section,
    text: formatDebugLog(section.role),
  }));
});

function clear(role: DebugRole) {
  if (!window.confirm("Diagnose-Protokoll auf diesem Gerät löschen?")) return;
  clearDebugLog(role);
  version.value++;
}
</script>

<template>
  <div class="debug-page">
    <h1>Diagnose</h1>
    <p>
      Hier steht, was dieses Gerät während der letzten Quizze erlebt hat: Verbindungsabbrüche, empfangene und
      gesendete Nachrichten, wann der Bildschirm aus war. Das hilft, Probleme zu finden. Das Protokoll verlässt das
      Gerät nur, wenn du es selbst kopierst oder teilst — schick es dann an deine Lehrperson.
    </p>
    <p><button type="button" @click="version++">Aktualisieren</button></p>

    <p v-if="!logs.length">Auf diesem Gerät ist kein Protokoll gespeichert.</p>

    <section v-for="{ role, title, text } in logs" :key="role" class="debug-page__section">
      <h2>{{ title }}</h2>
      <DebugExport :role="role" />
      <button type="button" class="debug-page__clear" @click="clear(role)">Löschen</button>
      <details>
        <summary>Inhalt anzeigen</summary>
        <pre class="debug-page__log">{{ text }}</pre>
      </details>
    </section>
  </div>
</template>

<style scoped>
.debug-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
  text-align: left;
}
.debug-page__section {
  margin-top: 1.5rem;
}
.debug-page__clear {
  padding: 0.2rem 0.4rem;
  background: none;
  border: none;
  color: #888;
  font-size: 0.8rem;
  text-decoration: underline;
  min-height: 1rem;
  cursor: pointer;
}
.debug-page__log {
  max-height: 60vh;
  overflow: auto;
  padding: 0.5rem;
  background: var(--code-bg);
  font-family: var(--mono);
  font-size: 0.75rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
