/**
 * Pure SRT/VTT parse + cue chunking for Media chat ingest.
 * No Electron / DB deps — safe to unit-test under ELECTRON_RUN_AS_NODE.
 */

export interface CaptionCue {
  startSec: number
  endSec: number
  text: string
}

export interface CaptionChunk {
  startSec: number
  endSec: number
  text: string
}

export interface ChunkOptions {
  /** Target window length in seconds (default 45). */
  targetSec?: number
  /** Soft max characters per chunk (default 700). */
  maxChars?: number
}

const DEFAULT_TARGET_SEC = 45
const DEFAULT_MAX_CHARS = 700

/** Parse "HH:MM:SS,mmm" / "MM:SS.mmm" / "HH:MM:SS.mmm" → seconds. */
export function parseTimestamp(raw: string): number {
  const s = raw.trim().replace(',', '.')
  const parts = s.split(':')
  if (parts.length === 3) {
    const h = Number(parts[0])
    const m = Number(parts[1])
    const sec = Number(parts[2])
    if (![h, m, sec].every((n) => Number.isFinite(n))) return 0
    return h * 3600 + m * 60 + sec
  }
  if (parts.length === 2) {
    const m = Number(parts[0])
    const sec = Number(parts[1])
    if (![m, sec].every((n) => Number.isFinite(n))) return 0
    return m * 60 + sec
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Format seconds as MM:SS (or H:MM:SS when ≥ 1h). */
export function formatTimestamp(sec: number): string {
  const t = Math.max(0, Math.floor(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${mm}:${ss}`
  return `${mm}:${ss}`
}

function cleanCueText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '') // strip VTT tags
    .replace(/\{\\.*?\}/g, '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const TIME_ARROW = /-->/

/** Parse SubRip (.srt) captions. */
export function parseSrt(content: string): CaptionCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n\s*\n/)
  const cues: CaptionCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0)
    if (lines.length < 2) continue

    let timeLineIdx = lines.findIndex((l) => TIME_ARROW.test(l))
    if (timeLineIdx < 0) continue
    // Skip optional numeric index line
    const timeLine = lines[timeLineIdx]
    const m = timeLine.match(/([0-9:,.]+)\s*-->\s*([0-9:,.]+)/)
    if (!m) continue
    const startSec = parseTimestamp(m[1])
    const endSec = parseTimestamp(m[2])
    const text = cleanCueText(lines.slice(timeLineIdx + 1).join('\n'))
    if (!text) continue
    cues.push({ startSec, endSec: Math.max(endSec, startSec), text })
  }
  return cues
}

/** Parse WebVTT (.vtt) captions (basic cue support). */
export function parseVtt(content: string): CaptionCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Drop header + NOTE/STYLE/REGION blocks loosely by scanning for timing lines
  const lines = normalized.split('\n')
  const cues: CaptionCue[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!TIME_ARROW.test(line)) {
      i += 1
      continue
    }
    const m = line.match(/([0-9:.]+)\s*-->\s*([0-9:.]+)/)
    if (!m) {
      i += 1
      continue
    }
    const startSec = parseTimestamp(m[1])
    const endSec = parseTimestamp(m[2])
    i += 1
    const textLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      // Skip NOTE lines inside cue? treat as text unless starts with NOTE
      if (/^NOTE\b/i.test(lines[i].trim())) break
      textLines.push(lines[i])
      i += 1
    }
    const text = cleanCueText(textLines.join('\n'))
    if (text) cues.push({ startSec, endSec: Math.max(endSec, startSec), text })
  }
  return cues
}

/** Auto-detect SRT vs VTT from content or filename. */
export function parseCaptions(content: string, filenameHint?: string): CaptionCue[] {
  const hint = (filenameHint ?? '').toLowerCase()
  const head = content.slice(0, 32).toLowerCase()
  if (hint.endsWith('.vtt') || head.includes('webvtt')) {
    return parseVtt(content)
  }
  if (hint.endsWith('.srt')) {
    return parseSrt(content)
  }
  // Fallback: VTT if header present, else SRT
  if (/^\s*webvtt/i.test(content)) return parseVtt(content)
  return parseSrt(content)
}

/**
 * Group cues into ~30–60s / ~500–800 char notes.
 * Never splits a single cue across chunks.
 */
export function chunkCues(cues: CaptionCue[], opts?: ChunkOptions): CaptionChunk[] {
  const targetSec = opts?.targetSec ?? DEFAULT_TARGET_SEC
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS
  if (cues.length === 0) return []

  const chunks: CaptionChunk[] = []
  let buf: CaptionCue[] = []
  let bufChars = 0

  const flush = () => {
    if (buf.length === 0) return
    const text = buf.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim()
    if (!text) {
      buf = []
      bufChars = 0
      return
    }
    chunks.push({
      startSec: buf[0].startSec,
      endSec: buf[buf.length - 1].endSec,
      text,
    })
    buf = []
    bufChars = 0
  }

  for (const cue of cues) {
    const nextChars = bufChars + (bufChars > 0 ? 1 : 0) + cue.text.length
    const span =
      buf.length === 0 ? cue.endSec - cue.startSec : cue.endSec - buf[0].startSec
    const wouldExceed =
      buf.length > 0 && (span > targetSec || nextChars > maxChars)
    if (wouldExceed) flush()
    buf.push(cue)
    bufChars += (bufChars > 0 ? 1 : 0) + cue.text.length
    // If a single cue alone exceeds maxChars, still keep it as one chunk
    if (buf.length === 1 && bufChars > maxChars) flush()
  }
  flush()
  return chunks
}

/** Read `t_start: N` (seconds) from a transcript note body. */
export function parseTStartFromBody(body: string): number | null {
  const m = body.match(/^\s*t_start:\s*([0-9.]+)\s*$/m)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Read `t_end: N` from a transcript note body. */
export function parseTEndFromBody(body: string): number | null {
  const m = body.match(/^\s*t_end:\s*([0-9.]+)\s*$/m)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function buildTranscriptNoteBody(opts: {
  text: string
  startSec: number
  endSec: number
  sourcePath?: string
  sourceUrl?: string
}): string {
  const lines = [
    opts.text.trim(),
    '',
    `t_start: ${opts.startSec.toFixed(3)}`,
    `t_end: ${opts.endSec.toFixed(3)}`,
  ]
  if (opts.sourcePath) lines.push(`source_path: ${opts.sourcePath}`)
  if (opts.sourceUrl) lines.push(`source_url: ${opts.sourceUrl}`)
  lines.push('kind_tag: transcript')
  return lines.join('\n')
}

export function mediaNoteTitle(startSec: number, endSec: number): string {
  return `Media — ${formatTimestamp(startSec)}–${formatTimestamp(endSec)}`
}
