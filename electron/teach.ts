/**
 * Teach mode (#418): Vault tutors you through notes about something new.
 *
 *   teachPlan    the notes → a short ordered list of concepts (explain, example,
 *                check question, expected answer), each grounded in one note
 *   teachCheck   grade the learner's answer to a check: hint first, then what
 *                was right, the misconception, a re-explanation and a follow-up
 *   teachMissed  the notes behind missed concepts → Study cards due now
 *
 * Grounding follows the app's rules (generate.ts): only the notes' passages,
 * citations validated against those notes, no outside facts. Examples come from
 * the notes; when a note has none, Vault says so. Without a model, the plan comes
 * straight from the note's sections and checks use word overlap.
 */
import { createNoteCards, listCardsForItem } from './study-cards'
import { getDb, getItem, listItems } from './db'
import { citationsFromIds, extractCitedIds, validateCitations } from './generate'
import { llmGenerate } from './llm'
import { buildCloze, normalizeForMatch } from './study-session'
import type {
  Citation,
  Item,
  TeachCheckInput,
  TeachConcept,
  TeachFeedback,
  TeachMissedResult,
  TeachPlan,
  TeachPlanInput,
  TeachVerdict,
} from './types'

export const NOT_IN_NOTES = 'I couldn’t find that in your notes.'
export const MAX_CONCEPTS = 7
const MAX_NOTES = 8
const PASSAGE_CHARS = 1500

type Generate = (input: { system?: string; prompt: string }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>

export interface TeachDeps {
  generate?: Generate
}

const TEACH_RULES = `You are a patient tutor teaching a learner from their own notes.
Use ONLY the numbered passages below. Never add facts, examples or background that are not in the passages.
Cite passages with their exact id in square brackets, e.g. [itm_abc123]. Do not cite ids that are not listed.
Use plain, everyday language and short sentences. No markdown.`

function passagesFor(notes: Item[]): string {
  return notes
    .map((n, i) => `[Passage ${i + 1}] id=${n.id}\ntitle: ${n.title}\n${(n.body ?? '').slice(0, PASSAGE_CHARS)}`)
    .join('\n\n')
}

/** Parse the first JSON array (or object) in a model reply. Pure. */
export function parseJsonReply(text: string): unknown {
  const raw = (text ?? '').replace(/```(?:json)?/gi, '').trim()
  const a = raw.indexOf('[')
  const b = raw.lastIndexOf(']')
  const o = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  try {
    if (a >= 0 && b > a && (o < 0 || a < o)) return JSON.parse(raw.slice(a, b + 1))
    if (o >= 0 && e > o) return JSON.parse(raw.slice(o, e + 1))
  } catch {
    return null
  }
  return null
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Remove citation markers for notes that weren't given to the model. Pure. */
export function keepAllowedCitations(text: string, allowed: Set<string>): string {
  return text.replace(/\s*\[(itm_[^\]\s]*)\]/g, (m, id: string) => (allowed.has(id) ? m : '')).trim()
}

/** The quote, only when it really appears in the note (after normalizing). Pure. */
export function verifiedQuote(quote: string, body: string): string | null {
  const q = quote.trim()
  if (!q) return null
  return normalizeForMatch(body).includes(normalizeForMatch(q)) ? q : null
}

/** Validate the model's concept list against the notes it was given. Pure. */
export function conceptsFromModel(parsed: unknown, notes: Item[]): TeachConcept[] {
  if (!Array.isArray(parsed)) return []
  const byId = new Map(notes.map((n) => [n.id, n]))
  const allowed = new Set(byId.keys())
  const out: TeachConcept[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const cited = extractCitedIds(`${str(r.explain)} ${str(r.example)}`)
    const id = byId.has(str(r.id)) ? str(r.id) : cited.find((c) => byId.has(c))
    const note = id ? byId.get(id) : undefined
    const title = str(r.title)
    const explain = keepAllowedCitations(str(r.explain), allowed)
    const check = str(r.check)
    const answer = str(r.answer)
    if (!note || !title || !explain || !check || !answer) continue
    const example = keepAllowedCitations(str(r.example), allowed)
    out.push({
      id: `c${out.length + 1}`,
      title,
      explain,
      example: example || null,
      check,
      answer: keepAllowedCitations(answer, allowed),
      quote: verifiedQuote(str(r.quote), note.body ?? ''),
      sourceId: note.id,
      sourceTitle: note.title,
    })
    if (out.length >= MAX_CONCEPTS) break
  }
  return out
}

/** A note's sections: markdown headings, else paragraphs. Pure. */
export function noteSections(body: string): Array<{ heading: string | null; text: string }> {
  const lines = (body ?? '').split('\n')
  const out: Array<{ heading: string | null; text: string }> = []
  let heading: string | null = null
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) {
      for (const para of text.split(/\n\s*\n/)) {
        const p = para.trim()
        if (p) out.push({ heading, text: p })
      }
    }
    buf = []
  }
  for (const line of lines) {
    const h = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line)
    if (h) {
      flush()
      heading = h[1].trim()
    } else buf.push(line)
  }
  flush()
  return out
}

function firstSentences(text: string, n: number): string {
  const s = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)
  return s.slice(0, n).join(' ')
}

/** The no-model plan: one concept per section, explained in the note's own words. Pure. */
export function fallbackConcepts(notes: Item[]): TeachConcept[] {
  const out: TeachConcept[] = []
  for (const note of notes) {
    for (const sec of noteSections(note.body ?? '')) {
      if (sec.text.split(/\s+/).length < 6) continue
      const cloze = buildCloze(sec.text)
      const title = sec.heading ?? firstSentences(sec.text, 1).split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '')
      out.push({
        id: `c${out.length + 1}`,
        title,
        explain: firstSentences(sec.text, 2),
        example: null,
        check: cloze ? cloze.question : `In your own words, what does your note say about ${title}?`,
        answer: cloze ? cloze.answer : firstSentences(sec.text, 1),
        quote: cloze ? cloze.quote : firstSentences(sec.text, 1),
        sourceId: note.id,
        sourceTitle: note.title,
      })
      if (out.length >= MAX_CONCEPTS) return out
    }
  }
  return out
}

function notesFor(input: TeachPlanInput): Item[] {
  const ids = (input.itemIds ?? []).filter((x) => typeof x === 'string' && x)
  const notes = ids.length
    ? ids.map((id) => getItem(id)).filter((n): n is Item => !!n && n.status !== 'trashed')
    : input.project
      ? listItems({ project: input.project }).filter((n) => n.kind !== 'transcript')
      : []
  return notes.filter((n) => (n.body ?? '').trim().length > 0).slice(0, MAX_NOTES)
}

const defaultGenerate: Generate = async (input) => {
  const r = await llmGenerate(input)
  return r.ok ? { ok: true, text: r.text } : { ok: false, error: r.error }
}

export async function teachPlan(input: TeachPlanInput = {}, deps: TeachDeps = {}): Promise<TeachPlan> {
  const notes = notesFor(input ?? {})
  if (!notes.length) return { concepts: [], citations: [], notFound: true, notice: NOT_IN_NOTES }
  const citations: Citation[] = notes.map((n) => ({ id: n.id, title: n.title, project: n.project }))
  const generate = deps.generate ?? defaultGenerate
  const prompt = `${passagesFor(notes)}

Break these notes into 3 to ${MAX_CONCEPTS} key concepts, in the order a beginner should learn them.
Return ONLY a JSON array. Each item:
{"title":"short name","explain":"2-3 plain sentences explaining it, citing [id]","example":"an example copied or paraphrased from the passages, or \\"\\" if they give none","check":"one short question that checks the concept, answerable from the passages","answer":"the short answer","quote":"exact words copied from the passage","id":"the passage id"}`
  const gen = await generate({ system: TEACH_RULES, prompt })
  if (gen.ok) {
    const concepts = conceptsFromModel(parseJsonReply(gen.text), notes)
    if (concepts.length) return { concepts, citations }
  }
  const concepts = fallbackConcepts(notes)
  if (!concepts.length) return { concepts: [], citations, notFound: true, notice: 'These notes are too short to teach from yet. Add a few sentences and try again.' }
  return {
    concepts,
    citations,
    offline: !gen.ok,
    notice: gen.ok
      ? 'The model’s lesson plan didn’t check out against your notes, so these steps come straight from your note.'
      : 'No AI model answered, so these steps come straight from your note.',
  }
}

/* ---- Checking an answer ---- */

const WORD = /[\p{L}\p{N}]+/gu
const STOP = new Set('a an and are as at be by for from in is it of on or the to was were with that this they it’s its'.split(' '))
function contentWordsOf(text: string): string[] {
  return ((text ?? '').toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w))
}

/** No-model check: share of the expected answer's words in the attempt. Pure. */
export function overlapVerdict(attempt: string, answer: string): TeachVerdict {
  const want = [...new Set(contentWordsOf(answer))]
  if (!want.length) return 'partial'
  const got = new Set(contentWordsOf(attempt))
  const share = want.filter((w) => got.has(w)).length / want.length
  return share >= 0.6 ? 'right' : share >= 0.25 ? 'partial' : 'wrong'
}

/** A hint that doesn't give the answer away. Pure. */
export function answerShapeHint(concept: Pick<TeachConcept, 'answer' | 'sourceTitle'>): string {
  const a = concept.answer.replace(/\s*\[itm_[^\]]*\]/g, '').trim()
  const words = a.split(/\s+/).filter(Boolean)
  if (!words.length) return `Think about your note “${concept.sourceTitle}”.`
  return words.length > 1
    ? `Think about your note “${concept.sourceTitle}”. The answer is ${words.length} words and starts with “${words[0].charAt(0).toUpperCase()}”.`
    : `Think about your note “${concept.sourceTitle}”. The answer starts with “${a.charAt(0).toUpperCase()}”.`
}

export interface FeedbackParts {
  verdict: TeachVerdict
  right?: string
  misconception?: string
  reexplain?: string
  why?: string
  hint?: string
  followup?: string
}

/**
 * Turn a graded answer into what Vault says, following the tutor rules: right →
 * a short confirmation and sometimes a "why"; wrong or partly → a hint first;
 * still off after a hint → what was right, the misconception named gently, a
 * re-explanation and a follow-up check. Pure.
 */
export function composeFeedback(parts: FeedbackParts, input: Pick<TeachCheckInput, 'hintsGiven' | 'askWhy' | 'concept'>): Omit<TeachFeedback, 'citations'> {
  const right = (parts.right ?? '').trim()
  if (parts.verdict === 'right') {
    const why = input.askWhy ? (parts.why ?? '').trim() : ''
    return {
      verdict: 'right',
      say: `${right ? `Yes, ${right.charAt(0).toLowerCase()}${right.slice(1).replace(/[.\s]+$/, '')}.` : 'Yes, that’s right.'}${why ? ` ${why}` : ''}`,
      retry: false,
      missed: false,
      ...(why ? { followUp: why } : {}),
    }
  }
  if (input.hintsGiven < 1) {
    const hint = (parts.hint ?? '').trim() || answerShapeHint(input.concept)
    const lead = parts.verdict === 'partial' ? (right ? `You’re partly there: ${right.replace(/[.\s]+$/, '')}.` : 'You’re partly there.') : 'Not quite yet.'
    return { verdict: parts.verdict, say: `${lead} Here’s a hint: ${hint.replace(/[.\s]+$/, '')}. Try again.`, retry: true, missed: false }
  }
  const mis = (parts.misconception ?? '').trim()
  const re = (parts.reexplain ?? '').trim() || input.concept.explain
  const follow = (parts.followup ?? '').trim() || input.concept.check
  const segs = [
    right ? `You got this part right: ${right.replace(/[.\s]+$/, '')}.` : '',
    mis ? `One thing to untangle: ${mis.replace(/[.\s]+$/, '')}.` : '',
    `Let’s look at it another way. ${re}`,
    `Now try this: ${follow}`,
  ].filter(Boolean)
  return { verdict: parts.verdict, say: segs.join(' '), retry: false, missed: true, followUp: follow }
}

export async function teachCheck(input: TeachCheckInput, deps: TeachDeps = {}): Promise<TeachFeedback> {
  const concept = input.concept
  const note = concept?.sourceId ? getItem(concept.sourceId) : null
  if (!concept || !note) {
    return { verdict: 'wrong', say: NOT_IN_NOTES, retry: false, missed: false, citations: [] }
  }
  const allowed = new Set([note.id])
  const cite = (text: string): Citation[] => citationsFromIds(validateCitations(extractCitedIds(text), allowed))
  const attempt = (input.attempt ?? '').trim()
  const base = { hintsGiven: Math.max(0, Number(input.hintsGiven) || 0), askWhy: input.askWhy === true, concept }
  const fallback = (offline: boolean): TeachFeedback => {
    const verdict = attempt ? overlapVerdict(attempt, concept.answer) : 'wrong'
    const out = composeFeedback(
      {
        verdict,
        reexplain: concept.quote ? `Your note says: “${concept.quote}” [${note.id}]` : `${concept.explain} [${note.id}]`,
        why: `Why do you think that is, from your note?`,
      },
      base
    )
    return { ...out, citations: [{ id: note.id, title: note.title, project: note.project }], ...(offline ? { offline } : {}) }
  }
  if (!attempt) return fallback(false)
  const generate = deps.generate ?? defaultGenerate
  const prompt = `[Passage 1] id=${note.id}
title: ${note.title}
${(note.body ?? '').slice(0, PASSAGE_CHARS)}

Concept: ${concept.title}
Check question: ${input.question || concept.check}
Expected answer (from the notes): ${concept.answer}
Learner's answer: ${attempt}

Grade the learner's answer against the passage. Return ONLY a JSON object:
{"verdict":"right|partial|wrong","right":"what the learner got right, or \\"\\"","misconception":"the misunderstanding, named gently, or \\"\\"","reexplain":"explain the concept again from a different angle than before, 2 sentences, citing [${note.id}]","why":"one short why or how question that makes the learner elaborate","hint":"a hint that does not give the answer away","followup":"a new short check question on the same concept"}`
  const gen = await generate({ system: TEACH_RULES, prompt })
  if (!gen.ok) return fallback(true)
  const parsed = parseJsonReply(gen.text)
  const v = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  const verdict = v ? str(v.verdict).toLowerCase() : ''
  if (!v || (verdict !== 'right' && verdict !== 'partial' && verdict !== 'wrong')) return fallback(false)
  const clean = (k: string) => keepAllowedCitations(str(v[k]), allowed)
  const out = composeFeedback(
    {
      verdict: verdict as TeachVerdict,
      right: clean('right'),
      misconception: clean('misconception'),
      reexplain: clean('reexplain'),
      why: clean('why'),
      hint: clean('hint'),
      followup: clean('followup'),
    },
    base
  )
  const cited = cite(out.say)
  return { ...out, citations: cited.length ? cited : [{ id: note.id, title: note.title, project: note.project }] }
}

/* ---- Missed concepts → Study ---- */

/**
 * After a teach session: give the notes behind missed concepts Study cards due
 * now. A note without cards is enrolled (its new cards start due); a note with
 * cards has them made due now, keeping their history and intervals.
 */
export function teachMissed(itemIds: string[]): TeachMissedResult {
  const ids = [...new Set((itemIds ?? []).filter((x) => typeof x === 'string' && x))]
  const out: TeachMissedResult = { enrolled: 0, madeDue: 0, cards: 0 }
  const now = new Date().toISOString()
  const due = getDb().prepare('UPDATE card_schedule SET due_at = ?, updated_at = ? WHERE card_id = ? AND due_at > ?')
  for (const id of ids) {
    if (!getItem(id)) continue
    const res = createNoteCards(id)
    if (!res.alreadyEnrolled) {
      if (res.created.length) {
        out.enrolled++
        out.cards += res.created.length
      }
      continue
    }
    const cards = listCardsForItem(id).filter((c) => c.status === 'active')
    for (const c of cards) due.run(now, now, c.id, now)
    out.madeDue++
    out.cards += cards.length
  }
  return out
}
