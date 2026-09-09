import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const DATABASE_SCHEMA_VERSION = 2

const migrations = [
  {
    version: 1,
    migrate(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS swish_recipients (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          number TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_order_id TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          total INTEGER NOT NULL CHECK (total >= 0),
          swish_recipient_id TEXT NOT NULL,
          swish_recipient_name TEXT NOT NULL,
          swish_recipient_number TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL,
          product_name TEXT NOT NULL,
          unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          subtotal INTEGER NOT NULL CHECK (subtotal = unit_price * quantity)
        );

        CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
      `)

      const orderColumns = db.prepare('PRAGMA table_info(orders)').all()
      if (!orderColumns.some((column) => column.name === 'client_order_id')) {
        db.exec('ALTER TABLE orders ADD COLUMN client_order_id TEXT')
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id_idx
        ON orders(client_order_id) WHERE client_order_id IS NOT NULL
      `)
    },
  },
  {
    version: 2,
    migrate(db) {
      db.exec('CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at)')
    },
  },
]

function insertExampleProducts(db) {
  const insert = db.prepare('INSERT INTO products (name, price, active, sort_order) VALUES (?, ?, 1, ?)')
  insert.run('Kaffe', 10, 1)
  insert.run('Korv', 20, 2)
  insert.run('Macka', 25, 3)
}

function migrateDatabase(db, seedProducts) {
  const currentVersion = Number(db.prepare('PRAGMA user_version').get().user_version)
  if (currentVersion > DATABASE_SCHEMA_VERSION) {
    throw new Error(`Databasschemat är nyare än denna programversion (${currentVersion}).`)
  }

  const pendingMigrations = migrations.filter(({ version }) => version > currentVersion)
  if (pendingMigrations.length === 0) return

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const migration of pendingMigrations) {
      migration.migrate(db)
      if (migration.version === 1 && seedProducts) insertExampleProducts(db)
      db.exec(`PRAGMA user_version = ${migration.version}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function seedInitialData(db) {
  const selected = db.prepare('SELECT value FROM settings WHERE key = ?').get('swish_recipient')?.value
  const selectedExists = selected && db.prepare('SELECT 1 FROM swish_recipients WHERE id = ?').get(selected)
  if (!selectedExists) {
    const fallback = db.prepare('SELECT id FROM swish_recipients ORDER BY rowid LIMIT 1').get()?.id
    if (fallback) {
      db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run('swish_recipient', fallback)
    }
  }
}

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  try {
    const productsTableExisted = Boolean(db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'products'
    `).get())
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    migrateDatabase(db, !productsTableExisted)
    seedInitialData(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function toProduct(row) {
  return row ? { ...row, active: Boolean(row.active) } : row
}
