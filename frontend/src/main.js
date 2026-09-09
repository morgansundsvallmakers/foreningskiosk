import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import KioskView from './views/KioskView.vue'
import AdminView from './views/AdminView.vue'
import StatisticsView from './views/StatisticsView.vue'
import StartView from './views/StartView.vue'
import './styles.css'
import './admin-auth.css'
import './admin-layout.css'
import './logo-local.css'
import './start-layout.css'
import './statistics-export.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: KioskView },
    { path: '/admin', component: AdminView },
    { path: '/statistik', component: StatisticsView },
    { path: '/start', component: StartView },
  ],
})

createApp(App).use(router).mount('#app')
