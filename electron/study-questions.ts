/**
 * Study mode (#215) — generate sample recall questions from the user's notes.
 *
 * `parseQuestions` is pure (no DB/LLM) so it can be smoke-tested without a
 * model; `generateStudyQuestions` retrieves the selected project's notes and
 * asks the provider to write questions whose answers are stated in them.
 */
import type { StudyQuestionsInput, StudyQuestionsResult } from './types'
import { listItems } from './db'
import { llmGenerate } from './llm'

/** How many notes feed the question-generation prompt. */
const MAX_SOURCE_NOTES = 12
/** Chars of each note body sent to the model. */
const BODY_CHAR_CAP = 900

export const STUDY_QUESTIONS_SYSTEM = `You generate recall questions for a spaced-repetition study session.
Each question must be answerable from the numbered passages below.
Write short, factual, self-contained questions — no answers, no commentary.
Return ONLY a numbered list, one question per line, like:
1. What is …
2. Why does …
Do not include citations or ids.`

/**
 * Split a model reply into questions. Handles numbered lists (`1.`, `1)`, `Q1:`),
 * bullets (`-`, `*`, `•`) and bare lines. Returns trimmed, non-empty strings.
 */
export function parseQuestions(text: string): string[] {
  const lines = (text ?? '').split(/\r?\n/)
  const out: string[] = []
  for (const raw of lines) {
    const cleaned = raw
      .replace(
        /^\s*(?:\d+\s*[.)]\s*|[-*•]\s*|Q\s*\d+\s*[:.)]\s*|Question\s*\d+\s*[:.)]\s*)/i,
        '',
      )
      .trim()
    if (cleaned) out.push(cleaned)
  }
  return out
}

/**
 * Generate sample questions from the selected project's notes. An empty project
 * or an empty result list means "no notes to draw from" (no model call).
 * Throws when the model is unreachable so the panel can show the error.
 */
export async function generateStudyQuestions(
  input: StudyQuestionsInput,
): Promise<StudyQuestionsResult> {
  const count = Math.min(Math.max(input?.count ?? 5, 1), 10)
  const project = input?.project?.trim() || undefined

  const notes = listItems({ project, kind: 'note', status: 'active' }).slice(
    0,
    MAX_SOURCE_NOTES,
  )
  if (notes.length === 0) return { questions: [] }

  const passages = notes
    .map((n, i) => `[Passage ${i + 1}] title: ${n.title}\n${n.body.slice(0, BODY_CHAR_CAP)}`)
    .join('\n\n')

  const gen = await llmGenerate({
    system: STUDY_QUESTIONS_SYSTEM,
    prompt: `Passages:\n${passages}\n\nGenerate ${count} recall questions.`,
  })
  if (!gen.ok) {
    throw new Error(
      `Could not generate questions — ${gen.error}. Start a local model or add a provider in Advanced.`,
    )
  }

  return { questions: parseQuestions(gen.text).slice(0, count) }
}
