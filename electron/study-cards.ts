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
import type { StudyCard, StudyCardOrigin, StudyCardStatus } from './types'

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
