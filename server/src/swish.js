import { randomUUID } from 'node:crypto'
import { ValidationError } from './errors.js'

export function listSwishRecipients(db) {
  return db.prepare('SELECT id, name, number FROM swish_recipients ORDER BY rowid').all()
}

export function getSelectedSwishId(db) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get('swish_recipient')?.value || null
}

export function setSelectedSwishId(db, id) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('swish_recipient', id)
}

export function validateSwishRecipient(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const number = typeof body?.number === 'string' ? body.number.replace(/[\s-]/g, '') : ''
  if (!name || name.length > 100) throw new ValidationError('Mottagarens namn måste vara mellan 1 och 100 tecken.')
  if (!/^\d{10}$/.test(number)) throw new ValidationError('Swishnumret måste bestå av 10 siffror.')
  return { name, number }
}

export function createSwishRecipient(db, body) {
  const recipient = validateSwishRecipient(body)
  const id = randomUUID()
  db.prepare('INSERT INTO swish_recipients (id, name, number) VALUES (?, ?, ?)')
    .run(id, recipient.name, recipient.number)
  return { id, ...recipient }
}

export function updateSwishRecipient(db, id, body) {
  const recipient = validateSwishRecipient(body)
  const result = db.prepare('UPDATE swish_recipients SET name = ?, number = ? WHERE id = ?')
    .run(recipient.name, recipient.number, id)
  if (result.changes === 0) return null
  return { id, ...recipient }
}
