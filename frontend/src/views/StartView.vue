<script setup>
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { authApi, logoApi, networkApi } from '../api.js'

const network = ref(null)
const qrCode = ref('')
const error = ref('')
const pinConfigured = ref(false)
const pin = ref('')
const pinRepeat = ref('')
const pinMessage = ref('')
const savingPin = ref(false)
const logoConfigured = ref(false)
const logoLoading = ref(false)
const logoMessage = ref('')
const logoVersion = ref(Date.now())
const logoPreviewUrl = computed(() => `/api/logo?v=${logoVersion.value}`)
const primaryAddress = computed(() => network.value?.lan_addresses
  .find(({ profile }) => profile !== 'Public') || null)
const publicNetworks = computed(() => network.value?.network_profiles
  .filter(({ category }) => category === 'Public') || [])

async function savePin() {
  pinMessage.value = ''
  if (pin.value !== pinRepeat.value) {
    pinMessage.value = 'PIN-koderna stämmer inte överens.'
    return
  }
  savingPin.value = true
  try {
    await authApi.setPin(pin.value)
    pinConfigured.value = true
    pin.value = ''
    pinRepeat.value = ''
    pinMessage.value = 'Admin-PIN är sparad. Den här webbläsaren är inloggad i 24 timmar.'
  } catch (err) {
    pinMessage.value = err.message
  } finally {
    savingPin.value = false
  }
}

async function chooseLogo(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || logoLoading.value) return
  logoLoading.value = true
  logoMessage.value = ''
  try {
    await logoApi.upload(file)
    logoConfigured.value = true
    logoVersion.value = Date.now()
    logoMessage.value = 'Logotypen är sparad och används nu i kiosken.'
  } catch (err) {
    logoMessage.value = err.message
  } finally {
    logoLoading.value = false
  }
}

async function removeLogo() {
  if (logoLoading.value) return
  logoLoading.value = true
  logoMessage.value = ''
  try {
    await logoApi.remove()
    logoConfigured.value = false
    logoVersion.value = Date.now()
    logoMessage.value = 'Logotypen är borttagen. Kiosken visas utan bakgrundslogga.'
  } catch (err) {
    logoMessage.value = err.message
  } finally {
    logoLoading.value = false
  }
}

onMounted(async () => {
  try {
    const auth = await authApi.status()
    if (!auth.local) {
      window.location.replace('/')
      return
    }
    pinConfigured.value = auth.configured
  } catch (err) {
    error.value = err.message
    return
  }

  try {
    const logo = await logoApi.status()
    logoConfigured.value = logo.configured
  } catch (err) {
    logoMessage.value = err.message
  }

  try {
    network.value = await networkApi.info()
    if (primaryAddress.value) {
      qrCode.value = await QRCode.toDataURL(primaryAddress.value.url, {
        width: 340, margin: 3, errorCorrectionLevel: 'M',
        color: { dark: '#14342b', light: '#ffffff' },
      })
    }
  } catch (err) {
    error.value = err.message
  }
})
</script>

<template>
  <section class="page start-page">
    <div class="status start-admin-shortcut">
      <strong>Admin från kiosken:</strong>
      Tryck och håll fingret i <strong>övre vänstra hörnet</strong> i ungefär <strong>2 sekunder</strong>.
    </div>

    <section class="start-panel logo-settings" aria-labelledby="logo-heading">
      <div>
        <p id="logo-heading" class="eyebrow">Logotyp</p>
        <p>Valfri bakgrundslogga för kiosken. Utan logotyp visas kiosken neutralt.</p>
      </div>
      <div class="logo-settings-content">
        <img v-if="logoConfigured" class="logo-preview" :src="logoPreviewUrl" alt="Nuvarande kiosklogotyp">
        <div v-else class="logo-empty">Ingen logotyp vald</div>
        <div class="logo-actions">
          <label class="primary logo-file-button" :class="{ disabled: logoLoading }">
            {{ logoLoading ? 'Arbetar…' : (logoConfigured ? 'Byt bild' : 'Välj bild') }}
            <input type="file" accept="image/png,image/jpeg,image/gif" :disabled="logoLoading" @change="chooseLogo">
          </label>
          <button v-if="logoConfigured" class="secondary" type="button" :disabled="logoLoading" @click="removeLogo">Ta bort logotyp</button>
        </div>
      </div>
      <p class="logo-help">PNG, JPEG eller GIF, högst 5 MB.</p>
      <p v-if="logoMessage" class="pin-message">{{ logoMessage }}</p>
    </section>

    <p v-if="error" class="status error" role="alert">Startsidan kunde inte läsa nätverksinformationen: {{ error }}</p>

    <template v-if="network">
      <section class="pin-settings start-panel" aria-labelledby="pin-heading">
        <div>
          <p id="pin-heading" class="eyebrow">Admin-PIN</p>
          <p>PIN-koden används när Admin öppnas från kioskens surfplatta eller en annan enhet.</p>
        </div>
        <form class="pin-form" @submit.prevent="savePin">
          <input v-model="pin" aria-label="Ny PIN" placeholder="Ny PIN" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required />
          <input v-model="pinRepeat" aria-label="Upprepa PIN" placeholder="Upprepa PIN" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required />
          <button class="primary" type="submit" :disabled="savingPin">{{ savingPin ? 'Sparar…' : (pinConfigured ? 'Ändra PIN' : 'Sätt PIN') }}</button>
        </form>
        <p v-if="pinMessage" class="pin-message">{{ pinMessage }}</p>
      </section>

      <section class="start-panel start-status-panel" aria-labelledby="status-heading">
        <p class="eyebrow">Status</p>
        <div class="start-status-grid">
          <div class="start-status-row">
            <span class="status-dot is-ok" aria-hidden="true"></span>
            <span>Server</span>
            <strong>igång</strong>
          </div>
          <div class="start-status-row">
            <span class="status-dot" :class="publicNetworks.length ? 'is-warning' : 'is-ok'" aria-hidden="true"></span>
            <span>Kiosknätverk</span>
            <strong>{{ publicNetworks.length ? 'Offentligt' : 'Privat' }}</strong>
          </div>
          <div class="start-status-row">
            <span class="status-dot" :class="primaryAddress ? 'is-ok' : 'is-warning'" aria-hidden="true"></span>
            <span>Surfplatta</span>
            <strong>{{ primaryAddress ? 'kan ansluta' : 'kan inte ansluta ännu' }}</strong>
          </div>
        </div>

        <div v-if="publicNetworks.length" class="status error network-profile-warning" role="alert">
          <strong>Ändra kiosknätverket till Privat och starta om Föreningskiosken.</strong>
          När nätverket är Privat visas QR-koden för surfplattan här.
        </div>

        <div v-else-if="!primaryAddress" class="status error network-profile-warning">
          <strong>Ingen adress för surfplattan hittades.</strong>
          Kontrollera att datorn är ansluten till det lokala nätverket och starta sedan om Föreningskiosken.
        </div>
      </section>

      <section class="start-panel start-open-panel" aria-labelledby="open-heading">
        <p class="eyebrow">Öppna kiosken</p>
        <div class="start-local-open">
          <div>
            <h2 id="open-heading">På den här datorn</h2>
            <a class="primary start-open-button" :href="network.local_url">Öppna kiosken</a>
          </div>
          <div v-if="primaryAddress" class="start-network-address">
            <h2>På surfplattan</h2>
            <a class="start-url" :href="primaryAddress.url">{{ primaryAddress.url }}</a>
          </div>
        </div>

        <div v-if="primaryAddress" class="lan-qr-panel">
          <img :src="qrCode" :alt="`QR-kod som öppnar kiosken på ${primaryAddress.url}`" width="340" height="340">
          <div>
            <h2>Öppna kiosken på surfplattan</h2>
            <p>Anslut surfplattan till samma lokala nätverk som datorn och skanna sedan QR-koden.</p>
            <p>Kiosken öppnas direkt i webbläsaren.</p>
          </div>
        </div>

        <details v-if="network.lan_addresses.length > 1" class="alternative-addresses">
          <summary>Visa andra nätverksadresser</summary>
          <ul>
            <li v-for="item in network.lan_addresses.slice(1)" :key="`${item.name}-${item.address}`">{{ item.name }}: <a :href="item.url">{{ item.url }}</a></li>
          </ul>
        </details>
      </section>
    </template>

    <p v-else-if="!error" class="status">Kontrollerar nätverket…</p>
  </section>
</template>
