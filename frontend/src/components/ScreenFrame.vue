<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

// Reference resolution the host screen is designed around (SPEC.md host
// screen is a projector-style 16:9 display) - content is rendered at this
// canonical size, then uniformly scaled down to whatever width the frame
// ends up with (the frame's own `aspect-ratio: 16/9` CSS keeps its height
// in sync), so the preview always shows the exact same layout as the real
// host screen regardless of the browser window's own aspect ratio.
const REFERENCE_WIDTH = 1280;

const frameEl = ref<HTMLElement | null>(null);
const scale = ref(1);
let observer: ResizeObserver | null = null;

function updateScale() {
  if (!frameEl.value) return;
  scale.value = frameEl.value.clientWidth / REFERENCE_WIDTH;
}

onMounted(() => {
  updateScale();
  observer = new ResizeObserver(updateScale);
  if (frameEl.value) observer.observe(frameEl.value);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="frameEl" class="screen-frame">
    <div class="screen-frame__canvas" :style="{ transform: `scale(${scale})` }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.screen-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--border, #333);
  background: var(--bg, #fff);
  box-shadow: var(--shadow, none);
}
.screen-frame__canvas {
  width: 1280px;
  height: 720px;
  transform-origin: top left;
}
</style>
