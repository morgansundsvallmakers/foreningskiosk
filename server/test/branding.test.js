import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'
import { MAX_LOGO_BYTES } from '../src/branding.js'
import { openDatabase } from '../src/database.js'

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const directory = mkdtempSync(join(tmpdir(), 'foreningskiosken-logo-'))
const logoPath = join(directory, 'foreningskiosken-logo')
const db = openDatabase(':memory:')
const server = createApp({ db, logoPath, isLocalRequest: () => true })
let baseUrl

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

test('logotyp saknas initialt, kan sparas, hämtas och tas bort', async () => {
  const initialStatus = await fetch(`${baseUrl}/api/local/logo`)
  assert.equal(initialStatus.status, 200)
  assert.deepEqual(await initialStatus.json(), { configured: false })
  assert.equal((await fetch(`${baseUrl}/api/logo`)).status, 404)

  const upload = await fetch(`${baseUrl}/api/local/logo`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: tinyPng,
  })
  assert.equal(upload.status, 200)
  assert.deepEqual(await upload.json(), { configured: true })

  const publicLogo = await fetch(`${baseUrl}/api/logo`)
  assert.equal(publicLogo.status, 200)
  assert.equal(publicLogo.headers.get('content-type'), 'image/png')
  assert.equal(publicLogo.headers.get('cache-control'), 'no-cache')
  assert.deepEqual(Buffer.from(await publicLogo.arrayBuffer()), tinyPng)

  const remove = await fetch(`${baseUrl}/api/local/logo`, { method: 'DELETE' })
  assert.equal(remove.status, 200)
  assert.deepEqual(await remove.json(), { configured: false })
  assert.equal((await fetch(`${baseUrl}/api/logo`)).status, 404)
})

test('ogiltigt format, för stor fil och orimliga dimensioner avvisas', async () => {
  const invalid = await fetch(`${baseUrl}/api/local/logo`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('inte en bild'),
  })
  assert.equal(invalid.status, 400)

  const tooLarge = await fetch(`${baseUrl}/api/local/logo`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(MAX_LOGO_BYTES + 1),
  })
  assert.equal(tooLarge.status, 400)

  const unreasonable = Buffer.from(tinyPng)
  unreasonable.writeUInt32BE(8001, 16)
  const dimensions = await fetch(`${baseUrl}/api/local/logo`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: unreasonable,
  })
  assert.equal(dimensions.status, 400)
})

test('fjärrklient kan läsa men inte ändra eller ta bort logotyp', async () => {
  const localUpload = await fetch(`${baseUrl}/api/local/logo`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: tinyPng,
  })
  assert.equal(localUpload.status, 200)

  const remoteDb = openDatabase(':memory:')
  const remoteServer = createApp({ db: remoteDb, logoPath, isLocalRequest: () => false })
  await new Promise((resolve) => remoteServer.listen(0, '127.0.0.1', resolve))
  const remoteUrl = `http://127.0.0.1:${remoteServer.address().port}`
  try {
    assert.equal((await fetch(`${remoteUrl}/api/logo`)).status, 200)
    assert.equal((await fetch(`${remoteUrl}/api/local/logo`, { method: 'PUT', body: tinyPng })).status, 403)
    assert.equal((await fetch(`${remoteUrl}/api/local/logo`, { method: 'DELETE' })).status, 403)
  } finally {
    await new Promise((resolve) => remoteServer.close(resolve))
    remoteDb.close()
  }
})
