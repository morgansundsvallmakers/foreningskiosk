<script setup>
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { orderApi, paymentApi, productApi } from '../api.js'

const products = ref([])
const quantities = ref({})
const step = ref('select')
const loading = ref(true)
const error = ref('')
const recipient = ref(null)
const loadingPayment = ref(false)
const qrCode = ref('')
const savingOrder = ref(false)
const paymentError = ref('')
const clientOrderId = ref('')

const selectedItems = computed(() => products.value
  .filter((product) => (quantities.value[product.id] || 0) > 0)
  .map((product) => ({
    ...product,
    quantity: quantities.value[product.id],
    subtotal: quantities.value[product.id] * product.price,
  })))
const total = computed(() => selectedItems.value.reduce((sum, item) => sum + item.subtotal, 0))

function swishPayload(number, amount) {
  return `C${number};${amount.toFixed(2).replace('.', ',')};;0`
}

function createClientOrderId() {
  if (typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID()
  const bytes = window.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function loadSwishRecipient() {
  const payment = await paymentApi.swish()
  recipient.value = payment.recipient || null
  if (!recipient.value) throw new Error('Swish-mottagaren kunde inte hämtas.')
}

async function showPayment() {
  if (loadingPayment.value) return
  loadingPayment.value = true
  recipient.value = null
  qrCode.value = ''
  paymentError.value = ''
  try {
    await loadSwishRecipient()
    clientOrderId.value = createClientOrderId()
    if (total.value > 0) {
      qrCode.value = await QRCode.toDataURL(swishPayload(recipient.value.number, total.value), {
        width: 600,
        margin: 3,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  } catch (err) {
    paymentError.value = err.message || 'Swish-betalningen kunde inte förberedas.'
  } finally {
    loadingPayment.value = false
    step.value = 'payment'
  }
}

async function completePayment() {
  if (savingOrder.value) return
  savingOrder.value = true
  paymentError.value = ''
  try {
    if (!recipient.value) await loadSwishRecipient()
    await orderApi.create({
      client_order_id: clientOrderId.value,
      total: total.value,
      swish_recipient_id: recipient.value?.id,
      items: selectedItems.value.map((item) => ({ product_id: item.id, quantity: item.quantity })),
    })
    reset()
  } catch (err) {
    paymentError.value = err.message || 'Köpet kunde inte sparas. Försök igen.'
  } finally {
    savingOrder.value = false
  }
}

function changeQuantity(id, change) {
  quantities.value[id] = Math.max(0, (quantities.value[id] || 0) + change)
}

function reset() {
  quantities.value = {}
  recipient.value = null
  qrCode.value = ''
  paymentError.value = ''
  clientOrderId.value = ''
  step.value = 'select'
}

onMounted(async () => {
  try {
    products.value = await productApi.active()
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section v-if="step === 'select'" class="page kiosk-page">
    <div class="page-heading">
      <div><p class="eyebrow">Kiosk</p><h1>Vad vill du köpa?</h1></div>
      <div class="total-badge">Totalt <strong>{{ total }} kr</strong></div>
    </div>
    <p v-if="loading" class="status">Hämtar produkter…</p>
    <p v-else-if="error" class="status error">{{ error }}</p>
    <p v-else-if="products.length === 0" class="status">Det finns inga aktiva produkter just nu.</p>
    <div class="product-grid">
      <article v-for="product in products" :key="product.id" class="product-card">
        <div class="product-card-heading">
          <h2>{{ product.name }}</h2>
          <p class="price">{{ product.price }} kr</p>
        </div>
        <div class="quantity" :aria-label="`Antal ${product.name}`">
          <button type="button" :disabled="!quantities[product.id]" :aria-label="`Minska ${product.name}`" @click="changeQuantity(product.id, -1)">−</button>
          <output>{{ quantities[product.id] || 0 }}</output>
          <button type="button" :aria-label="`Öka ${product.name}`" @click="changeQuantity(product.id, 1)">+</button>
        </div>
      </article>
    </div>
    <button class="primary action-button" type="button" :disabled="selectedItems.length === 0" @click="step = 'review'">Klar</button>
  </section>

  <section v-else-if="step === 'review'" class="page narrow-page review-page">
    <p class="eyebrow">Kontrollera</p><h1>Stämmer beställningen?</h1>
    <div class="receipt">
      <div v-for="item in selectedItems" :key="item.id" class="receipt-row">
        <span>{{ item.quantity }} × {{ item.name }}</span><strong>{{ item.subtotal }} kr</strong>
      </div>
      <div class="receipt-total"><span>Totalt</span><strong>{{ total }} kr</strong></div>
    </div>
    <div class="button-row">
      <button class="secondary" type="button" :disabled="loadingPayment" @click="step = 'select'">Ändra</button>
      <button class="primary" type="button" :disabled="loadingPayment" @click="showPayment">{{ loadingPayment ? 'Förbereder betalning…' : 'Betala' }}</button>
    </div>
  </section>

  <section v-else class="page narrow-page payment-page branded-page">
    <p class="eyebrow">Betalning</p><h1>Betala {{ total }} kr</h1>
    <img v-if="qrCode" class="swish-qr" :src="qrCode" :alt="`Swish QR-kod: ${recipient?.name}, ${total} kr`" width="600" height="600">
    <div v-else class="qr-placeholder" aria-label="Swish QR-kod saknas">
      <span>Swish-QR</span><small>kunde inte skapas</small>
    </div>
    <p v-if="qrCode">Skanna QR-koden med Swish och genomför betalningen i appen.</p>
    <p v-if="recipient" class="payment-recipient"><strong>{{ recipient.name }}</strong><br>{{ recipient.number }}</p>
    <p v-if="paymentError" class="status error" role="alert">{{ paymentError }}</p>
    <button class="primary" type="button" :disabled="savingOrder || !recipient" @click="completePayment">
      {{ savingOrder ? 'Sparar köp…' : 'Betalning klar' }}
    </button>
  </section>
</template>
