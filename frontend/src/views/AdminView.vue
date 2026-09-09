<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { authApi, productApi, settingsApi } from '../api.js'

const products = ref([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const editingId = ref(null)
const form = reactive({ name: '', price: null, sort_order: 1, active: true })

const authLoading = ref(true)
const authenticated = ref(false)
const pinConfigured = ref(false)
const local = ref(false)
const pin = ref('')
const loginError = ref('')
const loggingIn = ref(false)
const loggingOut = ref(false)

const swishRecipients = ref([])
const selectedSwish = ref('')
const savingSwish = ref(false)
const editingSwish = ref(false)
const recipientFormOpen = ref(false)
const recipientEditingId = ref(null)
const recipientForm = reactive({ name: '', number: '' })
const selectedRecipient = computed(() => swishRecipients.value.find(({ id }) => id === selectedSwish.value) || null)

async function loadProducts() {
  loading.value = true
  error.value = ''
  try { products.value = await productApi.all() }
  catch (err) { error.value = err.message }
  finally { loading.value = false }
}

async function loadSwish() {
  try {
    const data = await settingsApi.swish()
    swishRecipients.value = data.recipients
    selectedSwish.value = data.selected
  } catch (err) { error.value = err.message }
}

async function loadAdmin() {
  await Promise.all([loadProducts(), loadSwish()])
  clearForm()
}

async function login() {
  loggingIn.value = true
  loginError.value = ''
  try {
    await authApi.login(pin.value)
    authenticated.value = true
    pin.value = ''
    await loadAdmin()
  } catch (err) { loginError.value = err.message }
  finally { loggingIn.value = false }
}

async function logout() {
  if (loggingOut.value) return
  loggingOut.value = true
  error.value = ''
  try {
    await authApi.logout()
    authenticated.value = false
    products.value = []
    swishRecipients.value = []
    selectedSwish.value = ''
    editingSwish.value = false
    closeRecipientForm()
    clearForm()
  } catch (err) { error.value = err.message }
  finally { loggingOut.value = false }
}

async function selectSwish(id) {
  if (savingSwish.value || id === selectedSwish.value) return
  const previous = selectedSwish.value
  selectedSwish.value = id
  savingSwish.value = true
  error.value = ''
  try {
    const data = await settingsApi.setSwish(id)
    selectedSwish.value = data.selected
  } catch (err) {
    selectedSwish.value = previous
    error.value = err.message
  } finally { savingSwish.value = false }
}

function openAddRecipient() {
  recipientEditingId.value = null
  Object.assign(recipientForm, { name: '', number: '' })
  recipientFormOpen.value = true
}

function openEditRecipient(recipient) {
  recipientEditingId.value = recipient.id
  Object.assign(recipientForm, { name: recipient.name, number: recipient.number })
  recipientFormOpen.value = true
}

function closeRecipientForm() {
  recipientFormOpen.value = false
  recipientEditingId.value = null
  Object.assign(recipientForm, { name: '', number: '' })
}

async function saveRecipient() {
  if (savingSwish.value) return
  savingSwish.value = true
  error.value = ''
  try {
    if (recipientEditingId.value) await settingsApi.updateSwishRecipient(recipientEditingId.value, recipientForm)
    else await settingsApi.addSwishRecipient(recipientForm)
    await loadSwish()
    closeRecipientForm()
  } catch (err) { error.value = err.message }
  finally { savingSwish.value = false }
}

async function deleteRecipient(recipient) {
  if (savingSwish.value || recipient.id === selectedSwish.value) return
  savingSwish.value = true
  error.value = ''
  try {
    await settingsApi.deleteSwishRecipient(recipient.id)
    await loadSwish()
    if (recipientEditingId.value === recipient.id) closeRecipientForm()
  } catch (err) { error.value = err.message }
  finally { savingSwish.value = false }
}

function closeSwishEditor() {
  editingSwish.value = false
  closeRecipientForm()
}

function nextSortOrder() {
  return products.value.reduce((highest, product) => Math.max(highest, product.sort_order || 0), 0) + 1
}

function clearForm() {
  editingId.value = null
  Object.assign(form, { name: '', price: null, sort_order: nextSortOrder(), active: true })
}

function edit(product) {
  editingId.value = product.id
  Object.assign(form, { name: product.name, price: product.price, sort_order: product.sort_order, active: product.active })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) await productApi.update(editingId.value, form)
    else await productApi.create({ ...form, sort_order: nextSortOrder() })
    clearForm()
    await loadProducts()
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}

async function removeEditedProduct() {
  if (!editingId.value || saving.value) return
  const product = products.value.find(({ id }) => id === editingId.value)
  const name = product?.name || form.name
  if (!window.confirm(`Ta bort ${name}?`)) return
  saving.value = true
  error.value = ''
  try {
    await productApi.delete(editingId.value)
    clearForm()
    await loadProducts()
  } catch (err) { error.value = err.message }
  finally { saving.value = false }
}

async function toggle(product) {
  error.value = ''
  try {
    await productApi.setActive(product.id, !product.active)
    await loadProducts()
  } catch (err) { error.value = err.message }
}

async function move(product, change) {
  error.value = ''
  try {
    await productApi.update(product.id, { ...product, sort_order: product.sort_order + change })
    await loadProducts()
  } catch (err) { error.value = err.message }
}

onMounted(async () => {
  try {
    const status = await authApi.status()
    authenticated.value = status.authenticated
    pinConfigured.value = status.configured
    local.value = status.local
    if (status.authenticated) await loadAdmin()
  } catch (err) { loginError.value = err.message }
  finally { authLoading.value = false }
})
</script>

<template>
  <section v-if="authLoading" class="page narrow-page"><p class="status">Kontrollerar adminbehörighet…</p></section>

  <section v-else-if="!authenticated" class="page narrow-page admin-login-page">
    <p class="eyebrow">Administration</p>
    <h1>Admin</h1>
    <div v-if="!pinConfigured" class="status error">
      <strong>Ingen Admin-PIN är satt.</strong>
      <span v-if="local">Gå till Start på den här datorn och sätt en PIN-kod.</span>
      <span v-else>PIN-koden måste sättas på kioskens serverdator.</span>
    </div>
    <form v-else class="admin-login" @submit.prevent="login">
      <label>PIN-kod<input v-model="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" autofocus required /></label>
      <button class="primary" type="submit" :disabled="loggingIn">{{ loggingIn ? 'Kontrollerar…' : 'Öppna admin' }}</button>
    </form>
    <p v-if="loginError" class="status error">{{ loginError }}</p>
  </section>

  <section v-else class="page admin-page">
    <div class="admin-page-session">
      <p class="eyebrow admin-page-label">Administration</p>
      <button class="secondary" type="button" :disabled="loggingOut" @click="logout">{{ loggingOut ? 'Loggar ut…' : 'Logga ut' }}</button>
    </div>

    <section class="swish-settings" :class="{ editing: editingSwish }" aria-labelledby="swish-heading">
      <div class="swish-settings-heading">
        <div><p class="eyebrow">Betalning</p><h2 id="swish-heading">Swish-mottagare</h2></div>
        <div v-if="!editingSwish && selectedRecipient" class="selected-swish-summary"><strong>{{ selectedRecipient.name }}</strong><span>{{ selectedRecipient.number }}</span></div>
        <button v-if="!editingSwish" class="secondary swish-edit-button" type="button" @click="editingSwish = true">Ändra</button>
      </div>

      <div v-if="editingSwish" class="swish-editor">
        <div class="swish-recipient-list">
          <label v-for="recipient in swishRecipients" :key="recipient.id" class="swish-recipient-row" :class="{ selected: selectedSwish === recipient.id }">
            <input type="radio" name="swish-recipient" :value="recipient.id" :checked="selectedSwish === recipient.id" :disabled="savingSwish" @change="selectSwish(recipient.id)" />
            <span class="swish-recipient-info"><strong>{{ recipient.name }}</strong><small>{{ recipient.number }}</small></span>
            <button class="secondary" type="button" :disabled="savingSwish" @click.prevent="openEditRecipient(recipient)">Redigera</button>
            <button class="secondary" type="button" :disabled="savingSwish || recipient.id === selectedSwish" @click.prevent="deleteRecipient(recipient)">Ta bort</button>
          </label>
        </div>
        <form v-if="recipientFormOpen" class="recipient-form" @submit.prevent="saveRecipient">
          <h3>{{ recipientEditingId ? 'Redigera mottagare' : 'Lägg till mottagare' }}</h3>
          <label>Namn<input v-model.trim="recipientForm.name" placeholder="Exempelklubben" required maxlength="100" /></label>
          <label>Swishnummer<input v-model.trim="recipientForm.number" placeholder="1234567890" required inputmode="numeric" maxlength="12" /></label>
          <div class="button-row recipient-form-actions">
            <button class="secondary" type="button" @click="closeRecipientForm">Avbryt</button>
            <button class="primary" type="submit" :disabled="savingSwish">{{ savingSwish ? 'Sparar…' : (recipientEditingId ? 'Spara' : 'Lägg till') }}</button>
          </div>
        </form>
        <div class="swish-editor-footer">
          <button v-if="!recipientFormOpen" class="secondary add-recipient-button" type="button" @click="openAddRecipient">Lägg till mottagare</button>
          <span v-else></span>
          <button class="primary swish-done-button" type="button" @click="closeSwishEditor">Klar</button>
        </div>
      </div>
    </section>

    <form class="product-form" :class="{ editing: editingId }" @submit.prevent="save">
      <p class="eyebrow product-form-heading">Produkter</p>
      <label v-if="editingId">Namn<input v-model.trim="form.name" required maxlength="100" /></label>
      <input v-else v-model.trim="form.name" aria-label="Namn" placeholder="Namn: ex Läsk" required maxlength="100" />
      <label v-if="editingId">Pris i kronor<input v-model.number="form.price" required type="number" min="0" step="1" /></label>
      <input v-else v-model.number="form.price" aria-label="Pris i kronor" placeholder="Pris: ex 10 kr" required type="number" min="0" step="1" />
      <button class="icon-button visibility-button product-form-visibility" :class="form.active ? 'is-active' : 'is-inactive'" type="button" :aria-label="form.active ? 'Produkten visas i kiosken' : 'Produkten är dold i kiosken'" :title="form.active ? 'Visas i kiosken' : 'Dold i kiosken'" @click="form.active = !form.active">
        <svg v-if="form.active" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.3 0 9.3 4.8 10 6.7a.8.8 0 0 1 0 .6C21.3 14.2 17.3 19 12 19S2.7 14.2 2 12.3a.8.8 0 0 1 0-.6C2.7 9.8 6.7 5 12 5Zm0 2c-3.6 0-6.6 2.9-7.9 5 1.3 2.1 4.3 5 7.9 5s6.6-2.9 7.9-5C18.6 9.9 15.6 7 12 7Zm0 2.2A2.8 2.8 0 1 1 12 15a2.8 2.8 0 0 1 0-5.6Z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2 18.7 18.7-1.3 1.3-3.2-3.2A11.8 11.8 0 0 1 12 20C6.7 20 2.7 15.2 2 13.3a.8.8 0 0 1 0-.6 13.8 13.8 0 0 1 4.1-5.4L2 3.3 3.3 2Zm4.2 6.7A11.3 11.3 0 0 0 4.1 13c1.3 2.1 4.3 5 7.9 5 1.4 0 2.7-.4 3.8-1L13.7 15a3 3 0 0 1-4.5-4.5L7.5 8.7ZM12 6c5.3 0 9.3 4.8 10 6.7a.8.8 0 0 1 0 .6 13.3 13.3 0 0 1-2.3 3.5l-1.4-1.4A11.3 11.3 0 0 0 19.9 13c-1.3-2.1-4.3-5-7.9-5-.5 0-1 0-1.5.2L8.8 6.5A12 12 0 0 1 12 6Z" /></svg>
      </button>
      <div class="button-row form-actions">
        <button v-if="editingId" class="danger-button" type="button" :disabled="saving" @click="removeEditedProduct">Ta bort</button>
        <button v-if="editingId" class="secondary" type="button" :disabled="saving" @click="clearForm">Avbryt</button>
        <button class="primary" type="submit" :disabled="saving">{{ saving ? 'Sparar…' : (editingId ? 'Spara' : 'Lägg till') }}</button>
      </div>
    </form>
    <p v-if="error" class="status error">{{ error }}</p>
    <p v-if="loading" class="status">Hämtar produkter…</p>
    <div v-else class="admin-list">
      <article v-for="(product, index) in products" :key="product.id" class="admin-product">
        <div class="admin-product-info">
          <div class="product-card-heading"><h2>{{ product.name }}</h2><p class="price">{{ product.price }} kr</p></div>
        </div>
        <div class="admin-actions">
          <div class="product-icon-actions">
            <button class="icon-button edit-icon-button" type="button" :aria-label="`Redigera ${product.name}`" title="Redigera" @click="edit(product)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm12.5-16.5 4 4 1-1a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-1 1Z" /></svg>
            </button>
            <button class="icon-button visibility-button" :class="product.active ? 'is-active' : 'is-inactive'" type="button" :aria-label="product.active ? `Dölj ${product.name} i kiosken` : `Visa ${product.name} i kiosken`" :title="product.active ? 'Visas i kiosken' : 'Dold i kiosken'" @click="toggle(product)">
              <svg v-if="product.active" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c5.3 0 9.3 4.8 10 6.7a.8.8 0 0 1 0 .6C21.3 14.2 17.3 19 12 19S2.7 14.2 2 12.3a.8.8 0 0 1 0-.6C2.7 9.8 6.7 5 12 5Zm0 2c-3.6 0-6.6 2.9-7.9 5 1.3 2.1 4.3 5 7.9 5s6.6-2.9 7.9-5C18.6 9.9 15.6 7 12 7Zm0 2.2A2.8 2.8 0 1 1 12 15a2.8 2.8 0 0 1 0-5.6Z" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m3.3 2 18.7 18.7-1.3 1.3-3.2-3.2A11.8 11.8 0 0 1 12 20C6.7 20 2.7 15.2 2 13.3a.8.8 0 0 1 0-.6 13.8 13.8 0 0 1 4.1-5.4L2 3.3 3.3 2Zm4.2 6.7A11.3 11.3 0 0 0 4.1 13c1.3 2.1 4.3 5 7.9 5 1.4 0 2.7-.4 3.8-1L13.7 15a3 3 0 0 1-4.5-4.5L7.5 8.7ZM12 6c5.3 0 9.3 4.8 10 6.7a.8.8 0 0 1 0 .6 13.3 13.3 0 0 1-2.3 3.5l-1.4-1.4A11.3 11.3 0 0 0 19.9 13c-1.3-2.1-4.3-5-7.9-5-.5 0-1 0-1.5.2L8.8 6.5A12 12 0 0 1 12 6Z" /></svg>
            </button>
          </div>
          <div class="reorder-buttons" aria-label="Ändra sorteringsordning">
            <button class="secondary" type="button" :disabled="index === 0" :aria-label="`Flytta ${product.name} upp`" @click="move(product, -1)">↑</button>
            <button class="secondary" type="button" :disabled="index === products.length - 1" :aria-label="`Flytta ${product.name} ned`" @click="move(product, 1)">↓</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
