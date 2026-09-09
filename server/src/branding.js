import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { HttpError, ValidationError } from './errors.js'

export const MAX_LOGO_BYTES = 5 * 1024 * 1024
export const MAX_LOGO_DIMENSION = 8000

function imageInfo(data) {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { contentType: 'image/png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data.length >= 10 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) {
    return { contentType: 'image/gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset + 3 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue }
      while (data[offset] === 0xff) offset += 1
      const marker = data[offset]
      offset += 1
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > data.length) break
      const segmentLength = data.readUInt16BE(offset)
      if (segmentLength < 2 || offset + segmentLength > data.length) break
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
      if (isStartOfFrame && segmentLength >= 7) {
        return {
          contentType: 'image/jpeg',
          width: data.readUInt16BE(offset + 5),
          height: data.readUInt16BE(offset + 3),
        }
      }
      offset += segmentLength
    }
  }
  return null
}

async function readRequest(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_LOGO_BYTES) throw new ValidationError('Logotypen måste vara en bildfil på högst 5 MB.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function logoConfigured(filename) {
  return existsSync(filename)
}

export function readLogo(filename) {
  if (!existsSync(filename)) return null
  const data = readFileSync(filename)
  const info = imageInfo(data)
  if (!info) throw new HttpError(500, 'Logotypen kunde inte läsas.')
  return { data, contentType: info.contentType }
}

export async function saveLogo(filename, request) {
  const data = await readRequest(request)
  const info = imageInfo(data)
  if (!info) throw new ValidationError('Logotypen måste vara PNG, JPEG eller GIF.')
  if (info.width < 1 || info.height < 1 || info.width > MAX_LOGO_DIMENSION || info.height > MAX_LOGO_DIMENSION) {
    throw new ValidationError('Bildfilen är ogiltig eller har orimliga dimensioner.')
  }
  mkdirSync(dirname(filename), { recursive: true })
  writeFileSync(filename, data, { mode: 0o600 })
}

export function deleteLogo(filename) {
  rmSync(filename, { force: true })
}
