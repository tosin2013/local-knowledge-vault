/**
 * Practice tests inside Study (#265).
 *
 * A pasted practice test becomes Study cards directly: the test's own question
 * (options removed, so it is recalled rather than recognised) and the test's
 * correct answer and explanation. No question generation. The only lookup is
 * grounding: each card is linked to the learner's note that covers it, found
 * by a project search with a word-overlap check; when no note covers it, a
 * short corrective AI draft is written from the test's explanation (no model
 * call) and linked. Reveal names the linked note only once it is confirmed in
 * the learner's own words (#217).
 *
 * The test itself is saved as one page of kind `practice-test` in the project
 * (questions, correct answers and explanations; never the learner's wrong
 * answers, so a wrong option can't be learned as a fact). "Study this project"
 * skips it, and every card points at it (`item_id`).
 *
 * - Wrong items start as Missed: due now, first in the session, and outside
 *   the new-card budget. Their seed grade is logged as `migrated` so it never
 *   counts as a session.
 * - "Also add the ones I got right" adds correct items as low-priority new cards.
 * - Answer-sheet lines with no question text ("Q12: B (correct: D)") are
 *   reported as needing question text until the learner types it in.
 * - Diagram and graph items become "open the source" cards; a PBQ becomes one
 *   walk-through-the-steps card.
 * - Re-importing the same test (same project, name and date) is idempotent.
 */
import fs from 'fs'
import path from 'path'
import { pdfText } from './book-import'
import {
  createItem,
  getDb,
  newId,
  nowIso,
  runInTransaction,
  updateItem,
} from './db'
import { searchQuery } from './search'
import { sectionWords } from './study-cards'
import { hashText } from './text-hash'
import { deriveTitle } from './test-to-notes'
import { resolveOption, splitOption } from './test-to-notes-parse'
import type {
  PracticeTestImportInput,
  PracticeTestFile,
  PracticeTestImportResult,
  PracticeTestSkipped,
  TestToNotesItem,
} from './types'

export const PRACTICE_TEST_KIND = 'practice-test'
/** Cards for items answered correctly come after everything else. */
export const CORRECT_ITEM_PRIORITY = -1
/** Cards for wrong items come first among new cards of equal standing. */
export const WRONG_ITEM_PRIORITY = 1
const DEFAULT_EASE = 2.5
/** Most items one import may hold. */
export const MAX_TEST_ITEMS = 300

/** Items that need a figure the card can't show. */
export const VISUAL_RE =
  /\b(?:diagram|graph|figure|map|chart|photograph|picture|image|illustrat\w*|(?:shown|illustrated|pictured) below|table below|data table)\b/i
/** Performance-based items (simulations, drag and drop). */
export const PBQ_RE = /^\s*PBQ\b|\b(?:simulation|drag[- ]and[- ]drop|performance[- ]based)\b/i

export type PracticeItemKind = 'question' | 'visual' | 'pbq'

export function practiceItemKind(question: string): PracticeItemKind {
  if (PBQ_RE.test(question)) return 'pbq'
  if (VISUAL_RE.test(question)) return 'visual'
  return 'question'
}

/** Today as YYYY-MM-DD in local time. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A stable key for one test: same project, name and date → same cards. */
export function testKey(project: string | null, name: string, date: string): string {
  return hashText(`${(project ?? '').trim()}\n${name.trim().toLowerCase().replace(/\s+/g, ' ')}\n${date}`)
}

export function practiceCardKey(key: string, index: number): string {
  return `test:${key}#${index + 1}`
}

/**
 * The recall form of a test question: answer options removed (inline
 * "(1) a (2) b" sets and trailing "A. … B. …" runs), bracketed figure
 * descriptions dropped, whitespace tidied.
 */
export function recallQuestion(question: string): string {
  let q = (question ?? '').replace(/\s+/g, ' ').trim()
  // An inline option run "(1) a (2) b …" or "(A) a (B) b …": cut it off.
  const first = /\s\((?:1|A|a)\)\s/.exec(q)
  if (first && first.index > 10 && /\((?:2|B|b)\)\s/.test(q.slice(first.index + 4))) q = q.slice(0, first.index)
  // A trailing "A. … B. …" run.
  const lettered = /\sA[.)]\s.+\sB[.)]\s/.exec(q)
  if (lettered && lettered.index > 10) q = q.slice(0, lettered.index)
  q = q.replace(/\s*\[[^\]]{3,80}\]\s*$/, '')
  return q.trim()
}

/** The test's answer for an item, as text: the key, or (for a correct item) the learner's own answer. */
export function itemAnswer(item: TestToNotesItem): string | null {
  const key = (item.correctAnswer ?? '').trim()
  if (key) return resolveOption(key, item.options)
  if (item.correct && item.answer?.trim()) return resolveOption(item.answer, item.options).replace(/^\(\d\)\s*/, '')
  return null
}

/** The learner's answer, resolved to option text where possible ("A" → "Disable System Restore"). */
export function learnerAnswer(item: TestToNotesItem): string {
  const a = (item.answer ?? '').trim()
  if (!a) return ''
  const text = resolveOption(a, item.options)
  return text === a ? a : `${splitOption(a).label || a}. ${text}`
}

/** The practice-test page body: questions, correct answers and explanations only. */
export function practiceTestBody(name: string, date: string, items: Array<{ index: number; item: TestToNotesItem; question: string }>): string {
  const lines = [`Practice test: ${name}`, `Date: ${date}`, '']
  for (const { index, item, question } of items) {
    lines.push(`${index + 1}. ${question}`)
    const answer = itemAnswer(item)
    if (answer) lines.push(`Correct answer: ${answer}`)
    if (item.explanation?.trim()) lines.push(`Explanation: ${item.explanation.trim()}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n
}

/**
 * The learner's note that covers a question: the best project search hit that
 * is not a practice test, an AI draft, archived or trashed, sharing at least two
 * content words with the question and answer and, when the answer is known,
 * containing one of its words.
 */
export function findCoveringNote(project: string | null, question: string, answer: string | null): string | null {
  const text = `${question} ${answer ?? ''}`.trim()
  if (!text) return null
  const { hits } = searchQuery({ text, limit: 8, ...(project ? { filters: { project } } : {}) })
  if (hits.length === 0) return null
  const database = getDb()
  const want = sectionWords(text)
  const answerWords = sectionWords(answer ?? '')
  for (const hit of hits) {
    if (hit.kind === PRACTICE_TEST_KIND) continue
    const row = database.prepare('SELECT title, body, status FROM items WHERE id = ?').get(hit.id) as
      | { title: string; body: string; status: string }
      | undefined
    if (!row || row.status === 'ai-draft' || row.status === 'trashed' || row.status === 'archived') continue
    const words = sectionWords(`${row.title} ${row.body}`)
    if (overlap(want, words) < 2) continue
    if (answerWords.size > 0 && overlap(answerWords, words) === 0) continue
    return hit.id
  }
  return null
}

/** A corrective AI draft written from the test itself (no model call, no raw ids). */
export function correctiveDraftBody(opts: { question: string; answer: string | null; explanation?: string; name: string; date: string }): string {
  const parts = [`Question: ${opts.question}`]
  if (opts.answer) parts.push(`Correct answer: ${opts.answer}`)
  if (opts.explanation?.trim()) parts.push(opts.explanation.trim())
  parts.push(`From the practice test “${opts.name}” (${opts.date}). Rewrite this in your own words, then confirm it.`)
  return parts.join('\n\n')
}

function findTestItem(project: string | null, key: string, title: string): string | null {
  const database = getDb()
  const byCard = database
    .prepare(
      `SELECT c.item_id FROM study_cards c JOIN items i ON i.id = c.item_id
       WHERE c.source_key LIKE ? AND i.status != 'trashed' LIMIT 1`,
    )
    .get(`test:${key}#%`) as { item_id: string } | undefined
  if (byCard) return byCard.item_id
  const byTitle = database
    .prepare(
      `SELECT id FROM items WHERE kind = ? AND title = ? AND status != 'trashed'
       AND ((project IS NULL AND ? IS NULL) OR project = ?) LIMIT 1`,
    )
    .get(PRACTICE_TEST_KIND, title, project, project) as { id: string } | undefined
  return byTitle?.id ?? null
}

/**
 * Import a practice test into Study: one card per item that has question text
 * (wrong items always, correct ones on request), linked to the learner's notes.
 */
export function importPracticeTest(input: PracticeTestImportInput): PracticeTestImportResult {
  const name = (input?.name ?? '').replace(/\s+/g, ' ').trim() || 'Practice test'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? '') ? String(input.date) : localDate()
  const project = (input?.project ?? '').trim() || null
  const items = (input?.items ?? []).slice(0, MAX_TEST_ITEMS)
  if (items.length === 0) throw new Error('Paste some practice-test results first')
  const key = testKey(project, name, date)
  const title = `${name} · ${date}`
  const texts = input?.questionTexts ?? {}

  const result: PracticeTestImportResult = {
    testItemId: '',
    name,
    date,
    added: 0,
    alreadyAdded: 0,
    needText: [],
    skipped: [],
    linked: 0,
    drafts: 0,
    cardIds: {},
  }

  // Work out each item's question first, so the page body and cards agree.
  const planned: Array<{ index: number; item: TestToNotesItem; question: string; kind: PracticeItemKind }> = []
  items.forEach((item, index) => {
    const typed = (texts[index] ?? '').replace(/\s+/g, ' ').trim()
    const raw = typed || (item.needsText ? '' : item.question)
    if (!raw) {
      result.needText.push(index)
      return
    }
    const kind = practiceItemKind(raw)
    planned.push({ index, item, question: kind === 'question' ? recallQuestion(raw) || raw : raw, kind })
  })

  const database = getDb()
  runInTransaction(() => {
    const body = practiceTestBody(name, date, planned)
    let testItemId = findTestItem(project, key, title)
    if (testItemId) {
      const existing = database.prepare('SELECT body FROM items WHERE id = ?').get(testItemId) as { body: string }
      if (existing.body !== body && planned.length > 0) updateItem(testItemId, { body })
    } else {
      testItemId = createItem({
        title,
        body,
        kind: PRACTICE_TEST_KIND,
        status: 'active',
        para: 'resources',
        project,
        summary: `Practice test: ${name} (${date}), ${items.length} questions`,
      }).id
    }
    result.testItemId = testItemId

    const ts = nowIso()
    const insertCard = database.prepare(
      `INSERT OR IGNORE INTO study_cards
         (id, item_id, chunk_index, origin, question, answer, quote, explanation, source_test, source_test_date,
          source_key, priority, status, q_kind, q_at, link_item_id, created_at, updated_at)
       VALUES (@id, @item_id, NULL, 'practice-test', @question, @answer, NULL, @explanation, @source_test,
               @source_test_date, @source_key, @priority, 'active', 'test', @ts, @link, @ts, @ts)`,
    )
    const insertSchedule = database.prepare(
      `INSERT OR IGNORE INTO card_schedule
         (card_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
       VALUES (@card_id, @ts, 0, @ease, 0, @lapses, @last_grade, @last_reviewed_at, @ts, @ts)`,
    )
    const insertLog = database.prepare(
      `INSERT INTO review_log (id, card_id, grade, reviewed_at, interval_days, ease, due_at, migrated)
       VALUES (?, ?, 'again', ?, 0, ?, ?, 1)`,
    )

    for (const { index, item, question, kind } of planned) {
      const sourceKey = practiceCardKey(key, index)
      const existing = database.prepare('SELECT id FROM study_cards WHERE source_key = ?').get(sourceKey) as
        | { id: string }
        | undefined
      if (existing) {
        result.alreadyAdded++
        result.cardIds[index] = existing.id
        continue
      }
      if (item.correct && !input.includeCorrect) {
        result.skipped.push({ index, question, reason: 'answered correctly' })
        continue
      }
      const answer = itemAnswer(item)
      const cardQuestion =
        kind === 'pbq' ? `Walk through the steps, in order: ${question.replace(/^\s*PBQ\s*\d*\s*[:.-]?\s*/i, '')}` : question
      let link = findCoveringNote(project, question, answer)
      if (link) result.linked++
      else if (!item.correct && (answer || item.explanation?.trim())) {
        link = createItem({
          title: deriveTitle(question),
          body: correctiveDraftBody({ question, answer, explanation: item.explanation, name, date }),
          kind: 'note',
          status: 'ai-draft',
          para: 'resources',
          project,
          summary: `Corrective note from the practice test “${name}”`.slice(0, 200),
        }).id
        result.drafts++
      }
      const id = newId('crd')
      insertCard.run({
        id,
        item_id: testItemId,
        question: cardQuestion,
        answer,
        explanation: item.explanation?.trim() || null,
        source_test: name,
        source_test_date: date,
        source_key: sourceKey,
        priority: item.correct ? CORRECT_ITEM_PRIORITY : WRONG_ITEM_PRIORITY,
        ts,
        link,
      })
      if (item.correct) {
        insertSchedule.run({ card_id: id, ts, ease: DEFAULT_EASE, lapses: 0, last_grade: null, last_reviewed_at: null })
      } else {
        // Missed on the test: due now, first in the session, outside the new-card budget.
        insertSchedule.run({ card_id: id, ts, ease: DEFAULT_EASE, lapses: 1, last_grade: 'again', last_reviewed_at: ts })
        insertLog.run(newId('rvl'), id, ts, DEFAULT_EASE, ts)
      }
      result.added++
      result.cardIds[index] = id
    }
  })
  return result
}

/** Point a practice-test card at a note (e.g. a draft saved from Suggest fixes). */
export function linkPracticeCard(cardId: string, noteId: string): boolean {
  const res = getDb()
    .prepare(`UPDATE study_cards SET link_item_id = ?, updated_at = ? WHERE id = ? AND origin = 'practice-test'`)
    .run(noteId, nowIso(), cardId)
  return res.changes > 0
}

/** Most characters read from a practice-test file into the paste box. */
export const MAX_PRACTICE_FILE_CHARS = 60_000

/** Read a practice-test file (PDF text layer, or TXT / CSV / Markdown) into text. */
export async function readPracticeTestFile(filePath: string): Promise<PracticeTestFile> {
  const name = path.basename(filePath)
  try {
    const buf = await fs.promises.readFile(filePath)
    const isPdf = /\.pdf$/i.test(name) || buf.subarray(0, 5).toString('latin1') === '%PDF-'
    let text = isPdf ? await pdfText(buf) : buf.toString('utf8')
    text = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
    if (!text.trim()) {
      return { name, error: isPdf ? 'This PDF has no text layer (scanned pages need OCR first).' : 'This file is empty.' }
    }
    const truncated = text.length > MAX_PRACTICE_FILE_CHARS
    return { name, text: truncated ? text.slice(0, MAX_PRACTICE_FILE_CHARS) : text, truncated }
  } catch (e) {
    return { name, error: e instanceof Error ? e.message : String(e) }
  }
}

export type { PracticeTestSkipped }
