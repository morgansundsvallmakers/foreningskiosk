import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createApp } from './app.js'
import { openDatabase } from './database.js'
import { getLanAddresses } from './network.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(currentDir, '..', '..')
const databasePath = process.env.DATABASE_PATH || resolve(projectRoot, 'data', 'foreningskiosken.db')
const logoPath = resolve(dirname(databasePath), 'foreningskiosken-logo')
const staticDir = resolve(projectRoot, 'frontend', 'dist')
const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 3000)
const db = openDatabase(databasePath)
const server = createApp({ db, staticDir, logoPath })

server.listen(port, host, () => {
  const actualPort = server.address().port
  console.log('Föreningskiosken är startad:')
  console.log(`  Lokalt: http://localhost:${actualPort}`)

  if (host === '0.0.0.0') {
    const lanAddresses = getLanAddresses().map(({ address }) => address)
    if (lanAddresses.length === 0) console.log('  LAN: ingen aktiv IPv4-adress hittades')
    for (const address of lanAddresses) console.log(`  LAN: http://${address}:${actualPort}`)
  } else {
    console.log(`  Nätverk: http://${host}:${actualPort}`)
  }

  if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `http://localhost:${actualPort}/start`], {
      detached: true, stdio: 'ignore',
    }).unref()
  }
})

function shutdown() {
  server.close(() => { db.close(); process.exit(0) })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
