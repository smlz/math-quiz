<script setup lang="ts">
import { ref, watch } from "vue";
import QRCode from "qrcode";

const props = defineProps<{
  pin: string;
  players: { player_id: string; nickname: string }[];
}>();

defineEmits<{ start: []; end: []; remove: [playerId: string] }>();

// BASE_URL already has a trailing slash; it is "/" both in dev and on
// quiz.smlz.ch, but going through it keeps the link correct if the app is
// ever served from a subpath again.
const joinBase = `${location.origin}${import.meta.env.BASE_URL}join`;
const joinUrl = `${joinBase}?pin=${props.pin}`;
const qrDataUrl = ref("");

watch(
  () => props.pin,
  async (pin) => {
    qrDataUrl.value = await QRCode.toDataURL(`${joinBase}?pin=${pin}`, { width: 400 });
  },
  { immediate: true },
);
</script>

<template>
  <section class="host-lobby">
    <h2>Beitreten auf <a :href="joinBase">{{ joinBase }}</a></h2>
    <p class="host-lobby__pin">{{ pin }}</p>
    <img v-if="qrDataUrl" :src="qrDataUrl" :alt="`QR-Code für ${joinUrl}`" class="host-lobby__qr" />
    <p class="host-lobby__count">{{ players.length }} Spieler:innen beigetreten</p>
    <ul class="host-lobby__roster">
      <li v-for="player in players" :key="player.player_id">
        <span class="host-lobby__name">{{ player.nickname }}</span>
        <button
          type="button"
          class="host-lobby__remove"
          :aria-label="`${player.nickname} entfernen`"
          :title="`${player.nickname} entfernen`"
          @click="$emit('remove', player.player_id)"
        >
          ×
        </button>
      </li>
    </ul>
    <button type="button" class="host-lobby__start" :disabled="players.length === 0" @click="$emit('start')">
      Frage starten
    </button>
    <button type="button" class="host-lobby__end" @click="$emit('end')">Quiz abbrechen</button>
  </section>
</template>

<style scoped>
.host-lobby {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  text-align: center;
}
.host-lobby__start {
  width: 100%;
  margin-top: auto;
}
.host-lobby__end {
  align-self: center;
  margin-top: 0.4rem;
  padding: 0.2rem 0.4rem;
  background: none;
  border: none;
  color: #888;
  font-size: 0.8rem;
  line-height: 1.2;
  text-decoration: underline;
  min-height: 1rem;
}
.host-lobby__pin {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: 0.25em;
  margin: 0.5rem 0;
}
.host-lobby__qr {
  margin: 3rem auto;
  display: block;
}
.host-lobby__count {
  color: #444;
}
.host-lobby__roster {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin-bottom: 1.5rem;
}
.host-lobby__roster li {
  background: #f0f0f0;
  border-radius: 999px;
  padding: 0.25rem 0.5rem 0.25rem 0.9rem;
}
.host-lobby__remove {
  margin-left: 0.4rem;
  padding: 0 0.3rem;
  min-height: 0;
  background: none;
  border: none;
  color: #999;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  /* Unobtrusive on the projector until the teacher points at it. */
  opacity: 0.4;
}
.host-lobby__remove:hover,
.host-lobby__remove:focus-visible {
  opacity: 1;
  color: #b00020;
}
</style>
