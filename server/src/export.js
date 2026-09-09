import { ValidationError } from './errors.js'

const stockholmDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
})

const stockholmTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

const stockholmDateTimeParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function stockholmMidnightUtc(date) {
  const wallTime = Date.parse(`${date}T00:00:00.000Z`)
  let utcTime = wallTime
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(stockholmDateTimeParts.formatToParts(new Date(utcTime))
      .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]))
    const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utcTime
    utcTime = wallTime - offset
  }
  return new Date(utcTime).toISOString()
}

export function stockholmDateRange(from, to) {
  validateDates(from, to)
  const dayAfterTo = new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
  return { start: stockholmMidnightUtc(from), end: stockholmMidnightUtc(dayAfterTo) }
}

function csvCell(value) {
  const raw = String(value ?? '')
  const text = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function validateDates(from, to) {
  if (!isDateKey(from) || !isDateKey(to)) throw new ValidationError('Välj giltiga datum för exporten.')
  if (from > to) throw new ValidationError('Från-datum får inte vara senare än till-datum.')
}

function filenameSuffix(from, to) {
  return from === to ? from : `${from}-till-${to}`
}

function toCsv(lines) {
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
}

export function createSalesExport(db, from, to) {
  const { start, end } = stockholmDateRange(from, to)

  const rows = db.prepare(`
    SELECT
      o.id AS order_id,
      o.created_at,
      o.total AS order_total,
      o.swish_recipient_name,
      o.swish_recipient_number,
      oi.product_name,
      oi.quantity,
      oi.unit_price,
      oi.subtotal
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.created_at >= ? AND o.created_at < ?
    ORDER BY o.created_at ASC, o.id ASC, oi.id ASC
  `).all(start, end)

  const lines = [[
    'Datum', 'Tid', 'Order-ID', 'Swish-mottagare', 'Swishnummer', 'Ordersumma',
    'Produkt', 'Antal', 'Styckpris', 'Radbelopp',
  ]]

  for (const row of rows) {
    const createdAt = new Date(row.created_at)
    lines.push([
      stockholmDate.format(createdAt),
      stockholmTime.format(createdAt),
      row.order_id,
      row.swish_recipient_name,
      row.swish_recipient_number,
      row.order_total,
      row.product_name,
      row.quantity,
      row.unit_price,
      row.subtotal,
    ])
  }

  return {
    filename: `foreningskiosken-${filenameSuffix(from, to)}.csv`,
    csv: toCsv(lines),
  }
}

export function createPaymentExport(db, from, to) {
  const { start, end } = stockholmDateRange(from, to)

  const rows = db.prepare(`
    SELECT id, created_at, total, swish_recipient_name, swish_recipient_number
    FROM orders
    WHERE created_at >= ? AND created_at < ?
    ORDER BY created_at ASC, id ASC
  `).all(start, end)

  const lines = [[
    'Datum', 'Tid', 'Order-ID', 'Swish-mottagare', 'Swishnummer', 'Belopp',
  ]]

  for (const row of rows) {
    const createdAt = new Date(row.created_at)
    lines.push([
      stockholmDate.format(createdAt),
      stockholmTime.format(createdAt),
      row.id,
      row.swish_recipient_name,
      row.swish_recipient_number,
      row.total,
    ])
  }

  return {
    filename: `foreningskiosken-betalningar-${filenameSuffix(from, to)}.csv`,
    csv: toCsv(lines),
  }
}
