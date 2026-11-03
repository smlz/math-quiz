<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { baseNickname, type PlayerRow } from "../quiz/roster";

// The whole roster for the teacher, during the game. The projected
// leaderboard shows the top five only and has no buttons on purpose; this
// list is opened on demand, mainly to clean up a pupil who ended up in the
// roster twice: their points move to the entry they play on now.

const props = defineProps<{ players: PlayerRow[] }>();
const emit = defineEmits<{ close: []; remove: [playerId: string]; merge: [sourceId: string, targetId: string] }>();

const dialog = ref<HTMLDialogElement | null>(null);
onMounted(() => dialog.value?.showModal());

const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });

// By name, so that "Ada" and "Ada (2)" end up next to each other.
const rows = computed(() => [...props.players].sort((a, b) => collator.compare(a.nickname, b.nickname)));

/** Everyone the points could go to, a name's namesakes first. */
function targetsFor(player: PlayerRow): PlayerRow[] {
  const base = baseNickname(player.nickname);
  const others = rows.value.filter((other) => other.player_id !== player.player_id);
  return [
    ...others.filter((other) => baseNickname(other.nickname) === base),
    ...others.filter((other) => baseNickname(other.nickname) !== base),
  ];
}

function activity(player: PlayerRow): string {
  return player.lastSeen < 0 ? "noch nie geantwortet" : `zuletzt dabei bei Frage ${player.lastSeen + 1}`;
}

function onMerge(player: PlayerRow, event: Event) {
  const select = event.target as HTMLSelectElement;
  const targetId = select.value;
  // Back to the prompt, whether the teacher confirms or not.
  select.value = "";
  if (targetId) emit("merge", player.player_id, targetId);
}
</script>

<template>
  <dialog ref="dialog" class="host-players" aria-labelledby="host-players-title" @close="emit('close')">
    <h2 id="host-players-title">Spieler:innen</h2>
    <p class="host-players__hint">
      Steht jemand doppelt in der Liste, übertrage die Punkte des Eintrags, der nicht mehr mitspielt, auf den
      aktuellen.
    </p>
    <ul class="host-players__list">
      <li
        v-for="player in rows"
        :key="player.player_id"
        class="host-players__row"
        :class="{ 'host-players__row--missed': player.missedLatest }"
      >
        <span class="host-players__name">{{ player.nickname }}</span>
        <span class="host-players__score">{{ player.score }} Punkte</span>
        <span class="host-players__activity">{{ activity(player) }}</span>
        <select
          class="host-players__merge"
          :aria-label="`Punkte von ${player.nickname} übertragen`"
          :disabled="rows.length < 2"
          @change="onMerge(player, $event)"
        >
          <option value="" selected>Punkte übertragen an …</option>
          <option v-for="other in targetsFor(player)" :key="other.player_id" :value="other.player_id">
            {{ other.nickname }}
          </option>
        </select>
        <button
          type="button"
          class="host-players__remove"
          :aria-label="`${player.nickname} entfernen`"
          @click="emit('remove', player.player_id)"
        >
          Entfernen
        </button>
      </li>
    </ul>
    <button type="button" class="host-players__close" @click="dialog?.close()">Schließen</button>
  </dialog>
</template>

<style scoped>
.host-players {
  width: min(48rem, calc(100vw - 2rem));
  background: var(--bg);
  color: var(--text-h);
  max-height: calc(100dvh - 2rem);
  padding: 1rem 1.25rem;
  border: none;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  text-align: left;
}
.host-players::backdrop {
  background: rgba(0, 0, 0, 0.45);
}
.host-players h2 {
  margin: 0 0 0.25rem;
}
.host-players__hint {
  margin: 0 0 0.75rem;
  color: var(--text);
  font-size: 0.9rem;
}
.host-players__list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}
.host-players__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--text) 25%, transparent);
}
.host-players__row--missed {
  opacity: 0.55;
}
.host-players__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.host-players__score {
  font-variant-numeric: tabular-nums;
}
.host-players__activity {
  color: var(--text);
  font-size: 0.85rem;
}
.host-players__merge {
  max-width: 12rem;
}
.host-players__remove {
  min-height: 0;
  padding: 0.2rem 0.5rem;
}
.host-players__close {
  display: block;
  margin-left: auto;
}
@media (max-width: 40rem) {
  .host-players__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
