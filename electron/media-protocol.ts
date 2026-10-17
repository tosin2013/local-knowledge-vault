/**
 * Media protocol registry: the `lkvmedia://` scheme serves only files that were
 * explicitly registered (at ingest/dialog time) under an opaque id. The URL never
 * carries a filesystem path, so a renderer (or a remote page) cannot read arbitrary
 * files on disk by guessing a path. The handler also serves HTTP range requests
 * (#326) so Chromium can seek in long local media.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'

/** Allowed media extensions → MIME type. Anything else is never served. */
const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aac': 'audio/aac',
}

// opaque id -> absolute file path
const registry = new Map<string, string>()

/** Validate a file is a regular file with an allowed media extension. */
function isServableMedia(absPath: string): boolean {
  let st: fs.Stats
  try {
    st = fs.statSync(absPath)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  return path.extname(absPath).toLowerCase() in MEDIA_MIME
}

/**
 * Register a media file and return its opaque id, or null if it isn't a regular
 * file with an allowed media extension. Idempotent: the same path maps to one id.
 */
export function registerMediaFile(absPath: string): string | null {
  if (!isServableMedia(absPath)) return null
  for (const [id, p] of registry) {
    if (p === absPath) return id
  }
  const id = crypto.randomBytes(16).toString('hex')
  registry.set(id, absPath)
  return id
}

/** Resolve an opaque id to its registered path, or null if unknown. */
export function resolveMediaFile(id: string): string | null {
  return registry.get(id) ?? null
}

export function mediaMimeType(absPath: string): string {
  return MEDIA_MIME[path.extname(absPath).toLowerCase()] ?? 'application/octet-stream'
}

/** Opaque media URL for a registered file, or null if it cannot be served. */
export function mediaProtocolUrlForPath(absPath: string): string | null {
  const id = registerMediaFile(absPath)
  return id ? `lkvmedia://media/${id}` : null
}

// ---- HTTP range serving (#326) ------------------------------------------------
// net.fetch(file://…) honours a Range header but answers 200 without a
// Content-Range header, so Chromium marks the media as not seekable
// (`seekable` is [[0,0]]) and every citation seek, scrub or resume snaps back
// to 0:00. We serve the bytes ourselves instead: stat → parse Range → stream
// the slice → 206 with Content-Range.

/** The subset of the protocol `Request` the handler needs. */
export interface MediaRequestLike {
  url: string
  headers: { get(name: string): string | null }
}

export interface ByteRange {
  /** First byte offset, inclusive. */
  start: number
  /** Last byte offset, inclusive. */
  end: number
}

/**
 * Parse a `Range: bytes=…` header against a file of `size` bytes (RFC 9110
 * §14.2). Returns the satisfiable range (end clamped to the file), `null` when
 * the header is absent or not something we honour (serve the whole file with
 * 200), or `'unsatisfiable'` for a bytes range outside the file (416). Only the
 * first range of a multi-range header is served; Chromium sends single ranges.
 */
export function parseByteRange(
  header: string | null,
  size: number
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)(?:\s*,.*)?$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    // Suffix form `bytes=-N`: the last N bytes.
    const n = Number(m[2])
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start > end || start >= size) return 'unsatisfiable'
  return { start, end }
}

/** File size in bytes, or -1 when the path is missing or not a regular file. */
async function mediaFileSize(filePath: string): Promise<number> {
  try {
    const st = await fs.promises.stat(filePath)
    return st.isFile() ? st.size : -1
  } catch {
    return -1
  }
}

function streamByteRange(filePath: string, range: ByteRange): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(filePath, { start: range.start, end: range.end })
  return Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>
}

/**
 * The `lkvmedia://media/<opaque-id>` handler, registered in main.ts via
 * `protocol.handle` and exercised directly by the media smoke test. Serves only
 * files registered under an opaque id (#18), with HTTP range support so
 * `<video>`/`<audio>` can seek anywhere in long local media (#326).
 */
export async function handleMediaRequest(request: MediaRequestLike): Promise<Response> {
  try {
    const u = new URL(request.url)
    // lkvmedia://media/<opaque-id> — the id is looked up in the registry,
    // never a filesystem path.
    const id = u.pathname.replace(/^\/+/, '').split('/')[0]
    if (!id) {
      return new Response('missing media id', { status: 400 })
    }
    const filePath = resolveMediaFile(id)
    if (!filePath) {
      return new Response('unknown media id', { status: 404 })
    }
    const size = await mediaFileSize(filePath)
    if (size < 0) {
      // Registered once but deleted (or replaced by a directory) since.
      return new Response('unknown media id', { status: 404 })
    }
    const headers: Record<string, string> = {
      'Content-Type': mediaMimeType(filePath),
      'Accept-Ranges': 'bytes',
    }
    const range = parseByteRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') {
      headers['Content-Range'] = `bytes */${size}`
      return new Response(null, { status: 416, headers })
    }
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
      headers['Content-Length'] = String(range.end - range.start + 1)
      return new Response(streamByteRange(filePath, range), { status: 206, headers })
    }
    headers['Content-Length'] = String(size)
    return new Response(size > 0 ? streamByteRange(filePath, { start: 0, end: size - 1 }) : null, {
      status: 200,
      headers,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(msg, { status: 500 })
  }
}

/** Clear the registry (tests). */
export function resetMediaRegistry(): void {
  registry.clear()
}
