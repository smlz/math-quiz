<script setup lang="ts">
defineProps<{
  // Players' phones have no room for more than the essentials.
  compact?: boolean;
}>();

// AGPL §13: users interacting with the app over a network get a way to the
// source. A modified deployment must point this at its own source.
const SOURCE_URL = "https://github.com/smlz/math-quiz";

// The commit this bundle was built from and its tag, if any (vite.config.ts),
// so the link leads to exactly the source that is running; null for what
// couldn't be determined. The tag reads nicer in the URL; the label keeps the
// commit hash, which a moved tag can't change.
declare const __SOURCE_VERSION__: { commit: string | null; tag: string | null };
const { commit, tag } = __SOURCE_VERSION__;
const ref = tag ?? commit;
const sourceHref = ref ? `${SOURCE_URL}/tree/${ref}` : SOURCE_URL;
const versionLabel = [tag, commit?.slice(0, 7)].filter(Boolean).join(", ");
</script>

<template>
  <footer class="app-footer">
    <ul>
      <li>
        <a :href="sourceHref" target="_blank" rel="noopener">
          Quellcode<template v-if="versionLabel && !compact"> ({{ versionLabel }})</template>
        </a>
      </li>
      <li><a :href="`${SOURCE_URL}/blob/main/LICENSE`" target="_blank" rel="noopener">AGPL-3.0</a></li>
      <li><a :href="`${SOURCE_URL}/blob/main/README.md#privacy`" target="_blank" rel="noopener">Datenschutz</a></li>
      <template v-if="!compact">
        <li><a :href="`${SOURCE_URL}/issues`" target="_blank" rel="noopener">Feedback</a></li>
        <li>
          Gesetzt mit
          <a href="https://typst.app" target="_blank" rel="noopener">Typst</a>
          &amp;
          <a href="https://github.com/Myriad-Dreamin/typst.ts" target="_blank" rel="noopener">typst.ts</a>
        </li>
      </template>
    </ul>
  </footer>
</template>

<style scoped>
/* Same box as the host's `.host-app__footer` with its "Quiz abbrechen"
   button, so the bottom line doesn't jump between screens. */
.app-footer {
  margin-top: 0.4rem;
}
.app-footer ul {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  list-style: none;
  white-space: nowrap;
}
.app-footer li {
  padding: 0.2rem 0.4rem;
  color: #888;
  font-size: 0.8rem;
  /* Explicit, because "normal" depends on the font and buttons don't
     inherit the page's; the height matches a button's exactly, where a
     line of text would round up to whole pixels. */
  line-height: 1.2;
  height: 1.2em;
}
.app-footer li + li::before {
  content: "·";
  margin-right: 0.8rem;
}
.app-footer a {
  color: inherit;
}
</style>
