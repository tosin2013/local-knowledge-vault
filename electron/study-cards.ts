/**
 * Study cards (#259 card model, docs/adr/0004-study-cards.md).
 *
 * A card is what the learner reviews and what the scheduler keys on:
 *  - origin `note`: a whole short note (chunk_index NULL) or one chunk of a
 *    long note (chunk_index = the `note_chunks` index);
 *  - origin `practice-test` (#265) and `reverse` (#273) arrive in Phase 2 and
 *    use the same table.
 *
 * A card always points at a note (`item_id`), so its project — and through
 * the project its exam date — is the note's *current* project. Question,
 * answer and quote stay NULL until generation (#263); until then the review
 * prompt falls back to the note's summary or title.
 */
import { getDb, newId, nowIso } from './db'
import { hashText } from './text-hash'
import type { StudyCard, StudyCardOrigin, StudyCardStatus, StudyEnrollResult } from './types'

/** Notes at or under this many characters are studied as one card (#263). */
export const WHOLE_NOTE_MAX_CHARS = 1200

const DEFAULT_EASE = 2.5

export interface CardUnit {
  /** null = the whole note. */
  chunkIndex: number | null
  text: string
}

/**
 * Which cards a note yields: one whole-note card when the body is short (or
 * has at most one chunk), otherwise one card per retrieval chunk. Pure.
 */
export function cardUnitsForNote(body: string, chunks: string[]): CardUnit[] {
  const text = body ?? ''
  if (!text.trim()) return []
  if (text.length <= WHOLE_NOTE_MAX_CHARS || chunks.length <= 1) {
    return [{ chunkIndex: null, text }]
  }
  return chunks.map((chunk, i) => ({ chunkIndex: i, text: chunk }))
}

/** The idempotency key for a note-origin card. */
export function noteCardKey(itemId: string, chunkIndex: number | null): string {
  return chunkIndex == null ? `note:${itemId}` : `note:${itemId}#${chunkIndex}`
}

function rowToCard(row: Record<string, unknown>): StudyCard {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    chunkIndex: row.chunk_index == null ? null : Number(row.chunk_index),
    chunkHash: row.chunk_hash == null ? null : String(row.chunk_hash),
    noteHash: row.note_hash == null ? null : String(row.note_hash),
    origin: String(row.origin) as StudyCardOrigin,
    question: row.question == null ? null : String(row.question),
    answer: row.answer == null ? null : String(row.answer),
    quote: row.quote == null ? null : String(row.quote),
    sourceTest: row.source_test == null ? null : String(row.source_test),
    sourceTestDate: row.source_test_date == null ? null : String(row.source_test_date),
    sourceKey: String(row.source_key),
    priority: Number(row.priority ?? 0),
    status: String(row.status) as StudyCardStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function getCard(cardId: string): StudyCard | null {
  const row = getDb().prepare('SELECT * FROM study_cards WHERE id = ?').get(cardId) as
    | Record<string, unknown>
    | undefined
  return row ? rowToCard(row) : null
}

/** Every card for a note, whole-note card first, then by chunk. */
export function listCardsForItem(itemId: string): StudyCard[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM study_cards WHERE item_id = ?
       ORDER BY chunk_index IS NOT NULL, chunk_index, created_at`,
    )
    .all(itemId) as Record<string, unknown>[]
  return rows.map(rowToCard)
}

function chunkBodies(itemId: string): string[] {
  const rows = getDb()
    .prepare('SELECT body FROM note_chunks WHERE item_id = ? ORDER BY chunk_index')
    .all(itemId) as Array<{ body: string }>
  return rows.map((r) => r.body)
}

export interface CreateNoteCardsResult {
  /** Cards created by this call (each with a fresh schedule, due now). */
  created: StudyCard[]
  /** True when the note already had note-origin cards (nothing was added). */
  alreadyEnrolled: boolean
}

/**
 * Enroll a note: create its note-origin cards and their schedules. Idempotent
 * — a note that already has any note-origin card is left untouched, so
 * re-enrolling never resets a schedule or adds a second set of cards.
 */
export function createNoteCards(itemId: string): CreateNoteCardsResult {
  const database = getDb()
  const item = database.prepare('SELECT id, body FROM items WHERE id = ?').get(itemId) as
    | { id: string; body: string }
    | undefined
  if (!item) throw new Error(`Note not found: ${itemId}`)

  const existing = database
    .prepare(`SELECT COUNT(*) AS c FROM study_cards WHERE item_id = ? AND origin = 'note'`)
    .get(itemId) as { c: number }
  if (Number(existing.c) > 0) return { created: [], alreadyEnrolled: true }

  const units = cardUnitsForNote(item.body, chunkBodies(itemId))
  const noteHash = hashText(item.body)
  const ts = nowIso()
  const insertCard = database.prepare(
    `INSERT OR IGNORE INTO study_cards
       (id, item_id, chunk_index, chunk_hash, note_hash, origin, source_key, status, created_at, updated_at)
     VALUES (@id, @item_id, @chunk_index, @chunk_hash, @note_hash, 'note', @source_key, 'active', @ts, @ts)`,
  )
  const insertSchedule = database.prepare(
    `INSERT OR IGNORE INTO card_schedule
       (card_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
     VALUES (@card_id, @ts, 0, @ease, 0, 0, NULL, NULL, @ts, @ts)`,
  )
  const createdIds: string[] = []
  database.transaction(() => {
    for (const unit of units) {
      const id = newId('crd')
      const res = insertCard.run({
        id,
        item_id: itemId,
        chunk_index: unit.chunkIndex,
        chunk_hash: hashText(unit.text),
        note_hash: noteHash,
        source_key: noteCardKey(itemId, unit.chunkIndex),
        ts,
      })
      if (res.changes > 0) {
        insertSchedule.run({ card_id: id, ts, ease: DEFAULT_EASE })
        createdIds.push(id)
      }
    }
  })()
  return {
    created: createdIds.map((id) => getCard(id)).filter((c): c is StudyCard => !!c),
    alreadyEnrolled: false,
  }
}

/** Remove every card (and its schedule and history) for a note. */
export function deleteCardsForItem(itemId: string): number {
  return getDb().prepare('DELETE FROM study_cards WHERE item_id = ?').run(itemId).changes
}

/** Remove one card. Returns true when it existed. */
export function deleteCard(cardId: string): boolean {
  return getDb().prepare('DELETE FROM study_cards WHERE id = ?').run(cardId).changes > 0
}

// --- Bulk enrolment: "Study this project" (#262) ---------------------------

/** Lines import paths prepend to a body (`Source:`, `Page:` …), not content. */
const BODY_HEADER_LINE = /^(source|page|pages|url|fetched|imported|author)s?:.*$/i

/** Words that carry letters or digits, after dropping import header lines. */
export function contentWords(body: string): string[] {
  const lines = (body ?? '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && (BODY_HEADER_LINE.test(lines[i].trim()) || !lines[i].trim())) i++
  return lines
    .slice(i)
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
}

/** Fewer real words than this is too little to quiz on. */
export const MIN_STUDY_WORDS = 20
/** A page this short that matches a boilerplate signal is treated as boilerplate. */
const SHORT_PAGE_WORDS = 120

/**
 * Boilerplate signals, grouped so one repeated header (for example the
 * "Copyright © 2024 CompTIA, Inc. All rights reserved." line on every page)
 * counts once. Each group holds distinct phrases.
 */
const BOILERPLATE_GROUPS: Array<{ group: string; patterns: RegExp[] }> = [
  {
    group: 'copyright',
    patterns: [/all rights reserved/i, /copyright\s*(©|\(c\)|\d{4})/i, /©\s*\d{4}/, /\bISBN[\s:-]*[\dX-]{10,}/i],
  },
  {
    group: 'exam-logistics',
    patterns: [
      /do not open this (examination|exam|test)? ?booklet/i,
      /communications? device[\s\S]{0,60}prohibited/i,
      /(separate|your) answer sheet/i,
      /student name\s*_{3,}/i,
      /school name\s*_{3,}/i,
      /\bproctor\b/i,
      /sign the declaration/i,
      /until the signal is given/i,
      /record (all )?(of )?your answers/i,
      /calculator must be available/i,
    ],
  },
  {
    group: 'exam-policy',
    patterns: [/brain dumps?/i, /candidate agreement/i, /authorized materials use policy/i, /exam policies/i],
  },
  {
    group: 'web-chrome',
    patterns: [
      /we use cookies/i,
      /accept (all )?cookies/i,
      /cookie (policy|settings|preferences)/i,
      /privacy policy/i,
      /terms of (use|service)/i,
      /subscribe to our newsletter/i,
    ],
  },
  { group: 'blank', patterns: [/this page (is )?intentionally left blank/i] },
  { group: 'contents', patterns: [/^\s*(table of )?contents\s*$/im] },
]

/**
 * Why a note should not become study cards, or null when it should. Pure.
 *
 * - fewer than {@link MIN_STUDY_WORDS} real words → too short;
 * - boilerplate when two or more signal groups match, three or more distinct
 *   exam-logistics phrases match (an exam cover or instructions page), or one
 *   group matches on a short page (≤ 120 words).
 *
 * A long content page with one repeated copyright header is kept.
 */
export function boilerplateReason(body: string): string | null {
  const text = body ?? ''
  const words = contentWords(text)
  if (words.length === 0) return 'empty'
  if (words.length < MIN_STUDY_WORDS) return 'too short to quiz on'
  const groups = new Set<string>()
  let logistics = 0
  for (const { group, patterns } of BOILERPLATE_GROUPS) {
    const hits = patterns.filter((p) => p.test(text)).length
    if (hits > 0) groups.add(group)
    if (group === 'exam-logistics') logistics = hits
  }
  if (groups.size >= 2 || logistics >= 3 || (groups.size === 1 && words.length <= SHORT_PAGE_WORDS)) {
    return 'boilerplate (cover, instructions, copyright or site chrome)'
  }
  return null
}

export interface EnrollCandidate {
  id: string
  title: string
  body: string
  kind: string
  status: string
  enrolled: boolean
}

/** Kinds that come from an import (PDF/EPUB pages, web articles) and can carry boilerplate. */
const IMPORTED_KINDS = new Set(['book', 'article'])
/** A note of the learner's own with fewer real words than this has nothing to quiz on. */
const MIN_OWN_NOTE_WORDS = 3

/**
 * Why a project note is left out of "Study this project", or null to enroll it.
 * Pure. Unconfirmed AI drafts wait for the own-words confirm (#217); video
 * transcripts are enrolled one at a time from Review, by choice.
 *
 * Boilerplate detection applies only to imported pages and articles. The
 * learner's own notes (including pasted ones) are kept unless they are
 * empty or a stub: a short note such as "ATP = the cell's energy currency"
 * is a good card, and a messy paste still holds the learner's material.
 */
export function enrollSkipReason(note: Pick<EnrollCandidate, 'body' | 'kind' | 'status'>): string | null {
  if (note.status === 'ai-draft') return 'unconfirmed AI draft (confirm it in your own words first)'
  if (note.status === 'archived') return 'archived'
  if (note.kind === 'transcript') return 'video transcript (add single parts from Review)'
  if (IMPORTED_KINDS.has(note.kind)) return boilerplateReason(note.body)
  const words = contentWords(note.body).length
  if (words === 0) return 'empty'
  if (words < MIN_OWN_NOTE_WORDS) return 'too short to quiz on'
  return null
}

export type EnrollProjectResult = StudyEnrollResult

/**
 * "Study this project" (#262): enroll every live note in a project at the card
 * unit. Idempotent: notes that already have cards are counted, not touched.
 * Trashed notes are ignored; skipped notes come back with a reason.
 */
export function enrollProject(project: string): EnrollProjectResult {
  const name = (project ?? '').trim()
  if (!name) throw new Error('Pick a project to study')
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT i.id, i.title, i.body, i.kind, i.status,
              EXISTS (SELECT 1 FROM study_cards c WHERE c.item_id = i.id) AS enrolled
       FROM items i
       WHERE i.project = ? AND i.status != 'trashed'
       ORDER BY i.created_at, i.id`,
    )
    .all(name) as Array<{ id: string; title: string; body: string; kind: string; status: string; enrolled: number }>

  const result: EnrollProjectResult = { project: name, notes: 0, cards: 0, alreadyScheduled: 0, skipped: [] }
  database.transaction(() => {
    for (const row of rows) {
      if (row.enrolled) {
        result.alreadyScheduled++
        continue
      }
      const reason = enrollSkipReason(row)
      if (reason) {
        result.skipped.push({ itemId: row.id, title: row.title, reason })
        continue
      }
      const { created } = createNoteCards(row.id)
      if (created.length > 0) {
        result.notes++
        result.cards += created.length
      }
    }
  })()
  return result
}
