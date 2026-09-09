<script setup>
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
let operatorShortcutTimer = null

function startOperatorShortcut() {
  clearOperatorShortcut()
  operatorShortcutTimer = window.setTimeout(() => {
    router.push('/admin')
  }, 2000)
}

function clearOperatorShortcut() {
  if (operatorShortcutTimer) {
    window.clearTimeout(operatorShortcutTimer)
    operatorShortcutTimer = null
  }
}
</script>

<template>
  <div class="app-shell">
    <button
      v-if="route.path === '/'"
      class="operator-shortcut"
      type="button"
      aria-label="Operatörsgenväg"
      @pointerdown="startOperatorShortcut"
      @pointerup="clearOperatorShortcut"
      @pointercancel="clearOperatorShortcut"
      @pointerleave="clearOperatorShortcut"
      @contextmenu.prevent
    ></button>
    <header v-if="route.path !== '/'" class="site-header">
      <RouterLink class="brand" to="/start">Föreningskiosken</RouterLink>
      <nav aria-label="Huvudmeny">
        <RouterLink to="/start">Start</RouterLink>
        <RouterLink to="/">Kiosk</RouterLink>
        <RouterLink to="/admin">Admin</RouterLink>
        <RouterLink to="/statistik">Statistik</RouterLink>
      </nav>
    </header>
    <main><RouterView /></main>
  </div>
</template>

<style scoped>
.operator-shortcut {
  position: fixed;
  z-index: 100;
  top: 0;
  left: 0;
  width: 72px;
  height: 72px;
  padding: 0;
  border: 0;
  opacity: 0;
  background: transparent;
  touch-action: none;
}
</style>
