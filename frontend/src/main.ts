import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { reportException } from './debug/debugLog'

const app = createApp(App)
// Vue catches what a component throws (rendering, hooks, watchers, event
// handlers), which therefore never reaches window's "error" event.
app.config.errorHandler = (error, instance, info) =>
  reportException('vue error', error, { component: instance?.$options.__name ?? '-', info })
app.mount('#app')
