<script setup lang="ts">
import HostApp from './components/HostApp.vue'
import PlayerApp from './components/PlayerApp.vue'
import QuizDocs from './components/QuizDocs.vue'

// No router dependency for v1: the host runs at "/" and players join via a
// "/join?pin=..." link (SPEC.md §4.1/§8). Real paths work on GitHub Pages
// thanks to public/404.html's redirect trick (see index.html's matching
// decode script), so there's no need to hide routes in the hash anymore.
const route = location.pathname
const isPlayerRoute = route.startsWith('/join')
const isDocsRoute = route.startsWith('/docs')
</script>

<template>
  <PlayerApp v-if="isPlayerRoute" />
  <QuizDocs v-else-if="isDocsRoute" />
  <HostApp v-else />
</template>
