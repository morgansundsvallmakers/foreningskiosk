<script setup>
import { computed, onMounted, ref } from 'vue'
import { statisticsApi } from '../api.js'

const stats = ref(null)
const loading = ref(true)
const error = ref('')
const today = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const exportFrom = ref(today)
const exportTo = ref(today)
const exportType = ref('sales')
const exportValid = computed(() => exportFrom.value && exportTo.value && exportFrom.value <= exportTo.value)
const exportUrl = computed(() => `/api/statistics/export?from=${encodeURIComponent(exportFrom.value)}&to=${encodeURIComponent(exportTo.value)}&type=${encodeURIComponent(exportType.value)}`)

function formatTime(value) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function formatAverage(value) {
  return Number.isInteger(value) ? `${value} kr` : `${value.toFixed(1).replace('.', ',')} kr`
}

onMounted(async () => {
  try {
    stats.value = await statisticsApi.today()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="page statistics-page">
    <p class="eyebrow">Statistik</p>
    <h1>Dagens försäljning</h1>

    <section class="statistics-export" aria-labelledby="export-heading">
      <h2 id="export-heading">Exportera CSV</h2>
      <div class="statistics-export-controls">
        <label>Från<input v-model="exportFrom" type="date" /></label>
        <label>Till<input v-model="exportTo" type="date" /></label>
      </div>
      <fieldset class="statistics-export-types">
        <legend>Innehåll</legend>
        <label>
          <input v-model="exportType" type="radio" value="sales" />
          <strong>Detaljerad försäljning</strong>
        </label>
        <label>
          <input v-model="exportType" type="radio" value="payments" />
          <strong>Betalningar</strong>
        </label>
      </fieldset>
      <div class="statistics-export-action">
        <a v-if="exportValid" class="primary statistics-export-button" :href="exportUrl">Exportera CSV</a>
        <button v-else class="primary statistics-export-button" type="button" disabled>Exportera CSV</button>
      </div>
      <p v-if="!exportValid" class="statistics-export-error">Från-datum får inte vara senare än till-datum.</p>
    </section>

    <p v-if="loading" class="status">Hämtar statistik…</p>
    <p v-else-if="error" class="status error">{{ error }}</p>

    <template v-else-if="stats">
      <div class="statistics-summary">
        <article class="stat-card">
          <span>Köp</span>
          <strong>{{ stats.order_count }}</strong>
        </article>
        <article class="stat-card">
          <span>Försäljning</span>
          <strong>{{ stats.total }} kr</strong>
        </article>
        <article class="stat-card">
          <span>Snitt per köp</span>
          <strong>{{ formatAverage(stats.average) }}</strong>
        </article>
      </div>

      <div v-if="stats.order_count === 0" class="empty-state">
        <h2>Inga köp registrerade idag</h2>
        <p>När ett köp markeras som betalt kommer det att visas här.</p>
      </div>

      <div v-else class="statistics-grid">
        <section class="statistics-panel">
          <h2>Sålda varor</h2>
          <div class="statistics-list">
            <div v-for="product in stats.products" :key="product.name" class="statistics-row">
              <span>{{ product.name }}</span>
              <span>{{ product.quantity }} st</span>
              <strong>{{ product.total }} kr</strong>
            </div>
          </div>
        </section>

        <section class="statistics-panel">
          <h2>Swish-mottagare</h2>
          <div class="statistics-list">
            <div v-for="recipient in stats.recipients" :key="recipient.id" class="statistics-row">
              <span>{{ recipient.name }}</span>
              <span>{{ recipient.orders }} köp</span>
              <strong>{{ recipient.total }} kr</strong>
            </div>
          </div>
        </section>

        <section class="statistics-panel statistics-recent">
          <h2>Senaste köp</h2>
          <div class="statistics-list">
            <div v-for="order in stats.recent" :key="order.id" class="statistics-row">
              <span>{{ formatTime(order.created_at) }}</span>
              <span>{{ order.swish_recipient_name }}</span>
              <strong>{{ order.total }} kr</strong>
            </div>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>
