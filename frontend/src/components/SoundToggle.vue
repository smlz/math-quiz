<script setup lang="ts">
import { soundOn, toggleSound } from "../sound/hostSound";
</script>

<template>
  <button
    type="button"
    class="sound-toggle"
    aria-label="Ton"
    :aria-pressed="soundOn"
    :title="soundOn ? 'Musik und Jubel ausschalten' : 'Musik und Jubel einschalten'"
    @click="toggleSound"
  >
    <!-- The current state, like a switch; the title says what a click does. -->
    {{ soundOn ? "🔊 Ton an" : "🔇 Ton aus" }}
  </button>
</template>

<style scoped>
/* Styled like the host's other footer links ("Quiz abbrechen"). */
.sound-toggle {
  padding: 0.2rem 0.4rem;
  background: none;
  border: none;
  color: #888;
  font-size: 0.8rem;
  line-height: 1.2;
  text-decoration: underline;
  min-height: 1rem;
}
</style>
