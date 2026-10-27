/**
 * Study guide / research notes built while watching (#365): you write, Vault
 * checks and cites.
 *
 * - The learner writes every checkpoint summary, key term, claim and take.
 *   Vault checks it against that part of the transcript and says what it
 *   covered, what it missed (as questions to rewatch for — never written-out
 *   answers) and what the transcript doesn't support (words from the learner's
 *   own text), each with a timestamp.
 * - Vault drafts only when asked. A draft is marked `ai-draft` (the note keeps
 *   `ai-draft` status) until the learner rewrites it or adds a one-line summary
 *   in their own words.
 * - Research quotes must match the transcript exactly (whitespace aside);
 *   anything else is refused and can be added as a claim instead.
 * - The note ("Study guide: <title>" / "Research notes: <title>") is rendered
 *   from the entries: headings by timestamp range with links, Key terms,
 *   Review these (bookmarks + Exam tutor misses), and the research sections.
 * - Cards go through the bookmark-card path (#334): one bookmark per key term
 *   or gap, so making cards twice never makes duplicates.
 *
 * Prompts are short for local qwen3:8b-class models; every reply is checked
 * and there is a no-model word-overlap fallback.
 */
import { createItem, getDb, getItem, getProjectSettings, listItemsByProjectExact, newId, nowIso, updateItem } from './db'
import { citationsFromIds } from './generate'
import { formatTimestamp, parseTEndFromBody, parseTStartFromBody } from './media-captions'
import { listVideoChapters } from './media-chapters'
import { addBookmark, getBookmark, listBookmarks, makeBookmarkCards, stripTranscriptMetadata, timestampLink } from './media-bookmarks'
import { listTutorMisses } from './media-tutor'
import { calendarDaysUntil } from './review'
import { searchQuery } from './search'
import { structuredGenerate } from './structured'
import { copiesRun, normalizeForMatch, stripCitations } from './study-session'
import type {
  Citation,
  GuideAddInput,
  GuideCardsResult,
  GuideCheckPoint,
  GuideCheckpointSaveInput,
  GuideConfirmInput,
  GuideConnectInput,
  GuideDraftInput,
  GuideEntry,
  GuideMode,
  GuideRelatedNote,
  GuideReviewItem,
  GuideSection,
  GuideSettingsInput,
  GuideStartInput,
  GuideSummaryCheck,
  GuideSummaryCheckInput,
  GuideTextCheck,
  GuideUnsupported,
  MediaGuide,
} from './types'

/** Same status string as src/domain.ts AI_DRAFT_STATUS (that module needs the DOM). */
export const GUIDE_AI_DRAFT_STATUS = 'ai-draft'
export const GUIDE_DEFAULT_CHECKPOINT_MIN = 10
export const GUIDE_TEXT_MAX = 4000
/** Transcript text per check — small models need a short prompt. */
export const GUIDE_PASSAGE_CHARS = 3000
export const GUIDE_MAX_GAPS = 3

export const GUIDE_SYSTEM =
  'You check a learner’s notes against a video transcript in Vault. Use ONLY the transcript given. Never add outside facts. Reply with JSON only.'

/* ---- Transcript chunks for one video ---- */

export interface GuideChunk {
  id: string
  start: number
  end: number
  text: string
}

/** The video's transcript notes, in time order (falls back to the project when none carry the video key). */
export function videoChunks(project: string, videoKey: string): GuideChunk[] {
  const all = listItemsByProjectExact(project).filter((n) => n.kind === 'transcript')
  const tagged = all.filter((n) => n.body.includes(`source_url: ${videoKey}`) || n.body.includes(`source_path: ${videoKey}`))
  return (tagged.length ? tagged : all)
    .map((n) => {
      const start = parseTStartFromBody(n.body) ?? 0
      return { id: n.id, start, end: parseTEndFromBody(n.body) ?? start, text: stripTranscriptMetadata(n.body) }
    })
    .filter((c) => c.text)
    .sort((a, b) => a.start - b.start)
}

/** Chunks overlapping [start, end). Pure. */
export function chunksInRange(chunks: GuideChunk[], startSec: number, endSec: number): GuideChunk[] {
  return chunks.filter((c) => c.end > startSec && c.start < endSec)
}

/** `[itm_x @ 12:00] text` lines, capped; long ranges keep an even spread. Pure. */
export function rangeBlock(chunks: GuideChunk[], max = GUIDE_PASSAGE_CHARS): string {
  if (!chunks.length) return ''
  const per = Math.max(120, Math.floor(max / chunks.length) - 20)
  const out: string[] = []
  let used = 0
  for (const c of chunks) {
    let t = c.text.replace(/\s+/g, ' ').trim()
    if (t.length > per) t = `${t.slice(0, per).replace(/\s+\S*$/, '')}…`
    const line = `[${c.id} @ ${formatTimestamp(c.start)}] ${t}`
    if (used + line.length > max) break
    out.push(line)
    used += line.length + 1
  }
  return out.join('\n')
}

/* ---- Prompts (short for local models; covered by the prompt-contract smoke) ---- */

export function summaryCheckPrompt(passages: string, summary: string, range: string): string {
  return `Transcript ${range}:
${passages}

Learner's summary:
"""${summary}"""

Compare the summary with the transcript only. Gaps are questions about important points the learner left out: do not answer them. Unsupported claims must be exact words from the summary.
JSON only:
{"covered":[{"point":"a point the learner got","id":"itm_id"}],"gaps":[{"q":"a question to rewatch for?","id":"itm_id"}],"unsupported":[{"claim":"words from the summary","why":"short reason"}]}`
}

export function textCheckPrompt(passage: string, label: string, text: string): string {
  return `Transcript: "${passage}"
Learner's ${label}: ${text}
Does the transcript support it? JSON only:
{"verdict":"supported|partly|unsupported","note":"one short sentence, no new facts"}`
}

export function draftPrompt(passages: string, range: string): string {
  return `Transcript ${range}:
${passages}

Write 3 short bullet points of the key ideas, each ending with its [itm_id]. Use only the transcript.`
}

/* ---- Checking ---- */

const STOP = new Set(
  'the and for are but not you all any can had her was one our out has his how its may new now see two who did get let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were what which into about could would there their these those then also because going really thing things kind okay right gonna yeah'.split(
    ' ',
  ),
)

export function contentWords(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

/** Share of `a`'s content words found in `b`. Pure. */
export function overlap(a: string, b: string): number {
  const aw = [...new Set(contentWords(a))]
  if (!aw.length) return 0
  const bw = new Set(contentWords(b))
  return aw.filter((w) => bw.has(w)).length / aw.length
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-*•\s]+/, '').trim())
    .filter((s) => s.length > 2)
}

function parseJson(text: string): unknown {
  const t = (text ?? '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  for (const cand of [t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]) {
    try {
      return JSON.parse(cand)
    } catch {
      /* next */
    }
  }
  return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A gap prompt Vault can show: a question that doesn't copy the transcript. Pure. */
export function sanitizeGap(q: string, chunk: GuideChunk): string {
  const text = stripCitations(q).replace(/\s+/g, ' ').trim()
  const generic = `What does the speaker explain at ${formatTimestamp(chunk.start)}?`
  if (!text || !text.endsWith('?') || text.length > 200) return generic
  if (copiesRun(text, chunk.text)) return generic
  return text
}

/** Validate a model's summary check: citations must be window notes; claims must be the learner's words. Pure. */
export function parseSummaryCheck(
  text: string,
  chunks: GuideChunk[],
  summary: string,
): Pick<GuideSummaryCheck, 'covered' | 'gaps' | 'unsupported'> | null {
  const data = parseJson(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  const byId = new Map(chunks.map((c) => [c.id, c]))
  const pickChunk = (id: unknown): GuideChunk | null => {
    const m = /itm_[A-Za-z0-9]+/.exec(str(id))
    return m ? (byId.get(m[0]) ?? null) : null
  }
  const covered: GuideCheckPoint[] = []
  for (const c of Array.isArray(o.covered) ? o.covered : []) {
    const ch = pickChunk((c as Record<string, unknown>)?.id)
    const point = stripCitations(str((c as Record<string, unknown>)?.point))
    if (ch && point) covered.push({ text: point.slice(0, 240), sec: ch.start, itemId: ch.id })
  }
  const gaps: GuideCheckPoint[] = []
  const seen = new Set<string>()
  for (const g of Array.isArray(o.gaps) ? o.gaps : []) {
    const ch = pickChunk((g as Record<string, unknown>)?.id)
    if (!ch || seen.has(ch.id)) continue
    seen.add(ch.id)
    gaps.push({ text: sanitizeGap(str((g as Record<string, unknown>)?.q), ch), sec: ch.start, itemId: ch.id })
    if (gaps.length >= GUIDE_MAX_GAPS) break
  }
  const unsupported: GuideUnsupported[] = []
  const norm = normalizeForMatch(summary)
  for (const u of Array.isArray(o.unsupported) ? o.unsupported : []) {
    const claim = str((u as Record<string, unknown>)?.claim).replace(/^["“]|["”]$/g, '')
    if (claim.length < 3 || !norm.includes(normalizeForMatch(claim))) continue
    unsupported.push({ claim, note: stripCitations(str((u as Record<string, unknown>)?.why)).slice(0, 200) || 'The transcript here doesn’t say this.' })
  }
  if (!covered.length && !gaps.length && !unsupported.length) return null
  return { covered, gaps, unsupported }
}

/** No-model check: word overlap between the learner's sentences and each chunk. Pure. */
export function overlapSummaryCheck(chunks: GuideChunk[], summary: string): Pick<GuideSummaryCheck, 'covered' | 'gaps' | 'unsupported'> {
  const mine = sentences(summary)
  const covered: GuideCheckPoint[] = []
  const gaps: Array<GuideCheckPoint & { weight: number }> = []
  for (const c of chunks) {
    let best = { s: '', score: 0 }
    for (const s of mine) {
      const score = overlap(s, c.text)
      if (score > best.score) best = { s, score }
    }
    if (best.score >= 0.4) {
      if (!covered.some((x) => x.text === best.s)) covered.push({ text: best.s, sec: c.start, itemId: c.id })
    } else {
      gaps.push({ text: `What does the speaker explain at ${formatTimestamp(c.start)}?`, sec: c.start, itemId: c.id, weight: new Set(contentWords(c.text)).size })
    }
  }
  const all = chunks.map((c) => c.text).join(' ')
  const unsupported = mine
    .filter((s) => contentWords(s).length >= 3 && overlap(s, all) < 0.4)
    .map((claim) => ({ claim, note: 'Vault couldn’t find this in this part of the transcript.' }))
  return {
    covered,
    gaps: gaps
      .sort((a, b) => b.weight - a.weight)
      .slice(0, GUIDE_MAX_GAPS)
      .sort((a, b) => a.sec - b.sec)
      .map(({ weight: _w, ...g }) => g),
    unsupported,
  }
}

export function parseVerdict(text: string): { verdict: 'supported' | 'partly' | 'unsupported'; note: string } | null {
  const data = parseJson(text) as Record<string, unknown> | null
  const v = str(data?.verdict).toLowerCase()
  if (v !== 'supported' && v !== 'partly' && v !== 'unsupported') return null
  return { verdict: v, note: stripCitations(str(data?.note)).slice(0, 240) }
}

function noticeFor(error: string, label?: string | null): string {
  const who = label ? ` (${label})` : ''
  return /no provider|no (?:local )?model|not configured|unavailable|ECONNREFUSED|fetch failed/i.test(error)
    ? `No model is available${who}, so Vault compared words with the transcript instead.`
    : `The model${who} didn’t give a usable check, so Vault compared words with the transcript instead.`
}

/* ---- Rows ---- */

interface GuideRow {
  id: string
  video_key: string
  mode: GuideMode
  project: string
  video_title: string
  source_type: string
  item_id: string | null
  checkpoint_min: number
  checkpoints_off: number
  snoozed_until_sec: number | null
  last_checkpoint_sec: number
  created_at: string
  updated_at: string
}

interface EntryRow {
  id: string
  guide_id: string
  section: GuideSection
  start_sec: number | null
  end_sec: number | null
  term: string | null
  text: string
  ai_draft: number
  draft_text: string | null
  confirmed_at: string | null
  check_json: string | null
  item_ref: string | null
  bookmark_id: string | null
  created_at: string
}

function guideRow(id: string): GuideRow {
  const row = getDb().prepare('SELECT * FROM media_guides WHERE id = ?').get(String(id ?? '')) as GuideRow | undefined
  if (!row) throw new Error('That study guide no longer exists.')
  return row
}

function entryRows(guideId: string): EntryRow[] {
  return getDb()
    .prepare('SELECT * FROM media_guide_entries WHERE guide_id = ? ORDER BY COALESCE(start_sec, 1e12), created_at, rowid')
    .all(guideId) as EntryRow[]
}

function toEntry(r: EntryRow): GuideEntry {
  let check: GuideEntry['check'] = null
  try {
    check = r.check_json ? (JSON.parse(r.check_json) as GuideEntry['check']) : null
  } catch {
    check = null
  }
  return {
    id: r.id,
    section: r.section,
    startSec: r.start_sec,
    endSec: r.end_sec,
    term: r.term,
    text: r.text,
    aiDraft: Boolean(r.ai_draft),
    confirmed: !r.ai_draft || Boolean(r.confirmed_at),
    check,
    itemRef: r.item_ref,
    bookmarkId: r.bookmark_id,
    createdAt: r.created_at,
  }
}

export function noteTitleFor(mode: GuideMode, videoTitle: string): string {
  return `${mode === 'research' ? 'Research notes' : 'Study guide'}: ${videoTitle || 'Untitled video'}`
}

/** Bookmarks made by "Make cards" for guide entries (kept out of "Review these"). */
function guideBookmarkIds(guideId: string): Set<string> {
  return new Set(entryRows(guideId).map((e) => e.bookmark_id).filter((x): x is string => Boolean(x)))
}

/** "Review these": the video's bookmarks (Confused first) and Exam tutor misses. */
export function reviewItems(videoKey: string, exclude: Set<string> = new Set()): GuideReviewItem[] {
  const bms: GuideReviewItem[] = listBookmarks(videoKey)
    .filter((b) => !exclude.has(b.id))
    .map((b) => ({
      kind: 'bookmark' as const,
      sec: b.positionSec,
      label: b.label || (b.transcriptLine ? b.transcriptLine.replace(/\s+/g, ' ').slice(0, 80) : 'Bookmark'),
      tag: b.tag,
      confidentWrong: false,
      refId: b.id,
    }))
  const misses: GuideReviewItem[] = listTutorMisses(videoKey).map((m) => ({
    kind: 'tutor-miss' as const,
    sec: m.rewatchSec,
    label: m.question,
    tag: null,
    confidentWrong: m.confidentWrong,
    refId: m.questionId,
  }))
  const rank = (r: GuideReviewItem): number => (r.tag === 'Confused' || r.confidentWrong ? 0 : r.kind === 'tutor-miss' ? 1 : 2)
  return [...bms, ...misses].sort((a, b) => rank(a) - rank(b) || a.sec - b.sec)
}

function loadGuide(id: string): MediaGuide {
  const row = guideRow(id)
  const entries = entryRows(row.id).map(toEntry)
  const item = row.item_id ? getItem(row.item_id) : null
  return {
    id: row.id,
    videoKey: row.video_key,
    mode: row.mode,
    project: row.project,
    videoTitle: row.video_title,
    sourceType: row.source_type === 'youtube' ? 'youtube' : 'local',
    itemId: item ? item.id : null,
    noteTitle: item?.title ?? noteTitleFor(row.mode, row.video_title),
    checkpointMin: row.checkpoint_min,
    checkpointsOff: Boolean(row.checkpoints_off),
    snoozedUntilSec: row.snoozed_until_sec,
    lastCheckpointSec: row.last_checkpoint_sec,
    chapters: listVideoChapters(row.video_key),
    entries,
    review: reviewItems(row.video_key, guideBookmarkIds(row.id)),
    hasUnconfirmedDraft: entries.some((e) => e.aiDraft && !e.confirmed),
    examDate: getProjectSettings(row.project)?.examDate ?? null,
  }
}

/* ---- Markdown ---- */

const VERDICT_MARK: Record<GuideTextCheck['verdict'], string> = {
  supported: '✓ transcript supports this',
  partly: '◐ transcript partly supports this',
  unsupported: '✗ transcript doesn’t support this',
  'not-found': '✗ not in the transcript',
}

function tsLink(videoKey: string, sec: number | null): string {
  if (sec == null) return ''
  return `[${formatTimestamp(sec)}](${timestampLink(videoKey, sec)})`
}

function checkMark(e: GuideEntry): string {
  const c = e.check as GuideTextCheck | null
  return c && 'verdict' in c ? ` _(${VERDICT_MARK[c.verdict]})_` : ''
}

/** Render the guide note from its entries. Pure. */
export function renderGuideMarkdown(g: MediaGuide): string {
  const v = g.videoKey
  const out: string[] = [`# ${g.noteTitle}`, '', `Video: [${g.videoTitle || 'video'}](${timestampLink(v, 0)})`, '']
  out.push(
    g.mode === 'research'
      ? '_My notes while watching. Quotes are copied exactly from the transcript; Vault checked claims and evidence against it._'
      : '_Written by me while watching; Vault checked each part against the transcript._',
    '',
  )
  const summaries = g.entries.filter((e) => e.section === 'summary').sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0))
  const gaps = g.entries.filter((e) => e.section === 'gap')
  const chapterTitle = (start: number | null): string => {
    if (start == null) return ''
    const ch = g.chapters.find((c) => c.startSec <= start && start < c.endSec)
    return ch?.title ? ` · ${ch.title}` : ''
  }
  if (g.mode === 'research' && summaries.length) out.push('## Summaries', '')
  for (const s of summaries) {
    out.push(`${g.mode === 'research' ? '###' : '##'} ${tsLink(v, s.startSec)}–${tsLink(v, s.endSec)}${chapterTitle(s.startSec)}`, '')
    out.push(s.text.trim(), '')
    if (s.aiDraft && !s.confirmed) out.push('> **ai-draft — rewrite to confirm.** Vault drafted this; it isn’t your note yet.', '')
    const mine = gaps.filter((x) => x.startSec != null && s.startSec != null && s.endSec != null && x.startSec >= s.startSec && x.startSec < s.endSec)
    if (mine.length) {
      out.push('Rewatch for:')
      for (const x of mine) out.push(`- ${tsLink(v, x.startSec)} ${x.text}`)
      out.push('')
    }
  }
  const terms = g.entries.filter((e) => e.section === 'term')
  if (terms.length) {
    out.push('## Key terms', '')
    for (const t of terms) out.push(`- **${t.term}** — ${t.text} ${tsLink(v, t.startSec)}${checkMark(t)}`)
    out.push('')
  }
  if (g.mode === 'research') {
    const sec = (section: GuideSection, heading: string, line: (e: GuideEntry) => string): void => {
      const list = g.entries.filter((e) => e.section === section)
      if (!list.length) return
      out.push(`## ${heading}`, '')
      for (const e of list) out.push(line(e))
      out.push('')
    }
    sec('claim', 'Claims', (e) => `- ${tsLink(v, e.startSec)} ${e.text}${checkMark(e)}`)
    sec('evidence', 'Evidence given', (e) => `- ${tsLink(v, e.startSec)} ${e.text}${checkMark(e)}`)
    sec('quote', 'Quotes', (e) => `> “${e.text}” — ${tsLink(v, e.startSec)}\n`)
    sec('take', 'My take', (e) => `- ${e.text}`)
    sec('question', 'Open questions', (e) => `- ${e.text}${e.startSec != null ? ` ${tsLink(v, e.startSec)}` : ''}`)
    sec('connection', 'Connections', (e) => `- [[${e.text}]]${e.itemRef ? ` [${e.itemRef}]` : ''}`)
  }
  if (g.review.length) {
    out.push('## Review these', '')
    for (const r of g.review) {
      const what =
        r.kind === 'tutor-miss'
          ? `Exam tutor${r.confidentWrong ? ' (confident but wrong)' : ' miss'}: ${r.label}`
          : `${r.label}${r.tag ? ` — ${r.tag}` : ''}`
      out.push(`- ${tsLink(v, r.sec)} ${what}`)
    }
    out.push('')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Re-render the note (recreating it if it was deleted) and keep its ai-draft status in step. */
function refresh(guideId: string): MediaGuide {
  let g = loadGuide(guideId)
  const status = g.hasUnconfirmedDraft ? GUIDE_AI_DRAFT_STATUS : 'active'
  if (!g.itemId) {
    const item = createItem({ title: g.noteTitle, body: '', kind: 'note', para: 'resources', project: g.project, status })
    getDb().prepare('UPDATE media_guides SET item_id = ? WHERE id = ?').run(item.id, guideId)
    g = loadGuide(guideId)
  }
  updateItem(g.itemId as string, { body: renderGuideMarkdown(g), status })
  getDb().prepare('UPDATE media_guides SET updated_at = ? WHERE id = ?').run(nowIso(), guideId)
  return g
}

/* ---- Public API ---- */

export function listGuides(videoKey: string): MediaGuide[] {
  const rows = getDb().prepare('SELECT id FROM media_guides WHERE video_key = ? ORDER BY mode').all(String(videoKey ?? '')) as Array<{ id: string }>
  return rows.map((r) => loadGuide(r.id))
}

export function getGuide(guideId: string): MediaGuide {
  return loadGuide(guideId)
}

/** Start (or reopen) the video's study guide or research notes. */
export function startGuide(input: GuideStartInput): MediaGuide {
  const videoKey = String(input?.videoKey ?? '').trim()
  const project = String(input?.project ?? '').trim()
  if (!videoKey) throw new Error('Open a video before starting a study guide.')
  if (!project) throw new Error('Open a media project before starting a study guide.')
  const mode: GuideMode = input.mode === 'research' ? 'research' : 'study'
  const existing = getDb().prepare('SELECT id FROM media_guides WHERE video_key = ? AND mode = ?').get(videoKey, mode) as { id: string } | undefined
  if (existing) return refresh(existing.id)
  const id = newId('gde')
  const ts = nowIso()
  const title = String(input.videoTitle ?? '').trim() || videoKey.split(/[\\/]/).pop() || 'video'
  getDb()
    .prepare(
      `INSERT INTO media_guides (id, video_key, mode, project, video_title, source_type, item_id, checkpoint_min, checkpoints_off, snoozed_until_sec, last_checkpoint_sec, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, NULL, 0, ?, ?)`,
    )
    .run(id, videoKey, mode, project, title, input.sourceType === 'youtube' ? 'youtube' : 'local', GUIDE_DEFAULT_CHECKPOINT_MIN, ts, ts)
  return refresh(id)
}

export function updateGuideSettings(input: GuideSettingsInput): MediaGuide {
  const row = guideRow(input?.guideId)
  const min = input.checkpointMin !== undefined ? Math.round(Number(input.checkpointMin)) : row.checkpoint_min
  if (!Number.isFinite(min) || min < 1 || min > 120) throw new Error('Checkpoints can be every 1–120 minutes.')
  const off = input.checkpointsOff !== undefined ? (input.checkpointsOff ? 1 : 0) : row.checkpoints_off
  const snooze =
    input.snoozedUntilSec !== undefined
      ? input.snoozedUntilSec == null || !Number.isFinite(Number(input.snoozedUntilSec))
        ? null
        : Math.max(0, Number(input.snoozedUntilSec))
      : row.snoozed_until_sec
  const last =
    input.lastCheckpointSec !== undefined && Number.isFinite(Number(input.lastCheckpointSec))
      ? Math.max(0, Number(input.lastCheckpointSec))
      : row.last_checkpoint_sec
  getDb()
    .prepare('UPDATE media_guides SET checkpoint_min = ?, checkpoints_off = ?, snoozed_until_sec = ?, last_checkpoint_sec = ?, updated_at = ? WHERE id = ?')
    .run(min, off, snooze, last, nowIso(), row.id)
  return loadGuide(row.id)
}

function cleanRange(start: unknown, end: unknown): { startSec: number; endSec: number } {
  const s = Math.max(0, Number(start) || 0)
  const e = Number(end)
  if (!Number.isFinite(e) || e <= s) throw new Error('Pick a part of the video to check (the end must be after the start).')
  return { startSec: s, endSec: e }
}

function cleanText(text: unknown, what: string): string {
  const t = String(text ?? '').trim()
  if (!t) throw new Error(`Write ${what} first — Vault checks what you write.`)
  return t.slice(0, GUIDE_TEXT_MAX)
}

/** Check the learner's summary of [start, end) against that part of the transcript. Saves nothing. */
export async function checkSummary(input: GuideSummaryCheckInput): Promise<GuideSummaryCheck> {
  const row = guideRow(input?.guideId)
  const { startSec, endSec } = cleanRange(input.startSec, input.endSec)
  const text = cleanText(input.text, 'your summary')
  const chunks = chunksInRange(videoChunks(row.project, row.video_key), startSec, endSec)
  const range = `${formatTimestamp(startSec)}–${formatTimestamp(endSec)}`
  if (!chunks.length) {
    return { startSec, endSec, covered: [], gaps: [], unsupported: [], citations: [], notice: `There’s no transcript for ${range}, so Vault can’t check this part.` }
  }
  let result: Pick<GuideSummaryCheck, 'covered' | 'gaps' | 'unsupported'> | null = null
  let notice: string | undefined
  const gen = await structuredGenerate({
    system: GUIDE_SYSTEM,
    prompt: summaryCheckPrompt(rangeBlock(chunks), text, range),
    maxTokens: 600,
    retryMaxTokens: 1200,
    expect: 'json',
  })
  if (gen.ok) {
    result = parseSummaryCheck(gen.text, chunks, text)
    if (!result) notice = 'The model’s check didn’t pass Vault’s checks, so Vault compared words with the transcript instead.'
  } else {
    notice = noticeFor(gen.error, gen.providerLabel)
  }
  if (!result) result = overlapSummaryCheck(chunks, text)
  const ids = [...new Set([...result.covered, ...result.gaps].map((p) => p.itemId))]
  return { startSec, endSec, ...result, citations: citationsFromIds(ids) as Citation[], ...(notice ? { notice } : {}) }
}

function insertEntry(guideId: string, e: Partial<EntryRow> & { section: GuideSection; text: string }): string {
  const id = newId('gen')
  const ts = nowIso()
  getDb()
    .prepare(
      `INSERT INTO media_guide_entries (id, guide_id, section, start_sec, end_sec, term, text, ai_draft, draft_text, confirmed_at, check_json, item_ref, bookmark_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
    )
    .run(
      id,
      guideId,
      e.section,
      e.start_sec ?? null,
      e.end_sec ?? null,
      e.term ?? null,
      e.text,
      e.ai_draft ? 1 : 0,
      e.draft_text ?? null,
      e.check_json ?? null,
      e.item_ref ?? null,
      ts,
      ts,
    )
  return id
}

/** Save a checkpoint: the learner's summary (verbatim) plus the gaps they chose to keep. */
export function saveCheckpoint(input: GuideCheckpointSaveInput): MediaGuide {
  const row = guideRow(input?.guideId)
  const { startSec, endSec } = cleanRange(input.startSec, input.endSec)
  const text = String(input.text ?? '').trim().slice(0, GUIDE_TEXT_MAX)
  const check = input.check ?? null
  const chosen = new Set((input.gapIndexes ?? []).map(Number))
  getDb().transaction(() => {
    if (text) insertEntry(row.id, { section: 'summary', start_sec: startSec, end_sec: endSec, text, check_json: check ? JSON.stringify(check) : null })
    check?.gaps.forEach((gap, i) => {
      if (!chosen.has(i)) return
      insertEntry(row.id, { section: 'gap', start_sec: gap.sec, end_sec: endSec, text: gap.text, item_ref: gap.itemId })
    })
    getDb().prepare('UPDATE media_guides SET last_checkpoint_sec = MAX(last_checkpoint_sec, ?), snoozed_until_sec = NULL WHERE id = ?').run(endSec, row.id)
  })()
  return refresh(row.id)
}

/** On request only: Vault drafts a section, marked ai-draft until the learner rewrites or confirms it. */
export async function draftSection(input: GuideDraftInput): Promise<MediaGuide> {
  const row = guideRow(input?.guideId)
  const { startSec, endSec } = cleanRange(input.startSec, input.endSec)
  const chunks = chunksInRange(videoChunks(row.project, row.video_key), startSec, endSec)
  if (!chunks.length) throw new Error(`There’s no transcript for ${formatTimestamp(startSec)}–${formatTimestamp(endSec)} to draft from.`)
  const valid = new Set(chunks.map((c) => c.id))
  let draft = ''
  const gen = await structuredGenerate({
    system: 'You summarise a video transcript in Vault. Use ONLY the transcript given. Never add outside facts.',
    prompt: draftPrompt(rangeBlock(chunks), `${formatTimestamp(startSec)}–${formatTimestamp(endSec)}`),
    maxTokens: 400,
    retryMaxTokens: 800,
    expect: 'list',
  })
  if (gen.ok) {
    const bullets = gen.text
      .split(/\n+/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && [...l.matchAll(/itm_[A-Za-z0-9]+/g)].every((m) => valid.has(m[0])) && /itm_/.test(l))
    if (bullets.length) draft = bullets.slice(0, 5).map((b) => `- ${b}`).join('\n')
  }
  if (!draft) {
    // No model: the transcript's own first sentence per chunk, cited — still a draft to rewrite.
    draft = chunks
      .slice(0, 4)
      .map((c) => `- ${(sentences(c.text)[0] ?? c.text).slice(0, 200)} [${c.id}]`)
      .join('\n')
  }
  insertEntry(row.id, { section: 'summary', start_sec: startSec, end_sec: endSec, text: draft, ai_draft: 1, draft_text: draft })
  getDb().prepare('UPDATE media_guides SET last_checkpoint_sec = MAX(last_checkpoint_sec, ?) WHERE id = ?').run(endSec, row.id)
  return refresh(row.id)
}

/** Why a confirm is refused (null = allowed). Pure. */
export function confirmRejection(draft: string, text?: string, ownLine?: string): string | null {
  const t = String(text ?? '').trim()
  const line = String(ownLine ?? '').trim()
  if (line) {
    if (/\n/.test(line)) return 'Keep the summary to one line.'
    if (contentWords(line).length < 3) return 'Write a fuller line in your own words (a few key words at least).'
    if (normalizeForMatch(draft).includes(normalizeForMatch(line))) return 'That line is copied from the draft — say it in your own words.'
    return null
  }
  if (!t) return 'Rewrite the draft, or add a one-line summary in your own words, to confirm it.'
  if (normalizeForMatch(t) === normalizeForMatch(draft)) return 'The text is unchanged — rewrite it, or add a one-line summary in your own words.'
  return null
}

/** Confirm an ai-draft: rewritten text replaces it; an own-words line is added on top. */
export function confirmEntry(input: GuideConfirmInput): MediaGuide {
  const row = getDb().prepare('SELECT * FROM media_guide_entries WHERE id = ?').get(String(input?.entryId ?? '')) as EntryRow | undefined
  if (!row) throw new Error('That entry no longer exists.')
  if (!row.ai_draft || row.confirmed_at) return refresh(row.guide_id)
  const draft = row.draft_text ?? row.text
  const why = confirmRejection(draft, input.text, input.ownLine)
  if (why) throw new Error(why)
  const line = String(input.ownLine ?? '').trim()
  const text = line ? `**In my words:** ${line}\n\n${String(input.text ?? '').trim() || row.text}` : String(input.text).trim().slice(0, GUIDE_TEXT_MAX)
  getDb().prepare('UPDATE media_guide_entries SET text = ?, confirmed_at = ?, updated_at = ? WHERE id = ?').run(text, nowIso(), nowIso(), row.id)
  return refresh(row.guide_id)
}

/** Collapse whitespace and typographic quotes/dashes only — quotes stay otherwise exact. Pure. */
export function quoteNorm(text: string): string {
  return String(text ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Find a quote verbatim in the transcript (whitespace aside). Returns the transcript's own text and time. Pure. */
export function findExactQuote(chunks: GuideChunk[], quote: string): { text: string; sec: number; itemId: string } | null {
  const q = quoteNorm(quote).replace(/^["']+|["']+$/g, '').trim()
  if (q.length < 3) return null
  // Join neighbouring chunks so a quote can cross a caption boundary.
  let joined = ''
  const starts: Array<{ at: number; chunk: GuideChunk }> = []
  for (const c of chunks) {
    if (joined) joined += ' '
    starts.push({ at: joined.length, chunk: c })
    joined += quoteNorm(c.text)
  }
  const at = joined.indexOf(q)
  if (at < 0) return null
  let owner = starts[0]
  for (const s of starts) if (s.at <= at) owner = s
  return { text: joined.slice(at, at + q.length), sec: owner.chunk.start, itemId: owner.chunk.id }
}

/** Check a term / claim / evidence against the transcript (nearest matching chunks first). */
export async function checkAgainstTranscript(chunks: GuideChunk[], label: string, text: string, sec: number, term?: string): Promise<GuideTextCheck> {
  const keys = term ? [normalizeForMatch(term)] : []
  let pool = keys.length ? chunks.filter((c) => normalizeForMatch(c.text).includes(keys[0])) : []
  if (!pool.length && !term) {
    pool = chunks
      .map((c) => ({ c, s: overlap(text, c.text) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.c)
  }
  if (!pool.length) {
    return { verdict: 'not-found', note: term ? `The transcript doesn’t mention “${term}”.` : 'Vault couldn’t find this in the transcript.', sec: null, citations: [] }
  }
  const near = [...pool].sort((a, b) => Math.abs(a.start - sec) - Math.abs(b.start - sec)).slice(0, 3)
  const passage = near.map((c) => c.text.replace(/\s+/g, ' ').trim()).join(' … ').slice(0, 1600)
  let parsed: { verdict: 'supported' | 'partly' | 'unsupported'; note: string } | null = null
  const gen = await structuredGenerate({ system: GUIDE_SYSTEM, prompt: textCheckPrompt(passage, label, text), maxTokens: 200, retryMaxTokens: 400, expect: 'json' })
  if (gen.ok) parsed = parseVerdict(gen.text)
  if (!parsed) {
    const s = overlap(text, passage)
    parsed =
      s >= 0.5
        ? { verdict: 'supported', note: 'Most of your words appear in the transcript here.' }
        : s >= 0.25
          ? { verdict: 'partly', note: 'Some of this matches the transcript; rewatch to check the rest.' }
          : { verdict: 'unsupported', note: 'Vault couldn’t match this to the transcript here.' }
  }
  return { ...parsed, sec: near[0].start, citations: citationsFromIds(near.map((c) => c.id)) as Citation[] }
}

const LABELS: Record<GuideAddInput['section'], string> = {
  term: 'definition',
  claim: 'claim',
  evidence: 'note of the evidence given',
  quote: 'quote',
  take: 'take',
  question: 'question',
}

/** Add a key term (study) or a research entry. Terms, claims and evidence are checked; quotes must be exact. */
export async function addEntry(input: GuideAddInput): Promise<MediaGuide> {
  const row = guideRow(input?.guideId)
  const section = input.section
  if (!(section in LABELS)) throw new Error('Unknown kind of entry.')
  const text = cleanText(input.text, section === 'term' ? 'a definition in your own words' : `your ${LABELS[section]}`)
  const sec = Number.isFinite(Number(input.sec)) ? Math.max(0, Number(input.sec)) : null
  const term = section === 'term' ? String(input.term ?? '').trim().slice(0, 120) : ''
  if (section === 'term' && !term) throw new Error('Name the key term.')
  const chunks = videoChunks(row.project, row.video_key)
  if (section === 'quote') {
    const near = sec == null ? chunks : chunks.filter((c) => Math.abs(c.start - sec) <= 180)
    const hit = findExactQuote(near, text) ?? findExactQuote(chunks, text)
    if (!hit) throw new Error('That quote doesn’t match the transcript exactly. Fix it to match word for word, or add it as a claim instead.')
    insertEntry(row.id, { section, start_sec: hit.sec, text: hit.text, item_ref: hit.itemId })
    return refresh(row.id)
  }
  let check: GuideTextCheck | null = null
  if (section === 'term' || section === 'claim' || section === 'evidence') {
    check = await checkAgainstTranscript(chunks, LABELS[section] + (term ? ` of "${term}"` : ''), text, sec ?? 0, term || undefined)
  }
  insertEntry(row.id, {
    section,
    start_sec: check?.sec ?? sec,
    term: term || null,
    text,
    check_json: check ? JSON.stringify(check) : null,
    item_ref: check?.citations[0]?.id ?? null,
  })
  return refresh(row.id)
}

export function deleteEntry(entryId: string): MediaGuide {
  const row = getDb().prepare('SELECT guide_id FROM media_guide_entries WHERE id = ?').get(String(entryId ?? '')) as { guide_id: string } | undefined
  if (!row) throw new Error('That entry no longer exists.')
  getDb().prepare('DELETE FROM media_guide_entries WHERE id = ?').run(String(entryId))
  return refresh(row.guide_id)
}

/** Notes in the vault related to what the learner has written (never transcripts or the guide itself). */
export function relatedNotes(guideId: string, query?: string): GuideRelatedNote[] {
  const g = loadGuide(guideId)
  const linked = new Set(g.entries.filter((e) => e.section === 'connection').map((e) => e.itemRef))
  let text = String(query ?? '').trim()
  if (!text) {
    const mine = g.entries.filter((e) => !e.aiDraft || e.confirmed).map((e) => `${e.term ?? ''} ${e.text}`).join(' ')
    const freq = new Map<string, number>()
    for (const w of contentWords(mine)) freq.set(w, (freq.get(w) ?? 0) + 1)
    text = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w).join(' OR ')
  }
  if (!text) return []
  const hits = searchQuery({ text, limit: 30 }).hits
  return hits
    .filter((h) => h.kind !== 'transcript' && h.id !== g.itemId && !linked.has(h.id) && !/^(Study guide|Research notes): /.test(h.title))
    .slice(0, 8)
    .map((h) => ({ itemId: h.id, title: h.title, snippet: (h.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160), project: h.project }))
}

export function connectNote(input: GuideConnectInput): MediaGuide {
  const row = guideRow(input?.guideId)
  const item = getItem(String(input?.itemId ?? ''))
  if (!item) throw new Error('That note no longer exists.')
  const dup = getDb().prepare("SELECT 1 FROM media_guide_entries WHERE guide_id = ? AND section = 'connection' AND item_ref = ?").get(row.id, item.id)
  if (!dup) insertEntry(row.id, { section: 'connection', text: item.title, item_ref: item.id })
  return refresh(row.id)
}

/** Suggested next review date from the exam date: about a third of the way there, never later than the day before. Pure. */
export function suggestReviewDate(examDate: string | null, now = new Date()): { date: string; note: string } {
  const day = (offset: number): string => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const days = calendarDaysUntil(examDate, now)
  if (days == null || days < 0) return { date: day(1), note: 'No exam date set — review these tomorrow; Study spaces them out after that.' }
  if (days <= 1) return { date: day(0), note: `Your exam is ${days === 0 ? 'today' : 'tomorrow'} (${examDate}) — review these today.` }
  const offset = Math.min(days - 1, Math.max(1, Math.round(days / 3)))
  return { date: day(offset), note: `Your exam is in ${days} days (${examDate}) — first review on ${day(offset)}, then Study spaces them up to the exam.` }
}

/** Make Study cards from key terms and gaps through the bookmark-card path — never duplicates. */
export function makeGuideCards(guideId: string, now = new Date()): GuideCardsResult {
  const g = loadGuide(guideId)
  const database = getDb()
  const ids: string[] = []
  for (const e of g.entries) {
    if (e.section !== 'term' && e.section !== 'gap') continue
    if (e.startSec == null) continue
    let bookmarkId = e.bookmarkId && getBookmark(e.bookmarkId) ? e.bookmarkId : null
    if (!bookmarkId) {
      const bm = addBookmark({
        videoKey: g.videoKey,
        project: g.project,
        videoTitle: g.videoTitle,
        sourceType: g.sourceType,
        positionSec: e.startSec,
        label: e.section === 'term' ? `Key term: ${e.term}` : `Rewatch: ${e.text}`,
        tag: 'Review',
      })
      bookmarkId = bm.id
      database.prepare('UPDATE media_guide_entries SET bookmark_id = ?, updated_at = ? WHERE id = ?').run(bookmarkId, nowIso(), e.id)
    }
    ids.push(bookmarkId)
  }
  if (!ids.length) throw new Error('Add a key term or keep a gap first — cards are made from those.')
  const made = makeBookmarkCards({ videoKey: g.videoKey, project: g.project, ids })
  refresh(guideId)
  const review = suggestReviewDate(g.examDate, now)
  return { created: made.created, existing: made.existing, reviewDate: review.date, reviewNote: review.note }
}
