/**
 * Media protocol registry: the `lkvmedia://` scheme serves only files that were
 * explicitly registered (at ingest/dialog time) under an opaque id. The URL never
 * carries a filesystem path, so a renderer (or a remote page) cannot read arbitrary
 * files on disk by guessing a path.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

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

/** Clear the registry (tests). */
export function resetMediaRegistry(): void {
  registry.clear()
}
