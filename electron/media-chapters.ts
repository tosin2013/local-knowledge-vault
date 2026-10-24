/**
 * Video chapters (#365): kept per video key so study-guide checkpoints can
 * fall on chapter boundaries. YouTube chapters come from the yt-dlp metadata
 * the ingest already reads; videos without chapters use every-N-minutes.
 */
import { getDb } from './db'
import type { MediaChapter } from './types'

/** Chapters from `yt-dlp -J` metadata (sorted, sane, titled). Pure. */
export function parseYtChapters(info: unknown): MediaChapter[] {
  const list = info && typeof info === 'object' ? (info as { chapters?: unknown }).chapters : null
  if (!Array.isArray(list)) return []
  const out: MediaChapter[] = []
  for (const c of list) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const startSec = Number(o.start_time)
    const endSec = Number(o.end_time)
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec || startSec < 0) continue
    out.push({ startSec, endSec, title: String(o.title ?? '').trim().slice(0, 200) })
  }
  return out.sort((a, b) => a.startSec - b.startSec)
}

/** Replace a video's chapters. */
export function saveVideoChapters(videoKey: string, chapters: MediaChapter[]): number {
  const key = String(videoKey ?? '').trim()
  if (!key) return 0
  const database = getDb()
  const insert = database.prepare('INSERT OR REPLACE INTO media_chapters (video_key, start_sec, end_sec, title) VALUES (?, ?, ?, ?)')
  database.transaction(() => {
    database.prepare('DELETE FROM media_chapters WHERE video_key = ?').run(key)
    for (const c of chapters) insert.run(key, c.startSec, c.endSec, c.title)
  })()
  return chapters.length
}

export function listVideoChapters(videoKey: string): MediaChapter[] {
  const rows = getDb()
    .prepare('SELECT start_sec, end_sec, title FROM media_chapters WHERE video_key = ? ORDER BY start_sec')
    .all(String(videoKey ?? '')) as Array<{ start_sec: number; end_sec: number; title: string }>
  return rows.map((r) => ({ startSec: r.start_sec, endSec: r.end_sec, title: r.title }))
}
