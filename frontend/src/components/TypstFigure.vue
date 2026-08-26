<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { renderTypst } from "../quiz/typst";

const props = defineProps<{ source: string }>();

const svg = ref("");
const error = ref<string | null>(null);

async function render() {
  error.value = null;
  try {
    svg.value = await renderTypst(props.source);
  } catch (e) {
    svg.value = "";
    error.value = e instanceof Error ? e.message : String(e);
  }
}

onMounted(render);
watch(() => props.source, render);
</script>

<template>
  <div class="typst-figure">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="svg" class="typst-figure__canvas" v-html="svg"></div>
    <p v-if="error" class="typst-figure__error">Rendering fehlgeschlagen: {{ error }}</p>
  </div>
</template>

<style scoped>
.typst-figure {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.typst-figure__canvas {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.typst-figure__canvas :deep(svg) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.typst-figure__error {
  color: #b00020;
  font-size: 0.85rem;
}
</style>
