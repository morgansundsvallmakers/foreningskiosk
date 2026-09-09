import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDatabase } from '../src/database.js'
import { createPaymentExport, createSalesExport } from '../src/export.js'

test('exporterar försäljning som semikolonseparerad CSV', () => {
  const db = openDatabase(':memory:')
  try {
    const order = db.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-06T10:15:00.000Z', 25, 'precision', 'Precision', '1231656503')
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(order.lastInsertRowid), 1, 'Kaffe', 5, 2, 10)
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(order.lastInsertRowid), 2, 'Läsk', 15, 1, 15)

    const exported = createSalesExport(db, '2026-09-06', '2026-09-06')
    assert.equal(exported.filename, 'foreningskiosken-2026-09-06.csv')
    assert.match(exported.csv, /^\uFEFFDatum;Tid;Order-ID;Swish-mottagare;/)
    assert.match(exported.csv, /Precision;1231656503;25;Kaffe;2;5;10/)
    assert.match(exported.csv, /Precision;1231656503;25;Läsk;1;15;15/)
  } finally {
    db.close()
  }
})

test('exporterar betalningar med en rad per order', () => {
  const db = openDatabase(':memory:')
  try {
    const first = db.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-06T10:15:00.000Z', 25, 'precision', 'Precision', '1231656503')
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(first.lastInsertRowid), 1, 'Kaffe', 5, 5, 25)

    const second = db.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-06T11:00:00.000Z', 40, 'field', 'Fält', '1231834977')
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(second.lastInsertRowid), 2, 'Korv', 20, 2, 40)
    db.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-05T21:59:59.999Z', 99, 'outside-before', 'Före', '1234567890')
    db.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-06T22:00:00.000Z', 99, 'outside-after', 'Efter', '1234567890')

    const exported = createPaymentExport(db, '2026-09-06', '2026-09-06')
    assert.equal(exported.filename, 'foreningskiosken-betalningar-2026-09-06.csv')
    assert.match(exported.csv, /^\uFEFFDatum;Tid;Order-ID;Swish-mottagare;Swishnummer;Belopp/)
    assert.match(exported.csv, /Precision;1231656503;25/)
    assert.match(exported.csv, /Fält;1231834977;40/)
    assert.equal(exported.csv.split('\r\n').filter(Boolean).length, 3)
  } finally {
    db.close()
  }
})

test('avvisar om från-datum ligger efter till-datum', () => {
  const db = openDatabase(':memory:')
  try {
    assert.throws(
      () => createSalesExport(db, '2026-09-07', '2026-09-06'),
      /Från-datum får inte vara senare än till-datum/,
    )
    assert.throws(
      () => createPaymentExport(db, '2026-09-07', '2026-09-06'),
      /Från-datum får inte vara senare än till-datum/,
    )
  } finally {
    db.close()
  }
})

test('avvisar verkligt ogiltiga kalenderdatum', () => {
  const db = openDatabase(':memory:')
  try {
    for (const invalidDate of ['2026-02-30', '2026-13-01', '2026-00-10']) {
      assert.throws(
        () => createSalesExport(db, invalidDate, '2026-03-01'),
        /Välj giltiga datum för exporten/,
      )
    }
  } finally {
    db.close()
  }
})

test('neutraliserar formelprefix i textfält utan att ändra vanlig exportdata', () => {
  const db = openDatabase(':memory:')
  try {
    const order = db.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-06T10:15:00.000Z', 10, 'danger', '=2+2', '+123456789')
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(order.lastInsertRowid), 1, '-Kaffe', 10, 1, 10)
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(order.lastInsertRowid), 2, '  @Kommando', 0, 1, 0)

    const sales = createSalesExport(db, '2026-09-06', '2026-09-06').csv
    const payments = createPaymentExport(db, '2026-09-06', '2026-09-06').csv
    assert.match(sales, /'=2\+2;'\+123456789;10;'-Kaffe;1;10;10/)
    assert.match(sales, /'  @Kommando;1;0;0/)
    assert.match(payments, /'=2\+2;'\+123456789;10/)
    assert.equal(sales.includes("'Datum"), false)
  } finally {
    db.close()
  }
})
