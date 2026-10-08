/**
 * The Study session loop (#263): one free-recall question per card, an
 * attempt before the answer is revealed, confidence, a Missed / Partly /
 * Got it grade that feeds the exam-aware scheduler (#264), and a summary.
 *
 * Questions are written just in time, one card (one section) per model call,
 * and cached on the card with the hash of the section they came from, so a
 * later session reuses them and an edit (#286) invalidates them. A generated
 * card is checked before it is stored (`dropReason`): the quote must be
 * verbatim from the note, the question must paraphrase, and it must not give
 * the answer away, point at something unseen, ask for an open list or be
 * multiple choice. Its citations go through `validateCitations` with only the
 * card's own note allowed. When no model is available, the call fails or the
 * card is dropped, the session falls back to a fill-the-gap (cloze) prompt
 * built from the section, or an "explain the main idea" prompt.
 *
 * Learning-science basis (docs/local-knowledge-vault-study-effects-on-learning.md
 * §2, §5): retrieval practice and free recall (Roediger & Karpicke 2006;
 * Rowland 2014), attempt before feedback (Kornell, Hays & Bjork 2009),
 * feedback (Butler & Roediger 2008), confidence calibration (Bjork, Dunlosky &
 * Kornell 2013) and paraphrased questions for transfer (Pan & Rickard 2018).
 * Every Vault-specific effect is a hypothesis (#218).
 */
import { getDb, newId, nowIso } from './db'
import { llmGenerate } from './llm'
import { isRateLimited, retryAfterMs, formatWait } from './providers/http'
import { buildGroundedMessages, citationsFromIds, extractCitedIds, validateCitations } from './generate'
import { hashText } from './text-hash'
import { VISUAL_RE } from './practice-test'
import { getCardState, getStudyStats, listDueReviews, rateReview, reviewGradeToSelfGrade, toReviewGrade } from './review'
import { calibrationSummary, clampConfidence, recordStudyAttempt } from './study'
import type {
  SearchHit,
  StudyAnswerInput,
  StudyAnswerResult,
  StudyAttempt,
  StudyCardOrigin,
  StudyCardQuestion,
  StudyQuestionKind,
  StudySelfGrade,
  StudySessionCardResult,
  StudySessionReport,
  StudySessionStart,
  StudySessionStartInput,
} from './types'

/** Output budget for one card. Reasoning models spend part of it thinking (#275). */
export const CARD_QUESTION_MAX_TOKENS = 1500
/** Budget for the single retry after an empty reply. */
export const CARD_QUESTION_RETRY_MAX_TOKENS = 3000
/** Default and maximum cards in one session. */
export const SESSION_DEFAULT_CARDS = 20
export const SESSION_MAX_CARDS = 100
/** A first try at or above this confidence that wasn't Got it is "confident but missed". */
export const CONFIDENT = 70

export const CARD_QUESTION_TASK = `TASK (study-card generation, not a chat answer): write 1 free-recall study question about the passage above.
Rules:
- Free recall: the student types a short answer from memory. No yes/no, no multiple choice, no "which of the following".
- Paraphrase. Do not copy a run of 6 or more words from the passage into the question.
- The question must have one clear answer that is stated in the passage, and must not contain that answer.
- Make the question self-contained. Never refer to "the passage", "the text", "this note", "mentioned" or "listed", or to anything not shown such as "this process", "the graph", "the figure" or "the map".
- Do not ask for "one example" or for a list of items.
- Do not ask about page numbers, figure numbers, the document itself, copyright, exam instructions, website menus, cookies or ads.
- If the passage has no study-worthy facts (boilerplate, instructions, navigation), return [].
- The answer must be short (a few words or one sentence) and end with the passage's [id] citation.
- "quote" must be copied exactly from the passage: the sentence or line that supports the answer.
Return ONLY a JSON array: [{"question": "...", "answer": "... [id]", "quote": "..."}]. Return [] if nothing is study-worthy.`

export interface GeneratedCard {
  question: string
  answer: string
  quote: string
}

/**
 * The first card in a model reply: a JSON array of objects (or one object),
 * tolerating code fences and prose around it. `[]` → `null` card with
 * `empty: true`; anything unreadable → `null`.
 */
export function parseCardJson(text: string): { card: GeneratedCard | null; empty: boolean } {
  const raw = (text ?? '').replace(/```(?:json)?/gi, '').trim()
  if (!raw) return { card: null, empty: false }
  const a = raw.indexOf('[')
  const b = raw.lastIndexOf(']')
  const o = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  let parsed: unknown = null
  try {
    if (a >= 0 && b > a && (o < 0 || a < o)) parsed = JSON.parse(raw.slice(a, b + 1))
    else if (o >= 0 && e > o) parsed = JSON.parse(raw.slice(o, e + 1))
  } catch {
    return { card: null, empty: false }
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null
  if (!list) return { card: null, empty: false }
  if (list.length === 0) return { card: null, empty: true }
  const first = list.find((x) => x && typeof x === 'object') as Record<string, unknown> | undefined
  if (!first) return { card: null, empty: false }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return { card: { question: str(first.question), answer: str(first.answer), quote: str(first.quote) }, empty: false }
}

const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in into is it its ' +
    'may more most no not of on or so such than that the their them then there these they this to too was ' +
    'we were what when where which while who whom why will with would you your about after also because ' +
    'before between both called during each every many much must only other over same should some through ' +
    'under up used uses using very'
  ).split(' '),
)

/** Lowercase, collapse whitespace and quotes/dashes, drop Markdown emphasis: for verbatim checks. */
export function normalizeForMatch(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

function contentWordsOf(text: string): string[] {
  return words(text).filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/** True when `question` repeats a run of `n` or more consecutive words from `source`. */
export function copiesRun(question: string, source: string, n = 6): boolean {
  const q = words(question)
  const s = words(source)
  if (q.length < n || s.length < n) return false
  const grams = new Set<string>()
  for (let i = 0; i + n <= s.length; i++) grams.add(s.slice(i, i + n).join(' '))
  for (let i = 0; i + n <= q.length; i++) if (grams.has(q.slice(i, i + n).join(' '))) return true
  return false
}

const META_WORDING =
  /\b(?:the|this|that)\s+(?:passage|text|note|notes|article|excerpt|document|reading|page|section|author)\b|\bmentioned\b|\blisted\b|\baccording to\b/i
const OPEN_LIST =
  /^(?:name|list|give|identify|state|mention|provide|describe)\s+(?:one|two|three|four|five|an?|any|some|several)\b|\b(?:one|an|any)\s+example\b|\bname (?:one|two|three)\b/i
const UNSEEN =
  /\b(?:this|that|these|those|the above|the following)\s+(?:process|graph|map|figure|diagram|table|image|picture|chart|step|steps|example|equation|data)\b|\bthe\s+(?:graph|map|figure|diagram|chart|image|picture|illustration)\b|\b(?:shown|pictured)\s+(?:above|below)\b/i
const MULTIPLE_CHOICE =
  /\bwhich of the following\b|\btrue or false\b|(?:^|\s)\(?[a-d]\)\s|\boptions?\s*[:(]|\bchoose (?:one|the)\b/i

/**
 * Why a generated card must be dropped, or null to keep it (#263 drop rules).
 * Pure. Dropped cards are not retried in v1; the session falls back to a
 * cloze or "explain" prompt for that section.
 */
export function dropReason(card: GeneratedCard, source: string): string | null {
  const question = (card.question ?? '').trim()
  const answer = stripCitations(card.answer ?? '').trim()
  const quote = (card.quote ?? '').trim()
  if (!question || !answer) return 'empty question or answer'
  if (!quote) return 'no supporting quote'
  const q = normalizeForMatch(quote).replace(/^["'\s]+|["'.;:,\s]+$/g, '')
  if (!normalizeForMatch(source).includes(q)) return 'the quote is not verbatim in the note'
  if (MULTIPLE_CHOICE.test(question)) return 'multiple choice'
  if (META_WORDING.test(question)) return 'refers to the passage instead of the idea'
  if (OPEN_LIST.test(question)) return 'asks for an open list or one example'
  if (UNSEEN.test(question)) return 'refers to something that is not shown'
  if (copiesRun(question, source)) return 'copies a run of 6+ words from the note'
  const answerWords = contentWordsOf(answer)
  const questionWords = new Set(contentWordsOf(question))
  if (answerWords.length > 0 && answerWords.every((w) => questionWords.has(w))) return 'the answer is already in the question'
  return null
}

/** Remove `[itm_…]` markers (the citation is stored separately). */
export function stripCitations(text: string): string {
  return (text ?? '')
    .replace(/\[(?:itm_[A-Za-z0-9]+(?:\s*,\s*)?)+\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/* ---- Offline fallbacks: cloze and "explain" ---- */

const HEADER_LINE = /^(?:source|page|pages|url|fetched|imported|author)s?:/i

function sentencesOf(source: string): string[] {
  const lines = (source ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !HEADER_LINE.test(l) && !/^\|?\s*:?-{2,}/.test(l))
    .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*+•]\s+/, '').replace(/[*`|]/g, ' ').replace(/\s+/g, ' ').trim())
  const out: string[] = []
  for (const line of lines) {
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9("'])/)) {
      const t = s.trim()
      if (t) out.push(t)
    }
  }
  return out
}

/** Words people write in capitals for emphasis or as site chrome; not acronyms worth a gap. */
const SHOUTED_WORDS = new Set(
  'ALL ALWAYS AND BUT DO DONT FIRST FREE IMPORTANT LAST MUST NEVER NEW NEXT NO NOT NOTE NOW ONE ONLY OR ORDER STOP THE TIP TIPS WARNING YES'.split(' '),
)

function termScore(token: string, index: number): number {
  const t = token.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, '')
  if (t.length < 2) return 0
  const lower = t.toLowerCase()
  if (STOPWORDS.has(lower) || SHOUTED_WORDS.has(t)) return 0
  if (/^[A-Z][A-Z0-9]{1,7}s?$/.test(t)) return 4 // acronym: ATP, DNA, NADPH
  if (/^\d+(?:[.,]\d+)?%?$/.test(t) && t.replace(/\D/g, '').length >= 2) return 3 // 443, 2.5, 10%
  if (index > 0 && /^[A-Z][a-z]{2,}/.test(t)) return 2.5 // a proper noun mid-sentence
  if (/^[a-z][a-z-]{7,}$/.test(t)) return 1 + Math.min(t.length, 16) / 16 // a long technical word
  return 0
}

/**
 * A fill-the-gap prompt from a section, with no model (#263 fallback): pick
 * the sentence with the strongest key term (an acronym, a number, a proper
 * noun or a long technical word) and blank that term. Pure; null when no
 * sentence is a good gap.
 */
export function buildCloze(source: string): { question: string; answer: string; quote: string } | null {
  let best: { score: number; sentence: string; term: string } | null = null
  for (const sentence of sentencesOf(source)) {
    const tokens = sentence.split(/\s+/)
    if (tokens.length < 6 || tokens.length > 45) continue
    tokens.forEach((tok, i) => {
      const score = termScore(tok, i)
      if (score > 0 && (!best || score > best.score)) {
        best = { score, sentence, term: tok.replace(/^[("'[]+|[)"'\],.;:!?]+$/g, '') }
      }
    })
  }
  if (!best) return null
  const { sentence, term } = best as { sentence: string; term: string }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blanked = sentence.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), '_____')
  if (!blanked.includes('_____')) return null
  return { question: `Fill the gap: ${blanked}`, answer: term, quote: sentence }
}

/** The last-resort prompt: explain the section's main idea (the section is the answer). */
export function explainPrompt(title: string, chunkIndex: number | null, chunkCount: number): string {
  const part = chunkIndex != null && chunkCount > 1 ? ` (part ${chunkIndex + 1} of ${chunkCount})` : ''
  return `From memory, explain the main idea of your note “${title}”${part}.`
}

/* ---- Loading a card and caching its question ---- */

interface CardRow {
  id: string
  item_id: string
  chunk_index: number | null
  origin: string
  question: string | null
  answer: string | null
  quote: string | null
  q_kind: string | null
  q_source_hash: string | null
  q_model: string | null
  q_note: string | null
  title: string
  body: string
  project: string | null
  para: string
  kind: string
  chunk_body: string | null
  chunk_count: number
  explanation: string | null
  source_test: string | null
  source_test_date: string | null
  link_item_id: string | null
  link_title: string | null
  link_status: string | null
}

function loadCard(cardId: string): CardRow | null {
  const row = getDb()
    .prepare(
      `SELECT c.id, c.item_id, c.chunk_index, c.origin, c.question, c.answer, c.quote,
              c.q_kind, c.q_source_hash, c.q_model, c.q_note,
              c.explanation, c.source_test, c.source_test_date, c.link_item_id,
              li.title AS link_title, li.status AS link_status,
              i.title, i.body, i.project, i.para, i.kind,
              nc.body AS chunk_body,
              (SELECT COUNT(*) FROM note_chunks n2 WHERE n2.item_id = i.id) AS chunk_count
       FROM study_cards c
       JOIN items i ON i.id = c.item_id
       LEFT JOIN items li ON li.id = c.link_item_id AND li.status != 'trashed'
       LEFT JOIN note_chunks nc ON nc.item_id = c.item_id AND nc.chunk_index = c.chunk_index
       WHERE c.id = ?`,
    )
    .get(cardId) as CardRow | undefined
  return row ?? null
}

function sectionOf(row: CardRow): string {
  return row.chunk_index == null ? row.body : (row.chunk_body ?? row.body)
}

function saveQuestion(
  cardId: string,
  q: { question: string; answer: string | null; quote: string | null; kind: StudyQuestionKind; sourceHash: string; model?: string | null; note?: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE study_cards SET question = ?, answer = ?, quote = ?, q_kind = ?, q_source_hash = ?, q_model = ?,
         q_at = ?, q_note = ?, updated_at = ? WHERE id = ?`,
    )
    .run(q.question, q.answer, q.quote, q.kind, q.sourceHash, q.model ?? null, nowIso(), q.note ?? null, nowIso(), cardId)
}

function baseQuestion(row: CardRow): Omit<StudyCardQuestion, 'kind' | 'question' | 'answer' | 'quote'> {
  if (row.origin === 'practice-test') {
    // The test is the answer key; the learner's note is cited only once it is
    // confirmed in their own words (#217, owner default 2).
    const linked = row.link_item_id && row.link_title
      ? { id: row.link_item_id, title: row.link_title, confirmed: row.link_status !== 'ai-draft' }
      : null
    return {
      cardId: row.id,
      itemId: row.item_id,
      title: row.title,
      project: row.project,
      origin: 'practice-test',
      sectionText: row.explanation ?? '',
      chunkIndex: null,
      chunkCount: 0,
      citations: linked?.confirmed ? [{ id: linked.id, title: linked.title, project: row.project }] : [],
      explanation: row.explanation,
      sourceTest: { itemId: row.item_id, name: row.source_test ?? row.title, date: row.source_test_date },
      linkedNote: linked,
      openSource: VISUAL_RE.test(row.question ?? ''),
    }
  }
  return {
    cardId: row.id,
    itemId: row.item_id,
    title: row.title,
    project: row.project,
    origin: row.origin as StudyCardOrigin,
    sectionText: sectionOf(row),
    chunkIndex: row.chunk_index == null ? null : Number(row.chunk_index),
    chunkCount: Number(row.chunk_count ?? 0),
    citations: citationsFromIds([row.item_id]),
  }
}

/** A fallback prompt (cloze, else explain) for a section. */
function fallbackFor(row: CardRow): { kind: StudyQuestionKind; question: string; answer: string | null; quote: string | null } {
  const cloze = buildCloze(sectionOf(row))
  if (cloze) return { kind: 'cloze', ...cloze }
  return {
    kind: 'explain',
    question: explainPrompt(row.title, row.chunk_index == null ? null : Number(row.chunk_index), Number(row.chunk_count ?? 0)),
    answer: null,
    quote: null,
  }
}

/** Plain-words reason for a failed model call: never the provider's own text (#274). */
function failureNotice(error: string, providerLabel?: string | null): { notice: string; offline: boolean; rateLimited: boolean } {
  const name = providerLabel || 'the AI provider'
  if (isRateLimited(error)) {
    const daily = /daily|per day|tokens per day|TPD|24 ?hours?/i.test(error)
    const wait = retryAfterMs(error)
    return {
      notice: daily
        ? `Daily limit reached for ${name}, so this is a fill-the-gap prompt from your note. Questions will be written again later.`
        : `Rate limited by ${name}${wait ? ` (try again in ${formatWait(wait)})` : ''}, so this is a fill-the-gap prompt from your note.`,
      offline: false,
      rateLimited: true,
    }
  }
  if (/no (?:local )?model|not running|no provider|api key|ECONNREFUSED|fetch failed/i.test(error)) {
    return {
      notice: 'AI offline: no model is available, so this prompt was made from your note without one. Start a local model or add a provider to get written questions.',
      offline: true,
      rateLimited: false,
    }
  }
  return {
    notice: `${name === 'the AI provider' ? 'The AI call' : `The ${name} call`} failed, so this prompt was made from your note without a model.`,
    offline: true,
    rateLimited: false,
  }
}

/**
 * The prompt and answer key for one card (#263). Cached questions are reused
 * while the section's text is unchanged; otherwise one model call writes a
 * question for this section only. Practice-test (#265) and pair (#273) cards
 * carry their own question.
 */
export async function getCardQuestion(cardId: string): Promise<StudyCardQuestion> {
  const row = loadCard(String(cardId ?? ''))
  if (!row) throw new Error('This card no longer exists.')
  const base = baseQuestion(row)
  const section = sectionOf(row)
  const sourceHash = hashText(section)

  // Cards that carry their own question (practice test, pairs) or a cached one.
  if (row.question && (row.origin !== 'note' || row.q_source_hash === sourceHash)) {
    const kind = (row.q_kind as StudyQuestionKind | null) ?? (row.origin === 'practice-test' ? 'test' : row.origin === 'reverse' ? 'pair' : 'generated')
    return {
      ...base,
      kind,
      question: row.question,
      answer: row.answer,
      quote: row.quote,
      model: row.q_model,
      notice: row.q_note && (kind === 'cloze' || kind === 'explain') ? `The written question didn’t pass Vault’s checks (${row.q_note}), so this prompt was made from your note.` : undefined,
    }
  }
  if (row.origin !== 'note') {
    const fb = fallbackFor(row)
    return { ...base, ...fb }
  }

  const hit: SearchHit = {
    id: row.item_id,
    title: row.title,
    snippet: '',
    score: 0,
    para: row.para as SearchHit['para'],
    kind: row.kind,
    project: row.project,
    passage: section,
  }
  const messages = buildGroundedMessages(CARD_QUESTION_TASK, [hit])
  let gen = await llmGenerate({ ...messages, maxTokens: CARD_QUESTION_MAX_TOKENS })
  if (gen.ok && !(gen.text ?? '').trim()) {
    // A reasoning model can spend its whole budget thinking and return nothing
    // (about 1 call in 10 on gpt-oss-20b, #275). One retry with a bigger budget.
    gen = await llmGenerate({ ...messages, maxTokens: CARD_QUESTION_RETRY_MAX_TOKENS })
  }
  if (!gen.ok) {
    // Transient: not cached, so the next session tries the model again.
    const why = failureNotice(gen.error, gen.providerLabel)
    return { ...base, ...fallbackFor(row), ...why }
  }
  const text = (gen.text ?? '').trim()
  if (!text) {
    // Empty output (a reasoning model used up its budget, #275): transient too.
    return {
      ...base,
      ...fallbackFor(row),
      notice: `${gen.providerLabel || 'The model'} returned no question this time, so this prompt was made from your note.`,
      offline: false,
    }
  }
  const parsed = parseCardJson(text)
  const reason = parsed.empty
    ? 'nothing study-worthy found'
    : !parsed.card
      ? 'the reply was not a question card'
      : dropReason(parsed.card, section)
  if (reason || !parsed.card) {
    const fb = fallbackFor(row)
    saveQuestion(row.id, { ...fb, sourceHash, model: gen.model, note: reason ?? 'unreadable reply' })
    return {
      ...base,
      ...fb,
      model: gen.model,
      notice: `The written question didn’t pass Vault’s checks (${reason}), so this prompt was made from your note.`,
    }
  }
  // Grounding contract: only the card's own note may be cited.
  const cited = validateCitations(extractCitedIds(parsed.card.answer), new Set([row.item_id]))
  const answer = stripCitations(parsed.card.answer)
  saveQuestion(row.id, {
    question: parsed.card.question,
    answer,
    quote: parsed.card.quote,
    kind: 'generated',
    sourceHash,
    model: gen.model,
  })
  return {
    ...base,
    kind: 'generated',
    question: parsed.card.question,
    answer,
    quote: parsed.card.quote,
    citations: citationsFromIds(cited.length ? cited : [row.item_id]),
    model: gen.model,
  }
}

/* ---- Session ---- */

/** Start a session: a fresh session id and the queue for the scope (#264 order). */
export function startStudySession(input: StudySessionStartInput = {}): StudySessionStart {
  const limit = Math.min(Math.max(Math.floor(Number(input?.limit ?? SESSION_DEFAULT_CARDS)) || SESSION_DEFAULT_CARDS, 1), SESSION_MAX_CARDS)
  const project = input?.project?.trim() || undefined
  return { sessionId: newId('ses'), cards: listDueReviews(undefined, limit, project) }
}

/**
 * Record one answer: grade the card (SM-2, exam-aware) and store the attempt
 * with its confidence, session, card and note so the summary and calibration
 * can be computed.
 */
export function answerStudyCard(input: StudyAnswerInput): StudyAnswerResult {
  const cardId = String(input?.cardId ?? '')
  const card = getDb().prepare('SELECT id, item_id FROM study_cards WHERE id = ?').get(cardId) as
    | { id: string; item_id: string }
    | undefined
  if (!card) throw new Error('This card no longer exists.')
  const grade = toReviewGrade(String(input.grade))
  const state = rateReview(cardId, grade)
  const due = getDb().prepare('SELECT due_at FROM card_schedule WHERE card_id = ?').get(cardId) as { due_at: string }
  recordStudyAttempt({
    question: input.question ?? '',
    attempt: input.dontKnow ? 'I don’t know' : (input.attempt ?? ''),
    confidence: input.dontKnow ? 0 : input.confidence,
    selfGrade: reviewGradeToSelfGrade(grade) ?? 'missed',
    citedIds: [card.item_id],
    answer: input.answer ?? null,
    cardId,
    itemId: card.item_id,
    sessionId: String(input.sessionId ?? ''),
    grade,
  })
  return { state: getCardState(cardId) ?? state, dueAt: String(due.due_at) }
}

/** Last moment of tomorrow, local time. */
function endOfTomorrow(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0, -1)
}

/**
 * The end-of-session summary (#263): grades of each card's first try,
 * confidence calibration with confident-but-missed cards called out, notes to
 * revisit, and what's next in the scope.
 */
export function studySessionSummary(sessionId: string, project?: string, now: Date = new Date()): StudySessionReport {
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT a.*, i.title AS title
       FROM study_attempts a LEFT JOIN items i ON i.id = a.item_id
       WHERE a.session_id = ? ORDER BY a.created_at, a.rowid`,
    )
    .all(String(sessionId ?? '')) as Array<Record<string, unknown>>
  const first = new Map<string, Record<string, unknown>>()
  const tries = new Map<string, number>()
  for (const r of rows) {
    const id = String(r.card_id ?? r.id)
    tries.set(id, (tries.get(id) ?? 0) + 1)
    if (!first.has(id)) first.set(id, r)
  }
  const firsts = [...first.values()]
  const asAttempt = (r: Record<string, unknown>): StudyAttempt => ({
    id: String(r.id),
    question: String(r.question ?? ''),
    attempt: String(r.attempt ?? ''),
    confidence: clampConfidence(r.confidence),
    self_grade: String(r.self_grade) as StudySelfGrade,
    self_explanation: null,
    cited_ids: String(r.cited_ids ?? ''),
    answer: r.answer == null ? null : String(r.answer),
    created_at: String(r.created_at),
  })
  const result = (r: Record<string, unknown>): StudySessionCardResult => ({
    cardId: String(r.card_id ?? ''),
    itemId: String(r.item_id ?? ''),
    title: String(r.title ?? 'Deleted note'),
    question: String(r.question ?? ''),
    confidence: clampConfidence(r.confidence),
    grade: String(r.self_grade) as StudySelfGrade,
  })
  let got = 0
  let partial = 0
  let missed = 0
  for (const r of firsts) {
    if (r.self_grade === 'got') got++
    else if (r.self_grade === 'partial') partial++
    else missed++
  }
  const revisit = new Map<string, string>()
  for (const r of firsts) if (r.self_grade !== 'got' && r.item_id) revisit.set(String(r.item_id), String(r.title ?? ''))

  const p = project?.trim()
  const scope = p ? ' AND i.project = @project' : ''
  const live = `c.status = 'active' AND i.status NOT IN ('trashed','archived')`
  const next = database
    .prepare(
      `SELECT MIN(cs.due_at) AS next FROM card_schedule cs JOIN study_cards c ON c.id = cs.card_id
       JOIN items i ON i.id = c.item_id WHERE ${live} AND cs.due_at > @now${scope}`,
    )
    .get({ now: now.toISOString(), project: p ?? '' }) as { next: string | null }
  // Reviewed cards due by the end of tomorrow, plus the new cards the daily
  // budget will actually bring in today and tomorrow (#264): a freshly enrolled
  // 140-card list is not "140 cards due by tomorrow".
  const soon = database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN cs.reps = 0 AND cs.last_reviewed_at IS NULL THEN 0 ELSE 1 END), 0) AS reviewed,
              COALESCE(SUM(CASE WHEN cs.reps = 0 AND cs.last_reviewed_at IS NULL THEN 1 ELSE 0 END), 0) AS fresh
       FROM card_schedule cs JOIN study_cards c ON c.id = cs.card_id
       JOIN items i ON i.id = c.item_id WHERE ${live} AND cs.due_at <= @until${scope}`,
    )
    .get({ until: endOfTomorrow(now).toISOString(), project: p ?? '' }) as { reviewed: number; fresh: number }
  const budget = getStudyStats(p || undefined, now)
  const freshSoon = Math.min(Number(soon?.fresh ?? 0), budget.newLeftToday + budget.newPerDay)

  const cards = firsts.length
  return {
    sessionId: String(sessionId ?? ''),
    cards,
    got,
    partial,
    missed,
    retried: [...tries.values()].filter((n) => n > 1).length,
    accuracy: cards === 0 ? 0 : (got + partial * 0.5) / cards,
    calibration: calibrationSummary(firsts.map(asAttempt)),
    confidentMisses: firsts
      .filter((r) => r.self_grade !== 'got' && clampConfidence(r.confidence) >= CONFIDENT)
      .map(result),
    revisit: [...revisit.entries()].map(([itemId, title]) => ({ itemId, title })),
    nextDueAt: next?.next ? String(next.next) : null,
    dueByTomorrow: Number(soon?.reviewed ?? 0) + freshSoon,
  }
}
