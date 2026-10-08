/**
 * #216 — spaced-review scheduling over the user's own notes.
 *
 *   npm run test:review
 *
 * Runs under Electron-as-Node against a temp DB. Covers the pure SM-2-style
 * math and the `review_schedule` accessors (migration v3).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDb, closeDb, createItem, trashItem, updateItem } from '../electron/db'
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

  // --- DB accessors ---
  console.log('\nreview_schedule accessors')
  const note = createItem({
    title: 'Photosynthesis',
    body: 'Chlorophyll captures light to make glucose from CO2 and water.',
    kind: 'note',
    para: 'resources',
  })
  assert(getReviewState(note.id) === null, 'a new note is not in review')

  const enqueued = enqueueReview(note.id)
  assert(enqueued.intervalDays === 0 && enqueued.reps === 0, 'enqueue starts a fresh schedule')
  assert(getReviewState(note.id) !== null, 'enqueue persists the row')

  const far = new Date(Date.now() + 60_000).toISOString()
  assert(listDueReviews(far).some((q) => q.id === note.id), 'an enqueued note is due')
  assert(countDueReviews(far) === 1, 'countDueReviews counts the due note')
  const dueItem = listDueReviews(far)[0]
  assert(dueItem.title === 'Photosynthesis' && dueItem.body.length > 0, 'the queue returns the note body')

  const rated = rateReview(note.id, 'good')
  assert(rated.reps === 1 && rated.intervalDays === 1, 'good advances the schedule')
  const afterRate = getReviewState(note.id)
  assert(!!afterRate && afterRate.intervalDays === 1, 'the new state is persisted')
  const nowIso = new Date().toISOString()
  assert(!listDueReviews(nowIso).some((q) => q.id === note.id), 'a rated note leaves the due list')

  const reEnqueue = enqueueReview(note.id)
  assert(reEnqueue.intervalDays === 1, 'enqueue leaves an existing schedule untouched')
  assert(!listDueReviews(nowIso).some((q) => q.id === note.id), 're-enqueue does not make it due again')

  assert(removeReview(note.id) === true, 'removeReview deletes the row')
  assert(getReviewState(note.id) === null, 'the state is gone after removal')
  assert(removeReview(note.id) === false, 'removing a missing row returns false')

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

  const states = listReviewStates()
  assert(
    Array.isArray(states) && states.every((s) => typeof s.itemId === 'string' && typeof s.dueAt === 'string'),
    'listReviewStates returns rows',
  )

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
