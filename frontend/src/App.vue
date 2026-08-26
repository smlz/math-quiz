<script setup lang="ts">
import HostApp from './components/HostApp.vue'
import PlayerApp from './components/PlayerApp.vue'
import QuizPreviewScreens from './components/QuizPreviewScreens.vue'

// No router dependency for v1: the host runs at "/", players join via a
// "/#/join?pin=..." link (SPEC.md §4.1/§8), and the setup screen's "Preview"
// button opens "#/preview" in a new tab, so a plain hash check is enough to
// pick which app to mount. Routes live in the hash so any static file server
// can serve the app without SPA rewrite rules.
const route = location.hash.replace(/^#/, '')
const isPlayerRoute = route.startsWith('/join')
const isPreviewRoute = route.startsWith('/preview')
</script>

<template>
  <PlayerApp v-if="isPlayerRoute" />
  <QuizPreviewScreens v-else-if="isPreviewRoute" />
  <HostApp v-else />
</template>
