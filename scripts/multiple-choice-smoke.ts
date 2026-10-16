/**
 * #324 — multiple-choice practice-test questions: parse → card → session → log.
 * An imported A–D item is asked with its options, a wrong pick is graded Missed
 * and logged, the next reveal names it, two correct answers in a row promote
 * the card to free recall and a recall miss demotes it, repeated wrong picks
 * are listed, the per-project opt-out works, generated note cards stay free
 * recall, and migration v12 keeps existing cards, schedules and grade logs.
 *
 *   npm run test:multiple-choice
 *
 * Electron-as-Node, temp DB, no model call.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
const origLoad = Module._load
let modelCalls = 0
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async () => {
        modelCalls++
        return { ok: false, error: 'No local model detected' }
      },
      providerDisplayName: (id: string | null | undefined, label?: string) => label || id || 'AI',
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs')
const os = require('os') as typeof import('os')
const path = require('path') as typeof import('path')

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

// Example data written for testing (not from a real exam).
const APLUS = `Practice Exam: Core 2 — Results
Question 1 of 3   Incorrect
An employee follows another person through a badge-controlled door without scanning a badge. Which type of attack is this?
  A. Shoulder surfing
  B. Phishing
  C. Tailgating   (Correct answer)
  D. Whaling
Your answer: A
Explanation: Tailgating is entering a secure area by following an authorized person. Shoulder surfing is watching someone's screen or keyboard to steal information.

Question 2 of 3   Correct
Which command repairs protected Windows system files?
  A. chkdsk
  B. sfc /scannow   (Correct answer)
  C. gpupdate
  D. diskpart
Your answer: B
Explanation: System File Checker (sfc /scannow) replaces corrupted protected system files.

Question 3 of 3   Incorrect
Which of these are valid private IPv4 ranges?
  A. 10.0.0.0/8
  B. 172.16.0.0/12
  C. All of the above   (Correct answer)
Your answer: A
`
const BIO = `1. Which organelle is the site of photosynthesis?
(1) mitochondrion (2) chloroplast (3) ribosome (4) nucleus
Your answer: (2) chloroplast ✓

2. The oxygen released during photosynthesis comes from which molecule?
(1) carbon dioxide (2) glucose (3) water (4) chlorophyll
Your answer: (1) carbon dioxide ✗
`

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — multiple-choice practice tests (#324) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-324-'))
  const db = require('../electron/db') as typeof import('../electron/db')
  const parse = require('../electron/test-to-notes-parse') as typeof import('../electron/test-to-notes-parse')
  const pt = require('../electron/practice-test') as typeof import('../electron/practice-test')
  const mc = require('../electron/multiple-choice') as typeof import('../electron/multiple-choice')
  const review = require('../electron/review') as typeof import('../electron/review')
  const session = require('../electron/study-session') as typeof import('../electron/study-session')
  db.initDb(path.join(tmp, 'test.sqlite'))
  const sqlite = db.getDb()

  console.log('Pure helpers')
  const items = parse.parseTestResults(APLUS)
  const m0 = mc.mcFromItem(items[0])
  assert(m0?.options.length === 4 && m0.answer === 'C' && m0.options[2].text === 'Tailgating', 'A–D options and a text key resolve to option C')
  assert(mc.mcFromItem({ question: 'q', answer: 'B', correct: false, correctAnswer: 'D', options: ['A. a', 'B. b', 'C. c', 'D. d'] })?.answer === 'D', 'a letter key resolves')
  assert(mc.mcFromItem({ question: 'q', answer: 'b', correct: true, options: ['a', 'b'] })?.options[1].key === 'B', 'unlabelled options get positional letters; a correct answer is the key')
  assert(mc.mcFromItem({ question: 'q', answer: 'x', correct: false, options: ['A. a', 'B. b'] }) === null, 'a wrong item with no key is not multiple choice')
  assert(mc.mcFromItem({ question: 'q', answer: 'A', correct: false, correctAnswer: 'A', options: ['A. only'] }) === null, 'one option is not multiple choice')
  assert(mc.mcFromItem({ question: 'q', answer: 'A', correct: false, correctAnswer: 'Z', options: ['A. a', 'B. b'] }) === null, 'an unresolvable key is not multiple choice')
  assert(mc.mcFromItem({ question: 'q', answer: '', correct: false } as never) === null && mc.mcFromItem({ question: 'q', answer: 'A', correct: false, correctAnswer: 'A', options: [null as never, 'A. a', 'B. b'] })?.options.length === 2, 'missing or null options are tolerated')
  assert(mc.mcFromItem({ question: 'q', answer: 'A', correct: false, correctAnswer: 'B', options: ['A. a', 'A. again', 'C. c'] })?.options[1].key === 'B', 'a repeated label falls back to its position')
  assert(mc.mcFromItem({ question: 'q', answer: 'A', correct: false, correctAnswer: 'A', options: ['A. a', 'B.'] }) === null, 'an option with no text is not multiple choice')
  assert(mc.mcFromItem({ question: 'q', answer: '1', correct: false, correctAnswer: 'A.', options: ['(1) x', '(2) y'] }) === null, 'a letter key that matches no numbered option is not resolved')
  assert(mc.parseOptions('{"key":"A"}') === null && mc.parseOptions(null) === null, 'a non-array or missing value is not options')
  const longWhy = mc.whyWrongLine('Phishing', [`Phishing ${'is a very long explanation about email '.repeat(10)}end.`]) ?? ''
  assert(longWhy.length === 218 && longWhy.endsWith('…'), 'a long why-wrong line is cut to one line')
  const bio = parse.parseTestResults(BIO)
  assert(mc.mcFromItem(bio[0])?.answer === '2' && mc.mcFromItem(bio[1]) === null, '(1)–(4) options with a correct answer resolve; a wrong item without a key does not')
  const opts = [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }, { key: 'D', text: 'd' }]
  let r = 0
  const seq = [0.1, 0.9, 0.5]
  const shuffled = mc.shuffleOptions(opts, () => seq[r++ % seq.length])
  assert(shuffled.length === 4 && shuffled.map((o) => o.key).sort().join('') === 'ABCD' && shuffled.map((o) => o.key).join('') !== 'ABCD', 'shuffle keeps every option and changes the order')
  const fixed = [...opts.slice(0, 3), { key: 'D', text: 'All of the above' }]
  assert(mc.shuffleOptions(fixed, () => 0).map((o) => o.key).join('') === 'ABCD', '"All of the above" keeps the order')
  assert(mc.parseOptions('nope') === null && mc.parseOptions('[{"key":"A","text":"x"}]') === null && mc.parseOptions(JSON.stringify(opts))?.length === 4, 'stored options parse safely')
  assert(/Shoulder surfing is watching/.test(mc.whyWrongLine('Shoulder surfing', [items[0].explanation]) ?? ''), 'why-wrong line comes from the explanation')
  assert(mc.whyWrongLine('Whaling', [items[0].explanation]) === null, 'no why-wrong line is invented')
  assert(/comes after quarantine/.test(mc.whyWrongLine('Disable System Restore', ['Quarantine first. Disabling System Restore comes after quarantine.']) ?? ''), 'word forms match ("disable" / "disabling")')
  assert(mc.whyWrongLine('Shoulder surfing', ['- Social engineering: phishing, vishing, whaling, tailgating, shoulder surfing, dumpster diving.']) === null, 'a list that merely names the option is not a reason')
  assert(mc.whyWrongLine('Shoulder surfing', ['# Security\n- Shoulder surfing means watching a screen to steal a PIN.']) === 'Shoulder surfing means watching a screen to steal a PIN.', 'note bullets are read line by line')
  assert(mc.whyWrongLine('the of', ['anything']) === null && mc.whyWrongLine('Phishing', [null, '']) === null, 'empty options and sources give nothing')
  assert(mc.mcMode(0, true) === 'mc' && mc.mcMode(2, true) === 'recall' && mc.mcMode(0, false) === 'recall', 'mode follows the streak and setting')
  assert(mc.nextStreak(0, 'mc', 'good', true) === 1 && mc.nextStreak(1, 'mc', 'hard', true) === 0 && mc.nextStreak(1, 'mc', 'again', false) === 0, 'MC streak: Got it +1, guess or wrong resets')
  assert(mc.nextStreak(2, 'recall', 'again', null) === 0 && mc.nextStreak(2, 'recall', 'good', null) === 2 && mc.nextStreak(1, 'recall', 'again', null) === 1, 'recall miss demotes; others keep')

  console.log('\nImport → card')
  const res = pt.importPracticeTest({ project: 'A+', name: 'Core 2', date: '2026-10-08', items, includeCorrect: true })
  const c0 = res.cardIds[0]
  const card = sqlite.prepare('SELECT * FROM study_cards WHERE id = ?').get(c0) as Record<string, unknown>
  assert(card.mc_answer === 'C' && (mc.parseOptions(card.mc_options as string)?.length ?? 0) === 4 && Number(card.mc_streak) === 0, 'the card stores options, key and a zero streak')
  assert(!/Shoulder surfing/.test(String(card.question)), 'the stored question is still the recall form')

  console.log('\nSession: multiple choice')
  const q = await session.getCardQuestion(c0)
  assert(q.mode === 'mc' && q.options?.length === 4 && q.answerKey === 'C' && q.lastPick === null, 'asked as multiple choice with 4 options')
  assert(/Shoulder surfing is watching/.test(q.whyWrong?.A ?? ''), 'why-wrong lines are attached by key')
  assert(modelCalls === 0, 'no model call for a multiple-choice card')
  const before = review.getCardState(c0)
  const wrong = session.answerStudyCard({ sessionId: 'ses1', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'A', confidence: 80, grade: 'good' })
  assert(wrong.correct === false && wrong.grade === 'again' && wrong.streak === 0, 'a wrong pick is graded Missed even if Got it was sent')
  const log = sqlite.prepare('SELECT grade, chosen_option FROM review_log WHERE card_id = ? AND migrated = 0 ORDER BY reviewed_at DESC, rowid DESC').get(c0) as { grade: string; chosen_option: string }
  assert(log.grade === 'again' && log.chosen_option === 'A', 'the chosen option is logged with the grade')
  assert((review.getCardState(c0)?.lapses ?? 0) === (before?.lapses ?? 0) + 1, 'it counts as a lapse')
  const queue = review.listDueReviews(undefined, 50, 'A+')
  assert(queue[0]?.card_id === c0 || queue[0]?.last_grade === 'again', 'missed cards come first')
  const attempt = sqlite.prepare('SELECT attempt, self_grade FROM study_attempts WHERE card_id = ? ORDER BY created_at DESC, rowid DESC').get(c0) as { attempt: string; self_grade: string }
  assert(attempt.attempt === 'Shoulder surfing' && attempt.self_grade === 'missed', 'the attempt records the picked option text')
  const q2 = await session.getCardQuestion(c0)
  assert(q2.lastPick?.key === 'A' && q2.lastPick.text === 'Shoulder surfing' && q2.lastPick.latest, 'the next reveal knows the last wrong pick')
  session.answerStudyCard({ sessionId: 'ses1', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'A', grade: 'again' })
  const repeated = review.getStudyStats('A+').repeatedPicks ?? []
  assert(repeated.length === 1 && repeated[0].picked === 'Shoulder surfing' && repeated[0].answer === 'Tailgating' && repeated[0].times === 2, '"Answers you keep picking" lists a wrong answer picked twice')
  assert((session.studySessionSummary('ses1', 'A+').repeatedPicks ?? []).length === 1, 'the session summary lists it too')
  // Options edited after the picks (the picked key no longer exists): skipped, not shown wrong.
  const keepOpts = sqlite.prepare('SELECT mc_options FROM study_cards WHERE id = ?').get(c0) as { mc_options: string }
  sqlite.prepare('UPDATE study_cards SET mc_options = ? WHERE id = ?').run(JSON.stringify([{ key: 'C', text: 'Tailgating' }, { key: 'D', text: 'Whaling' }]), c0)
  assert(mc.listRepeatedPicks({ project: 'A+' }).length === 0, 'a pick whose option is gone is left out')
  sqlite.prepare('UPDATE study_cards SET mc_options = ? WHERE id = ?').run(keepOpts.mc_options, c0)
  assert(mc.listRepeatedPicks({ cardIds: [] }).length === 0 && mc.listRepeatedPicks({ project: 'Nope' }).length === 0, 'scopes with no cards list nothing')

  console.log('\nPromotion and demotion')
  const ok1 = session.answerStudyCard({ sessionId: 'ses2', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'C', confidence: 70, grade: 'good' })
  assert(ok1.correct === true && ok1.grade === 'good' && ok1.streak === 1, 'a correct pick graded Got it counts')
  const guess = session.answerStudyCard({ sessionId: 'ses2', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'C', grade: 'hard' })
  assert(guess.correct === true && guess.grade === 'hard' && guess.streak === 0, 'a correct guess (Partly) resets the streak')
  session.answerStudyCard({ sessionId: 'ses2', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'C', grade: 'good' })
  const ok2 = session.answerStudyCard({ sessionId: 'ses2', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'C', grade: 'good' })
  assert(ok2.streak === 2, 'two correct in a row')
  const promoted = await session.getCardQuestion(c0)
  assert(promoted.mode === 'recall' && !promoted.options && promoted.question === q.question, 'the next review is free recall with the options hidden')
  const keep = session.answerStudyCard({ sessionId: 'ses3', cardId: c0, question: q.question, mode: 'recall', attempt: 'tailgating', grade: 'good' })
  assert(keep.streak === 2, 'recalling it keeps it in recall')
  const miss = session.answerStudyCard({ sessionId: 'ses3', cardId: c0, question: q.question, mode: 'recall', attempt: 'phishing', grade: 'again' })
  assert(miss.streak === 0 && (await session.getCardQuestion(c0)).mode === 'mc', 'a free-recall miss drops it back to multiple choice')
  const idk = session.answerStudyCard({ sessionId: 'ses3', cardId: c0, question: q.question, mode: 'mc', dontKnow: true, grade: 'good' })
  assert(idk.grade === 'again' && idk.streak === 0, '"I don\'t know" on multiple choice is Missed')
  const bogus = session.answerStudyCard({ sessionId: 'ses3', cardId: c0, question: q.question, mode: 'mc', chosenOption: 'Z', grade: 'good' })
  assert(bogus.correct === undefined && bogus.grade === 'good', 'an unknown option key is ignored (self grade stands)')

  console.log('\nPer-project opt-out')
  assert(db.getProjectSettings('A+').multipleChoice === true && db.getProjectSettings('').multipleChoice === true, 'on by default')
  db.setProjectExamDate('A+', '2027-01-15')
  assert(db.getProjectSettings('A+').multipleChoice === true, 'setting an exam date leaves it on')
  const off = db.setProjectMultipleChoice('A+', false)
  assert(off.multipleChoice === false && off.examDate === '2027-01-15', 'turning it off keeps the exam date')
  const plain = await session.getCardQuestion(c0)
  assert(plain.mode === undefined && !plain.options, 'with it off the card is plain free recall')
  db.renameProject('A+', 'CompTIA A+')
  assert(db.getProjectSettings('CompTIA A+').multipleChoice === false, 'the setting follows a rename')
  db.setProjectMultipleChoice('CompTIA A+', true)
  let threw = false
  try {
    db.setProjectMultipleChoice('  ', true)
  } catch {
    threw = true
  }
  assert(threw, 'a project is required')
  threw = false
  try {
    db.setProjectMultipleChoice(undefined as never, true)
  } catch {
    threw = true
  }
  assert(threw && db.projectMultipleChoice(null) === true && db.projectMultipleChoice('No such project') === true, 'no project, or one with no settings row, defaults to on')
  db.setProjectMultipleChoice('Merged away', false)
  db.createItem({ title: 'tmp', body: 'x', kind: 'note', project: 'Merged away', para: 'resources' })
  db.mergeProject('Merged away', 'Fresh target')
  assert(db.getProjectSettings('Fresh target').multipleChoice === false, 'a merge into a project with no settings carries the setting')

  console.log('\nRe-import and other cards')
  const c2 = res.cardIds[2]
  const q3 = await session.getCardQuestion(c2)
  assert(q3.mode === 'mc' && q3.options?.map((o) => o.key).join('') === 'ABC', '"All of the above" items are asked unshuffled')
  sqlite.prepare('UPDATE study_cards SET mc_options = NULL, mc_answer = NULL WHERE id = ?').run(res.cardIds[1])
  const schedBefore = JSON.stringify(sqlite.prepare('SELECT * FROM card_schedule ORDER BY card_id').all())
  const again = pt.importPracticeTest({ project: 'A+', name: 'Core 2', date: '2026-10-08', items, includeCorrect: true })
  const refilled = sqlite.prepare('SELECT mc_answer FROM study_cards WHERE id = ?').get(res.cardIds[1]) as { mc_answer: string | null }
  assert(again.alreadyAdded >= 1 && refilled.mc_answer === 'B', 'a card without options gains them on re-import')
  assert(JSON.stringify(sqlite.prepare('SELECT * FROM card_schedule ORDER BY card_id').all()) === schedBefore, 're-import leaves schedules alone')
  const note = db.createItem({ title: 'Ports', body: 'RDP listens on TCP 3389. SSH listens on TCP 22.', kind: 'note', project: 'CompTIA A+', para: 'resources' })
  review.enqueueReview(note.id)
  const noteCard = sqlite.prepare('SELECT id FROM study_cards WHERE item_id = ?').get(note.id) as { id: string }
  const nq = await session.getCardQuestion(noteCard.id)
  assert(nq.mode === undefined && !nq.options, 'generated note questions stay free recall')
  const noteAns = session.answerStudyCard({ sessionId: 'ses4', cardId: noteCard.id, question: nq.question, mode: 'mc', chosenOption: 'A', attempt: 'x', grade: 'good' })
  assert(noteAns.grade === 'good' && noteAns.correct === undefined, 'a note card ignores a stray pick')

  console.log('\nMigration v12 on a v11 vault')
  db.closeDb()
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const v11 = path.join(tmp, 'v11.sqlite')
  db.initDb(v11)
  const imp = pt.importPracticeTest({ project: 'Bio', name: 'Quiz', date: '2026-10-01', items: bio, includeCorrect: true })
  review.rateReview(imp.cardIds[1], 'good')
  db.setProjectExamDate('Bio', '2027-06-01')
  db.closeDb()
  const raw = new Database(v11)
  raw.exec(`ALTER TABLE study_cards DROP COLUMN mc_options; ALTER TABLE study_cards DROP COLUMN mc_answer;
    ALTER TABLE study_cards DROP COLUMN mc_streak; ALTER TABLE review_log DROP COLUMN chosen_option;
    ALTER TABLE project_settings DROP COLUMN mc_mode`)
  raw.pragma('user_version = 11')
  const snap = (d: import('better-sqlite3').Database) => ({
    cards: JSON.stringify(d.prepare('SELECT id, item_id, origin, question, answer, source_key, priority, status FROM study_cards ORDER BY id').all()),
    sched: JSON.stringify(d.prepare('SELECT * FROM card_schedule ORDER BY card_id').all()),
    log: JSON.stringify(d.prepare('SELECT id, card_id, grade, reviewed_at, interval_days, ease, due_at, migrated FROM review_log ORDER BY id').all()),
    ps: JSON.stringify(d.prepare('SELECT name, exam_date FROM project_settings ORDER BY name').all()),
  })
  const pre = snap(raw)
  raw.close()
  db.initDb(v11)
  const post = snap(db.getDb())
  assert(Number(db.getDb().pragma('user_version', { simple: true })) === 12, 'user_version is 12')
  assert(pre.cards === post.cards && pre.sched === post.sched && pre.log === post.log && pre.ps === post.ps, 'cards, schedules, grade logs and settings are unchanged')
  assert((db.getDb().prepare('SELECT COUNT(*) AS n FROM study_cards WHERE mc_options IS NOT NULL').get() as { n: number }).n === 0, 'old cards have no options until re-import')
  assert(db.getProjectSettings('Bio').multipleChoice === true, 'existing projects default to on')
  const reimp = pt.importPracticeTest({ project: 'Bio', name: 'Quiz', date: '2026-10-01', items: bio, includeCorrect: true })
  assert(reimp.added === 0 && (db.getDb().prepare('SELECT mc_answer FROM study_cards WHERE id = ?').get(imp.cardIds[0]) as { mc_answer: string }).mc_answer === '2', 're-import adds the format lazily')
  assert(JSON.stringify(db.getDb().prepare('SELECT * FROM card_schedule ORDER BY card_id').all()) === post.sched, '…and keeps the schedules')
  db.closeDb()

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
