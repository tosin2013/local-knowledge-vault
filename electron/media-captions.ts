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

/**
 * Decode caption bytes: honor UTF-8, UTF-16LE/BE (BOM or null-byte heuristic), else
 * best-effort UTF-8. Reading UTF-16 as UTF-8 previously produced garbage and the
 * all-important timing line never matched, so valid SRT files failed to import.
 */
export function decodeCaptions(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.toString('utf16le')
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    // Node has no utf16be decoder: swap pairs, then decode as LE.
    const swapped = Buffer.allocUnsafe(raw.length)
    for (let i = 0; i + 1 < raw.length; i += 2) {
      swapped[i] = raw[i + 1]
      swapped[i + 1] = raw[i]
    }
    return swapped.toString('utf16le')
  }
  if (raw.includes(0)) {
    // No BOM but NUL bytes: assume UTF-16LE (the near-universal Windows default).
    const even = raw.length - (raw.length % 2)
    return raw.subarray(0, even).toString('utf16le')
  }
  return raw.toString('utf8')
}

/** Parse "HH:MM:SS,mmm" / "MM:SS.mmm" / "HH:MM:SS.mmm" → seconds, or null when invalid. */
export function parseTimestamp(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  const parts = s.split(':')
  if (parts.length === 3) {
    const h = Number(parts[0])
    const m = Number(parts[1])
    const sec = Number(parts[2])
    if (
      ![h, m, sec].every((n) => Number.isFinite(n)) ||
      h < 0 || m < 0 || m >= 60 || sec < 0 || sec >= 60
    ) return null
    return h * 3600 + m * 60 + sec
  }
  if (parts.length === 2) {
    const m = Number(parts[0])
    const sec = Number(parts[1])
    if (![m, sec].every((n) => Number.isFinite(n)) || m < 0 || sec < 0 || sec >= 60) return null
    return m * 60 + sec
  }
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
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

/** Parse SubRip (.srt) captions. Blank lines inside a cue no longer truncate it. */
export function parseSrt(content: string): CaptionCue[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const cues: CaptionCue[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    if (!TIME_ARROW.test(line)) {
      i += 1
      continue
    }
    const m = line.match(/([0-9:,.]+)\s*-->\s*([0-9:,.]+)/)
    if (!m) {
      i += 1
      continue
    }
    const startSec = parseTimestamp(m[1])
    const endSec = parseTimestamp(m[2])
    if (startSec === null) {
      i += 1
      continue // invalid start: skip the cue instead of collapsing it to 0
    }
    i += 1
    const textLines: string[] = []
    while (i < lines.length) {
      const t = lines[i].trim()
      // A cue ends at the index line (digits), the next timing line, or a blank
      // line followed by a timing/index line. A lone blank line inside the cue
      // text is preserved.
      if (TIME_ARROW.test(t)) break
      if (/^\d+$/.test(t) && i + 1 < lines.length && TIME_ARROW.test(lines[i + 1])) break
      if (t === '') {
        const rest = lines.slice(i + 1)
        const nextNonBlank = rest.find((l) => l.trim() !== '')
        if (
          nextNonBlank === undefined ||
          TIME_ARROW.test(nextNonBlank.trim()) ||
          (/^\d+$/.test(nextNonBlank.trim()) &&
            rest.indexOf(nextNonBlank) + i + 2 < lines.length &&
            TIME_ARROW.test(lines[rest.indexOf(nextNonBlank) + i + 2]))
        ) {
          break
        }
      }
      textLines.push(lines[i])
      i += 1
    }
    const text = cleanCueText(textLines.join('\n'))
    if (!text) continue
    // Invalid end: zero-duration cue at the (valid) start, never 0.
    cues.push({ startSec, endSec: Math.max(endSec ?? startSec, startSec), text })
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
    if (startSec === null) {
      i += 1
      continue // invalid start: skip the cue instead of collapsing it to 0
    }
    i += 1
    const textLines: string[] = []
    while (i < lines.length) {
      const t = lines[i].trim()
      // A cue ends at a blank line, the next timing line, or a NOTE line.
      // A lone blank line inside cue text is preserved (same rule as SRS).
      if (TIME_ARROW.test(t)) break
      if (/^NOTE\b/i.test(t)) break
      if (t === '') {
        const rest = lines.slice(i + 1)
        const nextNonBlank = rest.find((l) => l.trim() !== '')
        if (nextNonBlank === undefined || TIME_ARROW.test(nextNonBlank.trim())) {
          break
        }
      }
      textLines.push(lines[i])
      i += 1
    }
    const text = cleanCueText(textLines.join('\n'))
    if (text) cues.push({ startSec, endSec: Math.max(endSec ?? startSec, startSec), text })
  }
  return cues
}

/** Auto-detect SRT vs VTT from content or filename. */
export function parseCaptions(content: string, filenameHint?: string): CaptionCue[] {
  const hint = (filenameHint ?? '').toLowerCase()
  const head = content.slice(0, 32).toLowerCase()
  const cues =
    hint.endsWith('.vtt') || head.includes('webvtt')
      ? parseVtt(content)
      : hint.endsWith('.srt')
        ? parseSrt(content)
        : /^\s*webvtt/i.test(content)
          ? parseVtt(content)
          : parseSrt(content)
  return dedupeRollingCues(cues)
}

/**
 * YouTube auto-captions use "rolling" cues: each cue repeats the previous line
 * plus the new one, with ~10 ms transition cues. Without deduplication every
 * line lands in the transcript 2–3x. Drop near-zero-duration cues and strip
 * whatever the previous cue already covered (the overlap can be a prefix or a
 * suffix of the previous cue's text).
 */
export function dedupeRollingCues(cues: CaptionCue[]): CaptionCue[] {
  const out: CaptionCue[] = []
  let prevText = ''
  for (const cue of cues) {
    // Transition cues: ~10 ms repeats of the previous line, carry no new content.
    // Only meaningful mid-stream — a first cue always survives.
    if (prevText && cue.endSec - cue.startSec <= 0.05) continue
    let text = cue.text
    if (prevText) {
      if (text.startsWith(prevText)) {
        text = text.slice(prevText.length).trim()
      } else {
        // Rolling overlap: the new line usually shares a whole line (≥2 words)
        // with the tail of the previous cue. Single-word matches are too common
        // in natural language and would eat real content.
        const words = prevText.split(' ')
        for (let take = Math.min(words.length, 8); take >= 2; take--) {
          const tail = words.slice(words.length - take).join(' ')
          if (text.startsWith(tail)) {
            text = text.slice(tail.length).trim()
            break
          }
        }
      }
      if (!text) continue // pure repeat of the previous cue
    }
    prevText = cue.text
    if (!text) continue
    out.push({ ...cue, text })
  }
  return out
}

/**
 * Group cues into ~30–60s / ~500–800 char notes.
 * Never splits a single cue across chunks. Sorts by start time first, so
 * out-of-order cue lists (e.g. from concat-ed files) don't produce end<start spans.
 */
export function chunkCues(cues: CaptionCue[], opts?: ChunkOptions): CaptionChunk[] {
  const targetSec = opts?.targetSec ?? DEFAULT_TARGET_SEC
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS
  if (cues.length === 0) return []
  const sorted = [...cues].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)

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

  for (const cue of sorted) {
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

export function mediaNoteTitle(startSec: number, sourceTitle?: string): string {
  const source = (sourceTitle ?? '').trim() || 'Media'
  return `${source} · ${formatTimestamp(startSec)}`
}
