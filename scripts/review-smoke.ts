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
import {
  initDb,
  closeDb,
  createItem,
  trashItem,
  updateItem,
  deleteItem,
  getDb,
  normalizeExamDate,
  getProjectSettings,
  setProjectExamDate,
  listProjects,
  renameProject,
  mergeProject,
  deleteProject,
} from '../electron/db'
import {
  boilerplateReason,
  cardUnitsForNote,
  contentWords,
  createNoteCards,
  enrollProject,
  enrollSkipReason,
  listCardsForItem,
  noteCardKey,
  WHOLE_NOTE_MAX_CHARS,
} from '../electron/study-cards'
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
  examDateForCard,
  getStudyStats,
  summarizeLastSession,
  calendarDaysUntil,
  capIntervalForExam,
  newCardBudget,
  unreachableNewCards,
  buildReviewQueue,
  toReviewGrade,
  reviewGradeToSelfGrade,
  getNewCardBudget,
  NEW_CARDS_PER_DAY_MAX,
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

  // --- Exam-aware spacing (#264, pure) ---
  console.log('\ncalendarDaysUntil')
  const evening = new Date(2026, 9, 8, 23, 30) // local time, so the test is time-zone independent
  assert(calendarDaysUntil('2026-10-22', evening) === 14, 'exam in 14 calendar days, even late in the day')
  assert(calendarDaysUntil('2026-10-22', new Date(2026, 9, 8, 0, 1)) === 14, 'and early in the day')
  assert(calendarDaysUntil('2026-10-09', evening) === 1 && calendarDaysUntil('2026-10-08', evening) === 0, 'tomorrow 1, today 0')
  assert(calendarDaysUntil('2026-10-01', evening) === -7, 'passed exams are negative')
  assert(calendarDaysUntil(null, evening) === null && calendarDaysUntil('', evening) === null, 'no date → null')

  console.log('\ncapIntervalForExam')
  const capped = (i: number, d: number | null) => capIntervalForExam(i, d).intervalDays
  assert(capped(40, null) === 40, 'no exam → no cap')
  assert(capped(40, -3) === 40, 'exam passed → normal SM-2 resumes')
  assert(capped(40, 0) === 40 && capped(40, 1) === 40, 'exam today or tomorrow → no cap (nothing fits before it)')
  assert(capped(0, 10) === 0, 'a missed card stays due now')
  assert(capped(3, 14) === 3, 'short horizon: an interval under half the remaining time is kept')
  assert(capped(25, 14) === 6 && capIntervalForExam(25, 14).capped, 'short horizon: 25 d with 14 d left → 6 d (half of 13)')
  assert(capped(10, 14) === 6, 'over half the remaining time is cut to half')
  assert(capped(60, 120) === 59 && capped(30, 120) === 30, 'long horizon: only intervals past half are cut')
  assert(capped(5, 4) === 3 && capped(2, 4) === 2, '≤3 days remaining: land on the day before the exam')
  assert(capped(5, 2) === 1, 'exam in 2 days: the next review is tomorrow, the day before')
  // Walk a card that keeps getting Good: no review ever lands on or after the exam day, the last one lands 1 day before.
  let day = 0
  let interval = 1
  const reviewDays: number[] = [0]
  while (true) {
    const next = capped(Math.max(1, Math.round(interval * 2.5)), 14 - day)
    if (day + next >= 14) break
    day += next
    interval = next
    reviewDays.push(day)
  }
  assert(reviewDays[reviewDays.length - 1] === 13, `the last review lands the day before the exam (days ${reviewDays.join(', ')})`)
  assert(reviewDays.length >= 3, 'a well-known card is still seen at least twice before the exam')

  // scheduleReview applies the cap with an exam date.
  const examNow = new Date(2026, 9, 8, 12, 0)
  const longCard = { intervalDays: 20, ease: 2.5, reps: 4, lapses: 0 }
  const capRes = scheduleReview(longCard, 'good', { now: examNow, targetDate: '2026-10-22' })
  assert(capRes.state.intervalDays === 6 && capRes.capped, 'scheduleReview caps a 50-day Good to 6 days with the exam in 14')
  assert(new Date(capRes.dueAt) < new Date(2026, 9, 22), 'the due date is before the exam')
  assert(scheduleReview(longCard, 'good', { now: examNow }).state.intervalDays === 50, 'without an exam the interval is 50 days')
  assert(scheduleReview(longCard, 'good', { now: examNow, targetDate: '2026-09-01' }).state.intervalDays === 50, 'after the exam, no cap')

  console.log('\nnewCardBudget / unreachableNewCards')
  assert(newCardBudget(60, 14) === 5, 'worked example: Regents in 14 days, ~60 chunks → 5 new cards a day')
  assert(newCardBudget(70 + 80, 30) === 6, 'worked example: A+ Core 1 in 30 days, 70 chunks + 80 reverse → 6 a day')
  assert(newCardBudget(1000, 14) === NEW_CARDS_PER_DAY_MAX, 'the budget is capped at 25')
  assert(newCardBudget(40, null) === 25 && newCardBudget(10, null) === 10, 'no exam → up to 25 a day')
  assert(newCardBudget(30, 2) === 25 && newCardBudget(3, 1) === 3, 'the last days: whatever is left, still at most 25')
  assert(newCardBudget(0, 14) === 0, 'nothing left → 0')
  assert(unreachableNewCards(60, 14) === 0, '60 cards in 14 days are all reachable')
  assert(unreachableNewCards(400, 14) === 100, '400 cards in 14 days: 25 × 12 = 300 reachable, 100 not')
  assert(unreachableNewCards(400, null) === 0 && unreachableNewCards(400, -1) === 0, 'no warning with no exam or after it')

  console.log('\nbuildReviewQueue (pure)')
  const qc = (id: string, o: Partial<{ project: string | null; dueAt: string; lastGrade: string | null; isNew: boolean }>) => ({
    id,
    project: 'P',
    dueAt: '2026-10-08T10:00:00.000Z',
    lastGrade: null,
    isNew: false,
    ...o,
  })
  const queue = buildReviewQueue(
    [
      qc('new1', { isNew: true }),
      qc('good-early', { lastGrade: 'good', dueAt: '2026-10-01T00:00:00.000Z' }),
      qc('hard', { lastGrade: 'hard', dueAt: '2026-10-07T00:00:00.000Z' }),
      qc('new2', { isNew: true }),
      qc('again', { lastGrade: 'again', dueAt: '2026-10-08T09:00:00.000Z' }),
      qc('good-late', { lastGrade: 'easy', dueAt: '2026-10-05T00:00:00.000Z' }),
      qc('new3', { isNew: true }),
      qc('other-new', { isNew: true, project: 'Q' }),
    ],
    (p) => (p === 'P' ? 2 : 0),
  ).map((c) => c.id)
  assert(
    queue.join(',') === 'again,hard,good-early,good-late,new1,new2',
    `missed first, then Partly, then due by date, then new within budget (${queue.join(',')})`,
  )

  console.log('\ngrade scales')
  assert(toReviewGrade('missed') === 'again' && toReviewGrade('partial') === 'hard' && toReviewGrade('got') === 'good', 'Missed/Partly/Got it → again/hard/good')
  assert(toReviewGrade('easy') === 'easy' && toReviewGrade('good') === 'good', 'SM-2 grades pass through (legacy easy kept)')
  let badGrade = false
  try {
    toReviewGrade('perfect')
  } catch {
    badGrade = true
  }
  assert(badGrade, 'unknown grades are rejected')
  assert(reviewGradeToSelfGrade('easy') === 'got' && reviewGradeToSelfGrade('hard') === 'partial' && reviewGradeToSelfGrade(null) === null, 'old easy reads as Got it')

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

  // --- Exam date per project (#261) ---
  console.log('\nproject exam dates')
  assert(normalizeExamDate('2026-06-01') === '2026-06-01', 'a real ISO date is accepted')
  assert(normalizeExamDate('') === null && normalizeExamDate(null) === null, 'empty clears the date')
  for (const bad of ['2026-02-30', '06/01/2026', '2026-6-1', 'tomorrow']) {
    let rejected = false
    try {
      normalizeExamDate(bad)
    } catch {
      rejected = true
    }
    assert(rejected, `"${bad}" is rejected`)
  }
  let noName = false
  try {
    setProjectExamDate('  ', '2026-06-01')
  } catch {
    noName = true
  }
  assert(noName, 'a project name is required')

  const bio = createItem({ title: 'Bio note', body: 'Osmosis moves water.', kind: 'note', para: 'resources', project: 'Bio' })
  assert(getProjectSettings('Bio').examDate === null, 'a project starts with no exam date')
  setProjectExamDate('Bio', '2027-01-15')
  assert(getProjectSettings('Bio').examDate === '2027-01-15', 'the exam date is saved')
  assert(listProjects().find((p) => p.name === 'Bio')?.examDate === '2027-01-15', 'listProjects returns examDate')
  assert(listProjects().find((p) => p.name === 'Alpha')?.examDate === null, 'projects without a date list null')

  // A card reads the date from its note's current project.
  enqueueReview(bio.id)
  const bioCard = listCardsForItem(bio.id)[0]
  assert(examDateForCard(bioCard.id) === '2027-01-15', 'a card reads its project exam date')
  const examIn20 = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
  setProjectExamDate('Bio', examIn20)
  assert(rateReview(bioCard.id, 'good').intervalDays === 3, 'rateReview anchors the first Good to the exam date (20 d → 3 d)')
  const loose = createItem({ title: 'Loose note', body: 'No project here.', kind: 'note', para: 'resources' })
  enqueueReview(loose.id)
  const looseCard = listCardsForItem(loose.id)[0]
  assert(examDateForCard(looseCard.id) === null, 'a note with no project has no exam date')
  assert(rateReview(looseCard.id, 'good').intervalDays === 1, 'no project → plain first interval')
  updateItem(loose.id, { project: 'Bio' })
  assert(examDateForCard(looseCard.id) === examIn20, 'moving a note into a project picks up its exam date')

  // Rename carries the settings; the destination keeps its own date on conflict.
  renameProject('Bio', 'Biology')
  assert(getProjectSettings('Bio').examDate === null, 'rename removes the old settings row')
  assert(getProjectSettings('Biology').examDate === examIn20, 'rename carries the exam date')
  assert(examDateForCard(bioCard.id) === examIn20, 'cards follow the renamed project')
  createItem({ title: 'Chem note', body: 'x', kind: 'note', para: 'resources', project: 'Chem' })
  setProjectExamDate('Chem', '2027-03-01')
  createItem({ title: 'Phys note', body: 'x', kind: 'note', para: 'resources', project: 'Phys' })
  setProjectExamDate('Phys', '2027-04-01')
  renameProject('Phys', 'Chem')
  assert(getProjectSettings('Chem').examDate === '2027-03-01', 'renaming onto a dated project keeps the destination date')
  assert(getProjectSettings('Phys').examDate === null, 'and drops the source row')

  // Merge: the destination's date wins; a destination with none takes the source's.
  mergeProject('Biology', 'Chem')
  assert(getProjectSettings('Chem').examDate === '2027-03-01', 'merge keeps the destination date')
  assert(getProjectSettings('Biology').examDate === null, 'merge removes the source settings')
  createItem({ title: 'Geo note', body: 'x', kind: 'note', para: 'resources', project: 'Geo' })
  createItem({ title: 'Hist note', body: 'x', kind: 'note', para: 'resources', project: 'Hist' })
  setProjectExamDate('Geo', '2027-05-01')
  mergeProject('Geo', 'Hist')
  assert(getProjectSettings('Hist').examDate === '2027-05-01', 'merge into an undated project takes the source date')
  setProjectExamDate('Hist', null)
  assert(getProjectSettings('Hist').examDate === null, 'the date can be cleared')

  // Delete removes the settings with the notes.
  deleteProject('Chem')
  assert(
    (getDb().prepare(`SELECT COUNT(*) AS c FROM project_settings WHERE name = 'Chem'`).get() as { c: number }).c === 0,
    'deleting a project removes its settings',
  )

  // --- Study this project (#262) ---
  console.log('\nboilerplate detection (pure)')
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
  assert(contentWords('Source: bio.pdf\nPage: 3\n\nOne two three').length === 3, 'import header lines are not content')
  assert(boilerplateReason('') === 'empty', 'an empty body is empty')
  assert(boilerplateReason('Source: x.pdf\nPage: 1\n\nCover') === 'too short to quiz on', 'a near-empty page is too short')
  const regentsCover = `Source: regents.pdf\nPage: 1\n\nLIVING ENVIRONMENT The University of the State of New York REGENTS HIGH SCHOOL EXAMINATION
Student Name______________ School Name______________
The possession or use of any communications device is strictly prohibited when taking this examination.
A separate answer sheet for multiple-choice questions has been provided. Follow the instructions from the proctor.
You must sign the declaration printed on your separate answer sheet. ${words(150)}
DO NOT OPEN THIS EXAMINATION BOOKLET UNTIL THE SIGNAL IS GIVEN.`
  assert(boilerplateReason(regentsCover)?.startsWith('boilerplate') === true, 'an exam cover/instructions page is boilerplate')
  const comptiaAbout = `Copyright © 2024 CompTIA, Inc. All rights reserved. About the Exam. Individuals who utilize brain dumps
violate the CompTIA Candidate Agreement. ${words(200)}`
  assert(boilerplateReason(comptiaAbout)?.startsWith('boilerplate') === true, 'a copyright + exam-policy page is boilerplate')
  const contentWithHeader = `CompTIA A+ 220-1201 Exam Objectives. Copyright © 2024 CompTIA, Inc. All rights reserved.
1.1 Given a scenario, monitor mobile device hardware and use appropriate replacement techniques. ${words(200)}`
  assert(boilerplateReason(contentWithHeader) === null, 'a long content page with one repeated copyright header is kept')
  assert(
    boilerplateReason(`We use cookies to improve your experience. Accept all cookies. ${words(40)}`)?.startsWith('boilerplate') === true,
    'a short cookie-banner page is boilerplate',
  )
  const realNote = `Photosynthesis converts light energy into chemical energy. ${words(30)}`
  assert(boilerplateReason(realNote) === null, 'a real note is kept')
  assert(
    enrollSkipReason({ body: realNote, kind: 'note', status: 'ai-draft' })?.includes('AI draft') === true,
    'unconfirmed AI drafts are skipped',
  )
  assert(enrollSkipReason({ body: realNote, kind: 'transcript', status: 'active' })?.includes('transcript') === true, 'transcripts are skipped')
  assert(enrollSkipReason({ body: realNote, kind: 'book', status: 'active' }) === null, 'book pages are enrolled')
  assert(
    enrollSkipReason({ body: 'ATP is the energy currency of the cell.', kind: 'note', status: 'active' }) === null,
    'a short note of your own is enrolled (boilerplate rules apply to imports only)',
  )
  const messyPaste = `Skip to main content\nWe use cookies to improve your experience. Accept all\nLaser printer imaging: Processing, Charging, Exposing, Developing, Transferring, Fusing, Cleaning.\n© 2026 Some Training Site. All rights reserved. Privacy · Terms`
  assert(enrollSkipReason({ body: messyPaste, kind: 'note', status: 'active' }) === null, 'a messy paste in your own note is kept')
  assert(enrollSkipReason({ body: messyPaste, kind: 'article', status: 'active' })?.startsWith('boilerplate') === true, 'the same text as an imported article page is boilerplate')
  assert(enrollSkipReason({ body: 'TODO', kind: 'note', status: 'active' }) === 'too short to quiz on', 'a one-word stub is skipped')
  assert(enrollSkipReason({ body: '  ', kind: 'note', status: 'active' }) === 'empty', 'an empty note is skipped')
  assert(enrollSkipReason({ body: realNote, kind: 'article', status: 'active' }) === null, 'articles are enrolled')

  console.log('\nenrollProject')
  const course = 'Regents Bio'
  const mk = (title: string, body: string, extra: Record<string, unknown> = {}) =>
    createItem({ title, body, kind: 'note', para: 'resources', project: course, ...extra } as Parameters<typeof createItem>[0])
  const good1 = mk('Osmosis', `Osmosis is the diffusion of water across a membrane. ${words(30)}`)
  const good2 = mk('Enzymes', `Enzymes are biological catalysts that lower activation energy. ${words(30)}`)
  const page = mk('Regents · p.5', `Source: bio.pdf\nPage: 5\n\n${[para(1), para(2), para(3)].join('\n\n')}`, { kind: 'book' })
  const article = mk('Cell article', `Cells are the basic unit of life. ${words(40)}`, { kind: 'article' })
  const cover = mk('Regents · p.1', regentsCover, { kind: 'book' })
  const draft = mk('Draft: ATP', `ATP stores energy in phosphate bonds. ${words(30)}`, { status: 'ai-draft' })
  const tiny = mk('Stub', 'TODO')
  const transcript = mk('Lecture · 00:00', `Today we talk about mitosis. ${words(40)}`, { kind: 'transcript' })
  const trashed = mk('Old', `Old note body text. ${words(30)}`)
  trashItem(trashed.id)
  const preEnrolled = mk('Already', `Already in review before bulk enrol. ${words(30)}`)
  enqueueReview(preEnrolled.id)

  let threwNoProject = false
  try {
    enrollProject('  ')
  } catch {
    threwNoProject = true
  }
  assert(threwNoProject, 'enrollProject needs a project')

  const first = enrollProject(course)
  const pageCards = listCardsForItem(page.id).length
  assert(pageCards > 1, `a long imported page becomes ${pageCards} chunk cards`)
  assert(first.notes === 4, `four notes enrolled (got ${first.notes})`)
  assert(first.cards === 3 + pageCards, `cards = 3 whole-note + ${pageCards} chunk cards (got ${first.cards})`)
  assert(first.alreadyScheduled === 1, 'the pre-enrolled note is counted as already scheduled')
  const skippedIds = first.skipped.map((x) => x.itemId).sort()
  assert(
    JSON.stringify(skippedIds) === JSON.stringify([cover.id, draft.id, tiny.id, transcript.id].sort()),
    'cover, AI draft, stub and transcript are skipped',
  )
  assert(first.skipped.every((x) => x.reason && x.title), 'every skip has a title and a reason')
  assert(!first.skipped.some((x) => x.itemId === trashed.id), 'trashed notes are ignored entirely')
  assert(listCardsForItem(good1.id).length === 1 && listCardsForItem(article.id).length === 1, 'short notes are one card each')

  rateReview(listCardsForItem(good1.id)[0].id, 'good')
  const second = enrollProject(course)
  assert(second.notes === 0 && second.cards === 0, 'running it twice adds nothing')
  assert(second.alreadyScheduled === 5, 'everything enrolled is now already scheduled')
  assert(getCardState(listCardsForItem(good1.id)[0].id)?.reps === 1, 'a second run does not reset a schedule')
  assert(
    (getDb().prepare('SELECT COUNT(*) AS c FROM study_cards c JOIN items i ON i.id = c.item_id WHERE i.project = ?').get(course) as { c: number }).c ===
      first.cards + 1,
    'no duplicate cards',
  )
  // Confirming the draft makes it eligible on the next run.
  updateItem(draft.id, { status: 'active' })
  const third = enrollProject(course)
  assert(third.notes === 1 && third.cards === 1, 'a confirmed draft is enrolled on the next run')
  void good2

  console.log('\nstudy stats')
  const stats = getStudyStats(course)
  const courseCards = first.cards + 1 + third.cards
  assert(stats.project === course && stats.totalCards === courseCards, `stats count ${courseCards} cards`)
  assert(stats.due === courseCards - 1, 'due counts every card but the one just graded')
  assert(stats.newCards === courseCards - 1, 'new cards are the never-reviewed ones')
  assert(stats.liveNotes === 9 && stats.enrolledNotes === 6, `live notes 9, enrolled 6 (got ${stats.liveNotes}/${stats.enrolledNotes})`)
  assert(stats.lastSession?.reviewed === 1 && stats.lastSession.got === 1 && stats.lastSession.score === 1, 'last session from the review log')
  assert(stats.examDate === null, 'no exam date set yet')
  setProjectExamDate(course, '2027-06-18')
  assert(getStudyStats(course).examDate === '2027-06-18', 'stats include the exam date')
  const all = getStudyStats()
  assert(all.project === null && all.examDate === null && all.totalCards >= courseCards, 'all-projects stats have no exam date')

  console.log('\nsummarizeLastSession (pure)')
  assert(summarizeLastSession([]) === null, 'no reviews → no session')
  const t = (min: number) => new Date(Date.UTC(2026, 9, 8, 12, 0) + min * 60_000).toISOString()
  const sess = summarizeLastSession([
    { grade: 'again', reviewedAt: t(-120) }, // earlier session (90-min gap)
    { grade: 'good', reviewedAt: t(0) },
    { grade: 'hard', reviewedAt: t(5) },
    { grade: 'again', reviewedAt: t(20) },
    { grade: 'easy', reviewedAt: t(45) },
  ])
  assert(sess?.reviewed === 4, 'the last session is the run with gaps under 30 minutes')
  assert(sess?.got === 2 && sess.partial === 1 && sess.missed === 1, 'got/partial/missed counts')
  assert(sess?.score === 0.5 && sess.startedAt === t(0) && sess.endedAt === t(45), 'score and bounds')

  // --- Exam-aware queue over the DB (#264) ---
  console.log('\nexam-aware queue')
  const examCourse = 'Exam course'
  const examNotes = Array.from({ length: 60 }, (_, i) =>
    createItem({ title: `Card ${i}`, body: `Fact number ${i} about the course. ${words(25)}`, kind: 'note', para: 'resources', project: examCourse }),
  )
  enrollProject(examCourse)
  const in14 = new Date(Date.now() + 14 * 86_400_000)
  const in14Day = `${in14.getFullYear()}-${String(in14.getMonth() + 1).padStart(2, '0')}-${String(in14.getDate()).padStart(2, '0')}`
  setProjectExamDate(examCourse, in14Day)
  const b0 = getNewCardBudget(examCourse)
  assert(b0.perDay === 5 && b0.leftToday === 5 && b0.unreachable === 0, `60 cards, exam in 14 days → 5 new today (got ${JSON.stringify(b0)})`)
  const q0 = listDueReviews(undefined, 50, examCourse)
  assert(q0.length === 5 && q0.every((q) => q.reps === 0), 'the session holds only 5 new cards')
  assert(q0[0].title === 'Card 0' && q0[4].title === 'Card 4', 'new cards come in reading order')
  assert(countDueReviews(undefined, examCourse) === 5 && getStudyStats(examCourse).due === 5, 'count and stats match the queue')

  // Grade them: one missed, one partly, three got it.
  rateReview(q0[0].card_id, 'good')
  rateReview(q0[1].card_id, 'again')
  rateReview(q0[2].card_id, 'hard')
  rateReview(q0[3].card_id, 'good')
  rateReview(q0[4].card_id, 'good')
  const b1 = getNewCardBudget(examCourse)
  assert(b1.perDay === 5 && b1.leftToday === 0, 'the day\'s budget is used up (it does not grow back during the day)')
  const q1 = listDueReviews(undefined, 50, examCourse)
  assert(q1.length === 1 && q1[0].card_id === q0[1].card_id, 'only the missed card is due again today')
  const later = new Date(Date.now() + 2 * 86_400_000).toISOString()
  const q2 = listDueReviews(later, 50, examCourse)
  assert(q2[0].card_id === q0[1].card_id && q2[1].card_id === q0[2].card_id, 'later: the missed card first, then Partly')
  // The cap keeps every schedule before the exam.
  const examMidnight = new Date(in14.getFullYear(), in14.getMonth(), in14.getDate()).toISOString()
  for (let r = 0; r < 6; r++) rateReview(q0[0].card_id, 'good')
  const capRow = getDb().prepare('SELECT due_at FROM card_schedule WHERE card_id = ?').get(q0[0].card_id) as { due_at: string }
  assert(capRow.due_at < examMidnight, 'repeated Got it never schedules past the exam')

  // More cards than 25 a day can cover → a warning count.
  for (let i = 0; i < 300; i++) {
    createItem({ title: `Extra ${i}`, body: `Extra fact ${i}. ${words(25)}`, kind: 'note', para: 'resources', project: examCourse })
  }
  enrollProject(examCourse)
  const b2 = getNewCardBudget(examCourse)
  assert(b2.perDay === 25, 'a big backlog hits the 25-a-day maximum')
  assert(b2.unreachable === 360 - 25 * 12, `cards that won't be reached are counted (${b2.unreachable})`)
  assert(getStudyStats(examCourse).unreachable === b2.unreachable, 'stats carry the warning count')
  void examNotes

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

  // --- Migration v7 → v8: an existing v7 vault gains project_settings ---
  console.log('\nmigration v8 (project_settings)')
  const v7Path = path.join(tmp, 'v7.sqlite')
  initDb(v7Path)
  createItem({ title: 'Existing', body: 'x', kind: 'note', para: 'resources', project: 'Kept' })
  closeDb()
  const raw7 = new Database(v7Path)
  raw7.exec('DROP TABLE project_settings')
  raw7.pragma('user_version = 7')
  raw7.close()
  initDb(v7Path)
  assert(Number(getDb().pragma('user_version', { simple: true })) >= 8, 'v7 vault upgrades')
  assert(listProjects().some((p) => p.name === 'Kept' && p.examDate === null), 'existing projects list with no date')
  setProjectExamDate('Kept', '2027-02-02')
  assert(getProjectSettings('Kept').examDate === '2027-02-02', 'the upgraded vault stores exam dates')
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
