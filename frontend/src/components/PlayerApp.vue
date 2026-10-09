<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import {
  pointsForReveal,
  sendMessage,
  subscribeToState,
  STALE_AFTER_MS,
  type ConnectionStatus,
  type SessionSnapshot,
} from "../api/quizClient";
import {
  clearPlayerSession,
  forgetNickname,
  savePlayerSession,
  type StoredPlayerSession,
} from "../api/storedSession";
import PlayerAnswerGrid from "./PlayerAnswerGrid.vue";
import PlayerJoin from "./PlayerJoin.vue";
import PlayerQuestion from "./PlayerQuestion.vue";

type Status = "join" | "lobby" | "question" | "reveal" | "leaderboard" | "finished";

/** How often an unconfirmed message is re-sent until a snapshot shows it
 * landed. This is the whole of the delivery guarantee. */
const RETRY_MS = 2000;

const status = ref<Status>("join");
const connection = ref<ConnectionStatus>("open");
const pin = ref<string | null>(null);
const playerId = ref<string | null>(null);
const playerToken = ref<string | null>(null);
const nickname = ref<string | null>(null);

const currentQuestionIndex = ref<number | null>(null);
const selectedIndex = ref<number | null>(null);
const answeredQuestionIndex = ref<number | null>(null);
const joinAcknowledged = ref(false);
const answerAcknowledged = ref(false);
const lastPoints = ref(0);
const revealCorrectIndex = ref<number | null>(null);
const myScore = ref(0);
const myRank = ref<number | null>(null);
// Prefill and explanation for the join form after the host removed us.
const joinPin = ref<string | undefined>();
const joinNotice = ref<string | undefined>();

// The host re-broadcasts the same reveal snapshot every few seconds, so the
// score must only be taken from the first one seen per question.
let scoredQuestionIndex = -1;

let unsubscribe: (() => void) | null = null;
let retryTimer: number | null = null;
let lastSnapshotAt = 0;

// Non-gameplay states (no answer grid) get their content vertically centered,
// except leaderboard, which aligns to the top (bottom stays reserved/empty,
// matching the host's button-anchored-to-bottom layout).
const isCenteredState = computed(() => status.value === "lobby" || status.value === "finished");

/** The only thing that drives this screen. Every snapshot is complete, so it
 * is applied from scratch rather than merged -- missing one costs nothing but
 * the wait for the next. */
function handleSnapshot(snapshot: SessionSnapshot) {
  lastSnapshotAt = Date.now();
  connection.value = "open";

  const me = playerId.value;
  if (!me) return;
  if (snapshot.removed?.includes(me)) {
    leaveAfterRemoval();
    return;
  }
  const listed = snapshot.players.includes(me);

  if (snapshot.phase === "question" && snapshot.question_index !== currentQuestionIndex.value) {
    currentQuestionIndex.value = snapshot.question_index;
    selectedIndex.value = null;
    answeredQuestionIndex.value = null;
    answerAcknowledged.value = false;
    revealCorrectIndex.value = null;
  }

  switch (snapshot.phase) {
    case "lobby":
      joinAcknowledged.value = listed;
      status.value = "lobby";
      break;
    case "question":
      // During a question the list is who has answered, so being in it also
      // proves the join landed.
      answerAcknowledged.value = listed;
      if (listed) joinAcknowledged.value = true;
      status.value = "question";
      break;
    case "reveal":
      revealCorrectIndex.value = snapshot.correct_index ?? null;
      if (scoredQuestionIndex !== snapshot.question_index) {
        scoredQuestionIndex = snapshot.question_index ?? -1;
        lastPoints.value = pointsForReveal(snapshot.players, me);
        myScore.value += lastPoints.value;
        persist();
      }
      status.value = "reveal";
      break;
    case "leaderboard":
    case "finished": {
      const position = snapshot.players.indexOf(me);
      myRank.value = position === -1 ? null : position + 1;
      if (listed) joinAcknowledged.value = true;
      status.value = snapshot.phase;
      if (snapshot.phase === "finished") {
        // The quiz is over, so the reconnect credential has no further use.
        if (pin.value) clearPlayerSession(pin.value);
        teardown();
      }
      break;
    }
  }
}

// The score and the player's own choice are the only state nobody else keeps
// for us, so they have to survive a reload locally.
function persist() {
  if (!pin.value || !playerId.value || !playerToken.value || !nickname.value) return;
  savePlayerSession({
    pin: pin.value,
    playerId: playerId.value,
    playerToken: playerToken.value,
    nickname: nickname.value,
    score: myScore.value,
    selectedIndex: selectedIndex.value,
    answeredQuestionIndex: answeredQuestionIndex.value,
  });
}

/** Re-sends whatever the host has not confirmed yet, and notices when
 * snapshots stop arriving. */
function tick() {
  if (!pin.value || !playerToken.value) return;

  if (!joinAcknowledged.value && nickname.value) {
    void sendMessage(pin.value, playerToken.value, {
      type: "join",
      nickname: nickname.value,
    }).catch(() => {});
  } else if (
    status.value === "question" &&
    selectedIndex.value !== null &&
    !answerAcknowledged.value &&
    currentQuestionIndex.value !== null
  ) {
    void sendMessage(pin.value, playerToken.value, {
      type: "answer",
      question_index: currentQuestionIndex.value,
      option_index: selectedIndex.value,
    }).catch(() => {});
  }

  if (Date.now() - lastSnapshotAt > STALE_AFTER_MS) connection.value = "reconnecting";
}

function teardown() {
  unsubscribe?.();
  unsubscribe = null;
  if (retryTimer !== null) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

/** The host removed this player, most likely over its nickname. The id is
 * dead for this session, so forget it along with the remembered name and
 * offer the join form again: joining anew mints a fresh id under a new name. */
function leaveAfterRemoval() {
  teardown();
  if (pin.value) clearPlayerSession(pin.value);
  forgetNickname();
  joinPin.value = pin.value ?? undefined;
  joinNotice.value = "Die Lehrperson hat dich aus dem Quiz entfernt. Wähle einen anderen Namen, um wieder beizutreten.";

  playerId.value = null;
  playerToken.value = null;
  nickname.value = null;
  currentQuestionIndex.value = null;
  selectedIndex.value = null;
  answeredQuestionIndex.value = null;
  joinAcknowledged.value = false;
  answerAcknowledged.value = false;
  lastPoints.value = 0;
  revealCorrectIndex.value = null;
  myScore.value = 0;
  myRank.value = null;
  scoredQuestionIndex = -1;
  status.value = "join";
}

function onJoined(session: StoredPlayerSession) {
  joinNotice.value = undefined;
  pin.value = session.pin;
  playerId.value = session.playerId;
  playerToken.value = session.playerToken;
  nickname.value = session.nickname;
  myScore.value = session.score;
  selectedIndex.value = session.selectedIndex;
  answeredQuestionIndex.value = session.answeredQuestionIndex;
  // Seeded so the first snapshot for the question we already answered is not
  // mistaken for a new one and does not clear the locked-in pick.
  currentQuestionIndex.value = session.answeredQuestionIndex;
  status.value = "lobby";
  lastSnapshotAt = Date.now();

  unsubscribe = subscribeToState(session.pin, handleSnapshot, (state) => {
    connection.value = state;
  });
  retryTimer = window.setInterval(tick, RETRY_MS);
  tick();
}

async function answer(optionIndex: number) {
  if (!pin.value || !playerToken.value || currentQuestionIndex.value === null) return;
  if (selectedIndex.value !== null) return;
  selectedIndex.value = optionIndex;
  answeredQuestionIndex.value = currentQuestionIndex.value;
  persist();
  try {
    await sendMessage(pin.value, playerToken.value, {
      type: "answer",
      question_index: currentQuestionIndex.value,
      option_index: optionIndex,
    });
  } catch {
    // `tick` keeps re-sending until a snapshot confirms it arrived.
  }
}

onUnmounted(teardown);
</script>

<template>
  <div class="player-app">
    <PlayerJoin v-if="status === 'join'" :initial-pin="joinPin" :notice="joinNotice" @joined="onJoined" />

    <template v-else>
      <header class="player-app__header">
        <p class="player-app__nickname">{{ nickname }}</p>
        <p v-if="connection === 'reconnecting'" class="player-app__reconnecting">
          Verbindung wird wiederhergestellt …
        </p>
      </header>

      <main class="player-app__main" :class="{ 'player-app__main--center': isCenteredState }">
        <div v-if="status === 'lobby'" class="player-app__panel">
          <h2>Du bist dabei, {{ nickname }}!</h2>
          <p>Warte, bis das Quiz startet…</p>
        </div>

        <template v-else-if="status === 'question'">
          <p class="player-app__instruction">
            {{ selectedIndex !== null ? "Antwort abgeschickt — warte auf Auflösung…" : "Jetzt antworten!" }}
          </p>
          <PlayerQuestion :selected-index="selectedIndex" @answer="answer" />
        </template>

        <template v-else-if="status === 'reveal'">
          <h2 v-if="lastPoints > 0" class="player-app__instruction player-app__reveal-correct">
            Richtig! +{{ lastPoints }} Punkte
          </h2>
          <h2 v-else class="player-app__instruction player-app__reveal-wrong">Falsch. +0 Punkte</h2>
          <p class="player-app__total-score">Gesamtpunktzahl: {{ myScore }}</p>
          <PlayerAnswerGrid
            :selected-index="selectedIndex"
            :correct-index="revealCorrectIndex"
            :disabled="true"
          />
        </template>

        <div v-else-if="status === 'leaderboard'" class="player-app__panel player-app__panel--top">
          <h2>Rangliste</h2>
          <p v-if="myRank">Du bist auf Platz {{ myRank }} mit {{ myScore }} Punkten</p>
        </div>

        <div v-else-if="status === 'finished'" class="player-app__panel">
          <h2>Quiz beendet!</h2>
          <p v-if="myRank">Du hast auf Platz {{ myRank }} mit {{ myScore }} Punkten abgeschlossen</p>
        </div>
      </main>
    </template>
  </div>
</template>

<style scoped>
.player-app {
  width: 100%;
  height: 100dvh;
  margin: 0;
  padding: 1rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  text-align: center;
}
.player-app__header {
  flex: 0 0 auto;
}
.player-app__nickname {
  margin: 0 0 0.5rem;
  font-weight: 700;
  color: #444;
}
.player-app__reconnecting {
  margin: 0 0 0.5rem;
  padding: 0.3rem 0.5rem;
  background: #b8860b;
  color: #fff;
  font-weight: 600;
  border-radius: 4px;
}
.player-app__main {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
}
.player-app__main--center {
  justify-content: center;
  align-items: center;
}
.player-app__panel {
  width: 100%;
  max-width: 480px;
  margin: auto;
}
.player-app__panel--top {
  margin: 0 auto;
}
.player-app__instruction {
  margin: 0 0 0.75rem;
  font-size: 1.1rem;
}
.player-app__reveal-correct {
  color: #1a7a1a;
}
.player-app__reveal-wrong {
  color: #c00000;
}
.player-app__total-score {
  margin: 0 0 0.75rem;
  color: #444;
}
.player-app__standings {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 0.4rem;
  text-align: left;
}
.player-app__standings li {
  padding: 0.4rem 0.8rem;
  border: 1px solid #eee;
  border-radius: 6px;
}
.player-app__me {
  border-color: #1565c0 !important;
  background: #e3f2fd;
  font-weight: 600;
}
</style>
