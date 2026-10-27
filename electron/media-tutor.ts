/**
 * Exam tutor for Media chat (#364): quiz before telling.
 *
 * The loop, per question:
 *   1. `tutorQuiz` writes 1–3 short-answer recall questions from the transcript
 *      window around the playhead (or a bookmark). Only the question text goes
 *      to the renderer; the answer key, hint, key term and supporting quote stay
 *      here until the learner has tried.
 *   2. `tutorHint` gives graduated help: a nudge, then a key term, then where to
 *      rewatch. The answer itself is only ever the explicit "Just show me".
 *   3. `tutorReveal` needs an attempt (or "I don't know" / "Just show me") and
 *      a Low / Medium / High confidence. It grades Missed / Partly / Got it
 *      (Study's vocabulary) and returns the cited answer and a timestamp.
 *   4. `tutorWhy` checks the learner's one-sentence "why" against the passage.
 *   5. `tutorPractice` turns a miss into a Confused bookmark and, optionally, a
 *      Study card through the bookmark-card path (#334) — never a duplicate.
 *
 * Prompts are short so local qwen3:8b-class models follow them; every model
 * reply is checked (the quote must be verbatim in the window, citations must be
 * window notes, objectives must come from a cited objectives note) and there is
 * a no-model fallback (cloze questions, word-overlap grading) so the loop works
 * offline.
 */
import { getDb, getItem, getProjectSettings, listItemsByProjectExact, newId, nowIso } from './db'
import { citationsFromIds, extractCitedIds, validateCitations } from './generate'
import { formatTimestamp, parseTStartFromBody, parseTEndFromBody } from './media-captions'
import { notesNearPlayhead } from './media-ingest'
import { addBookmark, getBookmark, listBookmarks, makeBookmarkCards, stripTranscriptMetadata, DEFAULT_WINDOW_SEC } from './media-bookmarks'
import { calendarDaysUntil } from './review'
import { structuredGenerate } from './structured'
import { buildCloze, dropReason, normalizeForMatch, stripCitations } from './study-session'
import type {
  Item,
  StudySelfGrade,
  TutorConfidence,
  TutorHint,
  TutorHintInput,
  TutorMiss,
  TutorObjectiveTag,
  TutorPracticeInput,
  TutorPracticeResult,
  TutorQuestion,
  TutorQuiz,
  TutorQuizInput,
  TutorReveal,
  TutorRevealInput,
  TutorWhyInput,
  TutorWhyResult,
} from './types'

export const TUTOR_MAX_QUESTIONS = 3
export const TUTOR_DEFAULT_QUESTIONS = 2
/** Transcript text sent with a quiz request — small models need a short prompt. */
export const TUTOR_PASSAGE_CHARS = 2400
export const TUTOR_MAX_OBJECTIVES = 6
export const TUTOR_ATTEMPT_MAX = 1000
export const TUTOR_CONFIDENCES: readonly TutorConfidence[] = ['low', 'medium', 'high']

/** Short system line for every tutor call (the full Media rules live in the voice prompt). */
export const TUTOR_SYSTEM =
  'You are Exam tutor in Vault Media chat. Use ONLY the transcript passages given. Never add outside facts. Reply with JSON only.'

/* ---- Window + objectives ---- */

export interface WindowChunk {
  id: string
  start: number
  end: number
  text: string
}

function windowChunks(project: string, centerSec: number, windowSec: number): WindowChunk[] {
  return notesNearPlayhead(project, centerSec, windowSec)
    .map((n: Item) => ({
      id: n.id,
      start: parseTStartFromBody(n.body) ?? centerSec,
      end: parseTEndFromBody(n.body) ?? centerSec,
      text: stripTranscriptMetadata(n.body),
    }))
    .filter((c) => c.text)
}

/** The passages block: `[itm_x @ 12:00] text`, capped for small models. Pure. */
export function passagesBlock(chunks: WindowChunk[], max = TUTOR_PASSAGE_CHARS): string {
  const out: string[] = []
  let used = 0
  for (const c of chunks) {
    const line = `[${c.id} @ ${formatTimestamp(c.start)}] ${c.text.replace(/\s+/g, ' ').trim()}`
    if (used + line.length > max) {
      if (out.length === 0) out.push(line.slice(0, max))
      break
    }
    out.push(line)
    used += line.length + 1
  }
  return out.join('\n')
}

export interface ObjectiveLine {
  code: string
  text: string
  itemId: string
  title: string
}

const OBJECTIVES_TITLE = /\bobjectives?\b/i
const OBJECTIVE_LINE = /^\s*(?:[-*•]\s*)?(?:(?:objective|obj\.?)\s*)?(\d+(?:\.\d+){1,2})\s*[).:\-–—]?\s+(.{3,200})$/i

/** Parse "1.1 Given a scenario, …" style lines from an objectives note. Pure. */
export function parseObjectives(body: string, itemId: string, title: string): ObjectiveLine[] {
  const out: ObjectiveLine[] = []
  const seen = new Set<string>()
  for (const raw of (body ?? '').split(/\r?\n/)) {
    const m = OBJECTIVE_LINE.exec(raw.replace(/^#+\s*/, ''))
    if (!m) continue
    const code = m[1]
    if (seen.has(code)) continue
    seen.add(code)
    out.push({ code, text: m[2].trim(), itemId, title })
  }
  return out
}

/** Every objective line from the project's own objectives notes (never transcripts). */
export function projectObjectives(project: string): ObjectiveLine[] {
  if (!project) return []
  const out: ObjectiveLine[] = []
  for (const it of listItemsByProjectExact(project)) {
    if (it.kind === 'transcript' || !OBJECTIVES_TITLE.test(it.title)) continue
    out.push(...parseObjectives(it.body, it.id, it.title))
  }
  return out
}

function contentWords(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w))
}

const STOP = new Set(
  'the and for are but not you all any can had her was one our out has his how its may new now see two who did get let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were what which into about could would there their these those then also because given scenario'.split(
    ' ',
  ),
)

/** The objectives that share the most words with the window (the model may only pick from these). Pure. */
export function candidateObjectives(objectives: ObjectiveLine[], windowText: string, max = TUTOR_MAX_OBJECTIVES): ObjectiveLine[] {
  const words = new Set(contentWords(windowText))
  return objectives
    .map((o) => ({ o, score: contentWords(o.text).filter((w) => words.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.o)
}

/** Match the model's "obj" to a candidate by its code — anything else is dropped. Pure. */
export function matchObjective(obj: unknown, candidates: ObjectiveLine[]): ObjectiveLine | null {
  const v = typeof obj === 'string' ? obj.trim() : typeof obj === 'number' ? String(obj) : ''
  if (!v) return null
  const code = /^(\d+(?:\.\d+){1,2})/.exec(v)?.[1]
  if (!code) return null
  return candidates.find((c) => c.code === code) ?? null
}

/* ---- Prompts (kept short for local models) ---- */

/** The quiz prompt. Pure — covered by the prompt-contract smoke test. */
export function quizPrompt(passages: string, count: number, objectives: ObjectiveLine[]): string {
  const obj = objectives.length
    ? `\nExam objectives (set "obj" to the number of one that clearly matches, else ""):\n${objectives.map((o) => `${o.code} ${o.text}`).join('\n')}\n`
    : '\n'
  return `Passages:
${passages}
${obj}
Write ${count} short-answer recall question${count === 1 ? '' : 's'} a learner can answer from these passages only.
Rules: one fact each; no multiple choice; never say "the passage"; never put the answer in the question.
JSON array only:
[{"q":"question","a":"short answer [itm_id]","quote":"exact words copied from one passage","hint":"a nudge that does not give the answer","term":"one key term","obj":""}]`
}

/** The grading prompt. Pure. */
export function gradePrompt(answer: string, quote: string, attempt: string): string {
  return `Answer key: ${answer}
Supporting quote: "${quote}"
Learner's answer: ${attempt}
Grade the learner against the answer key only. JSON only:
{"grade":"missed|partial|got","missed":"what they missed or got wrong, one short sentence, no new facts"}`
}

/** The why-check prompt. Pure. */
export function whyPrompt(passage: string, why: string): string {
  return `Passage: "${passage}"
Learner's reason: ${why}
Does the passage support the reason? JSON only:
{"verdict":"supported|partly|unsupported","note":"one short sentence"}`
}

/* ---- Parsing ---- */

function parseJson(text: string): unknown {
  const raw = (text ?? '').replace(/```(?:json)?/gi, '').trim()
  const a = raw.indexOf('[')
  const o = raw.indexOf('{')
  try {
    if (a >= 0 && (o < 0 || a < o)) return JSON.parse(raw.slice(a, raw.lastIndexOf(']') + 1))
    if (o >= 0) return JSON.parse(raw.slice(o, raw.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export interface DraftQuestion {
  question: string
  answer: string
  quote: string
  hint: string
  term: string
  obj: unknown
}

/** The model's quiz reply as raw drafts (unchecked). Pure. */
export function parseQuizReply(text: string): DraftQuestion[] {
  const parsed = parseJson(text)
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  return list
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      question: str(x.q ?? x.question),
      answer: str(x.a ?? x.answer),
      quote: str(x.quote),
      hint: str(x.hint),
      term: str(x.term),
      obj: x.obj ?? x.objective,
    }))
}

/** The chunk a quote comes from, or null when it is not verbatim in the window. Pure. */
export function chunkForQuote(quote: string, chunks: WindowChunk[]): WindowChunk | null {
  const q = normalizeForMatch(quote).replace(/^["'\s]+|["'.;:,\s]+$/g, '')
  if (!q) return null
  return chunks.find((c) => normalizeForMatch(c.text).includes(q)) ?? null
}

/** True when `text` gives the answer away (contains it). Pure. */
export function revealsAnswer(text: string, answer: string): boolean {
  const a = normalizeForMatch(stripCitations(answer)).replace(/[.!?]+$/, '')
  if (!a) return false
  return normalizeForMatch(text).includes(a)
}

/** A key-term hint that never is the answer: the term, or its first letter and length. Pure. */
export function termHint(term: string, answer: string): string {
  const a = stripCitations(answer).trim()
  const t = term.trim()
  if (t && !revealsAnswer(t, a) && !revealsAnswer(a, t)) return `Key term: ${t}`
  const word = a.split(/\s+/)[0] ?? ''
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '')
  if (!letters) return 'Key term: think of the one word the speaker stresses here.'
  return `Key term: it starts with “${letters[0].toUpperCase()}” (${letters.length} characters${a.split(/\s+/).length > 1 ? ', first word' : ''}).`
}

/* ---- Storage ---- */

interface QuestionRow {
  id: string
  quiz_id: string
  video_key: string
  project: string
  center_sec: number
  window_sec: number
  bookmark_id: string | null
  question: string
  answer: string
  hint: string
  key_term: string
  quote: string
  rewatch_sec: number
  source_ids: string
  objective: string | null
  objective_item_id: string | null
  kind: string
  model: string | null
  hints_used: number
  attempt: string | null
  dont_know: number
  just_shown: number
  confidence: string | null
  grade: string | null
  feedback: string | null
  why: string | null
  why_verdict: string | null
  practice_bookmark_id: string | null
  created_at: string
  revealed_at: string | null
}

function loadRow(id: string): QuestionRow {
  const row = getDb().prepare('SELECT * FROM media_tutor_questions WHERE id = ?').get(String(id ?? '')) as QuestionRow | undefined
  if (!row) throw new Error('This tutor question no longer exists.')
  return row
}

function objectiveTag(row: Pick<QuestionRow, 'objective' | 'objective_item_id'>): TutorObjectiveTag | null {
  if (!row.objective || !row.objective_item_id) return null
  const note = getItem(row.objective_item_id)
  // Only ever shown with its cited objectives note; a deleted note drops the tag.
  if (!note || note.status === 'trashed') return null
  return { label: row.objective, itemId: note.id, title: note.title }
}

/** What the renderer may see before the reveal: never the answer, hint, term, quote or sources. */
export function publicQuestion(row: QuestionRow, index: number, total: number): TutorQuestion {
  return {
    id: row.id,
    quizId: row.quiz_id,
    text: row.question,
    index,
    total,
    kind: row.kind === 'cloze' ? 'cloze' : 'generated',
    objective: objectiveTag(row),
  }
}

/* ---- Failure copy (never the provider's raw error) ---- */

function noticeFor(error: string, label?: string | null): string {
  const name = label || 'The AI provider'
  if (/rate limit|429|too many/i.test(error)) return `${name} is rate limited, so these are fill-the-gap questions from the transcript.`
  if (/no (?:local )?model|not running|no provider|api key|ECONNREFUSED|fetch failed/i.test(error)) {
    return 'AI offline: these fill-the-gap questions were made from the transcript without a model.'
  }
  return `${name} could not write questions, so these are fill-the-gap questions from the transcript.`
}

/* ---- 1. Quiz ---- */

function clampCount(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return TUTOR_DEFAULT_QUESTIONS
  return Math.min(v, TUTOR_MAX_QUESTIONS)
}

interface Prepared {
  question: string
  answer: string
  quote: string
  hint: string
  term: string
  rewatch: number
  sources: string[]
  objective: ObjectiveLine | null
  kind: 'generated' | 'cloze'
}

/** Check model drafts against the window: Study's drop rules, verbatim quote, window-only citations. Pure. */
export function checkDrafts(drafts: DraftQuestion[], chunks: WindowChunk[], candidates: ObjectiveLine[], max: number): Prepared[] {
  const windowText = chunks.map((c) => c.text).join('\n')
  const allowed = new Set(chunks.map((c) => c.id))
  const out: Prepared[] = []
  const seen = new Set<string>()
  for (const d of drafts) {
    if (out.length >= max) break
    if (dropReason({ question: d.question, answer: d.answer, quote: d.quote }, windowText)) continue
    const chunk = chunkForQuote(d.quote, chunks)
    if (!chunk) continue
    const key = normalizeForMatch(d.question)
    if (seen.has(key)) continue
    seen.add(key)
    const cited = validateCitations(extractCitedIds(d.answer), allowed)
    const answer = stripCitations(d.answer)
    const hint = d.hint && !revealsAnswer(d.hint, answer) ? d.hint : ''
    out.push({
      question: d.question,
      answer,
      quote: d.quote.replace(/^["“\s]+|["”\s]+$/g, ''),
      hint,
      term: d.term,
      rewatch: chunk.start,
      sources: cited.length ? cited : [chunk.id],
      objective: matchObjective(d.obj, candidates),
      kind: 'generated',
    })
  }
  return out
}

/** No-model questions: one fill-the-gap per transcript chunk. Pure. */
export function clozeQuestions(chunks: WindowChunk[], max: number): Prepared[] {
  const out: Prepared[] = []
  for (const c of chunks) {
    if (out.length >= max) break
    const cloze = buildCloze(c.text)
    if (!cloze) continue
    out.push({
      question: cloze.question,
      answer: cloze.answer,
      quote: cloze.quote,
      hint: `Listen to what is said around ${formatTimestamp(c.start)}.`,
      term: '',
      rewatch: c.start,
      sources: [c.id],
      objective: null,
      kind: 'cloze',
    })
  }
  return out
}

export async function tutorQuiz(input: TutorQuizInput): Promise<TutorQuiz> {
  const videoKey = String(input?.videoKey ?? '').trim()
  if (!videoKey) throw new Error('Open a video before asking for a quiz.')
  let project = String(input?.project ?? '').trim()
  const windowSec = Number(input?.windowSec) > 0 ? Number(input.windowSec) : DEFAULT_WINDOW_SEC
  let centerSec = Math.max(0, Number(input?.centerSec) || 0)
  let bookmarkId: string | null = null
  if (input?.bookmarkId) {
    const b = getBookmark(String(input.bookmarkId))
    if (!b) throw new Error('That bookmark no longer exists.')
    bookmarkId = b.id
    centerSec = b.positionSec
    project = b.project || project
  }
  if (!project) throw new Error('Open a media project before asking for a quiz.')
  const count = clampCount(input?.count)
  const chunks = windowChunks(project, centerSec, windowSec)
  if (chunks.length === 0) {
    throw new Error(`The transcript has nothing around ${formatTimestamp(centerSec)}, so there is nothing to quiz you on here.`)
  }
  const candidates = candidateObjectives(projectObjectives(project), chunks.map((c) => c.text).join(' '))

  let prepared: Prepared[] = []
  let notice: string | undefined
  let model: string | null = null
  const gen = await structuredGenerate({
    system: TUTOR_SYSTEM,
    prompt: quizPrompt(passagesBlock(chunks), count, candidates),
    maxTokens: 700,
    retryMaxTokens: 1400,
    expect: 'json',
  })
  if (gen.ok) {
    model = gen.model
    prepared = checkDrafts(parseQuizReply(gen.text), chunks, candidates, count)
    if (prepared.length === 0) notice = 'The written questions didn’t pass Vault’s checks, so these are fill-the-gap questions from the transcript.'
  } else {
    notice = noticeFor(gen.error, gen.providerLabel)
  }
  if (prepared.length === 0) prepared = clozeQuestions(chunks, count)
  if (prepared.length === 0) throw new Error('The transcript here is too short to quiz you on. Try another moment.')

  const quizId = newId('tqz')
  const ts = nowIso()
  const database = getDb()
  const insert = database.prepare(
    `INSERT INTO media_tutor_questions (id, quiz_id, video_key, project, center_sec, window_sec, bookmark_id, question, answer, hint,
       key_term, quote, rewatch_sec, source_ids, objective, objective_item_id, kind, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const rows: QuestionRow[] = []
  database.transaction(() => {
    for (const p of prepared) {
      const id = newId('tq')
      insert.run(
        id,
        quizId,
        videoKey,
        project,
        centerSec,
        windowSec,
        bookmarkId,
        p.question,
        p.answer,
        p.hint,
        p.term,
        p.quote,
        p.rewatch,
        JSON.stringify(p.sources),
        p.objective ? `${p.objective.code} ${p.objective.text}`.slice(0, 200) : null,
        p.objective?.itemId ?? null,
        p.kind,
        model,
        ts,
      )
      rows.push(loadRow(id))
    }
  })()
  return {
    quizId,
    questions: rows.map((r, i) => publicQuestion(r, i, rows.length)),
    centerSec,
    windowSec,
    windowStartSec: Math.max(0, centerSec - windowSec),
    windowEndSec: centerSec + windowSec,
    bookmarkId,
    notice,
    examDate: getProjectSettings(project).examDate,
  }
}

/* ---- 2. Hints ---- */

export function tutorHint(input: TutorHintInput): TutorHint {
  const row = loadRow(input?.questionId)
  if (row.revealed_at) throw new Error('This question has already been answered.')
  const level = Math.min(3, Math.max(1, Math.floor(Number(input?.level) || 1))) as 1 | 2 | 3
  getDb().prepare('UPDATE media_tutor_questions SET hints_used = MAX(hints_used, ?) WHERE id = ?').run(level, row.id)
  if (level === 1) {
    return { level, text: row.hint || 'Think about what the speaker is explaining at this point.', seekSec: null, last: false }
  }
  if (level === 2) return { level, text: termHint(row.key_term, row.answer), seekSec: null, last: false }
  return { level, text: `Rewatch from ${formatTimestamp(row.rewatch_sec)} — the answer is said there.`, seekSec: row.rewatch_sec, last: true }
}

/* ---- 3. Reveal ---- */

const GRADES: readonly StudySelfGrade[] = ['missed', 'partial', 'got']

/** Word-overlap grade for when no model is available. Pure. */
export function overlapGrade(answer: string, attempt: string): StudySelfGrade {
  const a = normalizeForMatch(stripCitations(answer))
  const t = normalizeForMatch(attempt)
  if (!t) return 'missed'
  if (a && t.includes(a.replace(/[.!?]+$/, ''))) return 'got'
  const keys = [...new Set(contentWords(a))]
  if (keys.length === 0) return 'missed'
  const words = new Set(contentWords(t))
  const share = keys.filter((w) => words.has(w)).length / keys.length
  return share >= 0.8 ? 'got' : share >= 0.34 ? 'partial' : 'missed'
}

/** Read a grading reply. Pure. */
export function parseGrade(text: string): { grade: StudySelfGrade; missed: string } | null {
  const v = parseJson(text)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const raw = str(o.grade).toLowerCase().replace(/[\s_-]+/g, '')
  const grade = raw === 'gotit' ? 'got' : raw === 'partly' || raw === 'partiallycorrect' ? 'partial' : (raw as StudySelfGrade)
  if (!GRADES.includes(grade)) return null
  return { grade, missed: str(o.missed ?? o.note).slice(0, 300) }
}

function normalizeConfidence(v: unknown): TutorConfidence {
  const c = String(v ?? '').toLowerCase()
  if (!(TUTOR_CONFIDENCES as readonly string[]).includes(c)) {
    throw new Error('Pick how sure you are (Low, Medium or High) before the reveal.')
  }
  return c as TutorConfidence
}

/** The exam reminder for a reveal, when the project has an exam date. Pure. */
export function examNoteFor(examDate: string | null, offerPractice: boolean, now = new Date()): string | null {
  const days = calendarDaysUntil(examDate, now)
  if (days == null || days < 0) return null
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
  return offerPractice
    ? `Your exam is ${when} (${examDate}). Make this a Study card so it comes back before then.`
    : `Your exam is ${when} (${examDate}).`
}

export async function tutorReveal(input: TutorRevealInput, now = new Date()): Promise<TutorReveal> {
  const row = loadRow(input?.questionId)
  const attempt = String(input?.attempt ?? '').trim().slice(0, TUTOR_ATTEMPT_MAX)
  const dontKnow = !!input?.dontKnow
  const justShown = !!input?.justShowMe
  // The guard: no answer without a try (or an explicit "I don't know" / "Just show me")
  // and a confidence pick first.
  if (!attempt && !dontKnow && !justShown) throw new Error('Type an answer or press “I don’t know” first.')
  const confidence = normalizeConfidence(input?.confidence)

  let grade: StudySelfGrade
  let feedback = ''
  let notice: string | undefined
  if (dontKnow || justShown) {
    grade = 'missed'
    feedback = justShown ? 'You asked to see the answer — try it again from memory later.' : 'No problem: a try plus feedback still helps you remember it.'
  } else {
    const quick = overlapGrade(row.answer, attempt)
    if (quick === 'got') {
      grade = 'got'
    } else {
      const gen = await structuredGenerate({
        system: TUTOR_SYSTEM,
        prompt: gradePrompt(row.answer, row.quote, attempt),
        maxTokens: 200,
        retryMaxTokens: 400,
        expect: 'json',
      })
      const parsed = gen.ok ? parseGrade(gen.text) : null
      if (parsed) {
        grade = parsed.grade
        feedback = parsed.missed
      } else {
        grade = quick
        if (!gen.ok) notice = 'Graded by matching words (no model available).'
      }
    }
    if (!feedback) {
      feedback =
        grade === 'got' ? 'That matches the transcript.' : grade === 'partial' ? 'Part of it — compare with the answer below.' : 'Not this time — the answer is below.'
    }
  }
  const offerPractice = grade === 'missed' || (confidence === 'high' && grade !== 'got')
  const sources = (JSON.parse(row.source_ids || '[]') as string[]).filter((id) => typeof id === 'string')
  getDb()
    .prepare(
      `UPDATE media_tutor_questions SET attempt = ?, dont_know = ?, just_shown = ?, confidence = ?, grade = ?, feedback = ?, revealed_at = ? WHERE id = ?`,
    )
    .run(attempt || null, dontKnow ? 1 : 0, justShown ? 1 : 0, confidence, grade, feedback, nowIso(), row.id)
  return {
    questionId: row.id,
    grade,
    answer: row.answer,
    feedback,
    quote: row.quote,
    citations: citationsFromIds(sources),
    rewatchSec: row.rewatch_sec,
    askWhy: grade !== 'missed',
    offerPractice,
    examNote: examNoteFor(getProjectSettings(row.project).examDate, offerPractice, now),
    notice,
  }
}

/* ---- 4. Why ---- */

/** Read a why-check reply. Pure. */
export function parseWhy(text: string): { verdict: TutorWhyResult['verdict']; note: string } | null {
  const v = parseJson(text)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const verdict = str(o.verdict).toLowerCase().replace(/[^a-z]/g, '')
  const map: Record<string, TutorWhyResult['verdict']> = { supported: 'supported', partly: 'partly', partial: 'partly', unsupported: 'unsupported', notsupported: 'unsupported' }
  if (!map[verdict]) return null
  return { verdict: map[verdict], note: str(o.note).slice(0, 300) }
}

export async function tutorWhy(input: TutorWhyInput): Promise<TutorWhyResult> {
  const row = loadRow(input?.questionId)
  if (!row.revealed_at) throw new Error('Answer the question first.')
  const why = String(input?.why ?? '').trim().slice(0, 400)
  if (!why) throw new Error('Write one sentence about why.')
  const sources = (JSON.parse(row.source_ids || '[]') as string[]).filter((id) => typeof id === 'string')
  const passage = sources
    .map((id) => getItem(id))
    .filter((it): it is Item => !!it)
    .map((it) => stripTranscriptMetadata(it.body))
    .join(' ')
    .slice(0, 1200) || row.quote
  const gen = await structuredGenerate({ system: TUTOR_SYSTEM, prompt: whyPrompt(passage, why), maxTokens: 160, retryMaxTokens: 320, expect: 'json' })
  let result = gen.ok ? parseWhy(gen.text) : null
  if (!result) {
    const share = overlapGrade(passage, why)
    const words = new Set(contentWords(passage))
    const mine = contentWords(why)
    const hit = mine.length ? mine.filter((w) => words.has(w)).length / mine.length : 0
    const verdict: TutorWhyResult['verdict'] = hit >= 0.6 ? 'supported' : hit >= 0.3 || share !== 'missed' ? 'partly' : 'unsupported'
    result = {
      verdict,
      note:
        verdict === 'supported'
          ? 'Your reason uses what the speaker says here.'
          : verdict === 'partly'
            ? 'Some of that is in the transcript; check the cited moment for the rest.'
            : 'The transcript here doesn’t say that — rewatch the cited moment.',
    }
  }
  getDb().prepare('UPDATE media_tutor_questions SET why = ?, why_verdict = ? WHERE id = ?').run(why, result.verdict, row.id)
  return { ...result, citations: citationsFromIds(sources) }
}

/* ---- 5. Practice from a miss ---- */

function bookmarkLabel(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim()
  return (`Tutor: ${q}`).slice(0, 120)
}

export function tutorPractice(input: TutorPracticeInput): TutorPracticeResult {
  const row = loadRow(input?.questionId)
  if (!row.revealed_at) throw new Error('Answer the question first.')
  let bookmark = row.practice_bookmark_id ? getBookmark(row.practice_bookmark_id) : null
  let bookmarkCreated = false
  if (!bookmark) {
    // Reuse a Confused bookmark already at this moment rather than adding a second one.
    bookmark =
      listBookmarks(row.video_key).find((b) => b.tag === 'Confused' && Math.abs(b.positionSec - row.rewatch_sec) < 1) ?? null
    if (!bookmark) {
      bookmark = addBookmark({
        videoKey: row.video_key,
        project: row.project,
        videoTitle: input?.videoTitle,
        sourceType: input?.sourceType,
        positionSec: row.rewatch_sec,
        label: bookmarkLabel(row.question),
        tag: 'Confused',
      })
      bookmarkCreated = true
    }
    getDb().prepare('UPDATE media_tutor_questions SET practice_bookmark_id = ? WHERE id = ?').run(bookmark.id, row.id)
  }
  let cardId: string | null = bookmark.cardId
  let cardCreated = false
  if (input?.makeCard) {
    const made = makeBookmarkCards({ videoKey: row.video_key, project: row.project, ids: [bookmark.id] })
    const link = made.cards.find((c) => c.bookmarkId === bookmark!.id)
    cardId = link?.cardId ?? null
    cardCreated = !!link?.created
    bookmark = getBookmark(bookmark.id) ?? bookmark
  }
  return { bookmark, bookmarkCreated, cardId, cardCreated }
}

/* ---- Review list (#365) ---- */

/** Missed answers and confident-but-wrong answers on a video, oldest first. */
export function listTutorMisses(videoKey: string): TutorMiss[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM media_tutor_questions
       WHERE video_key = ? AND revealed_at IS NOT NULL AND (grade = 'missed' OR (confidence = 'high' AND grade != 'got'))
       ORDER BY rewatch_sec, created_at`,
    )
    .all(String(videoKey ?? '')) as QuestionRow[]
  return rows.map((r) => ({
    questionId: r.id,
    videoKey: r.video_key,
    project: r.project,
    question: r.question,
    rewatchSec: r.rewatch_sec,
    grade: (r.grade as StudySelfGrade) ?? 'missed',
    confidence: (r.confidence as TutorConfidence | null) ?? null,
    confidentWrong: r.confidence === 'high' && r.grade !== 'got',
    createdAt: r.created_at,
  }))
}

