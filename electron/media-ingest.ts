/**
 * Media chat ingest: local video/audio + captions, YouTube via yt-dlp.
 * Creates transcript notes, Media reader prompt, and a chat profile.
 */
import { spawn, spawnSync } from 'child_process'
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
  listItemsByProjectExact,
  listPrompts,
  runInTransaction,
  updateChatProfile,
  updatePrompt,
} from './db'
import { resolveUserDataDir } from './user-data'
import { mediaProtocolUrlForPath } from './media-protocol'
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
  // Match by exact project only — reusing a profile by display name would leak
  // it across two sources whose projects happen to share a title.
  return createChatProfile({ name, promptId, project })
}

function stemFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)) || 'Media'
}

/** A media source identity: absolute local path, or canonical YouTube watch URL. */
export interface MediaSource {
  sourcePath?: string
  sourceUrl?: string
}

export function itemSource(it: Item): { sourcePath?: string; sourceUrl?: string } {
  const pathM = it.body.match(/^\s*source_path:\s*(.+)\s*$/m)
  const urlM = it.body.match(/^\s*source_url:\s*(.+)\s*$/m)
  return { sourcePath: pathM?.[1].trim(), sourceUrl: urlM?.[1].trim() }
}

/** true = this source, false = a different source, null = no source marker (legacy note). */
export function matchesSource(it: Item, src: MediaSource): boolean | null {
  const s = itemSource(it)
  if (s.sourcePath === undefined && s.sourceUrl === undefined) return null
  return (
    (src.sourcePath !== undefined && s.sourcePath === src.sourcePath) ||
    (src.sourceUrl !== undefined && s.sourceUrl === src.sourceUrl)
  )
}

/**
 * Resolve the project name for an ingest. A name is reused only when every
 * transcript note under it belongs to this source (or is legacy/marker-less);
 * if another source already uses it, the name gets a "(2)", "(3)", … suffix so
 * two different files/videos never share a project — and can never wipe or mix
 * each other's notes.
 */
export function projectNameFor(base: string, source: MediaSource): string {
  for (let i = 1; i < 200; i++) {
    const name = i === 1 ? base : `${base.slice(0, 116)} (${i})`
    const notes = listItemsByProjectExact(name, 'transcript')
    if (notes.length === 0) return name
    if (notes.some((it) => matchesSource(it, source) === false)) continue
    return name
  }
  throw new Error(`Could not find a free project name for "${base}"`)
}

/**
 * Delete transcript notes under `project` that belong to `source` (plus legacy
 * marker-less notes, safe because projectNameFor guarantees no other source uses
 * this project). Another source's notes in a colliding project are never touched.
 */
export function replaceProjectTranscripts(project: string, source: MediaSource): number {
  const candidates = listItemsByProjectExact(project).filter(
    (it) => it.kind === 'transcript' || /kind_tag:\s*transcript/i.test(it.body)
  )
  let n = 0
  for (const it of candidates) {
    if (matchesSource(it, source) === false) continue
    deleteItem(it.id)
    n += 1
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

export { mediaProtocolUrlForPath }

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
  const source: MediaSource = { sourcePath: mediaPath }
  const baseName = (input.project?.trim() || stemFromPath(mediaPath)).slice(0, 120)
  const project = projectNameFor(baseName, source)

  // Delete + create in one transaction: a mid-ingest failure can no longer
  // leave the project empty.
  const created = runInTransaction(() => {
    if (input.replaceExisting !== false) replaceProjectTranscripts(project, source)
    return writeChunksAsNotes(chunks, { project, sourcePath: mediaPath })
  })

  const prompt = ensureMediaReaderPrompt()
  const profile = upsertMediaProfile(project, prompt.id, project)

  return {
    project,
    title: project,
    noteCount: created.length,
    itemIds: created.map((c) => c.id),
    promptId: prompt.id,
    profileId: profile.id,
    sourceType: 'local',
    mediaPath,
    mediaProtocolUrl: mediaProtocolUrlForPath(mediaPath) ?? undefined,
  }
}

/** Result of one async yt-dlp run (never blocks the main process). */
export interface YtDlpRunResult {
  stdout: string
  stderr: string
  status: number | null
  signal: NodeJS.Signals | null
  /** True when the timeout killed the process before it exited. */
  timedOut: boolean
  /** Set when the process could not be spawned at all (e.g. ENOENT). */
  error?: Error
}

/**
 * Run a yt-dlp command asynchronously, capturing stdout/stderr, with a hard timeout and an
 * optional output cap. Unlike `spawnSync` this never blocks the event loop, so a slow or hung
 * yt-dlp (or YouTube rate-limiting) can't freeze the app. On timeout the child is killed and
 * `timedOut` is set; a spawn failure surfaces via `error`.
 */
export function runYtDlp(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; maxBuffer?: number } = { timeoutMs: 60_000 }
): Promise<YtDlpRunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const finish = (result: YtDlpRunResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)

    // Mirror spawnSync's maxBuffer: stop the process if output outgrows the budget so a runaway
    // child can't exhaust main-process memory. We keep the bytes collected so far.
    const cap = (chunk: Buffer, acc: string): string => {
      const next = acc + chunk.toString('utf8')
      if (opts.maxBuffer && next.length > opts.maxBuffer) {
        child.kill('SIGKILL')
        return acc
      }
      return next
    }

    child.stdout?.on('data', (d: Buffer) => {
      stdout = cap(d, stdout)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr = cap(d, stderr)
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ stdout, stderr, status: null, signal: null, timedOut, error: err })
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      finish({
        stdout,
        stderr,
        status: code,
        signal: signal as NodeJS.Signals | null,
        timedOut,
      })
    })
  })
}

/**
 * Locate yt-dlp: LKV_YTDLP_PATH → PATH → <userData>/bin → common install dirs → project venv →
 * python -m yt_dlp. Apps launched from Finder/Explorer get a minimal PATH, so the well-known
 * install dirs (Homebrew, pipx/uv, Scoop, winget) are probed explicitly.
 */
export function resolveYtDlp(): { cmd: string; argsPrefix: string[] } | null {
  const isWin = process.platform === 'win32'
  const exe = isWin ? 'yt-dlp.exe' : 'yt-dlp'

  const envPath = process.env.LKV_YTDLP_PATH?.trim()
  if (envPath && fs.existsSync(envPath)) return { cmd: envPath, argsPrefix: [] }

  const which = spawnSync(isWin ? 'where' : 'which', ['yt-dlp'], { encoding: 'utf8' })
  const found = which.status === 0 ? which.stdout.split(/\r?\n/)[0]?.trim() : ''
  if (found) return { cmd: found, argsPrefix: [] }

  const home = os.homedir()
  const candidates = [
    path.join(resolveUserDataDir(), 'bin', exe),
    ...(isWin
      ? [
          path.join(home, 'scoop', 'shims', exe),
          path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', exe),
          path.join(home, '.local', 'bin', exe),
        ]
      : [
          '/opt/homebrew/bin/yt-dlp',
          '/usr/local/bin/yt-dlp',
          '/usr/bin/yt-dlp',
          path.join(home, '.local', 'bin', 'yt-dlp'),
        ]),
    // Project-local venv created for Media chat MVP (dev checkouts)
    path.join(__dirname, '..', '.venv-ytdlp', isWin ? 'Scripts' : 'bin', exe),
    path.join(process.cwd(), '.venv-ytdlp', isWin ? 'Scripts' : 'bin', exe),
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

const YOUTUBE_ID_RE = /^[\w-]{11}$/

function isYoutubeHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === 'youtube.com' ||
    h.endsWith('.youtube.com') ||
    h === 'youtu.be' ||
    h.endsWith('.youtu.be') ||
    h === 'youtube-nocookie.com' ||
    h.endsWith('.youtube-nocookie.com')
  )
}

/** Extract + validate a YouTube video id. Exact host match (evil-youtube.com is rejected). */
function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase()
    if (!isYoutubeHost(host)) return null
    let id: string | null = null
    if (host.endsWith('youtu.be')) {
      id = u.pathname.replace(/^\//, '').split('/')[0]
    } else {
      id = u.searchParams.get('v')
      if (!id) {
        const parts = u.pathname.split('/').filter(Boolean)
        const embedIdx = parts.indexOf('embed')
        if (embedIdx >= 0 && parts[embedIdx + 1]) id = parts[embedIdx + 1]
        const shortsIdx = parts.indexOf('shorts')
        if (!id && shortsIdx >= 0 && parts[shortsIdx + 1]) id = parts[shortsIdx + 1]
      }
    }
    if (!id) return null
    id = id.split(/[/?#]/)[0]
    return YOUTUBE_ID_RE.test(id) ? id : null
  } catch {
    return null
  }
}

/** Canonical watch URL for a validated YouTube link, or null (rejects injection/foreign hosts). */
export function normalizeYoutubeUrl(input: string): string | null {
  const id = extractYoutubeId(input)
  return id ? `https://www.youtube.com/watch?v=${id}` : null
}

export function youtubeEmbedUrl(watchUrl: string): string | null {
  const id = extractYoutubeId(watchUrl)
  if (!id) return null
  return `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`
}

/** One caption track chosen from yt-dlp metadata. */
export interface CaptionTrack {
  lang: string
  auto: boolean
  /** YouTube machine translation (caption URL carries `tlang=`); used only as a last resort. */
  translated?: boolean
}

type CaptionFormats = Array<{ ext?: string; url?: string }>
interface YtDlpCaptionInfo {
  subtitles?: Record<string, CaptionFormats>
  automatic_captions?: Record<string, CaptionFormats>
}

const MANUAL_ENGLISH = ['en', 'en-US', 'en-GB']
const isEnglish = (lang: string) => /^en(-|$)/i.test(lang)
const isTranslation = (formats: CaptionFormats) => formats.some((f) => (f.url ?? '').includes('tlang='))

/**
 * Pick the caption track to download from `yt-dlp -J` metadata:
 * manual English (en, en-US, en-GB, then any en-*), then the original auto transcript
 * (`en-orig`), then any auto English track that is not a translation, and only then a
 * machine translation. For auto-caption videos YouTube's `en` is often a translation
 * (`tlang=en`), which it rate-limits with HTTP 429.
 */
export function pickCaptionTrack(info: YtDlpCaptionInfo): CaptionTrack | null {
  const manual = info.subtitles ?? {}
  const manualLang =
    MANUAL_ENGLISH.find((l) => manual[l]?.length) ??
    Object.keys(manual).find((l) => isEnglish(l) && manual[l]?.length)
  if (manualLang) return { lang: manualLang, auto: false }

  const auto = info.automatic_captions ?? {}
  if (auto['en-orig']?.length) return { lang: 'en-orig', auto: true }
  const english = Object.keys(auto).filter((l) => isEnglish(l) && auto[l]?.length)
  const original = english.find((l) => !isTranslation(auto[l]))
  if (original) return { lang: original, auto: true }
  if (english[0]) return { lang: english[0], auto: true, translated: true }
  return null
}

/** Written by yt-dlp's --print-to-file so the title comes from the same run as the captions. */
const YTDLP_TITLE_FILE = 'lkv-title.txt'

/** Extra yt-dlp arguments from LKV_YTDLP_EXTRA_ARGS (whitespace-separated), e.g. `--cookies-from-browser firefox`. */
function ytDlpExtraArgsFromEnv(): string[] {
  return (process.env.LKV_YTDLP_EXTRA_ARGS ?? '').trim().split(/\s+/).filter(Boolean)
}

/**
 * yt-dlp arguments for downloading one English caption track (manual preferred, auto fallback).
 * No player_client is forced: the android client returns no automatic captions and its caption
 * URLs need a PO token (HTTP 429), while yt-dlp's default clients fetch them. The title is
 * written in the same run, so there is no second request right after a rate-limited one.
 */
export function buildYtDlpSubtitleArgs(
  url: string,
  tmpDir: string,
  extraArgs: string[] = [],
  track?: CaptionTrack
): string[] {
  // With a chosen track, download exactly that one (see pickCaptionTrack). Without one
  // (metadata unavailable), fall back to a few English variants; every en-* track is a
  // request, and requesting them all trips 429s.
  const selection = track
    ? [track.auto ? '--write-auto-subs' : '--write-subs', '--sub-langs', track.lang]
    : ['--write-subs', '--write-auto-subs', '--sub-langs', 'en,en-US,en-GB']
  return [
    '--skip-download',
    ...selection,
    '--sub-format',
    'vtt/srt/best',
    '--sleep-subtitles',
    '2',
    '--retries',
    '5',
    '--retry-sleep',
    'http:exp=1:20',
    '--print-to-file',
    '%(title)s',
    path.join(tmpDir, YTDLP_TITLE_FILE),
    '-o',
    path.join(tmpDir, '%(title)s.%(ext)s'),
    '--no-warnings',
    ...extraArgs,
    '--',
    url,
  ]
}

/** User-facing error for a yt-dlp run that produced no caption file. */
export function describeYtDlpFailure(
  output: string,
  status: number | null,
  opts: { timedOut?: boolean; error?: Error } = {}
): string {
  const err = output.trim()
  if (opts.error) {
    return `Failed to run yt-dlp: ${opts.error.message.slice(0, 800)}`
  }
  if (opts.timedOut) {
    return (
      'yt-dlp timed out (no response). YouTube may be slow or rate-limiting; wait and retry, ' +
      'or ingest a local SRT/VTT instead.'
    )
  }
  if (/HTTP Error 429|Too Many Requests/i.test(err)) {
    return (
      'YouTube rate-limited the caption download (HTTP 429). Wait a few minutes and retry. ' +
      'If it keeps happening, install yt-dlp with impersonation support ' +
      '(pipx install "yt-dlp[default,curl-cffi]"), update it, or set ' +
      'LKV_YTDLP_EXTRA_ARGS="--cookies-from-browser firefox". Local SRT/VTT ingest still works.'
    )
  }
  if (status !== 0) return `yt-dlp failed: ${(err || `yt-dlp exited ${status}`).slice(0, 800)}`
  return 'No captions/subtitles found for this YouTube URL (video may lack captions). Try another URL or ingest a local SRT/VTT.'
}

export async function ingestYoutubeMedia(input: IngestYoutubeInput): Promise<MediaIngestResult> {
  const raw = input.url.trim()
  if (!raw) throw new Error('YouTube URL is required')
  const url = normalizeYoutubeUrl(raw)
  if (!url) {
    throw new Error(
      'Invalid YouTube URL — paste a youtube.com / youtu.be watch, share, or embed link'
    )
  }

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
        const titleProbe = await runYtDlp(
          ytdlp.cmd,
          [...ytdlp.argsPrefix, '--skip-download', '--print', '%(title)s', '--no-warnings', '--', url],
          { timeoutMs: 60_000 }
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
    const source: MediaSource = { sourceUrl: url }
    const baseName = (input.project?.trim() || title).slice(0, 120)
    const project = projectNameFor(baseName, source)
    const created = runInTransaction(() => {
      if (input.replaceExisting !== false) replaceProjectTranscripts(project, source)
      return writeChunksAsNotes(chunks, { project, sourceUrl: url })
    })
    const prompt = ensureMediaReaderPrompt()
    const profile = upsertMediaProfile(project, prompt.id, project)
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
      'yt-dlp not found. Install it (brew install yt-dlp, pipx install yt-dlp, or winget install yt-dlp), or set LKV_YTDLP_PATH, then retry. Local SRT/VTT ingest still works.'
    )
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-yt-'))

  try {
    const extraArgs = ytDlpExtraArgsFromEnv()
    // Metadata first, so exactly one caption track is requested (no machine translations).
    // The JSON lists every translation language and can exceed 10 MB.
    let track: CaptionTrack | undefined
    const meta = await runYtDlp(
      ytdlp.cmd,
      [...ytdlp.argsPrefix, '-J', '--skip-download', '--no-warnings', ...extraArgs, '--', url],
      { timeoutMs: 60_000, maxBuffer: 64 * 1024 * 1024 }
    )
    if (meta.status === 0 && meta.stdout) {
      const picked = pickCaptionTrack(JSON.parse(meta.stdout) as YtDlpCaptionInfo)
      if (!picked) {
        throw new Error(
          'No English captions found for this YouTube URL. Try another URL or ingest a local SRT/VTT.'
        )
      }
      track = picked
    } else if (/HTTP Error 429|Too Many Requests/i.test(meta.stderr || '')) {
      throw new Error(describeYtDlpFailure(meta.stderr, meta.status))
    }
    // Otherwise fall through without a track: the download below requests a few English variants.

    const args = [...ytdlp.argsPrefix, ...buildYtDlpSubtitleArgs(url, tmpDir, extraArgs, track)]
    const result = await runYtDlp(ytdlp.cmd, args, {
      timeoutMs: 180_000,
      maxBuffer: 20 * 1024 * 1024,
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
      throw new Error(
        describeYtDlpFailure(result.stderr || result.stdout || '', result.status, {
          timedOut: result.timedOut,
          error: result.error,
        })
      )
    }

    // Title written by --print-to-file in the same run (non-fatal if missing).
    let printedTitle: string | undefined
    try {
      printedTitle = fs
        .readFileSync(path.join(tmpDir, YTDLP_TITLE_FILE), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .pop()
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
    const source: MediaSource = { sourceUrl: url }
    const baseName = (input.project?.trim() || title).slice(0, 120)
    const project = projectNameFor(baseName, source)

    const created = runInTransaction(() => {
      if (input.replaceExisting !== false) {
        replaceProjectTranscripts(project, source)
      }
      return writeChunksAsNotes(chunks, {
        project,
        sourceUrl: url,
      })
    })

    const prompt = ensureMediaReaderPrompt()
    const profile = upsertMediaProfile(project, prompt.id, project)

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
          ? (mediaProtocolUrlForPath(mediaPath) ?? undefined)
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
