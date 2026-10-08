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
 *
 * Editing an enrolled note rebuilds only the sections that changed (#286,
 * `syncNoteCards`): unchanged sections keep their schedule and history,
 * removed ones are retired rather than deleted.
 */
import { getDb, newId, nowIso, onNoteBodyChanged, type NoteBodyBefore } from './db'
import { hashText } from './text-hash'
import { PROSE_SECTION_MIN_WORDS, createPairCards, syncPairCards } from './study-pairs'
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
       ORDER BY chunk_index IS NOT NULL, chunk_index, created_at, rowid`,
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
  /** True when the note already had cards (nothing was added). */
  alreadyEnrolled: boolean
  /** Two-way list cards among `created` (#273). */
  pairCards: number
}

export interface CreateNoteCardsOptions {
  /** Make two-way cards for a list-like note (#273). Default true. */
  pairs?: boolean
}

/** Insert section cards (and schedules) for every section of a note. Returns the new card ids. */
function addSectionCards(itemId: string): string[] {
  const database = getDb()
  const item = database.prepare('SELECT body FROM items WHERE id = ?').get(itemId) as { body: string } | undefined
  if (!item) return []
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
  return createdIds
}

/**
 * Enroll a note: create its cards and their schedules. Idempotent — a note
 * that already has note or list cards is left untouched, so re-enrolling never
 * resets a schedule or adds a second set of cards.
 *
 * A list-like note (acronyms, a port table, term definitions) gets two-way
 * list cards instead of section cards (#273); it also gets section cards when
 * it has enough prose outside the list. Pass `{ pairs: false }` to skip list
 * cards.
 */
export function createNoteCards(itemId: string, options: CreateNoteCardsOptions = {}): CreateNoteCardsResult {
  const database = getDb()
  const item = database.prepare('SELECT id, body FROM items WHERE id = ?').get(itemId) as
    | { id: string; body: string }
    | undefined
  if (!item) throw new Error(`Note not found: ${itemId}`)

  const existing = database
    .prepare(`SELECT COUNT(*) AS c FROM study_cards WHERE item_id = ? AND origin IN ('note', 'reverse')`)
    .get(itemId) as { c: number }
  if (Number(existing.c) > 0) return { created: [], alreadyEnrolled: true, pairCards: 0 }

  let pairIds: string[] = []
  if (options.pairs !== false) {
    const pairs = createPairCards(itemId)
    pairIds = pairs.created
    if (pairIds.length > 0 && pairs.proseWords < PROSE_SECTION_MIN_WORDS) {
      return { created: pairIds.map((id) => getCard(id)).filter((c): c is StudyCard => !!c), alreadyEnrolled: false, pairCards: pairIds.length }
    }
  }

  const createdIds = addSectionCards(itemId)
  return {
    created: [...createdIds, ...pairIds].map((id) => getCard(id)).filter((c): c is StudyCard => !!c),
    alreadyEnrolled: false,
    pairCards: pairIds.length,
  }
}

// --- Rebuild changed sections after an edit (#286) ---------------------------

/** Sections at least this similar (word-set Jaccard) count as the same section, edited. */
export const SECTION_SIMILARITY_MIN = 0.5

/** Function words that every section shares; they would make unrelated sections look alike. */
const SIMILARITY_STOPWORDS = new Set(
  (
    'a an and are as at be been but by can do does for from had has have how if in into is it its may more ' +
    'most not of on or so such than that the their them then there these they this to too was were what when ' +
    'where which while who why will with you your'
  ).split(' '),
)

/** Lower-cased content words of a text (function words dropped). */
export function sectionWords(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !SIMILARITY_STOPWORDS.has(w)),
  )
}

/** Word-set Jaccard similarity of two section texts (function words ignored), 0..1. Pure. */
export function sectionSimilarity(a: string, b: string): number {
  const wa = sectionWords(a)
  const wb = sectionWords(b)
  if (wa.size === 0 && wb.size === 0) return 1
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  const union = wa.size + wb.size - shared
  return union === 0 ? 0 : shared / union
}

/** An existing note-origin card, as the section planner sees it. */
export interface SectionCard {
  cardId: string
  chunkIndex: number | null
  /** `chunk_hash`: the hash of the section text the card was made from. */
  hash: string | null
  status: StudyCardStatus
  /** The section's text before the edit, when known (needed to spot an edited section). */
  textBefore: string | null
}

export interface SectionPlan {
  /** Same text: the card, its schedule and history stay; only the index may move. */
  keep: Array<{ cardId: string; chunkIndex: number | null; hash: string }>
  /** Same section, new text: the card and schedule stay, its question is rebuilt. */
  edit: Array<{ cardId: string; chunkIndex: number | null; hash: string }>
  /** New sections: new cards. */
  add: Array<{ chunkIndex: number | null; hash: string; text: string }>
  /** Sections that are gone: retire the card (history kept, no longer scheduled). */
  retire: string[]
}

/**
 * Plan how a note's existing cards map onto its sections after an edit (#286).
 * Pure.
 *
 * 1. A section whose hash equals a card's hash keeps that card (a retired card
 *    with the same text comes back, e.g. after an undo).
 * 2. Otherwise the most similar unmatched live card whose old text is at least
 *    {@link SECTION_SIMILARITY_MIN} similar is the same section, edited. This
 *    matters because chunking is greedy: one inserted sentence shifts later
 *    chunk boundaries, and a shifted section must not lose its schedule.
 * 3. Sections left over are new; live cards left over are retired.
 */
export function planSectionSync(cards: SectionCard[], units: CardUnit[]): SectionPlan {
  const plan: SectionPlan = { keep: [], edit: [], add: [], retire: [] }
  const used = new Set<string>()
  const next = units.map((u) => ({ ...u, hash: hashText(u.text), done: false }))
  // Live cards first, so a duplicate hash prefers the card still being studied.
  const byPreference = [...cards].sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired'))

  for (const unit of next) {
    const match = byPreference.find((c) => !used.has(c.cardId) && c.hash === unit.hash)
    if (!match) continue
    used.add(match.cardId)
    unit.done = true
    plan.keep.push({ cardId: match.cardId, chunkIndex: unit.chunkIndex, hash: unit.hash })
  }

  const pairs: Array<{ unit: (typeof next)[number]; card: SectionCard; sim: number }> = []
  for (const unit of next) {
    if (unit.done) continue
    for (const card of cards) {
      if (used.has(card.cardId) || card.status === 'retired' || card.textBefore == null) continue
      const sim = sectionSimilarity(card.textBefore, unit.text)
      if (sim >= SECTION_SIMILARITY_MIN) pairs.push({ unit, card, sim })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim)
  for (const { unit, card } of pairs) {
    if (unit.done || used.has(card.cardId)) continue
    used.add(card.cardId)
    unit.done = true
    plan.edit.push({ cardId: card.cardId, chunkIndex: unit.chunkIndex, hash: unit.hash })
  }

  for (const unit of next) {
    if (!unit.done) plan.add.push({ chunkIndex: unit.chunkIndex, hash: unit.hash, text: unit.text })
  }
  for (const card of cards) {
    if (!used.has(card.cardId) && card.status !== 'retired') plan.retire.push(card.cardId)
  }
  return plan
}

export interface SectionSyncResult {
  kept: number
  edited: number
  added: number
  retired: number
}

/**
 * Rebuild a note's section cards after its body changed (#286): unchanged
 * sections keep their card, schedule and grade history; edited sections keep
 * their schedule and get their question rebuilt; removed sections are retired
 * (history kept, no longer scheduled); new sections get new cards. Notes that
 * were never enrolled are left alone. `before` is the body and chunks as they
 * were before the edit.
 */
export function syncNoteCards(itemId: string, before: NoteBodyBefore): SectionSyncResult {
  const database = getDb()
  const result: SectionSyncResult = { kept: 0, edited: 0, added: 0, retired: 0 }
  const rows = database
    .prepare(`SELECT id, chunk_index, chunk_hash, status FROM study_cards WHERE item_id = ? AND origin = 'note'`)
    .all(itemId) as Array<{ id: string; chunk_index: number | null; chunk_hash: string | null; status: string }>
  if (rows.length === 0) return result
  const item = database.prepare('SELECT body FROM items WHERE id = ?').get(itemId) as { body: string } | undefined
  if (!item) return result

  const cards: SectionCard[] = rows.map((r) => ({
    cardId: r.id,
    chunkIndex: r.chunk_index == null ? null : Number(r.chunk_index),
    hash: r.chunk_hash,
    status: r.status as StudyCardStatus,
    textBefore: r.chunk_index == null ? before.body : (before.chunks[Number(r.chunk_index)] ?? null),
  }))
  const plan = planSectionSync(cards, cardUnitsForNote(item.body, chunkBodies(itemId)))
  const noteHash = hashText(item.body)
  const ts = nowIso()

  const keep = database.prepare(
    `UPDATE study_cards SET chunk_index = ?, note_hash = ?, status = 'active', updated_at = ? WHERE id = ?`,
  )
  const edit = database.prepare(
    `UPDATE study_cards SET chunk_index = ?, chunk_hash = ?, note_hash = ?, question = NULL, answer = NULL,
       quote = NULL, q_kind = NULL, q_source_hash = NULL, q_model = NULL, q_at = NULL, q_note = NULL,
       updated_at = ? WHERE id = ?`,
  )
  const retire = database.prepare(`UPDATE study_cards SET status = 'retired', updated_at = ? WHERE id = ?`)
  const insertCard = database.prepare(
    `INSERT INTO study_cards
       (id, item_id, chunk_index, chunk_hash, note_hash, origin, source_key, status, created_at, updated_at)
     VALUES (@id, @item_id, @chunk_index, @chunk_hash, @note_hash, 'note', @source_key, 'active', @ts, @ts)`,
  )
  const insertSchedule = database.prepare(
    `INSERT OR IGNORE INTO card_schedule
       (card_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
     VALUES (@card_id, @ts, 0, @ease, 0, 0, NULL, NULL, @ts, @ts)`,
  )
  database.transaction(() => {
    for (const k of plan.keep) keep.run(k.chunkIndex, noteHash, ts, k.cardId)
    for (const e of plan.edit) edit.run(e.chunkIndex, e.hash, noteHash, ts, e.cardId)
    for (const id of plan.retire) retire.run(ts, id)
    for (const a of plan.add) {
      const id = newId('crd')
      // Kept cards may have moved index, so a positional key could collide;
      // a card added by an edit gets a key tied to its own id.
      insertCard.run({
        id,
        item_id: itemId,
        chunk_index: a.chunkIndex,
        chunk_hash: a.hash,
        note_hash: noteHash,
        source_key: `note:${itemId}:${id}`,
        ts,
      })
      insertSchedule.run({ card_id: id, ts, ease: DEFAULT_EASE })
    }
  })()
  result.kept = plan.keep.length
  result.edited = plan.edit.length
  result.added = plan.add.length
  result.retired = plan.retire.length
  return result
}

/**
 * Every body edit that goes through `updateItem` rebuilds the note's cards:
 * section cards (#286) and list cards (#273). A list note whose pairs are all
 * gone, with no section cards, gets section cards so it stays in Study.
 */
export function syncCardsAfterEdit(itemId: string, before: NoteBodyBefore): void {
  syncNoteCards(itemId, before)
  const pairs = syncPairCards(itemId)
  if (pairs.kept + pairs.updated + pairs.added + pairs.retired === 0) return
  const live = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM study_cards WHERE item_id = ? AND origin IN ('note', 'reverse') AND status != 'retired'`)
    .get(itemId) as { c: number }
  const notes = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM study_cards WHERE item_id = ? AND origin = 'note'`)
    .get(itemId) as { c: number }
  if (Number(live.c) === 0 && Number(notes.c) === 0) addSectionCards(itemId)
}

onNoteBodyChanged((itemId, before) => {
  syncCardsAfterEdit(itemId, before)
})

/**
 * Which of these notes already have cards in Study (active or waiting), so
 * "Add to review" can say "Already in Study" up front. Retired cards don't count.
 */
export function enrolledItemIds(itemIds: string[]): string[] {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).filter((x) => typeof x === 'string' && x))].slice(0, 500)
  if (ids.length === 0) return []
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT item_id FROM study_cards
       WHERE status IN ('active', 'pending') AND item_id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as Array<{ item_id: string }>
  return rows.map((r) => r.item_id)
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
/**
 * Does this text look like an exam paper (or a results page) rather than notes?
 * True when it holds at least three multiple-choice option sets: "(1) … (2) …
 * (3) …" runs or "A. / B. / C." option lines. Questions generated from exam
 * pages were only 33% usable in the Oct 8 evaluation and one learned a wrong
 * option as a fact, so exam papers go through Import practice test (#265).
 */
export function looksLikeExamPaper(body: string): boolean {
  const text = body ?? ''
  const count = (re: RegExp) => (text.match(re) ?? []).length
  const numbered = Math.min(count(/(?:^|\s)\(1\)\s/g), count(/(?:^|\s)\(2\)\s/g), count(/(?:^|\s)\(3\)\s/g))
  const lettered = Math.min(count(/^\s*\(?A[.)]\s/gm), count(/^\s*\(?B[.)]\s/gm), count(/^\s*\(?C[.)]\s/gm))
  return numbered >= 3 || lettered >= 3
}

export const PRACTICE_TEST_SKIP = 'practice test (its questions are already cards)'
export const EXAM_PAPER_SKIP = 'exam paper or answer page (import it as a practice test)'

export function enrollSkipReason(note: Pick<EnrollCandidate, 'body' | 'kind' | 'status'>): string | null {
  if (note.kind === 'practice-test') return PRACTICE_TEST_SKIP
  if (note.status === 'ai-draft') return 'unconfirmed AI draft (confirm it in your own words first)'
  if (note.status === 'archived') return 'archived'
  if (note.kind === 'transcript') return 'video transcript (add single parts from Review)'
  if (looksLikeExamPaper(note.body)) return EXAM_PAPER_SKIP
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
export function enrollProject(project: string, options: CreateNoteCardsOptions = {}): EnrollProjectResult {
  const name = (project ?? '').trim()
  if (!name) throw new Error('Pick a project to study')
  const database = getDb()
  const rows = database
    .prepare(
      `SELECT i.id, i.title, i.body, i.kind, i.status,
              EXISTS (SELECT 1 FROM study_cards c WHERE c.item_id = i.id) AS enrolled,
              EXISTS (SELECT 1 FROM study_cards c WHERE c.item_id = i.id AND c.origin = 'reverse') AS has_pairs
       FROM items i
       WHERE i.project = ? AND i.status != 'trashed'
       ORDER BY i.created_at, i.id`,
    )
    .all(name) as Array<{
    id: string
    title: string
    body: string
    kind: string
    status: string
    enrolled: number
    has_pairs: number
  }>

  const result: EnrollProjectResult = {
    project: name,
    notes: 0,
    cards: 0,
    alreadyScheduled: 0,
    skipped: [],
    pairNotes: 0,
    pairCards: 0,
  }
  const pairsOn = options.pairs !== false
  database.transaction(() => {
    for (const row of rows) {
      // A practice test's cards are its own; it is never enrolled as a note.
      if (row.kind === 'practice-test') {
        result.skipped.push({ itemId: row.id, title: row.title, reason: PRACTICE_TEST_SKIP })
        continue
      }
      if (row.enrolled) {
        result.alreadyScheduled++
        // A list note enrolled before list cards existed gets them now (#273);
        // its section cards are left as they are.
        if (pairsOn && !row.has_pairs && row.status !== 'ai-draft' && row.status !== 'archived' && row.kind !== 'transcript') {
          const added = createPairCards(row.id).created.length
          if (added > 0) {
            result.pairNotes++
            result.pairCards += added
            result.cards += added
          }
        }
        continue
      }
      const reason = enrollSkipReason(row)
      if (reason) {
        result.skipped.push({ itemId: row.id, title: row.title, reason })
        continue
      }
      const { created, pairCards } = createNoteCards(row.id, { pairs: pairsOn })
      if (created.length > 0) {
        result.notes++
        result.cards += created.length
      }
      if (pairCards > 0) {
        result.pairNotes++
        result.pairCards += pairCards
      }
    }
  })()
  return result
}
