import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { toProduct } from './database.js'
import { HttpError, ValidationError } from './errors.js'
import { createPaymentExport, createSalesExport, stockholmDateRange } from './export.js'
import { deleteLogo, logoConfigured, readLogo, saveLogo } from './branding.js'
import { getLanAddresses as detectLanAddresses, getNetworkProfiles as detectNetworkProfiles } from './network.js'
import {
  createSwishRecipient,
  getSelectedSwishId,
  listSwishRecipients,
  setSelectedSwishId,
  updateSwishRecipient,
} from './swish.js'
import {
  clearAdminSession,
  createAdminSession,
  isAdminAuthorized,
  isLocalRequest as detectLocalRequest,
  pinConfigured,
  setAdminPin,
  verifyAdminPin,
} from './auth.js'

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
}

const stockholmDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
})

const LOGIN_FAILURE_WINDOW_MS = 10 * 60 * 1000
const LOGIN_BLOCK_MS = 60 * 1000
const LOGIN_MAX_FAILURES = 5
const LOGIN_BASE_DELAY_MS = 150
const MAX_PRODUCT_PRICE = 100_000
const MAX_PRODUCT_SORT_ORDER = 10_000

function dateKey(value = new Date()) {
  return stockholmDate.format(value)
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function unauthorized(response) {
  return json(response, 401, { error: 'Admin-PIN krävs.' })
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new HttpError(413, 'För stor begäran.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw new ValidationError('Ogiltig JSON.') }
}

function requireJsonObject(body, message) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError(message)
  return body
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ValidationError('Ogiltig URL-kodning.')
  }
}

function validateProduct(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Ogiltiga produktdata.')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const price = body.price
  const sortOrder = body.sort_order ?? 1
  if (!name || name.length > 100) throw new ValidationError('Namn måste vara mellan 1 och 100 tecken.')
  if (!Number.isSafeInteger(price) || price < 0 || price > MAX_PRODUCT_PRICE) {
    throw new ValidationError(`Pris måste vara ett heltal mellan 0 och ${MAX_PRODUCT_PRICE} kronor.`)
  }
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 1 || sortOrder > MAX_PRODUCT_SORT_ORDER) {
    throw new ValidationError(`Sorteringsordning måste vara ett heltal mellan 1 och ${MAX_PRODUCT_SORT_ORDER}.`)
  }
  if (body.active !== undefined && typeof body.active !== 'boolean') throw new ValidationError('active måste vara true eller false.')
  return { name, price, sort_order: sortOrder, active: body.active === undefined ? true : Boolean(body.active) }
}

function validateOrderRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Ogiltiga orderdata.')
  const clientOrderId = typeof body.client_order_id === 'string' ? body.client_order_id.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientOrderId)) {
    throw new ValidationError('Ogiltigt köp-ID.')
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw new ValidationError('Ordern måste innehålla mellan 1 och 100 orderrader.')
  }
  if (!Number.isSafeInteger(body.total) || body.total < 0) throw new ValidationError('Ogiltig ordersumma.')

  const seenProductIds = new Set()
  const requestedItems = body.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ValidationError('Ogiltig orderrad.')
    if (!Number.isSafeInteger(item.product_id) || item.product_id < 1) throw new ValidationError('Ogiltigt produkt-id i ordern.')
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) throw new ValidationError('Ogiltigt antal i ordern.')
    if (seenProductIds.has(item.product_id)) throw new ValidationError('En produkt får bara förekomma en gång i ordern.')
    seenProductIds.add(item.product_id)
    return { product_id: item.product_id, quantity: item.quantity }
  })
  return {
    client_order_id: clientOrderId,
    swish_recipient_id: body.swish_recipient_id,
    requestedItems,
    total: body.total,
  }
}

function validateNewOrder(requestedOrder, db) {
  const recipient = db.prepare('SELECT id, name, number FROM swish_recipients WHERE id = ?')
    .get(requestedOrder.swish_recipient_id)
  if (!recipient) throw new ValidationError('Ogiltig Swish-mottagare.')

  const selectProduct = db.prepare('SELECT id, name, price FROM products WHERE id = ? AND active = 1')
  const items = requestedOrder.requestedItems.map((requestedItem) => {
    const product = selectProduct.get(requestedItem.product_id)
    if (!product) throw new ValidationError('En produkt i ordern finns inte eller är inaktiv.')
    const subtotal = product.price * requestedItem.quantity
    if (!Number.isSafeInteger(subtotal)) throw new ValidationError('Orderradens summa är för stor.')
    return {
      product_id: product.id,
      product_name: product.name,
      unit_price: product.price,
      quantity: requestedItem.quantity,
      subtotal,
    }
  })
  const total = items.reduce((sum, item) => sum + item.subtotal, 0)
  if (!Number.isSafeInteger(total) || total !== requestedOrder.total) throw new ValidationError('Ordersumman stämmer inte med orderraderna.')
  return { ...requestedOrder, recipient, items, total }
}

function existingOrderMatches(db, existing, requestedOrder) {
  if (existing.total !== requestedOrder.total || existing.swish_recipient_id !== requestedOrder.swish_recipient_id) {
    return false
  }
  const savedItems = db.prepare(`
    SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id
  `).all(existing.id)
  const requestedItems = [...requestedOrder.requestedItems].sort((a, b) => a.product_id - b.product_id)
  return savedItems.length === requestedItems.length && savedItems.every((item, index) => (
    item.product_id === requestedItems[index].product_id && item.quantity === requestedItems[index].quantity
  ))
}

function reorderProducts(db, movingId, requestedOrder) {
  const rows = db.prepare(`
    SELECT id FROM products
    WHERE id <> ?
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC
  `).all(movingId)
  const targetIndex = Math.min(Math.max(requestedOrder, 1), rows.length + 1) - 1
  rows.splice(targetIndex, 0, { id: movingId })
  const updateOrder = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?')
  rows.forEach((row, index) => updateOrder.run(index + 1, row.id))
}

function normalizeProductOrder(db) {
  const rows = db.prepare('SELECT id FROM products ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC').all()
  const updateOrder = db.prepare('UPDATE products SET sort_order = ? WHERE id = ?')
  rows.forEach((row, index) => updateOrder.run(index + 1, row.id))
}

function serveStatic(requestPath, response, staticDir) {
  if (!staticDir || !existsSync(staticDir)) return false
  const relativePath = requestPath === '/' ? 'index.html' : normalize(requestPath).replace(/^([/\\])+/, '')
  let filePath = join(staticDir, relativePath)
  if (!filePath.startsWith(staticDir) || !existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(staticDir, 'index.html')
  if (!existsSync(filePath)) return false
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' })
  createReadStream(filePath).pipe(response)
  return true
}

export function createApp({
  db, staticDir, logoPath,
  getLanAddresses = detectLanAddresses,
  getNetworkProfiles = detectNetworkProfiles,
  isLocalRequest = detectLocalRequest,
  loginBaseDelayMs = LOGIN_BASE_DELAY_MS,
  logError = console.error,
}) {
  const order = 'ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC'
  const selectById = db.prepare('SELECT id, name, price, active, sort_order FROM products WHERE id = ?')
  const loginFailures = new Map()

  function loginState(request) {
    const key = request.socket.remoteAddress || 'unknown'
    const now = Date.now()
    let state = loginFailures.get(key)
    if (state && now - state.firstFailure >= LOGIN_FAILURE_WINDOW_MS && state.blockedUntil <= now) {
      loginFailures.delete(key)
      state = null
    }
    return { key, now, state }
  }

  function tooManyLoginAttempts(response, blockedUntil) {
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000))))
    return json(response, 429, { error: 'För många felaktiga PIN-försök. Försök igen om en stund.' })
  }

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const productMatch = url.pathname.match(/^\/api\/products\/(\d+)$/)
    const activeMatch = url.pathname.match(/^\/api\/products\/(\d+)\/active$/)
    const recipientMatch = url.pathname.match(/^\/api\/settings\/swish\/recipients\/([^/]+)$/)
    try {
      if (request.method === 'GET' && url.pathname === '/start' && !isLocalRequest(request)) {
        response.writeHead(302, { Location: '/' })
        return response.end()
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/status') {
        return json(response, 200, {
          configured: pinConfigured(db),
          authenticated: isAdminAuthorized(request, db),
          local: isLocalRequest(request),
        })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        if (!pinConfigured(db)) return json(response, 400, { error: 'Ingen Admin-PIN är satt ännu.' })
        const attempt = loginState(request)
        if (attempt.state?.blockedUntil > attempt.now) return tooManyLoginAttempts(response, attempt.state.blockedUntil)
        const body = requireJsonObject(await readJson(request), 'Ogiltiga inloggningsdata.')
        if (!verifyAdminPin(db, body.pin)) {
          const failures = (attempt.state?.failures || 0) + 1
          const state = {
            failures,
            firstFailure: attempt.state?.firstFailure || attempt.now,
            blockedUntil: failures >= LOGIN_MAX_FAILURES ? attempt.now + LOGIN_BLOCK_MS : 0,
          }
          loginFailures.set(attempt.key, state)
          if (state.blockedUntil) return tooManyLoginAttempts(response, state.blockedUntil)
          const delayMs = Math.min(loginBaseDelayMs * (2 ** (failures - 1)), 1_200)
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
          return json(response, 401, { error: 'Fel PIN-kod.' })
        }
        loginFailures.delete(attempt.key)
        createAdminSession(response, db)
        return json(response, 200, { authenticated: true })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        clearAdminSession(request, response)
        return json(response, 200, { authenticated: false })
      }
      if (request.method === 'PUT' && url.pathname === '/api/local/admin-pin') {
        if (!isLocalRequest(request)) return json(response, 403, { error: 'PIN-koden kan bara ändras på serverdatorn.' })
        const body = requireJsonObject(await readJson(request), 'Ogiltiga PIN-data.')
        setAdminPin(db, body.pin)
        createAdminSession(response, db)
        return json(response, 200, { configured: true, authenticated: true })
      }
      if (request.method === 'GET' && url.pathname === '/api/network') {
        if (!isLocalRequest(request)) return json(response, 403, { error: 'Nätverksinformationen är endast tillgänglig på serverdatorn.' })
        const host = request.headers.host || 'localhost:3000'
        let port = 3000
        try { port = Number(new URL(`http://${host}`).port || 80) }
        catch { /* Använd standardporten för ett ogiltigt Host-huvud. */ }
        const profiles = await getNetworkProfiles()
        const profileByName = new Map(profiles.map((profile) => [profile.name, profile.category]))
        const profileRank = { Private: 0, Unknown: 1, DomainAuthenticated: 1, Public: 2 }
        const lanAddresses = getLanAddresses().map(({ name, address }) => ({
          name, address, url: `http://${address}:${port}`,
          profile: profileByName.get(name) || 'Unknown',
        })).sort((a, b) => (profileRank[a.profile] ?? 1) - (profileRank[b.profile] ?? 1))
        return json(response, 200, {
          local_url: `http://localhost:${port}`,
          lan_addresses: lanAddresses,
          network_profiles: profiles,
        })
      }
      if (request.method === 'GET' && url.pathname === '/api/logo') {
        if (!logoPath) return response.writeHead(404).end()
        const logo = readLogo(logoPath)
        if (!logo) return response.writeHead(404).end()
        response.writeHead(200, { 'Content-Type': logo.contentType, 'Cache-Control': 'no-cache' })
        return response.end(logo.data)
      }
      if (url.pathname === '/api/local/logo') {
        if (!isLocalRequest(request)) return json(response, 403, { error: 'Logotypen kan bara ändras på serverdatorn.' })
        if (!logoPath) return json(response, 500, { error: 'Logotypens lagringsplats saknas.' })
        if (request.method === 'GET') return json(response, 200, { configured: logoConfigured(logoPath) })
        if (request.method === 'PUT') {
          await saveLogo(logoPath, request)
          return json(response, 200, { configured: true })
        }
        if (request.method === 'DELETE') {
          deleteLogo(logoPath)
          return json(response, 200, { configured: false })
        }
        response.setHeader('Allow', 'GET, PUT, DELETE')
        return json(response, 405, { error: 'Metoden stöds inte.' })
      }
      if (request.method === 'GET' && url.pathname === '/api/payment/swish') {
        const selected = getSelectedSwishId(db)
        const recipient = selected
          ? db.prepare('SELECT id, name, number FROM swish_recipients WHERE id = ?').get(selected)
          : null
        if (!recipient) return json(response, 404, { error: 'Ingen aktiv Swish-mottagare är vald.' })
        return json(response, 200, { recipient })
      }
      if (request.method === 'GET' && url.pathname === '/api/settings/swish') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        return json(response, 200, {
          selected: getSelectedSwishId(db),
          recipients: listSwishRecipients(db),
        })
      }
      if (request.method === 'PUT' && url.pathname === '/api/settings/swish') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const body = requireJsonObject(await readJson(request), 'Ogiltiga Swish-inställningar.')
        const recipient = db.prepare('SELECT id FROM swish_recipients WHERE id = ?').get(body.selected)
        if (!recipient) return json(response, 400, { error: 'Ogiltig Swish-mottagare.' })
        setSelectedSwishId(db, recipient.id)
        return json(response, 200, {
          selected: recipient.id,
          recipients: listSwishRecipients(db),
        })
      }
      if (request.method === 'POST' && url.pathname === '/api/settings/swish/recipients') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        try {
          return json(response, 201, createSwishRecipient(db, await readJson(request)))
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) return json(response, 400, { error: 'Swishnumret finns redan.' })
          throw error
        }
      }
      if (request.method === 'PUT' && recipientMatch) {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const id = decodePathSegment(recipientMatch[1])
        try {
          const recipient = updateSwishRecipient(db, id, await readJson(request))
          if (!recipient) return json(response, 404, { error: 'Swish-mottagaren finns inte.' })
          return json(response, 200, recipient)
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) return json(response, 400, { error: 'Swishnumret finns redan.' })
          throw error
        }
      }
      if (request.method === 'DELETE' && recipientMatch) {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const id = decodePathSegment(recipientMatch[1])
        if (id === getSelectedSwishId(db)) {
          return json(response, 400, { error: 'Välj en annan aktiv Swish-mottagare innan du tar bort denna.' })
        }
        const result = db.prepare('DELETE FROM swish_recipients WHERE id = ?').run(id)
        if (result.changes === 0) return json(response, 404, { error: 'Swish-mottagaren finns inte.' })
        response.writeHead(204)
        return response.end()
      }
      if (request.method === 'GET' && url.pathname === '/api/products') {
        const rows = db.prepare(`SELECT id, name, price, active, sort_order FROM products WHERE active = 1 ${order}`).all()
        return json(response, 200, rows.map(toProduct))
      }
      if (request.method === 'GET' && url.pathname === '/api/admin/products') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const rows = db.prepare(`SELECT id, name, price, active, sort_order FROM products ${order}`).all()
        return json(response, 200, rows.map(toProduct))
      }
      if (request.method === 'GET' && url.pathname === '/api/statistics/today') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const today = dateKey()
        const { start, end } = stockholmDateRange(today, today)
        const orders = db.prepare(`
          SELECT id, created_at, total, swish_recipient_id, swish_recipient_name
          FROM orders
          WHERE created_at >= ? AND created_at < ?
          ORDER BY created_at DESC, id DESC
        `).all(start, end)
        const items = db.prepare(`
          SELECT oi.order_id, oi.product_name, oi.quantity, oi.subtotal
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.created_at >= ? AND o.created_at < ?
          ORDER BY oi.id ASC
        `).all(start, end)
        const products = new Map()
        for (const item of items) {
          const current = products.get(item.product_name) || { name: item.product_name, quantity: 0, total: 0 }
          current.quantity += item.quantity
          current.total += item.subtotal
          products.set(item.product_name, current)
        }
        const recipients = new Map()
        for (const row of orders) {
          const current = recipients.get(row.swish_recipient_id) || {
            id: row.swish_recipient_id, name: row.swish_recipient_name, orders: 0, total: 0,
          }
          current.orders += 1
          current.total += row.total
          recipients.set(row.swish_recipient_id, current)
        }
        const total = orders.reduce((sum, row) => sum + row.total, 0)
        return json(response, 200, {
          date: today,
          order_count: orders.length,
          total,
          average: orders.length ? total / orders.length : 0,
          products: [...products.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'sv')),
          recipients: [...recipients.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'sv')),
          recent: orders.slice(0, 10),
        })
      }
      if (request.method === 'GET' && url.pathname === '/api/statistics/export') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const from = url.searchParams.get('from')
        const to = url.searchParams.get('to')
        const type = url.searchParams.get('type') || 'sales'
        if (!['sales', 'payments'].includes(type)) return json(response, 400, { error: 'Ogiltig exporttyp.' })
        const { filename, csv } = type === 'payments'
          ? createPaymentExport(db, from, to)
          : createSalesExport(db, from, to)
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        })
        return response.end(csv)
      }
      if (request.method === 'POST' && url.pathname === '/api/orders') {
        const requestedOrder = validateOrderRequest(await readJson(request))
        const existing = db.prepare(`
          SELECT id, created_at, total, swish_recipient_id
          FROM orders WHERE client_order_id = ?
        `).get(requestedOrder.client_order_id)
        if (existing) {
          if (!existingOrderMatches(db, existing, requestedOrder)) {
            return json(response, 409, { error: 'Köp-ID:t har redan använts för en annan order.' })
          }
          return json(response, 200, { id: existing.id, created_at: existing.created_at, total: existing.total })
        }
        const order = validateNewOrder(requestedOrder, db)
        db.exec('BEGIN')
        try {
          const result = db.prepare(`
            INSERT INTO orders (client_order_id, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
            VALUES (?, ?, ?, ?, ?)
          `).run(order.client_order_id, order.total, order.recipient.id, order.recipient.name, order.recipient.number)
          const orderId = Number(result.lastInsertRowid)
          const insertItem = db.prepare(`
            INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          for (const item of order.items) {
            insertItem.run(orderId, item.product_id, item.product_name, item.unit_price, item.quantity, item.subtotal)
          }
          const saved = db.prepare('SELECT id, created_at, total FROM orders WHERE id = ?').get(orderId)
          db.exec('COMMIT')
          return json(response, 201, saved)
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/products') {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const product = validateProduct(await readJson(request))
        db.exec('BEGIN')
        try {
          const result = db.prepare('INSERT INTO products (name, price, active, sort_order) VALUES (?, ?, ?, ?)')
            .run(product.name, product.price, Number(product.active), product.sort_order)
          reorderProducts(db, Number(result.lastInsertRowid), product.sort_order)
          db.exec('COMMIT')
          return json(response, 201, toProduct(selectById.get(result.lastInsertRowid)))
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      if (request.method === 'DELETE' && productMatch) {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const id = Number(productMatch[1])
        db.exec('BEGIN')
        try {
          const result = db.prepare('DELETE FROM products WHERE id = ?').run(id)
          if (result.changes === 0) {
            db.exec('ROLLBACK')
            return json(response, 404, { error: 'Produkten finns inte.' })
          }
          normalizeProductOrder(db)
          db.exec('COMMIT')
          response.writeHead(204)
          return response.end()
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      if (request.method === 'PUT' && productMatch) {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const id = Number(productMatch[1])
        if (!selectById.get(id)) return json(response, 404, { error: 'Produkten finns inte.' })
        const product = validateProduct(await readJson(request))
        db.exec('BEGIN')
        try {
          db.prepare('UPDATE products SET name = ?, price = ?, active = ? WHERE id = ?')
            .run(product.name, product.price, Number(product.active), id)
          reorderProducts(db, id, product.sort_order)
          db.exec('COMMIT')
          return json(response, 200, toProduct(selectById.get(id)))
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
      if (request.method === 'PATCH' && activeMatch) {
        if (!isAdminAuthorized(request, db)) return unauthorized(response)
        const id = Number(activeMatch[1])
        const body = await readJson(request)
        if (typeof body?.active !== 'boolean') return json(response, 400, { error: 'active måste vara true eller false.' })
        const result = db.prepare('UPDATE products SET active = ? WHERE id = ?').run(Number(body.active), id)
        if (result.changes === 0) return json(response, 404, { error: 'Produkten finns inte.' })
        return json(response, 200, toProduct(selectById.get(id)))
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'API-sökvägen finns inte.' })
      if (request.method === 'GET' && serveStatic(url.pathname, response, staticDir)) return
      return json(response, 404, { error: 'Sidan finns inte. Kör npm run build innan npm start.' })
    } catch (error) {
      if (error instanceof HttpError) return json(response, error.status, { error: error.message })
      logError(`Oväntat fel för ${request.method} ${url.pathname}:`, error)
      return json(response, 500, { error: 'Ett oväntat internt fel inträffade.' })
    }
  })
}
