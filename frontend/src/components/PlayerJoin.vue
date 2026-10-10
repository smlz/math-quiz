<script setup lang="ts">
import { onMounted, ref } from "vue";
import { joinSession } from "../api/quizClient";
import {
  loadNickname,
  loadPlayerSession,
  saveNickname,
  savePlayerSession,
  type StoredPlayerSession,
} from "../api/storedSession";

const props = defineProps<{
  /** Pin to prefill when the link that opened the page carries none. */
  initialPin?: string;
  /** Shown above the form, e.g. after the host removed this player. */
  notice?: string;
}>();

const params = new URLSearchParams(location.search);
const pin = ref(params.get("pin") ?? props.initialPin ?? "");
// The lobby's QR code carries the pin, so a link with one was opened by a
// pupil mid-lesson, who has no use for the way to the host page.
const showCreateLink = !params.has("pin");
const storedNickname = loadNickname();
const nickname = ref(storedNickname);
const nicknameReadonly = ref(!!storedNickname);
const error = ref("");
const joining = ref(false);
const reconnecting = ref(false);

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
    saveNickname(trimmedNickname);
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
//
// Anything else always waits for a tap, even with the pin and a nickname from
// an earlier quiz already filled in: joining on load would let any
// `/?pin=...` link, from anyone, hand this device's nickname to whatever
// session it names.
onMounted(() => {
  const stored = pin.value ? loadPlayerSession(pin.value) : null;
  if (stored) {
    reconnecting.value = true;
    emit("joined", stored);
  }
});
</script>

<template>
  <p v-if="reconnecting" class="player-join__reconnecting">Verbinde wieder…</p>

  <form v-else class="player-join" @submit.prevent="join()">
    <h2>Einem Quiz beitreten</h2>
    <p v-if="notice" class="player-join__notice">{{ notice }}</p>
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
    <a v-if="showCreateLink" class="player-join__create" href="/create">Eigenes Quiz erstellen</a>
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
.player-join__notice {
  margin: 0;
  padding: 0.6rem 0.8rem;
  background: #fff4e5;
  border-radius: 6px;
}
.player-join__error {
  color: #b00020;
}
.player-join__create {
  justify-self: center;
  font-size: 0.9rem;
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
