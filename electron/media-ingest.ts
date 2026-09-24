/**
 * Media chat ingest: local video/audio + captions, YouTube via yt-dlp.
 * Creates transcript notes, Media reader prompt, and a chat profile.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  buildTranscriptNoteBody,
  chunkCues,
  formatTimestamp,
  mediaNoteTitle,
  parseCaptions,
  parseTEndFromBody,
  parseTStartFromBody,
  type CaptionChunk,
} from './media-captions'
import {
  createChatProfile,
  createItem,
  createPrompt,
  deleteItem,
  listChatProfiles,
  listItems,
  listPrompts,
  updateChatProfile,
  updatePrompt,
} from './db'
import type { ChatProfile, Item, Prompt } from './types'

export const MEDIA_READER_NAME = 'Media reader'

const MEDIA_READER_BODY = `You are a Media reader helping someone understand a video or audio clip from its transcript notes.

Tone:
- Speak in plain language about what was said in the media.
- Do not lead with vault/storage jargon (SQLite, FTS, PARA, etc.) unless the user asks how the app works.

Rules:
1. Stay inside these transcript notes. Do not invent dialogue or facts that are not supported by the passages.
2. Cite supporting notes with square-bracket item IDs exactly as given, e.g. [itm_abc123]. Only cite IDs that appear in the provided passages.
3. When useful, mention the time range from the note title or t_start/t_end metadata (e.g. "around 01:24").
4. If the passages do not support the ask, say plainly that you do not know from this media / these notes.
5. On vague follow-ups, use conversation history plus retrieved passages; still do not invent outside them.`

const MEDIA_READER_DESC =
  'Friendly answers from media transcripts only; cite itm_ IDs; mention times when useful.'

export interface MediaIngestResult {
  project: string
  title: string
  noteCount: number
  itemIds: string[]
  promptId: string
  profileId: string
  sourceType: 'local' | 'youtube'
  mediaPath?: string
  mediaUrl?: string
  /** Custom-protocol URL for <video>/<audio> src */
  mediaProtocolUrl?: string
}

export interface MediaProjectInfo {
  project: string
  noteCount: number
  sourceType: 'local' | 'youtube' | 'unknown'
  mediaPath?: string
  mediaUrl?: string
  mediaProtocolUrl?: string
  updatedAt: string
}

export interface IngestLocalInput {
  mediaPath: string
  captionsPath: string
  /** Optional project override; default = media filename stem */
  project?: string
  replaceExisting?: boolean
}

export interface IngestYoutubeInput {
  url: string
  project?: string
  replaceExisting?: boolean
  /** Skip yt-dlp and use this captions file (VTT/SRT). Useful for retries / offline. */
  captionsPath?: string
}

export function ensureMediaReaderPrompt(): Prompt {
  const existing = listPrompts().find((p) => p.name === MEDIA_READER_NAME)
  if (existing) {
    // Keep body fresh if we evolve the seed
    if (existing.body !== MEDIA_READER_BODY) {
      return updatePrompt(existing.id, {
        body: MEDIA_READER_BODY,
        description: MEDIA_READER_DESC,
      })!
    }
    return existing
  }
  return createPrompt({
    name: MEDIA_READER_NAME,
    body: MEDIA_READER_BODY,
    description: MEDIA_READER_DESC,
  })
}

function upsertMediaProfile(project: string, promptId: string, displayTitle: string): ChatProfile {
  const name = `Media · ${displayTitle}`.slice(0, 80)
  const existing = listChatProfiles().find(
    (p) => p.prompt_id === promptId && (p.project ?? '').trim() === project
  )
  if (existing) {
    if (existing.name !== name) {
      return updateChatProfile(existing.id, { name, promptId, project })!
    }
    return existing
  }
  // Also match by name for re-ingest
  const byName = listChatProfiles().find((p) => p.name === name)
  if (byName) {
    return updateChatProfile(byName.id, { name, promptId, project })!
  }
  return createChatProfile({ name, promptId, project })
}

function stemFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)) || 'Media'
}

function replaceProjectTranscripts(project: string): number {
  const items = listItems({ project, kind: 'transcript' })
  let n = 0
  for (const it of items) {
    deleteItem(it.id)
    n += 1
  }
  // Also remove legacy notes tagged kind_tag: transcript under this project
  const all = listItems({ project })
  for (const it of all) {
    if (it.kind === 'transcript') continue
    if (/kind_tag:\s*transcript/i.test(it.body) || /^Media — /.test(it.title)) {
      deleteItem(it.id)
      n += 1
    }
  }
  return n
}

function writeChunksAsNotes(
  chunks: CaptionChunk[],
  opts: {
    project: string
    sourcePath?: string
    sourceUrl?: string
  }
): Item[] {
  const created: Item[] = []
  for (const chunk of chunks) {
    const title = mediaNoteTitle(chunk.startSec, chunk.endSec)
    const body = buildTranscriptNoteBody({
      text: chunk.text,
      startSec: chunk.startSec,
      endSec: chunk.endSec,
      sourcePath: opts.sourcePath,
      sourceUrl: opts.sourceUrl,
    })
    const item = createItem({
      title,
      summary: chunk.text.slice(0, 180).replace(/\s+/g, ' ').trim(),
      body,
      para: 'resources',
      kind: 'transcript',
      status: 'active',
      project: opts.project,
    })
    created.push(item)
  }
  return created
}

/** Prefer companion captions next to media (same basename .srt / .vtt). */
export function findCompanionCaptions(mediaPath: string): string | null {
  const dir = path.dirname(mediaPath)
  const stem = path.basename(mediaPath, path.extname(mediaPath))
  for (const ext of ['.srt', '.vtt', '.en.srt', '.en.vtt']) {
    const candidate = path.join(dir, stem + ext)
    if (fs.existsSync(candidate)) return candidate
  }
  // Also try stem without language suffix patterns already covered
  return null
}

export function mediaProtocolUrlForPath(absPath: string): string {
  return `lkvmedia://local/?path=${encodeURIComponent(absPath)}`
}

export function ingestLocalMedia(input: IngestLocalInput): MediaIngestResult {
  const mediaPath = path.resolve(input.mediaPath)
  const captionsPath = path.resolve(input.captionsPath)
  if (!fs.existsSync(mediaPath)) throw new Error(`Media file not found: ${mediaPath}`)
  if (!fs.existsSync(captionsPath)) throw new Error(`Captions file not found: ${captionsPath}`)

  const raw = fs.readFileSync(captionsPath, 'utf8')
  const cues = parseCaptions(raw, captionsPath)
  if (cues.length === 0) {
    throw new Error('No caption cues found in SRT/VTT file')
  }
  const chunks = chunkCues(cues)
  const title = stemFromPath(mediaPath)
  const project = (input.project?.trim() || title).slice(0, 120)

  if (input.replaceExisting !== false) {
    replaceProjectTranscripts(project)
  }

  const created = writeChunksAsNotes(chunks, {
    project,
    sourcePath: mediaPath,
  })

  const prompt = ensureMediaReaderPrompt()
  const profile = upsertMediaProfile(project, prompt.id, title)

  return {
    project,
    title,
    noteCount: created.length,
    itemIds: created.map((c) => c.id),
    promptId: prompt.id,
    profileId: profile.id,
    sourceType: 'local',
    mediaPath,
    mediaProtocolUrl: mediaProtocolUrlForPath(mediaPath),
  }
}

/** Locate yt-dlp binary (PATH, project venv, or python -m yt_dlp). */
export function resolveYtDlp(): { cmd: string; argsPrefix: string[] } | null {
  const which = spawnSync('which', ['yt-dlp'], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout.trim()) {
    return { cmd: which.stdout.trim(), argsPrefix: [] }
  }

  // Project-local venv created for Media chat MVP
  const candidates = [
    path.join(__dirname, '..', '.venv-ytdlp', 'bin', 'yt-dlp'),
    path.join(process.cwd(), '.venv-ytdlp', 'bin', 'yt-dlp'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return { cmd: c, argsPrefix: [] }
  }

  // python -m yt_dlp
  for (const py of ['python3', 'python']) {
    const probe = spawnSync(py, ['-m', 'yt_dlp', '--version'], { encoding: 'utf8' })
    if (probe.status === 0) return { cmd: py, argsPrefix: ['-m', 'yt_dlp'] }
  }
  return null
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0]
      return id || null
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/').filter(Boolean)
      const embedIdx = parts.indexOf('embed')
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1]
      const shortsIdx = parts.indexOf('shorts')
      if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1]
    }
  } catch {
    /* ignore */
  }
  return null
}

export function youtubeEmbedUrl(watchUrl: string): string | null {
  const id = extractYoutubeId(watchUrl)
  if (!id) return null
  return `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`
}

export function ingestYoutubeMedia(input: IngestYoutubeInput): MediaIngestResult {
  const url = input.url.trim()
  if (!url) throw new Error('YouTube URL is required')

  const providedCaptions = input.captionsPath?.trim()
  if (providedCaptions) {
    const captionsPath = path.resolve(providedCaptions)
    if (!fs.existsSync(captionsPath)) throw new Error(`Captions file not found: ${captionsPath}`)
    const raw = fs.readFileSync(captionsPath, 'utf8')
    const cues = parseCaptions(raw, captionsPath)
    if (cues.length === 0) throw new Error('Downloaded captions contained no cues')
    const chunks = chunkCues(cues)
    let title = 'YouTube'
    try {
      const ytdlp = resolveYtDlp()
      if (ytdlp) {
        const titleProbe = spawnSync(
          ytdlp.cmd,
          [...ytdlp.argsPrefix, '--skip-download', '--print', '%(title)s', '--no-warnings', url],
          { encoding: 'utf8', timeout: 60_000 }
        )
        if (titleProbe.status === 0) {
          title =
            (titleProbe.stdout || '')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .pop() || title
        }
      }
    } catch {
      /* ignore */
    }
    title = title.slice(0, 120)
    const project = (input.project?.trim() || title).slice(0, 120)
    if (input.replaceExisting !== false) replaceProjectTranscripts(project)
    const created = writeChunksAsNotes(chunks, { project, sourceUrl: url })
    const prompt = ensureMediaReaderPrompt()
    const profile = upsertMediaProfile(project, prompt.id, title)
    return {
      project,
      title,
      noteCount: created.length,
      itemIds: created.map((c) => c.id),
      promptId: prompt.id,
      profileId: profile.id,
      sourceType: 'youtube',
      mediaUrl: url,
    }
  }

  const ytdlp = resolveYtDlp()
  if (!ytdlp) {
    throw new Error(
      'yt-dlp not found. Install it (e.g. create .venv-ytdlp and pip install yt-dlp) then retry. Local SRT/VTT ingest still works.'
    )
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-yt-'))

  try {
    // Prefer a single English track (manual or auto). Avoid downloading every
    // en-* variant — that trips YouTube 429s and older flag combos with --print
    // could exit 0 without writing any files.
    const args = [
      ...ytdlp.argsPrefix,
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'en',
      '--sub-format',
      'vtt/srt/best',
      '--sleep-subtitles',
      '2',
      '--extractor-args',
      'youtube:player_client=android',
      '-o',
      path.join(tmpDir, '%(title)s.%(ext)s'),
      '--no-warnings',
      url,
    ]
    const result = spawnSync(ytdlp.cmd, args, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 180_000,
    })

    const files = fs.readdirSync(tmpDir)
    const captionCandidates = files
      .filter((f) => f.endsWith('.vtt') || f.endsWith('.srt'))
      .sort((a, b) => {
        // Prefer shorter lang suffix / manual CC names; any file beats none.
        const score = (name: string) => {
          const lower = name.toLowerCase()
          if (lower.includes('.en.vtt') || lower.endsWith('.en.srt')) return 0
          if (lower.includes('.en-orig')) return 1
          if (lower.includes('.en-')) return 2
          return 3
        }
        return score(a) - score(b)
      })
    const captionFile = captionCandidates[0] || null

    // yt-dlp may return non-zero if a secondary lang 429s after one good file.
    if (!captionFile) {
      const err = (result.stderr || result.stdout || '').trim() || `yt-dlp exited ${result.status}`
      throw new Error(
        result.status !== 0
          ? `yt-dlp failed: ${err.slice(0, 800)}`
          : 'No captions/subtitles found for this YouTube URL (video may lack captions). Try another URL or ingest a local SRT/VTT.'
      )
    }

    // Title from a quick metadata probe (non-fatal if it fails).
    let printedTitle: string | undefined
    try {
      const titleProbe = spawnSync(
        ytdlp.cmd,
        [...ytdlp.argsPrefix, '--skip-download', '--print', '%(title)s', '--no-warnings', url],
        { encoding: 'utf8', timeout: 60_000 }
      )
      if (titleProbe.status === 0) {
        printedTitle = (titleProbe.stdout || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .pop()
      }
    } catch {
      /* ignore */
    }

    const captionsPath = path.join(tmpDir, captionFile)
    const raw = fs.readFileSync(captionsPath, 'utf8')
    const cues = parseCaptions(raw, captionsPath)
    if (cues.length === 0) {
      throw new Error('Downloaded captions contained no cues')
    }
    const chunks = chunkCues(cues)
    // Stem often looks like "Title.en-XXXX"; drop trailing lang tags for display.
    const stem = stemFromPath(captionFile).replace(/\.(en(?:-[^.]+)?)$/i, '')
    const title = (printedTitle || stem || 'YouTube').slice(0, 120)
    const project = (input.project?.trim() || title).slice(0, 120)

    if (input.replaceExisting !== false) {
      replaceProjectTranscripts(project)
    }

    const created = writeChunksAsNotes(chunks, {
      project,
      sourceUrl: url,
    })

    const prompt = ensureMediaReaderPrompt()
    const profile = upsertMediaProfile(project, prompt.id, title)

    return {
      project,
      title,
      noteCount: created.length,
      itemIds: created.map((c) => c.id),
      promptId: prompt.id,
      profileId: profile.id,
      sourceType: 'youtube',
      mediaUrl: url,
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore cleanup */
    }
  }
}

function sourceMetaFromItems(items: Item[]): {
  sourceType: MediaProjectInfo['sourceType']
  mediaPath?: string
  mediaUrl?: string
  mediaProtocolUrl?: string
} {
  for (const it of items) {
    const pathM = it.body.match(/^\s*source_path:\s*(.+)\s*$/m)
    const urlM = it.body.match(/^\s*source_url:\s*(.+)\s*$/m)
    if (pathM) {
      const mediaPath = pathM[1].trim()
      return {
        sourceType: 'local',
        mediaPath,
        mediaProtocolUrl: fs.existsSync(mediaPath)
          ? mediaProtocolUrlForPath(mediaPath)
          : undefined,
      }
    }
    if (urlM) {
      return { sourceType: 'youtube', mediaUrl: urlM[1].trim() }
    }
  }
  return { sourceType: 'unknown' }
}

export function listMediaProjects(): MediaProjectInfo[] {
  const items = listItems({ kind: 'transcript' })
  const byProject = new Map<string, Item[]>()
  for (const it of items) {
    const p = (it.project ?? '').trim() || 'Untitled media'
    const list = byProject.get(p) ?? []
    list.push(it)
    byProject.set(p, list)
  }
  const out: MediaProjectInfo[] = []
  for (const [project, list] of byProject) {
    const meta = sourceMetaFromItems(list)
    const updatedAt = list
      .map((i) => i.updated_at)
      .sort()
      .reverse()[0]
    out.push({
      project,
      noteCount: list.length,
      updatedAt,
      ...meta,
    })
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return out
}

/** Notes whose t_start/t_end overlap [centerSec - windowSec, centerSec + windowSec]. */
export function notesNearPlayhead(
  project: string,
  centerSec: number,
  windowSec = 45
): Item[] {
  const items = listItems({ project, kind: 'transcript' })
  const lo = centerSec - windowSec
  const hi = centerSec + windowSec
  return items.filter((it) => {
    const start = parseTStartFromBody(it.body)
    const end = parseTEndFromBody(it.body)
    if (start == null || end == null) return false
    return start <= hi && end >= lo
  })
}

export { formatTimestamp, parseTStartFromBody }
