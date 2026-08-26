<script setup lang="ts">
import { ref, watch } from "vue";
import QRCode from "qrcode";

const props = defineProps<{
  pin: string;
  nicknames: string[];
}>();

defineEmits<{ start: [] }>();

// BASE_URL already has a trailing slash ("/" in dev, "/math-quiz/" on Pages).
const joinBase = `${location.origin}${import.meta.env.BASE_URL}#/join`;
const joinUrl = `${joinBase}?pin=${props.pin}`;
const qrDataUrl = ref("");

watch(
  () => props.pin,
  async (pin) => {
    qrDataUrl.value = await QRCode.toDataURL(`${joinBase}?pin=${pin}`, { width: 220 });
  },
  { immediate: true },
);
</script>

<template>
  <section class="host-lobby">
    <h2>Beitreten auf {{ joinBase }}</h2>
    <p class="host-lobby__pin">{{ pin }}</p>
    <img v-if="qrDataUrl" :src="qrDataUrl" :alt="`QR-Code für ${joinUrl}`" class="host-lobby__qr" />
    <p class="host-lobby__count">{{ nicknames.length }} Spieler:innen beigetreten</p>
    <ul class="host-lobby__roster">
      <li v-for="nickname in nicknames" :key="nickname">{{ nickname }}</li>
    </ul>
    <button type="button" class="host-lobby__start" :disabled="nicknames.length === 0" @click="$emit('start')">
      Frage starten
    </button>
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
.host-lobby__pin {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: 0.25em;
  margin: 0.5rem 0;
}
.host-lobby__qr {
  margin: 1rem auto;
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
  padding: 0.25rem 0.9rem;
}
</style>
