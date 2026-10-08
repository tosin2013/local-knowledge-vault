/**
 * Test to notes (#166) — turn wrong practice-test answers into grounded
 * corrective notes.
 *
 * Retrieval + generation follow the same grounding contract as Ask: retrieve
 * the learner's notes, let the model answer only from those passages, then keep
 * only `[itm_…]` citations that were actually retrieved. Correct items are
 * skipped (the panel turns them into reinforcement flash-cards instead).
 */
import type {
  ItemFilters,
  TestToNotesItem,
  TestToNotesParseResult,
  TestToNotesSuggestion,
} from './types'
import { searchQuery } from './search'
import { llmGenerate } from './llm'
import { isRateLimited, retryAfterMs } from './providers/http'
import {
  buildGroundedMessages,
  citationsFromIds,
  offlineCopy,
  extractCitedIds,
  validateCitations,
  finalizeAnswer,
} from './generate'
import { MAX_TEST_FIELD_CHARS, parseTestResults } from './test-to-notes-parse'

export * from './test-to-notes-parse'

export const TEST_TO_NOTES_PARSE_SYSTEM = `You parse pasted practice-test results into a structured list.
The input can be plain text, CSV, a quiz export, or transcript-like text in almost any format.
For every question you find, output a JSON array of objects with exactly these keys:
- "question" (string): the question or prompt
- "answer" (string): the learner's given answer, or "" when none is recorded
- "correct" (boolean): true when the learner got it right, false otherwise
Infer correctness from ✓/✗, correct/incorrect, right/wrong, yes/no, or true/false markers — and from the answer itself when it is obviously right or wrong.
Output ONLY the JSON array. No commentary, no code fences.`

function capField(value: unknown): string {
  const s = value == null ? '' : typeof value === 'string' ? value : String(value)
  const trimmed = s.trim()
  return trimmed.length > MAX_TEST_FIELD_CHARS ? trimmed.slice(0, MAX_TEST_FIELD_CHARS) : trimmed
}

/**
 * Parse a model's JSON-array reply into items. Tolerates leading/trailing prose
 * and code fences. Returns null when the reply is not a JSON array.
 */
export function parseAiJson(text: string): TestToNotesItem[] | null {
  const raw = (text ?? '').trim()
  if (!raw) return null
  const fenced = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  const start = fenced.indexOf('[')
  const end = fenced.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const items: TestToNotesItem[] = []
  for (const el of parsed) {
    if (typeof el !== 'object' || el === null) continue
    const obj = el as Record<string, unknown>
    const question = capField(obj.question)
    if (!question) continue
    const answer = capField(obj.answer)
    const correct =
      obj.correct === true ||
      obj.correct === 'true' ||
      obj.correct === 'yes' ||
      obj.correct === 1
    items.push({ question, answer, correct })
  }
  return items
}

/**
 * Parse pasted test results with the model, falling back to the deterministic
 * parser when the model is offline or returns an unexpected shape.
 */
export async function parseTestResultsWithAi(
  input: { text: string },
): Promise<TestToNotesParseResult> {
  const raw = (input?.text ?? '').replace(/\r\n?/g, '\n')
  if (!raw.trim()) return { items: [] }

  const gen = await llmGenerate({ system: TEST_TO_NOTES_PARSE_SYSTEM, prompt: `Test results:\n${raw}` })
  if (!gen.ok) {
    const rateLimited = isRateLimited(gen.error)
    return {
      items: parseTestResults(raw),
      offline: !rateLimited,
      rateLimited,
      retryAfterMs: rateLimited ? retryAfterMs(gen.error) : undefined,
      error: gen.error,
    }
  }
  const parsed = parseAiJson(gen.text)
  if (parsed && parsed.length > 0) return { items: parsed }
  return {
    items: parseTestResults(raw),
    error: 'The model returned an unexpected format; used the built-in parser instead.',
  }
}

/** What the model should write for each wrong answer. */
export const TEST_TO_NOTES_SYSTEM_EXTRA = `You are writing a short corrective study note for a learner who answered a practice-test question incorrectly.
Write 2–5 plain sentences that: (a) state the correct answer using ONLY the numbered passages; (b) briefly name what the learner's answer got wrong; (c) avoid preamble, headings and lists.
Cite every factual claim with the exact passage id, e.g. [itm_abc123]. Do not invent facts or cite ids that are not listed.`

/** Short, readable card title derived from the question. */
export function deriveTitle(question: string): string {
  const cleaned = (question ?? '').replace(/\s+/g, ' ').trim()
  const base = cleaned || 'practice-test question'
  const clipped = base.length > 60 ? base.slice(0, 57).trimEnd() + '…' : base
  return `Fix: ${clipped}`
}

/**
 * Draft a grounded corrective note per wrong item.
 *
 * - Correct items are skipped.
 * - No matching notes → a suggestion with clear "no notes cover this" copy and
 *   no citations (no model call).
 * - Model unreachable → a suggestion with `offline: true`.
 */
export async function analyzeTestResults(
  items: TestToNotesItem[],
  opts?: { filters?: ItemFilters; limit?: number }
): Promise<TestToNotesSuggestion[]> {
  const wrong = (items ?? []).filter((it) => it && !it.correct && !!it.question?.trim())
  const limit = Math.min(Math.max(opts?.limit ?? 6, 1), 20)
  const suggestions: TestToNotesSuggestion[] = []

  for (const item of wrong) {
    const question = item.question.trim()
    const yourAnswer = (item.answer ?? '').trim()
    const title = deriveTitle(question)

    const { hits } = searchQuery({ text: question, filters: opts?.filters, limit })
    if (hits.length === 0) {
      suggestions.push({
        question,
        yourAnswer,
        title,
        body: `No notes cover this yet — nothing in your vault matched “${question}”. Add or import a note on this topic, then run Suggest fixes again.`,
        citations: [],
      })
      continue
    }

    // Tell the model what the learner wrote so it can name what went wrong.
    const promptQuestion = yourAnswer
      ? `${question}\n\n(My answer was: ${yourAnswer})`
      : question

    const messages = buildGroundedMessages(promptQuestion, hits, {
      systemExtra: TEST_TO_NOTES_SYSTEM_EXTRA,
    })
    const gen = await llmGenerate(messages)
    if (!gen.ok) {
      const rateLimited = isRateLimited(gen.error)
      suggestions.push({
        question,
        yourAnswer,
        title,
        body: offlineCopy(gen, 'Showing no corrective note — check your notes directly'),
        citations: [],
        offline: !rateLimited,
        rateLimited,
        retryAfterMs: rateLimited ? retryAfterMs(gen.error) : undefined,
        error: gen.error,
      })
      continue
    }

    const allowed = new Set(hits.map((h) => h.id))
    const validIds = validateCitations(extractCitedIds(gen.text), allowed)
    const finalized = finalizeAnswer(gen.text, allowed)
    suggestions.push({
      question,
      yourAnswer,
      title,
      body: finalized.answer,
      citations: citationsFromIds(validIds),
      uncited: finalized.uncited,
    })
  }

  return suggestions
}
