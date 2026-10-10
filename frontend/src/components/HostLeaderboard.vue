<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { LeaderboardEntry } from "../quiz/types";

const props = defineProps<{
  standings: LeaderboardEntry[];
  /** The same players as they stood before the last question was scored.
   * When given, the leaderboard appears in that state and then turns into
   * `standings`; without it, `standings` are simply shown. */
  previous?: LeaderboardEntry[] | null;
  finished: boolean;
}>();

// Only the top 5 players are shown, regardless of how many joined.
const TOP_N = 5;

// Milliseconds, in the order the phases play.
const TIMING = {
  hold: 600, // the old leaderboard stands still before anything happens
  stagger: 90, // delay between one row's "+12" and the next one's
  gainLead: 200, // the "+12" is readable before its score starts counting
  count: 900, // counting a score up
  settle: 300, // pause between the points and the reordering
  move: 900, // rows travelling to their new places
  swap: 160, // a rank number fading out, and again fading back in
  linger: 900, // how long the "+12" stays once everything has settled
  fade: 300, // "+12" fading out, ▲/▼ fading in
  pop: 350, // "+12" popping in, and the bump of a finished score
};

interface Row extends LeaderboardEntry {
  /** Position in the list. `TOP_N` and beyond is parked below it, where rows
   * enter from and leave to. */
  slot: number;
  out: boolean;
  rising: boolean;
  swappingRank: boolean;
  /** Ranks climbed in the last question (negative: dropped); 0 shows nothing. */
  climbed: number;
  /** Points won in the last question; 0 shows nothing. */
  gain: number;
  gainFading: boolean;
  bumped: boolean;
}

function toRow(entry: LeaderboardEntry, slot: number, climbed = 0): Row {
  return {
    ...entry,
    slot,
    climbed,
    out: false,
    rising: false,
    swappingRank: false,
    gain: 0,
    gainFading: false,
    bumped: false,
  };
}

const listEl = ref<HTMLElement | null>(null);
const rows = ref<Row[]>((props.previous ?? props.standings).slice(0, TOP_N).map((entry, slot) => toRow(entry, slot)));
const shownCount = computed(() => rows.value.filter((row) => !row.out).length);

let animating = false;
let alive = true;

/** Shows the standings as they are, keeping the ▲/▼ markers. Rows are put in
 * rank order here and nowhere else: moving an element in the document cuts
 * off its running transitions, so the animation leaves the order alone. */
function showStandings() {
  const climbed = new Map(rows.value.map((row) => [row.player_id, row.climbed]));
  rows.value = props.standings
    .slice(0, TOP_N)
    .map((entry, slot) => toRow(entry, slot, climbed.get(entry.player_id) ?? 0));
}

// Never resolves once the component is gone, which abandons a running
// animation wherever it happens to be.
function sleep(duration: number) {
  return new Promise<void>((resolve) => setTimeout(() => alive && resolve(), duration));
}

function countUp(row: Row, to: number) {
  const from = row.score;
  return new Promise<void>((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      if (!alive) return;
      const t = Math.min(1, Math.max(0, (now - start) / TIMING.count));
      const eased = 1 - (1 - t) ** 2; // fast at first, settling on the final value
      row.score = Math.round(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** Changes the rank number while the row is in flight. */
async function swapRank(row: Row, rank: number) {
  const climbed = row.rank - rank;
  await sleep(TIMING.move * 0.35);
  if (climbed !== 0) {
    row.swappingRank = true;
    await sleep(TIMING.swap);
    row.rank = rank;
    row.swappingRank = false;
  }
  row.climbed = climbed;
}

/** Turns the leaderboard `from` into the leaderboard `to`:
 *  1. points: "+12" appears next to each score, which then counts up;
 *  2. order: rows travel to their new places, rank numbers change on the way;
 *  3. the "+12" markers fade, the ▲/▼ markers stay. */
async function play(from: LeaderboardEntry[], to: LeaderboardEntry[]) {
  animating = true;
  await sleep(TIMING.hold);

  const before = new Map(from.map((entry, index) => [entry.player_id, { ...entry, index }]));
  const after = new Map(to.map((entry, index) => [entry.player_id, { ...entry, index }]));

  // 1. Points
  let scorers = 0;
  await Promise.all(
    rows.value.map(async (row) => {
      const target = after.get(row.player_id)?.score ?? row.score;
      if (target === row.score) return;
      await sleep(scorers++ * TIMING.stagger);
      row.gain = target - row.score;
      await sleep(TIMING.gainLead);
      await countUp(row, target);
      row.bumped = true;
    }),
  );
  if (scorers > 0) await sleep(TIMING.settle);

  // 2. Order
  // Newcomers were below the fold while the points were counted, so they
  // arrive with their new score already in place.
  const newcomers = to.slice(0, TOP_N).filter((entry) => (before.get(entry.player_id)?.index ?? TOP_N) >= TOP_N);
  newcomers.forEach((entry, i) => {
    const was = before.get(entry.player_id) ?? entry;
    rows.value.push({ ...toRow(entry, TOP_N + i), rank: was.rank, gain: entry.score - was.score, out: true });
  });
  // They have to be rendered in their parking slots before they can travel.
  await nextTick();
  void listEl.value?.offsetHeight;

  const indexAfter = (row: Row) => after.get(row.player_id)?.index ?? Infinity;
  const leaving = rows.value.filter((row) => indexAfter(row) >= TOP_N).sort((a, b) => indexAfter(a) - indexAfter(b));
  leaving.forEach((row, i) => {
    row.slot = TOP_N + i;
    row.out = true;
  });
  for (const row of rows.value) {
    const now = after.get(row.player_id);
    if (!now || now.index >= TOP_N) continue;
    row.rising = now.index < row.slot;
    row.slot = now.index;
    row.out = false;
    void swapRank(row, now.rank);
  }

  await sleep(TIMING.move);
  rows.value = rows.value.filter((row) => !row.out);
  for (const row of rows.value) row.rising = false;

  // 3. Aftermath
  if (rows.value.some((row) => row.gain > 0)) {
    await sleep(TIMING.linger);
    for (const row of rows.value) row.gainFading = true;
    await sleep(TIMING.fade);
  }

  animating = false;
  // Also picks up whatever changed meanwhile, e.g. a late joiner.
  showStandings();
}

watch(
  () => props.standings,
  () => {
    if (!animating) showStandings();
  },
);

onMounted(() => {
  if (props.previous) void play(props.previous, props.standings);
});
onUnmounted(() => {
  alive = false;
});
</script>

<template>
  <section class="leaderboard">
    <h2>{{ finished ? "Endergebnis" : "Rangliste" }}</h2>
    <ol ref="listEl" class="leaderboard__list" :style="{ '--rows': shownCount }">
      <li
        v-for="row in rows"
        :key="row.player_id"
        class="leaderboard__row"
        :class="{ 'leaderboard__row--out': row.out, 'leaderboard__row--rising': row.rising }"
        :style="{ '--slot': row.slot }"
      >
        <span class="leaderboard__rank" :class="{ 'leaderboard__rank--swapping': row.swappingRank }">{{ row.rank }}</span>
        <span
          class="leaderboard__trend"
          :class="{ 'leaderboard__trend--up': row.climbed > 0, 'leaderboard__trend--down': row.climbed < 0 }"
        >{{ row.climbed > 0 ? `▲${row.climbed}` : row.climbed < 0 ? `▼${-row.climbed}` : "" }}</span>
        <span class="leaderboard__nickname">{{ row.nickname }}</span>
        <span v-if="row.gain > 0" class="leaderboard__gain" :class="{ 'leaderboard__gain--fading': row.gainFading }">+{{ row.gain }}</span>
        <span class="leaderboard__score" :class="{ 'leaderboard__score--bumped': row.bumped }">{{ row.score }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.leaderboard {
  --up: #1a7f37;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
@media (prefers-color-scheme: dark) {
  .leaderboard {
    --up: #4ade80;
  }
}
/* Rows are positioned by slot rather than by document order: reordering is
   then nothing but a change of `--slot`, which the transform transition
   turns into movement. */
.leaderboard__list {
  --row-h: 2.6rem;
  --row-gap: 0.4rem;
  position: relative;
  width: 100%;
  max-width: 480px;
  height: calc(var(--rows) * var(--row-h) + (var(--rows) - 1) * var(--row-gap));
  list-style: none;
  padding: 0;
  margin: 1rem 0;
}
.leaderboard__row {
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--row-h);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 0.9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  /* Opaque, because rows pass over each other while changing places. */
  background: var(--bg);
  text-align: left;
  transform: translateY(calc(var(--slot) * (var(--row-h) + var(--row-gap))));
  transition:
    transform v-bind("TIMING.move + 'ms'") cubic-bezier(0.65, 0, 0.35, 1),
    opacity v-bind("TIMING.move + 'ms'") ease;
}
.leaderboard__row--out {
  opacity: 0;
}
/* A row moving up travels in front of the ones it overtakes. */
.leaderboard__row--rising {
  z-index: 1;
  animation: leaderboard-lift v-bind("TIMING.move + 'ms'") ease-in-out;
}
@keyframes leaderboard-lift {
  50% {
    scale: 1.04;
    border-color: var(--accent-border);
    box-shadow: var(--shadow);
  }
}
.leaderboard__rank {
  font-weight: 700;
  min-width: 1.5rem;
  transition: opacity v-bind("TIMING.swap + 'ms'") ease;
}
.leaderboard__rank--swapping {
  opacity: 0;
}
.leaderboard__trend {
  min-width: 2rem;
  margin-left: -0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: 0;
  transition: opacity v-bind("TIMING.fade + 'ms'") ease;
}
.leaderboard__trend--up,
.leaderboard__trend--down {
  opacity: 1;
}
.leaderboard__trend--up {
  color: var(--up);
}
.leaderboard__nickname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-h);
}
.leaderboard__gain {
  padding: 0 0.45rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  background: var(--accent-bg);
  animation: leaderboard-pop v-bind("TIMING.pop + 'ms'") cubic-bezier(0.34, 1.56, 0.64, 1);
  transition: opacity v-bind("TIMING.fade + 'ms'") ease;
}
@keyframes leaderboard-pop {
  from {
    opacity: 0;
    scale: 0.6;
  }
}
.leaderboard__gain--fading {
  opacity: 0;
}
.leaderboard__score {
  min-width: 3ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--text-h);
}
.leaderboard__score--bumped {
  animation: leaderboard-bump v-bind("TIMING.pop + 'ms'") ease-out;
}
@keyframes leaderboard-bump {
  40% {
    scale: 1.3;
    color: var(--accent);
  }
}
</style>
