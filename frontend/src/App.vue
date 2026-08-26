<script setup lang="ts">
import HostApp from './components/HostApp.vue'
import PlayerApp from './components/PlayerApp.vue'
import QuizDocs from './components/QuizDocs.vue'

// No router dependency for v1: the host runs at "/" and players join via a
// "/#/join?pin=..." link (SPEC.md §4.1/§8), so a plain hash check is enough
// to pick which app to mount. Routes live in the hash so any static file
// server can serve the app without SPA rewrite rules.
const route = location.hash.replace(/^#/, '')
const isPlayerRoute = route.startsWith('/join')
const isDocsRoute = route.startsWith('/docs')
</script>

<template>
  <PlayerApp v-if="isPlayerRoute" />
  <QuizDocs v-else-if="isDocsRoute" />
  <HostApp v-else />
</template>
