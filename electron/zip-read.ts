/**
 * Minimal, dependency-free ZIP reader (stored + deflate) for plugin installs.
 * Reads the central directory; rejects encrypted entries, zip64, absolute paths and "..".
 */
import zlib from 'zlib'

export interface ZipEntry {
  name: string
  data: Buffer
}

const MAX_ENTRIES = 500
const MAX_TOTAL_BYTES = 25 * 1024 * 1024

export function readZip(buf: Buffer): ZipEntry[] {
  // Find End Of Central Directory (last 64 KB)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 archives are not supported')
  if (count > MAX_ENTRIES) throw new Error(`Zip has too many files (${count} > ${MAX_ENTRIES})`)

  const out: ZipEntry[] = []
  let total = 0
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/')
    p += 46 + nameLen + extraLen + commentLen

    if (flags & 0x1) throw new Error(`Encrypted zip entries are not supported (${name})`)
    if (name.endsWith('/')) continue // directory
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').includes('..')) {
      throw new Error(`Unsafe path in zip: ${name}`)
    }
    total += size
    if (total > MAX_TOTAL_BYTES) throw new Error('Zip contents too large (> 25 MB)')

    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`Corrupt local header for ${name}`)
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.slice(start, start + compSize)
    let data: Buffer
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = zlib.inflateRawSync(raw)
    else throw new Error(`Unsupported zip compression method ${method} (${name})`)
    out.push({ name, data })
  }
  return out
}
