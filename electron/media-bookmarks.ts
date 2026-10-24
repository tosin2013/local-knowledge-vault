/**
 * Media chat bookmarks (#334): labelled moments on a video that survive
 * leaving Media chat and restarting the app, can be asked about, exported as
 * Markdown with timestamp links, and turned into Study cards that link back to
 * the moment.
 *
 * Bookmarks are keyed by the same stable video key as `media_state` (#329):
 * the YouTube URL or the local file path, never the per-run `lkvmedia://` id.
 */
import { createItem, getDb, listItemsByProjectExact, newId, nowIso } from './db'
import { formatTimestamp, parseTEndFromBody, parseTStartFromBody } from './media-captions'
import { notesNearPlayhead } from './media-ingest'
import { createNoteCards } from './study-cards'
import type {
  MediaBookmark,
  MediaBookmarkAddInput,
  MediaBookmarkCardsInput,
  MediaBookmarkCardsResult,
  MediaBookmarkUpdateInput,
  StudyMediaMoment,
} from './types'

/** The built-in tags, in the order the UI offers them. Anything else is a custom tag. */
export const BOOKMARK_TAGS = ['Review', 'Confused', 'Exam'] as const
export const BOOKMARK_LABEL_MAX = 120
export const BOOKMARK_TAG_MAX = 24
/** The transcript text shown next to a bookmark, at most this many characters. */
export const TRANSCRIPT_LINE_MAX = 160
/** A bookmark card's passage stays a single whole-note card (WHOLE_NOTE_MAX_CHARS is 1200). */
export const CARD_PASSAGE_MAX = 900
export const DEFAULT_WINDOW_SEC = 45

const METADATA_LINE = /^\s*(t_start|t_end|source_path|source_url|kind_tag|cited|media_bookmark):/i

/** Collapse whitespace and cap a label; '' when empty. */
export function normalizeLabel(label: unknown): string {
  const s = String(label ?? '').replace(/\s+/g, ' ').trim()
  return s.length > BOOKMARK_LABEL_MAX ? s.slice(0, BOOKMARK_LABEL_MAX).trimEnd() : s
}

/** A built-in tag in its canonical case, a trimmed custom tag, or null for none. */
export function normalizeTag(tag: unknown): string | null {
  if (tag == null) return null
  const s = String(tag).replace(/\s+/g, ' ').trim()
  if (!s) return null
  const builtIn = BOOKMARK_TAGS.find((t) => t.toLowerCase() === s.toLowerCase())
  if (builtIn) return builtIn
  return s.length > BOOKMARK_TAG_MAX ? s.slice(0, BOOKMARK_TAG_MAX).trimEnd() : s
}

function normalizePosition(sec: unknown): number {
  const n = Number(sec)
  if (!Number.isFinite(n) || n < 0) throw new Error('A bookmark needs a valid time in the video.')
  // Millisecond precision is plenty and keeps equality checks stable.
  return Math.round(n * 1000) / 1000
}

function requireKey(videoKey: unknown): string {
  const key = String(videoKey ?? '').trim()
  if (!key) throw new Error('Open a video before adding a bookmark.')
  return key
}

/** Transcript text with the machine metadata lines removed. */
export function stripTranscriptMetadata(body: string): string {
  return body
    .split('\n')
    .filter((line) => !METADATA_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

interface TranscriptChunk {
  id: string
  start: number
  end: number
  text: string
}

/** The project's transcript chunks in time order (one read per list call). */
function transcriptChunks(project: string): TranscriptChunk[] {
  if (!project) return []
  const out: TranscriptChunk[] = []
  for (const it of listItemsByProjectExact(project, 'transcript')) {
    const start = parseTStartFromBody(it.body)
    const end = parseTEndFromBody(it.body)
    if (start == null) continue
    out.push({ id: it.id, start, end: end ?? start, text: stripTranscriptMetadata(it.body) })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

/**
 * The chunk playing at `sec`: the one whose [start, end) covers it, else the
 * last one that started at or before it (a gap, or the very end).
 */
export function chunkAt<T extends { start: number; end: number }>(chunks: T[], sec: number): T | null {
  let before: T | null = null
  for (const c of chunks) {
    if (c.start > sec) break
    if (sec < c.end) return c
    before = c
  }
  return before
}

interface BookmarkRow {
  id: string
  video_key: string
  project: string
  video_title: string
  source_type: string
  position_sec: number
  label: string
  tag: string | null
  created_at: string
  updated_at: string
  card_id: string | null
}

const SELECT_BOOKMARK = `SELECT b.*, (SELECT bc.card_id FROM media_bookmark_cards bc WHERE bc.bookmark_id = b.id) AS card_id
  FROM media_bookmarks b`

function toBookmark(row: BookmarkRow, chunks: TranscriptChunk[]): MediaBookmark {
  const chunk = chunkAt(chunks, Number(row.position_sec))
  return {
    id: String(row.id),
    videoKey: String(row.video_key),
    project: String(row.project ?? ''),
    videoTitle: String(row.video_title ?? ''),
    sourceType: row.source_type === 'youtube' ? 'youtube' : 'local',
    positionSec: Number(row.position_sec),
    label: String(row.label ?? ''),
    tag: row.tag == null ? null : String(row.tag),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    transcriptLine: chunk && chunk.text ? oneLine(chunk.text, TRANSCRIPT_LINE_MAX) : null,
    cardId: row.card_id == null ? null : String(row.card_id),
  }
}

function withTranscript(rows: BookmarkRow[]): MediaBookmark[] {
  const cache = new Map<string, TranscriptChunk[]>()
  return rows.map((r) => {
    const p = String(r.project ?? '')
    if (!cache.has(p)) cache.set(p, transcriptChunks(p))
    return toBookmark(r, cache.get(p) ?? [])
  })
}

/** Every bookmark on a video, sorted by time. */
export function listBookmarks(videoKey: string): MediaBookmark[] {
  const key = String(videoKey ?? '').trim()
  if (!key) return []
  const rows = getDb()
    .prepare(`${SELECT_BOOKMARK} WHERE b.video_key = ? ORDER BY b.position_sec, b.created_at, b.rowid`)
    .all(key) as BookmarkRow[]
  return withTranscript(rows)
}

/** Every bookmark filed under a project (any video), sorted by video then time. */
export function listProjectBookmarks(project: string): MediaBookmark[] {
  const p = String(project ?? '').trim()
  if (!p) return []
  const rows = getDb()
    .prepare(`${SELECT_BOOKMARK} WHERE b.project = ? ORDER BY b.video_key, b.position_sec, b.created_at, b.rowid`)
    .all(p) as BookmarkRow[]
  return withTranscript(rows)
}

export function getBookmark(id: string): MediaBookmark | null {
  const row = getDb().prepare(`${SELECT_BOOKMARK} WHERE b.id = ?`).get(String(id ?? '')) as BookmarkRow | undefined
  return row ? withTranscript([row])[0] : null
}

/** Save the current moment as a bookmark. */
export function addBookmark(input: MediaBookmarkAddInput): MediaBookmark {
  const videoKey = requireKey(input?.videoKey)
  const positionSec = normalizePosition(input?.positionSec)
  const ts = nowIso()
  const id = newId('bmk')
  getDb()
    .prepare(
      `INSERT INTO media_bookmarks (id, video_key, project, video_title, source_type, position_sec, label, tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      videoKey,
      String(input.project ?? '').trim(),
      String(input.videoTitle ?? '').trim(),
      input.sourceType === 'youtube' ? 'youtube' : 'local',
      positionSec,
      normalizeLabel(input.label),
      normalizeTag(input.tag),
      ts,
      ts,
    )
  return getBookmark(id) as MediaBookmark
}

/** Change a bookmark's label, tag or time. Returns null when it no longer exists. */
export function updateBookmark(input: MediaBookmarkUpdateInput): MediaBookmark | null {
  const current = getBookmark(String(input?.id ?? ''))
  if (!current) return null
  const label = input.label !== undefined ? normalizeLabel(input.label) : current.label
  const tag = input.tag !== undefined ? normalizeTag(input.tag) : current.tag
  const positionSec = input.positionSec !== undefined ? normalizePosition(input.positionSec) : current.positionSec
  getDb()
    .prepare('UPDATE media_bookmarks SET label = ?, tag = ?, position_sec = ?, updated_at = ? WHERE id = ?')
    .run(label, tag, positionSec, nowIso(), current.id)
  return getBookmark(current.id)
}

/** Delete a bookmark. A Study card made from it stays (with its history). */
export function deleteBookmark(id: string): boolean {
  return getDb().prepare('DELETE FROM media_bookmarks WHERE id = ?').run(String(id ?? '')).changes > 0
}

/** The transcript around a moment, chronological, as `[h:mm:ss] text` paragraphs. */
export function passageAround(project: string, centerSec: number, windowSec = DEFAULT_WINDOW_SEC): string {
  if (!project) return ''
  return notesNearPlayhead(project, centerSec, windowSec)
    .map((n) => {
      const text = stripTranscriptMetadata(n.body)
      const start = parseTStartFromBody(n.body) ?? centerSec
      return text ? `[${formatTimestamp(start)}] ${text}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function capPassage(text: string, max = CARD_PASSAGE_MAX): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'))
  return `${(at > max * 0.6 ? cut.slice(0, at + 1) : cut).trimEnd()} …`
}

/** A timestamp link to the moment: YouTube `t=` or a media-fragment `#t=` on the file. */
export function timestampLink(videoKey: string, sec: number): string {
  const t = Math.max(0, Math.floor(sec))
  if (/^https?:\/\//i.test(videoKey)) {
    try {
      const u = new URL(videoKey)
      u.searchParams.set('t', `${t}s`)
      return u.toString()
    } catch {
      return videoKey
    }
  }
  const path = videoKey.replace(/\\/g, '/')
  const fileUrl = path.startsWith('/') ? `file://${encodeURI(path)}` : `file:///${encodeURI(path)}`
  return `${fileUrl}#t=${t}`
}

function cardTitle(b: MediaBookmark): string {
  const head = b.label || b.videoTitle || 'Video bookmark'
  return `Bookmark ${formatTimestamp(b.positionSec)} · ${head}`.slice(0, 120)
}

function cardBody(b: MediaBookmark, passage: string, windowSec: number): string {
  const what = [b.label && `“${b.label}”`, b.tag && `(${b.tag})`].filter(Boolean).join(' ')
  const lines = [
    `At ${formatTimestamp(b.positionSec)} in ${b.videoTitle ? `“${b.videoTitle}”` : 'the video'}${what ? ` — bookmark ${what}` : ''}.`,
    '',
    passage ? capPassage(passage) : '(no transcript near this moment)',
    '',
    // t_start is the bookmark itself, so a citation of this note seeks to the moment.
    `t_start: ${b.positionSec.toFixed(3)}`,
    `t_end: ${(b.positionSec + windowSec).toFixed(3)}`,
    /^https?:\/\//i.test(b.videoKey) ? `source_url: ${b.videoKey}` : `source_path: ${b.videoKey}`,
    `media_bookmark: ${b.id}`,
  ]
  return lines.join('\n')
}

/** Confused first (#334: "enrolled first"), then by time. */
function cardOrder(a: MediaBookmark, b: MediaBookmark): number {
  const ca = a.tag === 'Confused' ? 0 : 1
  const cb = b.tag === 'Confused' ? 0 : 1
  return ca - cb || a.positionSec - b.positionSec
}

/**
 * "Make cards from bookmarks": one Study card per bookmark, from the
 * transcript window around it, filed under the project. Each card's note
 * carries the moment (`t_start`, the source and the bookmark id) so the
 * reveal can reopen the video there. Bookmarks that already have a card are
 * left alone, so running it again adds no duplicates. Confused bookmarks are
 * made first and get a higher priority, so they come up first in Study.
 */
export function makeBookmarkCards(input: MediaBookmarkCardsInput): MediaBookmarkCardsResult {
  const videoKey = requireKey(input?.videoKey)
  const project = String(input?.project ?? '').trim()
  if (!project) throw new Error('Open a media project before making cards.')
  const windowSec = Number.isFinite(Number(input?.windowSec)) && Number(input?.windowSec) > 0 ? Number(input.windowSec) : DEFAULT_WINDOW_SEC
  const only = input?.ids?.length ? new Set(input.ids.map(String)) : null
  const bookmarks = listBookmarks(videoKey)
    .filter((b) => !only || only.has(b.id))
    .sort(cardOrder)
  const database = getDb()
  const linkOf = database.prepare(
    `SELECT bc.card_id, bc.item_id FROM media_bookmark_cards bc JOIN study_cards c ON c.id = bc.card_id WHERE bc.bookmark_id = ?`,
  )
  const result: MediaBookmarkCardsResult = { created: 0, existing: 0, cards: [] }
  database.transaction(() => {
    for (const b of bookmarks) {
      const link = linkOf.get(b.id) as { card_id: string; item_id: string } | undefined
      if (link) {
        result.existing++
        result.cards.push({ bookmarkId: b.id, cardId: link.card_id, itemId: link.item_id, created: false })
        continue
      }
      // A stale link (its card was deleted) is replaced below.
      database.prepare('DELETE FROM media_bookmark_cards WHERE bookmark_id = ?').run(b.id)
      const note = createItem({
        title: cardTitle(b),
        body: cardBody(b, passageAround(b.project || project, b.positionSec, windowSec), windowSec),
        kind: 'note',
        para: 'resources',
        project,
      })
      const made = createNoteCards(note.id, { pairs: false }).created
      const card = made[0]
      if (!card) continue
      if (b.tag === 'Confused') {
        database.prepare('UPDATE study_cards SET priority = 1 WHERE item_id = ?').run(note.id)
      }
      database
        .prepare('INSERT INTO media_bookmark_cards (bookmark_id, card_id, item_id, created_at) VALUES (?, ?, ?, ?)')
        .run(b.id, card.id, note.id, nowIso())
      result.created++
      result.cards.push({ bookmarkId: b.id, cardId: card.id, itemId: note.id, created: true })
    }
  })()
  return result
}

/** The moment a Study card was made from, or null for any other card. */
export function mediaMomentForCard(cardId: string): StudyMediaMoment | null {
  const row = getDb()
    .prepare(
      `SELECT b.id, b.video_key, b.project, b.position_sec, b.label, b.tag, b.source_type
       FROM media_bookmark_cards bc JOIN media_bookmarks b ON b.id = bc.bookmark_id
       WHERE bc.card_id = ?`,
    )
    .get(String(cardId ?? '')) as
    | { id: string; video_key: string; project: string; position_sec: number; label: string; tag: string | null; source_type: string }
    | undefined
  if (!row) return null
  return {
    bookmarkId: String(row.id),
    videoKey: String(row.video_key),
    project: String(row.project ?? ''),
    positionSec: Number(row.position_sec),
    label: String(row.label ?? ''),
    tag: row.tag == null ? null : String(row.tag),
    sourceType: row.source_type === 'youtube' ? 'youtube' : 'local',
  }
}

/**
 * Bookmarks as Markdown with timestamp links, grouped by video. Saved as a
 * note in the project, they go wherever the project's notes go.
 */
export function bookmarksMarkdown(input: { videoKey?: string; project?: string }): string {
  const list = input?.videoKey ? listBookmarks(input.videoKey) : listProjectBookmarks(input?.project ?? '')
  if (list.length === 0) return ''
  const byVideo = new Map<string, MediaBookmark[]>()
  for (const b of list) {
    const l = byVideo.get(b.videoKey) ?? []
    l.push(b)
    byVideo.set(b.videoKey, l)
  }
  const out: string[] = []
  for (const [key, items] of byVideo) {
    const title = items.find((b) => b.videoTitle)?.videoTitle || key
    out.push(`## Bookmarks — ${title}`, '')
    for (const b of items) {
      const parts = [`- [${formatTimestamp(b.positionSec)}](${timestampLink(key, b.positionSec)})`]
      if (b.label) parts.push(`**${b.label.replace(/\*/g, '')}**`)
      if (b.tag) parts.push(`\`${b.tag.replace(/`/g, '')}\``)
      let line = parts.join(' ')
      if (b.transcriptLine) line += ` — ${b.transcriptLine}`
      out.push(line)
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}
