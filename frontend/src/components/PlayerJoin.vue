<script setup lang="ts">
import { onMounted, ref } from "vue";
import { joinSession } from "../api/quizClient";
import { loadPlayerSession, savePlayerSession, type StoredPlayerSession } from "../api/storedSession";

const NICKNAME_STORAGE_KEY = "math-quiz-nickname";

const params = new URLSearchParams(location.search);
const pin = ref(params.get("pin") ?? "");
const storedNickname = localStorage.getItem(NICKNAME_STORAGE_KEY) ?? "";
const nickname = ref(storedNickname);
const nicknameReadonly = ref(!!storedNickname);
const error = ref("");
const joining = ref(false);
const reconnecting = ref(false);
const autoJoining = ref(false);

const emit = defineEmits<{ joined: [session: StoredPlayerSession] }>();

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
    // Minting an identity is anonymous; the nickname reaches the host as an
    // ordinary message, retried by PlayerApp until the roster confirms it.
    const { playerId, playerToken } = await joinSession(trimmedPin);
    localStorage.setItem(NICKNAME_STORAGE_KEY, trimmedNickname);
    const session: StoredPlayerSession = {
      pin: trimmedPin,
      playerId,
      playerToken,
      nickname: trimmedNickname,
      score: 0,
      selectedIndex: null,
      answeredQuestionIndex: null,
    };
    savePlayerSession(session);
    emit("joined", session);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    joining.value = false;
  }
}

// A stored token means this device already belongs to a player in this quiz.
// Tokens are signed rather than stored server-side, so resuming needs no
// request at all -- and re-joining would only create a duplicate player.
onMounted(async () => {
  const stored = pin.value ? loadPlayerSession(pin.value) : null;
  if (stored) {
    reconnecting.value = true;
    emit("joined", stored);
    return;
  }
  // Opened via the host's QR code with a nickname from an earlier quiz: there
  // is nothing left to ask for, so skip the form entirely.
  if (!storedNickname || !/^\d{6}$/.test(pin.value.trim())) return;
  autoJoining.value = true;
  await join();
  // Only a failed join returns here with the form still mounted.
  autoJoining.value = false;
});
</script>

<template>
  <p v-if="reconnecting" class="player-join__reconnecting">Verbinde wieder…</p>
  <p v-else-if="autoJoining" class="player-join__reconnecting">Trete bei…</p>

  <form v-else class="player-join" @submit.prevent="join()">
    <h2>Einem Quiz beitreten</h2>
    <label>
      Spiel-PIN
      <input v-model="pin" inputmode="numeric" maxlength="6" placeholder="123456" />
    </label>
    <label>
      Nickname
      <input v-model="nickname" :readonly="nicknameReadonly" maxlength="30" placeholder="Dein Name" />
      <button v-if="nicknameReadonly" type="button" class="player-join__change-nickname" @click="nicknameReadonly = false">
        Ändern
      </button>
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
.player-join__reconnecting {
  margin: 3rem auto;
  font-weight: 600;
}
.player-join__change-nickname {
  justify-self: start;
  background: none;
  border: none;
  padding: 0;
  min-height: 0;
  font-size: x-small;
  text-decoration: underline;
  cursor: pointer;
  font-weight: 400;
}
</style>
