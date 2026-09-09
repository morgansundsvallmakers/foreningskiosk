import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { DATABASE_SCHEMA_VERSION, openDatabase } from '../src/database.js'
import { createSalesExport } from '../src/export.js'

test('exempelprodukter seedas bara när produkttabellen skapas första gången', () => {
  const directory = mkdtempSync(join(tmpdir(), 'foreningskiosken-seed-'))
  const filename = join(directory, 'kiosk.db')
  let db
  try {
    db = openDatabase(filename)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 3)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM swish_recipients').get().count, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM settings WHERE key = 'swish_recipient'").get().count, 0)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, DATABASE_SCHEMA_VERSION)
    db.exec('DELETE FROM products')
    db.close()
    db = null

    db = openDatabase(filename)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM swish_recipients').get().count, 0)
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('befintliga Swish-mottagare och giltigt val bevaras vid uppstart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'foreningskiosken-swish-'))
  const filename = join(directory, 'kiosk.db')
  let db
  try {
    db = openDatabase(filename)
    db.exec(`
      INSERT INTO swish_recipients (id, name, number)
      VALUES ('example', 'Exempelklubben', '1234567890');
      INSERT INTO settings (key, value) VALUES ('swish_recipient', 'example');
    `)
    db.close()
    db = openDatabase(filename)

    const recipients = db.prepare('SELECT id, name, number FROM swish_recipients').all()
    assert.equal(recipients.length, 1)
    assert.equal(recipients[0].id, 'example')
    assert.equal(recipients[0].name, 'Exempelklubben')
    assert.equal(recipients[0].number, '1234567890')
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key = 'swish_recipient'").get().value,
      'example',
    )
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('äldre databas migreras utan att historik försvinner och kan exporteras', () => {
  const directory = mkdtempSync(join(tmpdir(), 'foreningskiosken-migration-'))
  const filename = join(directory, 'kiosk.db')
  let db
  try {
    const legacy = new DatabaseSync(filename)
    legacy.exec(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        total INTEGER NOT NULL CHECK (total >= 0),
        swish_recipient_id TEXT NOT NULL,
        swish_recipient_name TEXT NOT NULL,
        swish_recipient_number TEXT NOT NULL
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        unit_price INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        subtotal INTEGER NOT NULL
      );
    `)
    const order = legacy.prepare(`
      INSERT INTO orders (created_at, total, swish_recipient_id, swish_recipient_name, swish_recipient_number)
      VALUES (?, ?, ?, ?, ?)
    `).run('2026-09-06T10:15:00.000Z', 20, 'legacy', 'Historisk mottagare', '1234567890')
    legacy.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(order.lastInsertRowid), 42, 'Historisk produkt', 10, 2, 20)
    legacy.close()

    db = openDatabase(filename)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, DATABASE_SCHEMA_VERSION)
    const columns = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name)
    assert.ok(columns.includes('client_order_id'))
    const indexes = db.prepare('PRAGMA index_list(orders)').all().map((index) => index.name)
    assert.ok(indexes.includes('orders_client_order_id_idx'))
    assert.ok(indexes.includes('orders_created_at_idx'))
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count, 1)
    const exported = createSalesExport(db, '2026-09-06', '2026-09-06')
    assert.match(exported.csv, /Historisk mottagare;1234567890;20;Historisk produkt;2;10;20/)

    db.close()
    db = openDatabase(filename)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1)
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, DATABASE_SCHEMA_VERSION)
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nytt schema och exempelprodukter rullas tillbaka atomiskt om uppgraderingen misslyckas', () => {
  const directory = mkdtempSync(join(tmpdir(), 'foreningskiosken-atomic-migration-'))
  const filename = join(directory, 'kiosk.db')
  let inspected
  try {
    const legacy = new DatabaseSync(filename)
    legacy.exec(`
      CREATE TABLE orders_created_at_idx (id INTEGER);
      PRAGMA user_version = 0;
    `)
    legacy.close()

    assert.throws(() => openDatabase(filename), /orders_created_at_idx/)

    inspected = new DatabaseSync(filename)
    assert.equal(inspected.prepare('PRAGMA user_version').get().user_version, 0)
    assert.equal(inspected.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN ('products', 'settings', 'swish_recipients', 'orders', 'order_items')
    `).get().count, 0)
  } finally {
    inspected?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
