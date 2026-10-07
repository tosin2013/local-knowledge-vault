/**
 * Test to notes (#166) — turn wrong practice-test answers into grounded
 * corrective notes.
 *
 * Retrieval + generation follow the same grounding contract as Ask: retrieve
 * the learner's notes, let the model answer only from those passages, then keep
 * only `[itm_…]` citations that were actually retrieved. Correct items are
 * skipped (the panel turns them into reinforcement flash-cards instead).
 */
import type { ItemFilters, TestToNotesItem, TestToNotesSuggestion } from './types'
import { searchQuery } from './search'
import { llmGenerate } from './llm'
import {
  buildGroundedMessages,
  citationsFromIds,
  offlineCopy,
  extractCitedIds,
  validateCitations,
  finalizeAnswer,
} from './generate'

export * from './test-to-notes-parse'

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
      suggestions.push({
        question,
        yourAnswer,
        title,
        body: offlineCopy(gen, 'Showing no corrective note — check your notes directly'),
        citations: [],
        offline: true,
        error: gen.error,
      })
      continue
    }

    const allowed = new Set(hits.map((h) => h.id))
    const validIds = validateCitations(extractCitedIds(gen.text), allowed)
    suggestions.push({
      question,
      yourAnswer,
      title,
      body: finalizeAnswer(gen.text, allowed),
      citations: citationsFromIds(validIds),
    })
  }

  return suggestions
}
