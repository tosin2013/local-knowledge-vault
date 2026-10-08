/**
 * Study mode (#215) — generate sample recall questions from the user's notes.
 *
 * `parseQuestions`, `listEligibleChunks` and `sampleStudyPassages` are pure /
 * DB-only so they can be smoke-tested without a model; `generateStudyQuestions`
 * samples eligible chunks across every content kind and asks the provider to
 * write questions whose answers are stated in them.
 */
import type { StudyQuestionsInput, StudyQuestionsResult } from './types'
import { getDb } from './db'
import { llmGenerate } from './llm'

/** Max distinct notes drawn from in one generation (keeps the prompt bounded). */
export const MAX_SOURCE_NOTES = 12
/** Safety cap on each chunk body sent to the model (chunks are already ~800). */
export const CHUNK_CHAR_CAP = 1000

export const STUDY_QUESTIONS_SYSTEM = `You generate recall questions for a spaced-repetition study session.
Each question must be answerable from the numbered passages below.
Write short, factual, self-contained questions — no answers, no commentary.
Return ONLY a numbered list, one question per line, like:
1. What is …
2. Why does …
Do not include citations or ids.`

interface ChunkRow {
  itemId: string
  title: string
  body: string
}

/**
 * All chunks of eligible notes in scope — every content kind (`note`, `book`,
 * `article`, `transcript`), excluding trashed/archived notes and unconfirmed AI
 * drafts. Scoped to one project when `project` is set.
 */
export function listEligibleChunks(project?: string): ChunkRow[] {
  const database = getDb()
  const projectFilter = project ? ' AND i.project = ?' : ''
  const params: unknown[] = project ? [project] : []
  return database
    .prepare(
      `SELECT nc.item_id AS itemId, nc.body AS body, i.title AS title
       FROM note_chunks nc
       JOIN items i ON i.id = nc.item_id
       WHERE i.status = 'active'${projectFilter}
       ORDER BY nc.item_id, nc.chunk_index`,
    )
    .all(...params) as ChunkRow[]
}

/**
 * Sample up to `maxNotes` distinct notes and return one passage each. A random
 * chunk is chosen per note, so a section deep inside a long note/page can be
 * asked about instead of only the head. Spreads across the scope rather than
 * taking the first N.
 */
export function sampleStudyPassages(
  chunks: ChunkRow[],
  maxNotes = MAX_SOURCE_NOTES,
  rng: () => number = Math.random,
): Array<{ itemId: string; title: string; body: string }> {
  const byNote = new Map<string, ChunkRow[]>()
  for (const c of chunks) {
    const arr = byNote.get(c.itemId)
    if (arr) arr.push(c)
    else byNote.set(c.itemId, [c])
  }
  const noteIds = [...byNote.keys()]
  const n = Math.min(maxNotes, noteIds.length)

  // Partial Fisher–Yates shuffle: pick n distinct note ids.
  const pool = noteIds.slice()
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  const passages: Array<{ itemId: string; title: string; body: string }> = []
  for (let i = 0; i < n; i++) {
    const chunksOf = byNote.get(pool[i])!
    const chunk = chunksOf[Math.floor(rng() * chunksOf.length)]
    passages.push({ itemId: pool[i], title: chunksOf[0].title, body: chunk.body })
  }
  return passages
}

/**
 * Generate sample questions from the selected project's notes. An empty scope
 * returns no questions (no model call). Throws when the model is unreachable.
 */
export async function generateStudyQuestions(
  input: StudyQuestionsInput,
): Promise<StudyQuestionsResult> {
  const count = Math.min(Math.max(input?.count ?? 5, 1), 10)
  const project = input?.project?.trim() || undefined

  const chunks = listEligibleChunks(project)
  if (chunks.length === 0) return { questions: [] }

  const passages = sampleStudyPassages(chunks)
  const prompt = passages
    .map((p, i) => `[Passage ${i + 1}] title: ${p.title}\n${p.body.slice(0, CHUNK_CHAR_CAP)}`)
    .join('\n\n')

  const gen = await llmGenerate({
    system: STUDY_QUESTIONS_SYSTEM,
    prompt: `Passages:\n${prompt}\n\nGenerate ${count} recall questions.`,
  })
  if (!gen.ok) {
    throw new Error(
      `Could not generate questions — ${gen.error}. Start a local model or add a provider in Advanced.`,
    )
  }

  return { questions: parseQuestions(gen.text).slice(0, count) }
}

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
