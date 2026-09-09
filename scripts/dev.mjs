import { spawn } from 'node:child_process'

const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('Kunde inte hitta pnpm CLI. Starta utvecklingsmiljön med: pnpm dev')
  process.exit(1)
}

const processes = [
  spawn(process.execPath, [npmCli, '--dir', 'server', 'run', 'dev'], { stdio: 'inherit' }),
  spawn(process.execPath, [npmCli, '--dir', 'frontend', 'run', 'dev'], { stdio: 'inherit' }),
]

let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) child.kill()
  process.exitCode = exitCode
}

for (const child of processes) {
  child.on('exit', (code, signal) => {
    if (!stopping && signal !== 'SIGTERM') stop(code ?? 1)
  })
  child.on('error', (error) => {
    console.error(error.message)
    stop(1)
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
