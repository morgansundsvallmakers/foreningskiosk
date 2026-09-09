import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/database.js'

const db = openDatabase(':memory:')
db.exec(`
  INSERT INTO swish_recipients (id, name, number) VALUES
    ('precision', 'Exempelklubben', '1234567890'),
    ('field', 'Exempelföreningen', '1234567891'),
    ('club', 'Exempelgruppen', '1234567892');
  INSERT INTO settings (key, value) VALUES ('swish_recipient', 'precision');
`)
const loggedErrors = []
const server = createApp({
  db,
  getLanAddresses: () => [{ name: 'Wi-Fi', address: '192.168.1.50' }],
  getNetworkProfiles: async () => [{ name: 'Wi-Fi', category: 'Private' }],
  logError: (...args) => loggedErrors.push(args),
})
let baseUrl
let adminCookie

function adminHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', Cookie: adminCookie, ...extra }
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`

  const pinResponse = await fetch(`${baseUrl}/api/local/admin-pin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2468' }),
  })
  assert.equal(pinResponse.status, 200)
  adminCookie = pinResponse.headers.get('set-cookie')?.split(';')[0]
  assert.ok(adminCookie)
})
after(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
})

test('kräver PIN-session för admin och accepterar rätt PIN', async () => {
  const statusResponse = await fetch(`${baseUrl}/api/auth/status`)
  assert.equal(statusResponse.status, 200)
  assert.deepEqual(await statusResponse.json(), {
    configured: true,
    authenticated: false,
    local: true,
  })

  const denied = await fetch(`${baseUrl}/api/admin/products`)
  assert.equal(denied.status, 401)

  const wrongLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '0000' }),
  })
  assert.equal(wrongLogin.status, 401)

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }),
  })
  assert.equal(login.status, 200)
  assert.match(login.headers.get('set-cookie') || '', /Max-Age=86400/)
})

test('klassificerar strukturellt ogiltiga requestdata och URL-kodning som 400', async () => {
  const loggedBefore = loggedErrors.length
  const requests = [
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
    }),
    fetch(`${baseUrl}/api/local/admin-pin`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'null',
    }),
    fetch(`${baseUrl}/api/settings/swish`, {
      method: 'PUT', headers: adminHeaders(), body: 'null',
    }),
    fetch(`${baseUrl}/api/settings/swish/recipients/%`, {
      method: 'DELETE', headers: adminHeaders(),
    }),
  ]

  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 400)
    assert.notEqual((await response.json()).error, 'Ett oväntat internt fel inträffade.')
  }
  assert.equal(loggedErrors.length, loggedBefore)
})

test('listar de aktiva exempelprodukterna i sorteringsordning', async () => {
  const response = await fetch(`${baseUrl}/api/products`)
  assert.equal(response.status, 200)
  const products = await response.json()
  assert.deepEqual(products.map(({ name, price }) => ({ name, price })), [
    { name: 'Kaffe', price: 10 }, { name: 'Korv', price: 20 }, { name: 'Macka', price: 25 },
  ])
})

test('skapar, flyttar och inaktiverar en produkt med adminsession', async () => {
  const createdResponse = await fetch(`${baseUrl}/api/products`, {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ name: 'Läsk', price: 15, active: true, sort_order: 2 }),
  })
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json()

  let allProducts = await (await fetch(`${baseUrl}/api/admin/products`, { headers: adminHeaders() })).json()
  assert.deepEqual(allProducts.map(({ name, sort_order }) => ({ name, sort_order })), [
    { name: 'Kaffe', sort_order: 1 },
    { name: 'Läsk', sort_order: 2 },
    { name: 'Korv', sort_order: 3 },
    { name: 'Macka', sort_order: 4 },
  ])

  const updatedResponse = await fetch(`${baseUrl}/api/products/${created.id}`, {
    method: 'PUT', headers: adminHeaders(),
    body: JSON.stringify({ name: 'Läsk 33 cl', price: 18, active: true, sort_order: 4 }),
  })
  assert.equal(updatedResponse.status, 200)
  assert.equal((await updatedResponse.json()).price, 18)

  allProducts = await (await fetch(`${baseUrl}/api/admin/products`, { headers: adminHeaders() })).json()
  assert.deepEqual(allProducts.map(({ name, sort_order }) => ({ name, sort_order })), [
    { name: 'Kaffe', sort_order: 1 },
    { name: 'Korv', sort_order: 2 },
    { name: 'Macka', sort_order: 3 },
    { name: 'Läsk 33 cl', sort_order: 4 },
  ])

  const toggledResponse = await fetch(`${baseUrl}/api/products/${created.id}/active`, {
    method: 'PATCH', headers: adminHeaders(), body: JSON.stringify({ active: false }),
  })
  assert.equal(toggledResponse.status, 200)
  assert.equal((await toggledResponse.json()).active, false)
  const activeProducts = await (await fetch(`${baseUrl}/api/products`)).json()
  assert.equal(activeProducts.some((product) => product.id === created.id), false)
  allProducts = await (await fetch(`${baseUrl}/api/admin/products`, { headers: adminHeaders() })).json()
  assert.equal(allProducts.some((product) => product.id === created.id), true)
})

test('avvisar produktändring utan adminsession', async () => {
  const response = await fetch(`${baseUrl}/api/products`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Otillåten', price: 1, active: true, sort_order: 1 }),
  })
  assert.equal(response.status, 401)
})

test('avvisar ogiltiga produktdata', async () => {
  const response = await fetch(`${baseUrl}/api/products`, {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ name: '', price: 4.5 }),
  })
  assert.equal(response.status, 400)
})

test('avvisar produktvärden över praktiska maxgränser och osäkra heltal', async () => {
  const invalidProducts = [
    { name: 'Pris saknas', price: null, active: true, sort_order: 1 },
    { name: 'Fel pristyp', price: true, active: true, sort_order: 1 },
    { name: 'För dyr', price: 100_001, active: true, sort_order: 1 },
    { name: 'Osäkert pris', price: Number.MAX_SAFE_INTEGER + 1, active: true, sort_order: 1 },
    { name: 'För långt ned', price: 10, active: true, sort_order: 10_001 },
    { name: 'Osäker ordning', price: 10, active: true, sort_order: Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const product of invalidProducts) {
    const response = await fetch(`${baseUrl}/api/products`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify(product),
    })
    assert.equal(response.status, 400)
  }

  const maximum = await fetch(`${baseUrl}/api/products`, {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ name: 'Maxgräns', price: 100_000, active: true, sort_order: 10_000 }),
  })
  assert.equal(maximum.status, 201)
  const created = await maximum.json()
  assert.equal(created.price, 100_000)
  assert.equal((await fetch(`${baseUrl}/api/products/${created.id}`, {
    method: 'DELETE', headers: adminHeaders(),
  })).status, 204)
})

test('returnerar lokala adresser för startvyn', async () => {
  const response = await fetch(`${baseUrl}/api/network`)
  assert.equal(response.status, 200)
  const network = await response.json()
  assert.equal(network.local_url, baseUrl.replace('127.0.0.1', 'localhost'))
  assert.deepEqual(network.lan_addresses, [{
    name: 'Wi-Fi', address: '192.168.1.50', url: `http://192.168.1.50:${server.address().port}`,
    profile: 'Private',
  }])
  assert.deepEqual(network.network_profiles, [{ name: 'Wi-Fi', category: 'Private' }])
})

test('nekar nätverksinformation för en fjärrklient', async () => {
  const remoteDb = openDatabase(':memory:')
  const remoteServer = createApp({ db: remoteDb, isLocalRequest: () => false })
  try {
    await new Promise((resolve) => remoteServer.listen(0, '127.0.0.1', resolve))
    const remoteUrl = `http://127.0.0.1:${remoteServer.address().port}`
    const response = await fetch(`${remoteUrl}/api/network`)
    assert.equal(response.status, 403)
  } finally {
    await new Promise((resolve) => remoteServer.close(resolve))
    remoteDb.close()
  }
})

test('exponerar bara vald Swish-mottagare publikt och skyddar hela listan', async () => {
  const paymentResponse = await fetch(`${baseUrl}/api/payment/swish`)
  assert.equal(paymentResponse.status, 200)
  assert.deepEqual(await paymentResponse.json(), {
    recipient: { id: 'precision', name: 'Exempelklubben', number: '1234567890' },
  })

  const denied = await fetch(`${baseUrl}/api/settings/swish`)
  assert.equal(denied.status, 401)

  const allowed = await fetch(`${baseUrl}/api/settings/swish`, { headers: adminHeaders() })
  assert.equal(allowed.status, 200)
  const settings = await allowed.json()
  assert.equal(settings.selected, 'precision')
  assert.equal(settings.recipients.length, 3)
})

test('skyddar statistik och CSV-export med adminsession', async () => {
  assert.equal((await fetch(`${baseUrl}/api/statistics/today`)).status, 401)
  assert.equal((await fetch(`${baseUrl}/api/statistics/export?from=2026-09-06&to=2026-09-06`)).status, 401)

  const statistics = await fetch(`${baseUrl}/api/statistics/today`, { headers: adminHeaders() })
  assert.equal(statistics.status, 200)
  const exported = await fetch(`${baseUrl}/api/statistics/export?from=2026-09-06&to=2026-09-06`, {
    headers: adminHeaders(),
  })
  assert.equal(exported.status, 200)
  assert.match(exported.headers.get('content-type') || '', /^text\/csv/)
})

test('avvisar verkligt ogiltiga kalenderdatum i export-API:t', async () => {
  const response = await fetch(`${baseUrl}/api/statistics/export?from=2026-02-30&to=2026-03-01`, {
    headers: adminHeaders(),
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Välj giltiga datum för exporten.' })
})

test('skapar en order med mottagare och ögonblicksbilder av produkterna', async () => {
  const products = await (await fetch(`${baseUrl}/api/products`)).json()
  const coffee = products.find(({ name }) => name === 'Kaffe')
  const sandwich = products.find(({ name }) => name === 'Macka')
  const clientOrderId = randomUUID()
  const requestBody = {
    client_order_id: clientOrderId,
    total: coffee.price * 2 + sandwich.price,
    swish_recipient_id: 'precision',
    items: [
      { product_id: coffee.id, quantity: 2 },
      { product_id: sandwich.id, quantity: 1 },
    ],
  }
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  assert.equal(response.status, 201)
  const created = await response.json()
  assert.equal(Number.isInteger(created.id), true)
  assert.equal(created.total, 45)
  assert.equal(Number.isNaN(Date.parse(created.created_at)), false)

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(created.id)
  assert.equal(order.client_order_id, clientOrderId)
  assert.deepEqual({
    total: order.total,
    id: order.swish_recipient_id,
    name: order.swish_recipient_name,
    number: order.swish_recipient_number,
  }, { total: 45, id: 'precision', name: 'Exempelklubben', number: '1234567890' })
  const items = db.prepare(`
    SELECT product_id, product_name, unit_price, quantity, subtotal
    FROM order_items WHERE order_id = ? ORDER BY id
  `).all(created.id).map((item) => ({ ...item }))
  assert.deepEqual(items, [
    { product_id: coffee.id, product_name: 'Kaffe', unit_price: 10, quantity: 2, subtotal: 20 },
    { product_id: sandwich.id, product_name: 'Macka', unit_price: 25, quantity: 1, subtotal: 25 },
  ])

  db.prepare('UPDATE products SET name = ?, price = ? WHERE id = ?').run('Bryggkaffe', 12, coffee.id)
  const snapshots = db.prepare('SELECT product_name, unit_price FROM order_items WHERE order_id = ? ORDER BY id')
    .all(created.id).map((item) => ({ ...item }))
  assert.deepEqual(snapshots, [
    { product_name: 'Kaffe', unit_price: 10 },
    { product_name: 'Macka', unit_price: 25 },
  ])

  const ordersBeforeRetry = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count
  const retry = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
  })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).id, created.id)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, ordersBeforeRetry)

  const conflict = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody, total: requestBody.total + 1 }),
  })
  assert.equal(conflict.status, 409)
})

test('avvisar felaktig total utan att spara någon del av ordern', async () => {
  const product = db.prepare('SELECT id FROM products ORDER BY id LIMIT 1').get()
  const ordersBefore = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count
  const itemsBefore = db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_order_id: randomUUID(),
      total: 1,
      swish_recipient_id: 'club',
      items: [{ product_id: product.id, quantity: 1 }],
    }),
  })
  assert.equal(response.status, 400)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, ordersBefore)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count, itemsBefore)
})

test('rullar tillbaka ordern och döljer interna databasfel', async () => {
  const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get()
  const ordersBefore = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count
  const itemsBefore = db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count
  db.exec(`
    CREATE TRIGGER fail_order_item BEFORE INSERT ON order_items
    BEGIN
      SELECT RAISE(ABORT, 'simulerat fel i orderrad');
    END;
  `)
  try {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_order_id: randomUUID(),
        total: product.price,
        swish_recipient_id: 'club',
        items: [{ product_id: product.id, quantity: 1 }],
      }),
    })
    assert.equal(response.status, 500)
    const body = await response.json()
    assert.deepEqual(body, { error: 'Ett oväntat internt fel inträffade.' })
    assert.equal(JSON.stringify(body).includes('simulerat fel'), false)
    assert.match(String(loggedErrors.at(-1)?.[1]?.message), /simulerat fel i orderrad/)
  } finally {
    db.exec('DROP TRIGGER fail_order_item')
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, ordersBefore)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count, itemsBefore)
})

test('avvisar ogiltiga mottagare och orderrader', async () => {
  const product = db.prepare('SELECT id, price FROM products ORDER BY id LIMIT 1').get()
  const ordersBefore = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count
  const invalidOrders = [
    { client_order_id: randomUUID(), total: 0, swish_recipient_id: 'club', items: [] },
    { client_order_id: randomUUID(), total: product.price, swish_recipient_id: 'okand', items: [{ product_id: product.id, quantity: 1 }] },
    { client_order_id: randomUUID(), total: product.price, swish_recipient_id: 'club', items: [{ product_id: product.id, quantity: 0 }] },
    { client_order_id: randomUUID(), total: 0, swish_recipient_id: 'club', items: [{ product_id: 999999, quantity: 1 }] },
  ]
  for (const order of invalidOrders) {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order),
    })
    assert.equal(response.status, 400)
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, ordersBefore)
})

test('avvisar order för en inaktiv produkt', async () => {
  const product = db.prepare('SELECT id, price, active FROM products ORDER BY id LIMIT 1').get()
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(product.id)
  try {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_order_id: randomUUID(),
        total: product.price,
        swish_recipient_id: 'club',
        items: [{ product_id: product.id, quantity: 1 }],
      }),
    })
    assert.equal(response.status, 400)
  } finally {
    db.prepare('UPDATE products SET active = ? WHERE id = ?').run(product.active, product.id)
  }
})

test('logout rensar admincookien', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }),
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: cookie },
  })
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/)

  const clearedCookie = logout.headers.get('set-cookie')?.split(';')[0]
  const denied = await fetch(`${baseUrl}/api/admin/products`, { headers: { Cookie: clearedCookie } })
  assert.equal(denied.status, 401)
})

test('begränsar upprepade felaktiga PIN-försök', async () => {
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '0000' }),
    })
    assert.equal(response.status, 401)
  }
  const blocked = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '0000' }),
  })
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1)

  const stillBlocked = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }),
  })
  assert.equal(stillBlocked.status, 429)
})
