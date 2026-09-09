import { networkInterfaces } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function getLanAddresses(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, addresses]) => (addresses || [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => ({ name, address: entry.address })))
}

export async function getNetworkProfiles() {
  if (process.platform !== 'win32') return []
  const command = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8;',
    "Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } |",
    "Select-Object @{Name='name';Expression={$_.InterfaceAlias}},@{Name='category';Expression={$_.NetworkCategory.ToString()}} |",
    'ConvertTo-Json -Compress',
  ].join(' ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true,
    })
    if (!stdout.trim()) return []
    const result = JSON.parse(stdout)
    return (Array.isArray(result) ? result : [result])
      .filter((profile) => profile?.name && profile?.category)
  } catch {
    return []
  }
}
