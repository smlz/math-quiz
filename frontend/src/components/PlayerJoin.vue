<script setup lang="ts">
import { ref } from "vue";
import { joinSession } from "../api/mathQuizClient";

const NICKNAME_STORAGE_KEY = "math-quiz-nickname";

const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
const pin = ref(params.get("pin") ?? "");
const nickname = ref(localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "");
const error = ref("");
const joining = ref(false);

const emit = defineEmits<{ joined: [pin: string, playerId: string, nickname: string] }>();

async function join() {
  error.value = "";
  const trimmedPin = pin.value.trim();
  const trimmedNickname = nickname.value.trim();
  if (!/^\d{6}$/.test(trimmedPin)) {
    error.value = "Gib die 6-stellige Spiel-PIN ein";
    return;
  }
  if (!trimmedNickname) {
    error.value = "Gib einen Nickname ein";
    return;
  }

  joining.value = true;
  try {
    const { player_id } = await joinSession(trimmedPin, trimmedNickname);
    localStorage.setItem(NICKNAME_STORAGE_KEY, trimmedNickname);
    emit("joined", trimmedPin, player_id, trimmedNickname);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <form class="player-join" @submit.prevent="join">
    <h2>Einem Quiz beitreten</h2>
    <label>
      Spiel-PIN
      <input v-model="pin" inputmode="numeric" maxlength="6" placeholder="123456" />
    </label>
    <label>
      Nickname
      <input v-model="nickname" maxlength="30" placeholder="Dein Name" />
    </label>
    <p v-if="error" class="player-join__error">{{ error }}</p>
    <button type="submit" :disabled="joining">{{ joining ? "Trete bei…" : "Beitreten" }}</button>
  </form>
</template>

<style scoped>
.player-join {
  max-width: 320px;
  margin: 3rem auto;
  display: grid;
  gap: 1rem;
  text-align: left;
}
.player-join label {
  display: grid;
  gap: 0.25rem;
  font-weight: 600;
}
.player-join input {
  font-size: 1.1rem;
  padding: 0.5rem;
  box-sizing: border-box;
}
.player-join__error {
  color: #b00020;
}
</style>
