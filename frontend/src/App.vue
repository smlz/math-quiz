<script setup lang="ts">
import HostApp from './components/HostApp.vue'
import PlayerApp from './components/PlayerApp.vue'
import QuizAbout from './components/QuizAbout.vue'
import QuizDocs from './components/QuizDocs.vue'

// No router dependency for v1: players join at "/" (the lobby's QR code adds
// "?pin=..."), the host runs at "/create" (SPEC.md §4.1/§8). Real paths work
// on GitHub Pages thanks to public/404.html's redirect trick (see index.html's
// matching decode script), so there's no need to hide routes in the hash
// anymore.
const route = location.pathname
const isHostRoute = route.startsWith('/create')
const isDocsRoute = route.startsWith('/docs')
const isAboutRoute = route.startsWith('/about')
</script>

<template>
  <HostApp v-if="isHostRoute" />
  <QuizDocs v-else-if="isDocsRoute" />
  <QuizAbout v-else-if="isAboutRoute" />
  <PlayerApp v-else />
</template>
