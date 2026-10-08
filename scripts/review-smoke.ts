/**
 * #216 — spaced-review scheduling over the user's own notes.
 *
 *   npm run test:review
 *
 * Runs under Electron-as-Node against a temp DB. Covers the pure SM-2-style
 * math, the card model (study_cards / card_schedule / review_log, migration v7)
 * and the migration of the old note-keyed `review_schedule` rows.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { initDb, closeDb, createItem, trashItem, updateItem, deleteItem, getDb } from '../electron/db'
import { cardUnitsForNote, createNoteCards, listCardsForItem, noteCardKey, WHOLE_NOTE_MAX_CHARS } from '../electron/study-cards'
import {
  anchorFirstIntervalDays,
  scheduleReview,
  getReviewState,
  listReviewStates,
  listDueReviews,
  countDueReviews,
  enqueueReview,
  removeReview,
  rateReview,
  getCardState,
  listReviewLog,
} from '../electron/review'
import type { ReviewState } from '../electron/types'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

function near(a: number, b: number, msg: string): void {
  assert(Math.abs(a - b) < 1e-9, `${msg} (${a} ≈ ${b})`)
}

function main(): void {
  console.log('\n=== Local Knowledge Vault — spaced review (#216) ===\n')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-216-'))
  initDb(path.join(tmp, 'test.sqlite'))

  const now = new Date('2026-01-01T00:00:00.000Z')
  const fresh: ReviewState = { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 }

  // --- anchorFirstIntervalDays (Cepeda-style shrinking fraction) ---
  console.log('anchorFirstIntervalDays')
  assert(anchorFirstIntervalDays(0) === 1, '0 days → 1')
  assert(anchorFirstIntervalDays(7) === 2, '7 days → 2')
  assert(anchorFirstIntervalDays(30) === 5, '30 days → 5')
  assert(anchorFirstIntervalDays(365) === 26, '365 days → 26')

  // --- scheduleReview: again / hard / good / easy ---
  console.log('\nscheduleReview')
  const again = scheduleReview({ intervalDays: 10, ease: 2.5, reps: 3, lapses: 1 }, 'again', { now })
  assert(again.state.reps === 0, 'again resets reps')
  assert(again.state.lapses === 2, 'again counts a lapse')
  near(again.state.ease, 2.3, 'again lowers ease by 0.2')
  assert(again.state.intervalDays === 0, 'again resets the interval')
  assert(again.dueAt === now.toISOString(), 'again stays due now')

  const hardFirst = scheduleReview(fresh, 'hard', { now })
  assert(hardFirst.state.intervalDays === 1 && hardFirst.state.reps === 1, 'hard from a new item → 1 day, reps 1')
  near(hardFirst.state.ease, 2.35, 'hard lowers ease by 0.15')
  const hardLater = scheduleReview({ intervalDays: 10, ease: 2.5, reps: 2, lapses: 0 }, 'hard', { now })
  assert(hardLater.state.intervalDays === 12, 'hard expands slowly (×1.2)')

  const goodFirst = scheduleReview(fresh, 'good', { now })
  assert(goodFirst.state.intervalDays === 1 && goodFirst.state.reps === 1, 'first good → 1 day, reps 1')
  assert(
    scheduleReview(fresh, 'good', { now, targetDate: '2026-01-08' }).state.intervalDays === 2,
    'first good with a 7-day target → anchored 2 days',
  )
  assert(
    scheduleReview({ intervalDays: 1, ease: 2.5, reps: 1, lapses: 0 }, 'good', { now }).state.intervalDays === 3,
    'second good → 3 days',
  )
  assert(
    scheduleReview({ intervalDays: 10, ease: 2.5, reps: 2, lapses: 0 }, 'good', { now }).state.intervalDays === 25,
    'later good expands by ease (10 × 2.5)',
  )

  const easyFirst = scheduleReview(fresh, 'easy', { now })
  assert(easyFirst.state.intervalDays === 3 && easyFirst.state.reps === 1, 'first easy → at least 3 days')
  near(easyFirst.state.ease, 2.65, 'easy raises ease by 0.15')
  assert(
    scheduleReview(fresh, 'easy', { now, targetDate: '2026-01-08' }).state.intervalDays === 3,
    'first easy keeps max(anchored, 3)',
  )
  assert(
    scheduleReview({ intervalDays: 10, ease: 2.5, reps: 2, lapses: 0 }, 'easy', { now }).state.intervalDays === 33,
    'later easy expands by ease × 1.3',
  )

  // Ease clamp bounds.
  near(
    scheduleReview({ intervalDays: 5, ease: 1.3, reps: 2, lapses: 0 }, 'again', { now }).state.ease,
    1.3,
    'ease never drops below 1.3',
  )
  near(
    scheduleReview({ intervalDays: 5, ease: 3.0, reps: 1, lapses: 0 }, 'easy', { now }).state.ease,
    3.0,
    'ease never climbs above 3.0',
  )
  // Interval clamp.
  assert(
    scheduleReview({ intervalDays: 700, ease: 2.5, reps: 5, lapses: 0 }, 'good', { now }).state.intervalDays === 730,
    'interval is clamped to 730 days',
  )
  // dueAt follows the interval.
  assert(
    scheduleReview(fresh, 'good', { now }).dueAt === new Date(now.getTime() + 86_400_000).toISOString(),
    'dueAt = now + interval days',
  )

  // --- Card units (pure) ---
  console.log('\ncardUnitsForNote')
  assert(cardUnitsForNote('', []).length === 0, 'an empty note yields no card')
  const shortUnits = cardUnitsForNote('Short note.', ['Short note.'])
  assert(shortUnits.length === 1 && shortUnits[0].chunkIndex === null, 'a short note is one whole-note card')
  const longBody = 'x'.repeat(WHOLE_NOTE_MAX_CHARS + 1)
  assert(
    cardUnitsForNote(longBody, ['a']).length === 1 && cardUnitsForNote(longBody, ['a'])[0].chunkIndex === null,
    'a long note with a single chunk stays one card',
  )
  const chunked = cardUnitsForNote(longBody, ['a', 'b', 'c'])
  assert(
    chunked.length === 3 && chunked.map((u) => u.chunkIndex).join(',') === '0,1,2' && chunked[1].text === 'b',
    'a long note yields one card per chunk',
  )
  assert(noteCardKey('itm_1', null) === 'note:itm_1' && noteCardKey('itm_1', 2) === 'note:itm_1#2', 'source keys')

  // --- DB accessors over cards ---
  console.log('\ncard schedule accessors')
  const note = createItem({
    title: 'Photosynthesis',
    body: 'Chlorophyll captures light to make glucose from CO2 and water.',
    kind: 'note',
    para: 'resources',
  })
  assert(getReviewState(note.id) === null, 'a new note is not in review')

  const enqueued = enqueueReview(note.id)
  assert(enqueued.created === 1 && enqueued.cards === 1 && !enqueued.alreadyEnrolled, 'enqueue makes one card for a short note')
  const cards = listCardsForItem(note.id)
  assert(cards.length === 1 && cards[0].chunkIndex === null && cards[0].origin === 'note', 'the card is a whole-note card')
  assert(cards[0].question === null && cards[0].answer === null, 'question and answer stay empty until generation')
  assert(!!cards[0].noteHash && cards[0].noteHash === cards[0].chunkHash, 'the card keeps the note hash')
  const fresh0 = getReviewState(note.id)
  assert(!!fresh0 && fresh0.intervalDays === 0 && fresh0.reps === 0, 'enqueue starts a fresh schedule')

  const far = new Date(Date.now() + 60_000).toISOString()
  assert(listDueReviews(far).some((q) => q.id === note.id), 'an enqueued note is due')
  assert(countDueReviews(far) === 1, 'countDueReviews counts the due card')
  const dueItem = listDueReviews(far)[0]
  assert(dueItem.title === 'Photosynthesis' && dueItem.body.length > 0, 'the queue returns the note body')
  assert(dueItem.card_id === cards[0].id && dueItem.card_text === dueItem.body, 'a whole-note card reveals the body')

  const rated = rateReview(cards[0].id, 'good')
  assert(rated.reps === 1 && rated.intervalDays === 1, 'good advances the card schedule')
  const afterRate = getCardState(cards[0].id)
  assert(!!afterRate && afterRate.intervalDays === 1, 'the new state is persisted')
  const log = listReviewLog(cards[0].id)
  assert(log.length === 1 && log[0].grade === 'good' && !log[0].migrated, 'each grade is logged')
  const nowIso = new Date().toISOString()
  assert(!listDueReviews(nowIso).some((q) => q.id === note.id), 'a rated card leaves the due list')

  // Legacy callers that grade by note id grade the note's first card.
  rateReview(note.id, 'hard')
  assert(listReviewLog(cards[0].id).length === 2, 'grading by note id grades its first card')
  let threw = false
  try {
    rateReview('itm_missing', 'good')
  } catch {
    threw = true
  }
  assert(threw, 'grading a note that is not in review throws')

  const reEnqueue = enqueueReview(note.id)
  assert(reEnqueue.alreadyEnrolled && reEnqueue.created === 0, 'enqueue leaves an existing schedule untouched')
  assert(!listDueReviews(nowIso).some((q) => q.id === note.id), 're-enqueue does not make it due again')

  assert(removeReview(note.id) === true, 'removeReview deletes the cards')
  assert(getReviewState(note.id) === null, 'the state is gone after removal')
  assert(
    (getDb().prepare('SELECT COUNT(*) AS c FROM review_log WHERE card_id = ?').get(cards[0].id) as { c: number }).c === 0,
    'removal also clears that card history',
  )
  assert(removeReview(note.id) === false, 'removing a missing note returns false')

  // A long note is enrolled at chunk level; each chunk card reveals its chunk.
  const para = (n: number) =>
    `Section ${n}. ` + Array.from({ length: 40 }, (_, i) => `Sentence ${i} of section ${n} explains a detail.`).join(' ')
  const longNote = createItem({
    title: 'Cell transport chapter',
    body: [para(1), para(2), para(3)].join('\n\n'),
    kind: 'note',
    para: 'resources',
  })
  const longRes = enqueueReview(longNote.id)
  const longCards = listCardsForItem(longNote.id)
  assert(longRes.created > 1 && longCards.length === longRes.created, `a long note becomes ${longRes.created} chunk cards`)
  assert(longCards.every((c, i) => c.chunkIndex === i), 'chunk cards follow chunk order')
  const longDue = listDueReviews(far, 50).filter((q) => q.id === longNote.id)
  assert(longDue.length === longCards.length, 'every chunk card is due')
  assert(
    longDue.every((q) => q.chunk_count === longCards.length && q.card_text.length < longNote.body.length),
    'a chunk card reveals its chunk, not the whole note',
  )
  assert(createNoteCards(longNote.id).alreadyEnrolled, 'createNoteCards is idempotent')

  // Deleting the note cascades to its cards, schedules and history.
  rateReview(longCards[0].id, 'again')
  deleteItem(longNote.id)
  assert(listCardsForItem(longNote.id).length === 0, 'deleting the note removes its cards')
  assert(
    (getDb().prepare('SELECT COUNT(*) AS c FROM card_schedule WHERE card_id = ?').get(longCards[0].id) as { c: number })
      .c === 0,
    'and their schedules',
  )

  // Trashed and archived notes are excluded from the queue.
  const trashedNote = createItem({ title: 'Trash me', body: 'x', kind: 'note', para: 'resources' })
  enqueueReview(trashedNote.id)
  assert(listDueReviews(far).some((q) => q.id === trashedNote.id), 'an active note is due')
  trashItem(trashedNote.id)
  assert(!listDueReviews(far).some((q) => q.id === trashedNote.id), 'trashed notes are excluded')

  const archivedNote = createItem({ title: 'Archive me', body: 'x', kind: 'note', para: 'resources' })
  enqueueReview(archivedNote.id)
  updateItem(archivedNote.id, { status: 'archived' })
  assert(!listDueReviews(far).some((q) => q.id === archivedNote.id), 'archived notes are excluded')
  assert(countDueReviews(far) === 0, 'the count matches the visible queue')

  // Project filter: listDueReviews / countDueReviews scope to one project.
  const projA = createItem({ title: 'Project A note', body: 'x', kind: 'note', para: 'resources', project: 'Alpha' })
  const projB = createItem({ title: 'Project B note', body: 'x', kind: 'note', para: 'resources', project: 'Beta' })
  enqueueReview(projA.id)
  enqueueReview(projB.id)
  const alphaDue = listDueReviews(far, 50, 'Alpha')
  assert(alphaDue.some((q) => q.id === projA.id), 'the project filter returns the matching due note')
  assert(!alphaDue.some((q) => q.id === projB.id), 'the project filter excludes other projects')
  assert(countDueReviews(far, 'Alpha') === 1, 'countDueReviews respects the project filter')
  assert(countDueReviews(far, 'Beta') === 1, 'countDueReviews counts the other project')
  assert(listDueReviews(far, 50).length === 2, 'no project filter returns every due note')
  // Moving a note moves its cards: the project comes from the note.
  updateItem(projB.id, { project: 'Alpha' })
  assert(countDueReviews(far, 'Alpha') === 2, 'a card follows its note into another project')

  const states = listReviewStates()
  assert(
    Array.isArray(states) &&
      states.length > 0 &&
      states.every((s) => typeof s.cardId === 'string' && typeof s.itemId === 'string' && typeof s.dueAt === 'string'),
    'listReviewStates returns card rows',
  )

  closeDb()

  // --- Migration v6 → v7: note-keyed review_schedule rows become cards ---
  console.log('\nmigration v7 (review_schedule → study cards)')
  const migPath = path.join(tmp, 'legacy.sqlite')
  initDb(migPath)
  const n1 = createItem({ title: 'Legacy reviewed', body: 'Mitochondria make ATP.', kind: 'note', para: 'resources' })
  const n2 = createItem({ title: 'Legacy new', body: 'Ribosomes make proteins.', kind: 'note', para: 'resources' })
  closeDb()
  // Rebuild the v6 shape: drop the v7 tables, recreate review_schedule with two rows, set user_version 6.
  const raw = new Database(migPath)
  raw.exec(`
    DROP TABLE review_log; DROP TABLE card_schedule; DROP TABLE study_cards;
    CREATE TABLE review_schedule (
      item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL, interval_days REAL NOT NULL DEFAULT 0, ease REAL NOT NULL DEFAULT 2.5,
      reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, last_grade TEXT,
      last_reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  raw
    .prepare(
      `INSERT INTO review_schedule VALUES
       (?, '2026-02-01T00:00:00.000Z', 6, 2.36, 3, 1, 'hard', '2026-01-26T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-26T00:00:00.000Z'),
       (?, '2026-01-02T00:00:00.000Z', 0, 2.5, 0, 0, NULL, NULL, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    )
    .run(n1.id, n2.id)
  raw.pragma('user_version = 6')
  raw.close()

  initDb(migPath)
  const mc1 = listCardsForItem(n1.id)
  const mc2 = listCardsForItem(n2.id)
  assert(mc1.length === 1 && mc2.length === 1, 'each scheduled note becomes one card')
  assert(mc1[0].chunkIndex === null && mc1[0].sourceKey === `note:${n1.id}`, 'migrated cards are whole-note cards')
  const ms1 = getCardState(mc1[0].id)
  assert(
    !!ms1 && ms1.intervalDays === 6 && Math.abs(ms1.ease - 2.36) < 1e-9 && ms1.reps === 3 && ms1.lapses === 1,
    'the schedule (interval, ease, reps, lapses) is preserved',
  )
  const mrow = getDb().prepare('SELECT * FROM card_schedule WHERE card_id = ?').get(mc1[0].id) as Record<string, unknown>
  assert(
    mrow.due_at === '2026-02-01T00:00:00.000Z' && mrow.last_grade === 'hard' && mrow.last_reviewed_at === '2026-01-26T00:00:00.000Z',
    'due date and last grade are preserved',
  )
  const mlog = listReviewLog(mc1[0].id)
  assert(mlog.length === 1 && mlog[0].grade === 'hard' && mlog[0].migrated, 'the last grade becomes one migrated log row')
  assert(listReviewLog(mc2[0].id).length === 0, 'a never-reviewed note gets no log row')
  const tables = (getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
    (t) => t.name,
  )
  assert(tables.includes('review_schedule_legacy') && !tables.includes('review_schedule'), 'the old table is kept as a backup')
  const legacyCount = getDb().prepare('SELECT COUNT(*) AS c FROM review_schedule_legacy').get() as { c: number }
  assert(legacyCount.c === 2, 'the backup keeps every original row')
  assert(Number(getDb().pragma('user_version', { simple: true })) >= 7, 'user_version is bumped')
  closeDb()
  // Re-opening is a no-op (idempotent).
  initDb(migPath)
  assert(listCardsForItem(n1.id).length === 1, 're-opening the migrated vault adds nothing')
  closeDb()

  // A fresh vault drops the empty v3 table instead of keeping an empty backup.
  initDb(path.join(tmp, 'fresh.sqlite'))
  const freshTables = (getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(
    (t) => t.name,
  )
  assert(
    !freshTables.includes('review_schedule') && !freshTables.includes('review_schedule_legacy') && freshTables.includes('study_cards'),
    'a fresh vault has the card tables and no review_schedule',
  )
  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
