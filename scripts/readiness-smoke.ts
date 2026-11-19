/**
 * Offline smoke for exam readiness (#420): grouping rules (Strong / Shaky /
 * Not studied), evidence lines, the project dashboard, and Work on weak spots
 * starting a session on the right notes. No network; a temp DB only.
 *
 *   npm run test:readiness
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-420-'))
process.env.LKV_USER_DATA_DIR = tmp
process.env.LKV_OLLAMA_URL = 'http://127.0.0.1:9'
process.env.LKV_LMSTUDIO_URL = 'http://127.0.0.1:9/v1'

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

function main(): void {
  console.log('\n=== Local Knowledge Vault — exam readiness (#420) ===\n')

  const db = require('../electron/db') as typeof import('../electron/db')
  const review = require('../electron/review') as typeof import('../electron/review')
  const cards = require('../electron/study-cards') as typeof import('../electron/study-cards')
  const study = require('../electron/study') as typeof import('../electron/study')
  const session = require('../electron/study-session') as typeof import('../electron/study-session')
  const r = require('../electron/readiness') as typeof import('../electron/readiness')

  db.initDb(path.join(tmp, 'test.sqlite'))
  const now = new Date('2026-11-19T15:00:00.000-05:00')

  console.log('Pure grouping rules')
  assert(r.classifyNote({ reviewed: false, worstLastGrade: null, openConfidentMisses: 0 }) === 'unstudied', 'never reviewed → Not studied')
  assert(r.classifyNote({ reviewed: false, worstLastGrade: 'again', openConfidentMisses: 1 }) === 'unstudied', 'no review history stays Not studied even with leftover signals')
  assert(r.classifyNote({ reviewed: true, worstLastGrade: 'again', openConfidentMisses: 0 }) === 'shaky', 'last grade Missed → Shaky')
  assert(r.classifyNote({ reviewed: true, worstLastGrade: 'hard', openConfidentMisses: 0 }) === 'shaky', 'last grade Partly → Shaky')
  assert(r.classifyNote({ reviewed: true, worstLastGrade: 'good', openConfidentMisses: 1 }) === 'shaky', 'Got it but an open confident miss → Shaky')
  assert(r.classifyNote({ reviewed: true, worstLastGrade: 'easy', openConfidentMisses: 0 }) === 'strong', 'last grade Got it, no confident miss → Strong')
  assert(r.classifyNote({ reviewed: true, worstLastGrade: 'good', openConfidentMisses: 0 }) === 'strong', 'good with no open miss → Strong')

  assert(r.worseGrade(null, 'good') === 'good' && r.worseGrade('good', null) === 'good', 'worseGrade ignores nulls')
  assert(r.worseGrade('again', 'easy') === 'again' && r.worseGrade('easy', 'hard') === 'hard' && r.worseGrade('good', 'easy') === 'good', 'again < hard < good/easy')
  assert(r.gradeEvidenceLabel('again') === 'Missed' && r.gradeEvidenceLabel('missed') === 'Missed', 'Missed labels')
  assert(r.gradeEvidenceLabel('hard') === 'Partly' && r.gradeEvidenceLabel('partial') === 'Partly', 'Partly labels')
  assert(r.gradeEvidenceLabel('good') === 'Got it' && r.gradeEvidenceLabel('easy') === 'Got it' && r.gradeEvidenceLabel('got') === 'Got it', 'Got it labels')
  assert(r.gradeEvidenceLabel(null) === null && r.gradeEvidenceLabel(undefined) === null && r.gradeEvidenceLabel('nope' as never) === null, 'unknown grade → null')

  const unstudied = r.noteFromSignals(
    { itemId: 'a', title: 'A', cards: 0, reviewed: false, lapses: 0, worstLastGrade: null, openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: null },
    '2026-12-01',
  )
  assert(unstudied.group === 'unstudied' && unstudied.reasons[0] === 'Not studied yet' && unstudied.reasons.length === 1, 'unenrolled note: Not studied yet')
  const enrolledNew = r.noteFromSignals(
    { itemId: 'b', title: 'B', cards: 2, reviewed: false, lapses: 0, worstLastGrade: null, openConfidentMisses: 0, dueBeforeExam: 2, lastReviewedAt: null },
    '2026-12-01',
  )
  assert(enrolledNew.reasons.includes('Enrolled, not reviewed yet') && enrolledNew.reasons.includes('2 cards due before the exam'), 'enrolled unreviewed lists both facts')
  const enrolledDueNow = r.noteFromSignals(
    { itemId: 'b2', title: 'B2', cards: 1, reviewed: false, lapses: 0, worstLastGrade: null, openConfidentMisses: 0, dueBeforeExam: 1, lastReviewedAt: null },
    null,
  )
  assert(enrolledDueNow.reasons.includes('1 card due now'), 'without an exam date, due cards say due now')
  const shaky = r.noteFromSignals(
    { itemId: 'c', title: 'C', cards: 3, reviewed: true, lapses: 2, worstLastGrade: 'again', openConfidentMisses: 2, dueBeforeExam: 1, lastReviewedAt: '2026-11-18T00:00:00.000Z' },
    '2026-12-01',
  )
  assert(
    shaky.group === 'shaky' &&
      shaky.reasons.includes('Last review: Missed') &&
      shaky.reasons.includes('2 lapses') &&
      shaky.reasons.includes('2 confident answers that were wrong') &&
      shaky.reasons.includes('1 card due before the exam'),
    'shaky evidence lists grade, lapses, confident misses and due cards',
  )
  const oneMiss = r.noteFromSignals(
    { itemId: 'd', title: 'D', cards: 1, reviewed: true, lapses: 1, worstLastGrade: 'hard', openConfidentMisses: 1, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
    '2026-12-01',
  )
  assert(oneMiss.reasons.includes('Last review: Partly') && oneMiss.reasons.includes('1 lapse') && oneMiss.reasons.includes('1 confident answer that was wrong'), 'singular evidence wording')
  const strong = r.noteFromSignals(
    { itemId: 'e', title: 'E', cards: 1, reviewed: true, lapses: 2, worstLastGrade: 'easy', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
    '2026-12-01',
  )
  assert(strong.group === 'strong' && strong.reasons.includes('Last review: Got it') && strong.reasons.includes('2 lapses') && !/ready/i.test(strong.reasons.join(' ')), 'recovered lapses stay as evidence on Strong; never says ready')

  assert(r.evidenceFor({ itemId: 'x', title: 'X', cards: 1, reviewed: true, lapses: 0, worstLastGrade: null, openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() }, null).length === 0, 'reviewed with no stored grade and no other signals → no evidence lines')

  console.log('\nTrend and due cut-off')
  assert(r.trendFromLog([], now) === null, 'empty log → no trend')
  assert(r.trendFromLog([{ grade: 'good', reviewedAt: 'not-a-date' }, { grade: 'good', reviewedAt: '2026-10-01T00:00:00.000Z' }], now) === null, 'invalid and too-old rows are ignored')
  const trend = r.trendFromLog(
    [
      { grade: 'good', reviewedAt: '2026-11-18T12:00:00.000-05:00' },
      { grade: 'easy', reviewedAt: '2026-11-17T12:00:00.000-05:00' },
      { grade: 'hard', reviewedAt: '2026-11-16T12:00:00.000-05:00' },
      { grade: 'again', reviewedAt: '2026-11-10T12:00:00.000-05:00' },
      { grade: 'again', reviewedAt: '2026-11-09T12:00:00.000-05:00' },
      { grade: 'good', reviewedAt: '2026-11-20T12:00:00.000-05:00' },
      { grade: 'skip', reviewedAt: '2026-11-18T12:00:00.000-05:00' },
    ],
    now,
  )
  assert(trend !== null && trend.thisWeek.got === 2 && trend.thisWeek.partial === 1 && trend.thisWeek.missed === 0, 'this week counts got + partly')
  assert(trend !== null && trend.lastWeek.got === 0 && trend.lastWeek.partial === 0 && trend.lastWeek.missed === 2, 'previous week counts misses')
  assert(r.formatWeekCounts({ got: 2, partial: 1, missed: 0 }) === '2 got it, 1 partly', 'format omits zero buckets')
  assert(r.formatWeekCounts({ got: 0, partial: 0, missed: 3 }) === '3 missed', 'format missed only')
  assert(r.formatWeekCounts({ got: 0, partial: 0, missed: 0 }) === 'no reviews', 'format empty week')

  const examCutoff = r.dueBeforeExamCutoff('2026-11-25', now)
  assert(examCutoff === new Date(2026, 10, 25).toISOString(), 'cut-off is local midnight of the exam day')
  assert(r.dueBeforeExamCutoff('2026-11-19', now) === now.toISOString(), 'exam today → cut-off is now')
  assert(r.dueBeforeExamCutoff('2026-11-01', now) === now.toISOString(), 'exam passed → cut-off is now')
  assert(r.dueBeforeExamCutoff(null, now) === now.toISOString() && r.dueBeforeExamCutoff('  ', now) === now.toISOString(), 'no date → cut-off is now')
  assert(r.dueBeforeExamCutoff('not-a-date', now) === now.toISOString(), 'unparseable date → cut-off is now')
  assert(r.dueBeforeExamCutoff(undefined, now) === now.toISOString(), 'undefined date → cut-off is now')

  console.log('\nOpen confident misses')
  const attempts = [
    { cardId: 'c1', itemId: 'n1', confidence: 80, selfGrade: 'missed', createdAt: '2026-11-01T00:00:00.000Z' },
    { cardId: 'c1', itemId: 'n1', confidence: 90, selfGrade: 'got', createdAt: '2026-11-02T00:00:00.000Z' },
    { cardId: 'c2', itemId: 'n1', confidence: 75, selfGrade: 'partial', createdAt: '2026-11-03T00:00:00.000Z' },
    { cardId: 'c2', itemId: 'n1', confidence: 40, selfGrade: 'missed', createdAt: '2026-11-04T00:00:00.000Z' },
    { cardId: null, itemId: 'n1', confidence: 90, selfGrade: 'missed', createdAt: '2026-11-05T00:00:00.000Z' },
    { cardId: 'c9', itemId: 'n2', confidence: 95, selfGrade: 'missed', createdAt: '2026-11-05T00:00:00.000Z' },
  ]
  assert(r.openConfidentMissCount(attempts, 'n1', ['c1', 'c2']) === 2, 'closed miss on c1; open partial on c2; note-level miss without a card')
  assert(r.openConfidentMissCount(attempts, 'n2', []) === 1, 'attempts without matching card ids still count on the note')
  assert(r.openConfidentMissCount(attempts, 'n-none', ['c1']) === 0, 'other notes are ignored')
  assert(r.openConfidentMissCount([], 'n1', ['c1']) === 0, 'no attempts → 0')

  console.log('\nbuildReadiness ordering')
  const built = r.buildReadiness(
    'Bio',
    '2026-11-25',
    [
      { itemId: 's', title: 'Strong note', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'good', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 'm', title: 'Missed note', cards: 1, reviewed: true, lapses: 1, worstLastGrade: 'again', openConfidentMisses: 0, dueBeforeExam: 1, lastReviewedAt: now.toISOString() },
      { itemId: 'p', title: 'Partly note', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'hard', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 'q', title: 'Confident miss', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'good', openConfidentMisses: 3, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 'u2', title: 'Zebra new', cards: 0, reviewed: false, lapses: 0, worstLastGrade: null, openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: null },
      { itemId: 'u1', title: 'Apple new', cards: 0, reviewed: false, lapses: 0, worstLastGrade: null, openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: null },
    ],
    [{ grade: 'good', reviewedAt: '2026-11-18T12:00:00.000-05:00' }],
    now,
  )
  assert(built.project === 'Bio' && built.daysToExam === 6 && built.dueBeforeExam === 1, 'project totals include days to exam and due-before count')
  assert(built.strong.map((n) => n.itemId).join() === 's', 'one strong note')
  assert(built.shaky.map((n) => n.itemId).join() === 'm,p,q', 'shaky order: Missed, Partly, then confident-miss')
  assert(built.unstudied.map((n) => n.title).join() === 'Apple new,Zebra new', 'unstudied notes sorted by title')
  assert(built.weakItemIds.join() === 'm,p,q,u1,u2', 'weak ids are shaky then unstudied')
  const tied = r.buildReadiness(
    'Tie',
    null,
    [
      { itemId: 'a2', title: 'Beta', cards: 1, reviewed: true, lapses: 1, worstLastGrade: 'again', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 'a1', title: 'Alpha', cards: 1, reviewed: true, lapses: 3, worstLastGrade: 'again', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 'c2', title: 'Zed', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'good', openConfidentMisses: 1, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 'c1', title: 'Amy', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'good', openConfidentMisses: 2, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 's2', title: 'Strong B', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'good', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
      { itemId: 's1', title: 'Strong A', cards: 1, reviewed: true, lapses: 0, worstLastGrade: 'good', openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: now.toISOString() },
    ],
    [],
    now,
  )
  assert(tied.shaky.map((n) => n.itemId).join() === 'a1,a2,c1,c2', 'same-grade shaky notes sort by lapses, then confident misses, then title')
  assert(tied.strong.map((n) => n.title).join() === 'Strong A,Strong B', 'strong notes sort by title')
  assert(built.trend !== null && built.trend.thisWeek.got === 1, 'trend is included when the log has recent grades')
  assert(!JSON.stringify(built).toLowerCase().includes("you're ready") && !JSON.stringify(built).toLowerCase().includes('you are ready'), 'payload never says you are ready')

  const emptyProj = r.buildReadiness('', null, [], [], now)
  assert(emptyProj.strong.length === 0 && emptyProj.trend === null && emptyProj.daysToExam === null, 'empty build has no groups or trend')

  console.log('\nDatabase: getProjectReadiness')
  db.setProjectExamDate('Bio', '2026-11-25')
  const NOTE =
    'Mitochondria are the powerhouse of the cell. They make most of the ATP a cell uses, through cellular respiration. The Krebs cycle runs in the mitochondrial matrix.'
  const strongNote = db.createItem({ title: 'ATP', body: NOTE, kind: 'note', para: 'resources', project: 'Bio' })
  const missedNote = db.createItem({ title: 'Krebs cycle', body: NOTE, kind: 'note', para: 'resources', project: 'Bio' })
  const newNote = db.createItem({ title: 'Chloroplasts', body: NOTE, kind: 'note', para: 'resources', project: 'Bio' })
  const unenrolled = db.createItem({ title: 'Glycolysis', body: NOTE, kind: 'note', para: 'resources', project: 'Bio' })
  const transcript = db.createItem({ title: 'Lecture', body: 'A long transcript of the lecture about cells and more words here.', kind: 'transcript', para: 'resources', project: 'Bio' })
  const draft = db.createItem({ title: 'Draft ATP', body: NOTE, kind: 'note', status: 'ai-draft', para: 'resources', project: 'Bio' })
  const empty = db.createItem({ title: 'Blank', body: '   ', kind: 'note', para: 'resources', project: 'Bio' })
  const other = db.createItem({ title: 'Other course', body: NOTE, kind: 'note', para: 'resources', project: 'Chem' })
  void transcript
  void draft
  void empty
  void other

  const enStrong = review.enqueueReview(strongNote.id)
  const enMissed = review.enqueueReview(missedNote.id)
  const enNew = review.enqueueReview(newNote.id)
  assert(enStrong.created > 0 && enMissed.created > 0 && enNew.created > 0, 'enrolled three notes')
  const strongCard = cards.listCardsForItem(strongNote.id)[0]
  const missedCard = cards.listCardsForItem(missedNote.id)[0]
  const newCard = cards.listCardsForItem(newNote.id)[0]
  review.rateReview(strongCard.id, 'good')
  review.rateReview(missedCard.id, 'again')
  // Strong note also has a closed confident miss (later got) and an old lapse that was recovered.
  study.recordStudyAttempt({ question: 'Q', attempt: 'wrong', confidence: 90, selfGrade: 'missed', cardId: strongCard.id, itemId: strongNote.id, grade: 'again' })
  study.recordStudyAttempt({ question: 'Q', attempt: 'right', confidence: 80, selfGrade: 'got', cardId: strongCard.id, itemId: strongNote.id, grade: 'good' })
  // Open confident miss on the missed note.
  study.recordStudyAttempt({ question: 'Q2', attempt: 'no', confidence: 85, selfGrade: 'partial', cardId: missedCard.id, itemId: missedNote.id, grade: 'hard' })

  // Back-date one strong review into last week and one into this week for the trend.
  const database = db.getDb()
  const logs = database.prepare('SELECT id, card_id, reviewed_at FROM review_log WHERE migrated = 0').all() as Array<{ id: string; card_id: string; reviewed_at: string }>
  const strongLogs = logs.filter((l) => l.card_id === strongCard.id)
  if (strongLogs[0]) {
    database.prepare('UPDATE review_log SET reviewed_at = ? WHERE id = ?').run('2026-11-10T16:00:00.000-05:00', strongLogs[0].id)
  }

  const ready = r.getProjectReadiness('Bio', now)
  assert(ready.project === 'Bio' && ready.examDate === '2026-11-25' && ready.daysToExam === 6, 'loads the project exam date')
  assert(ready.strong.some((n) => n.itemId === strongNote.id), 'ATP is Strong (got it, confident miss was later corrected)')
  assert(ready.shaky.some((n) => n.itemId === missedNote.id && n.reasons.some((s) => /Missed/.test(s))), 'Krebs cycle is Shaky from the Missed grade')
  assert(ready.unstudied.some((n) => n.itemId === newNote.id) && ready.unstudied.some((n) => n.itemId === unenrolled.id), 'enrolled-unreviewed and never-enrolled notes are Not studied')
  assert(
    !ready.unstudied.some((n) => n.itemId === transcript.id) &&
      !ready.unstudied.some((n) => n.itemId === draft.id) &&
      !ready.unstudied.some((n) => n.itemId === empty.id),
    'transcripts, unconfirmed drafts and empty notes are left out',
  )
  assert(!ready.strong.some((n) => n.itemId === other.id) && !ready.unstudied.some((n) => n.itemId === other.id), 'other projects are out of scope')
  assert(ready.weakItemIds[0] === missedNote.id && ready.weakItemIds.includes(newNote.id) && ready.weakItemIds.includes(unenrolled.id), 'weak ids start with shaky, then not studied')
  assert(ready.dueBeforeExam >= 1, 'counts cards due before the exam')
  assert(ready.trend !== null && (ready.trend.lastWeek.got + ready.trend.lastWeek.missed + ready.trend.thisWeek.got + ready.trend.thisWeek.missed) >= 1, 'trend reads the review log')
  assert(!JSON.stringify(ready).toLowerCase().includes('you\'re ready'), 'dashboard never says you are ready')

  const noProject = r.getProjectReadiness('   ', now)
  assert(noProject.project === '' && noProject.strong.length === 0 && noProject.unstudied.length === 0, 'blank project name → empty dashboard')
  const unknown = r.getProjectReadiness('NoSuchProject', now)
  assert(unknown.project === 'NoSuchProject' && unknown.unstudied.length === 0 && unknown.examDate === null, 'unknown project is empty')

  // A note whose only signal is study attempts (reviewed=true via attempts).
  const attemptOnly = db.createItem({
    title: 'Attempts only',
    body: NOTE,
    kind: 'note',
    para: 'resources',
    project: 'Attempts',
  })
  review.enqueueReview(attemptOnly.id)
  const attemptCard = cards.listCardsForItem(attemptOnly.id)[0]
  // Leave the schedule unreviewed, but store an attempt so the note counts as studied and shaky.
  study.recordStudyAttempt({ question: 'Q', attempt: 'no', confidence: 90, selfGrade: 'missed', cardId: attemptCard.id, itemId: attemptOnly.id })
  const attemptReady = r.getProjectReadiness('Attempts', now)
  const attemptNote = attemptReady.shaky.find((n) => n.itemId === attemptOnly.id) ?? attemptReady.unstudied.find((n) => n.itemId === attemptOnly.id) ?? attemptReady.strong.find((n) => n.itemId === attemptOnly.id)
  assert(attemptNote?.group === 'shaky' && (attemptNote.openConfidentMisses ?? 0) >= 1, 'a confident miss with no schedule review still makes the note Shaky')

  console.log('\nWork on weak spots')
  assert(review.listItemReviewCards([], 20).length === 0 && review.listItemReviewCards(['x'], 0).length === 0, 'listItemReviewCards is empty with no ids or a zero limit')
  const focused = review.listItemReviewCards([missedNote.id, newNote.id, 'itm_missing'], 20)
  assert(focused[0].id === missedNote.id || focused[0].card_id === missedCard.id, 'focused queue starts with the missed note')
  assert(focused.some((c) => c.card_id === newCard.id), 'includes a not-due / unreviewed enrolled card')
  assert(!focused.some((c) => c.card_id === strongCard.id), 'does not pull in Strong notes')

  const none = session.startStudySession({ project: '', weakSpots: true })
  assert(none.cards.length === 0 && none.itemIds?.length === 0 && none.enrolled === 0, 'weak spots without a project returns an empty session')

  const prepared = r.prepareWeakSpots('Bio', { pairs: false }, now)
  assert(prepared.itemIds.includes(unenrolled.id) && prepared.enrolled >= 1, 'prepareWeakSpots enrolls unstudied notes that had no cards')
  const after = cards.listCardsForItem(unenrolled.id)
  assert(after.length > 0, 'Glycolysis now has Study cards')

  const weak = session.startStudySession({ project: 'Bio', weakSpots: true, pairs: false, limit: 20 })
  assert((weak.itemIds ?? []).includes(missedNote.id) && (weak.itemIds ?? []).includes(unenrolled.id), 'startSession({ weakSpots }) returns the weak note ids')
  assert((weak.enrolled ?? 0) === 0, 'second start does not enroll the same notes again')
  assert(weak.cards.some((c) => c.card_id === missedCard.id), 'weak-spots session includes the shaky card even if it is not the due queue')
  assert(weak.cards.every((c) => (weak.itemIds ?? []).includes(c.id) || (weak.itemIds ?? []).includes(c.item_id ?? (c as { itemId?: string }).itemId ?? '')), 'every card in the session belongs to a weak-spot note')
  // ReviewQueueItem extends Item, so c.id is the note id.
  assert(weak.cards.every((c) => (weak.itemIds ?? []).includes(c.id)), 'session cards are only from weak-spot notes')
  assert(!weak.cards.some((c) => c.id === strongNote.id), 'Strong notes stay out of the weak-spots session')

  const byIds = session.startStudySession({ itemIds: [missedNote.id], limit: 5 })
  assert(byIds.cards.length >= 1 && byIds.cards.every((c) => c.id === missedNote.id) && (byIds.itemIds ?? []).join() === missedNote.id, 'startSession({ itemIds }) focuses on those notes')

  const ordinary = session.startStudySession({ project: 'Bio', limit: 20 })
  assert(typeof ordinary.sessionId === 'string' && ordinary.itemIds === undefined, 'a normal session is unchanged (no itemIds field)')

  const idempotent = r.prepareWeakSpots('Bio', { pairs: false }, now)
  assert(idempotent.enrolled === 0, 'prepareWeakSpots is idempotent once notes are enrolled')

  db.closeDb()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
