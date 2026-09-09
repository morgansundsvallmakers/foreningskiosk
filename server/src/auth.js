import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { ValidationError } from './errors.js'

const SESSION_TTL_MS = 24 * 60 * 60 * 1000

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || ''
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function getSessionSecret(db) {
  let secret = getSetting(db, 'admin_session_secret')
  if (!secret) {
    secret = randomBytes(32).toString('hex')
    setSetting(db, 'admin_session_secret', secret)
  }
  return secret
}

function signSession(db, payload) {
  return createHmac('sha256', getSessionSecret(db)).update(payload).digest('hex')
}

export function isLocalRequest(request) {
  const address = request.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function pinConfigured(db) {
  return Boolean(getSetting(db, 'admin_pin_hash') && getSetting(db, 'admin_pin_salt'))
}

export function setAdminPin(db, pin) {
  if (!/^\d{4,8}$/.test(String(pin || ''))) {
    throw new ValidationError('PIN-koden måste bestå av 4–8 siffror.')
  }
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(String(pin), salt, 32).toString('hex')
  setSetting(db, 'admin_pin_salt', salt)
  setSetting(db, 'admin_pin_hash', hash)
  setSetting(db, 'admin_session_secret', randomBytes(32).toString('hex'))
}

export function verifyAdminPin(db, pin) {
  if (!pinConfigured(db)) return false
  const salt = getSetting(db, 'admin_pin_salt')
  const expected = Buffer.from(getSetting(db, 'admin_pin_hash'), 'hex')
  const actual = scryptSync(String(pin || ''), salt, 32)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=')
    if (index < 0) return ['', '']
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]
  }).filter(([key]) => key))
}

export function hasAdminSession(request, db) {
  const token = parseCookies(request).foreningskiosken_admin
  if (!token) return false
  const [expiresText, nonce, signature] = token.split('.')
  const expires = Number(expiresText)
  if (!expires || !nonce || !signature || expires <= Date.now()) return false
  const payload = `${expiresText}.${nonce}`
  const expected = Buffer.from(signSession(db, payload), 'hex')
  let actual
  try { actual = Buffer.from(signature, 'hex') }
  catch { return false }
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function createAdminSession(response, db) {
  const expires = Date.now() + SESSION_TTL_MS
  const nonce = randomBytes(16).toString('hex')
  const payload = `${expires}.${nonce}`
  const token = `${payload}.${signSession(db, payload)}`
  response.setHeader('Set-Cookie', `foreningskiosken_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`)
}

export function clearAdminSession(_request, response) {
  response.setHeader('Set-Cookie', 'foreningskiosken_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
}

export function isAdminAuthorized(request, db) {
  return pinConfigured(db) && hasAdminSession(request, db)
}
