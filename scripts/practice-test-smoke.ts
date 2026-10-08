/**
 * #265 — practice tests inside Study: the parser keeps every field across the
 * seven formats from the Oct 8 evaluation, an import turns the test's own Q&A
 * into cards (wrong items start as Missed), links them to the learner's notes
 * or writes a corrective draft, and "Study this project" skips practice tests
 * and exam papers (owner default 1) and video transcripts (default 4).
 *
 *   npm run test:practice-test
 *
 * Electron-as-Node, temp DB, mocked llmGenerate: no model is called.
 */

// --- Module._load hook to mock llm MUST BE FIRST ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load
type MockGen =
  | { ok: true; text: string; provider: string; providerLabel: string; model: string; local: boolean; fallback: boolean }
  | { ok: false; error: string; provider?: string; providerLabel?: string }
const mockQueue: MockGen[] = []
let mockCalls = 0
function reply(text: string): MockGen {
  return { ok: true, text, provider: 'groq', providerLabel: 'Groq', model: 'openai/gpt-oss-20b', local: false, fallback: false }
}
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async () => {
        mockCalls++
        return mockQueue.shift() ?? { ok: false, error: 'No local model detected' }
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

// Example data in the shapes of the evaluation fixtures (written for testing, not from a real exam).
const RESULTS_PAGE = `Practice Exam: Core 2 (220-1202) — Results
Score: 6/10 (60%)   Time taken: 14:02   Passing score: 70%
Review your answers

Question 1 of 3   Incorrect
A user reports pop-ups even when the browser is closed. After confirming the symptoms, what should the technician do NEXT according to the malware removal procedure?
  A. Disable System Restore
  B. Quarantine the infected system   (Correct answer)
  C. Educate the end user
  D. Schedule scans and run updates
Your answer: A
Explanation: After investigating and verifying malware symptoms, the next step is to quarantine the infected system so the malware cannot spread.

Question 2 of 3   Correct
Which command repairs protected Windows system files?
  A. chkdsk
  B. sfc /scannow   (Correct answer)
  C. gpupdate
Your answer: B
Explanation: System File Checker (sfc /scannow) scans and replaces corrupted protected system files.

Question 3 of 3   Incorrect
An employee follows another person through a badge-controlled door without scanning a badge. Which type of attack is this?
  A. Shoulder surfing
  B. Phishing
  C. Tailgating   (Correct answer)
Your answer: A
Explanation: Tailgating (piggybacking) is entering a secure area by following an authorized person.
`
const MIXED_TEST = `EXAMPLE DATA — written for testing.
Unit 2–3 Biology practice quiz — my results

1. Which organelle is the site of photosynthesis?
(1) mitochondrion (2) chloroplast (3) ribosome (4) nucleus
Your answer: (2) chloroplast ✓

2. The oxygen released during photosynthesis comes from which molecule?
(1) carbon dioxide (2) glucose (3) water (4) chlorophyll
Your answer: (1) carbon dioxide ✗

3. A red blood cell is placed in a hypertonic salt solution. Describe what happens to the cell and explain why.
Your answer: it bursts because water goes in ✗

4. The diagram below shows a cell with structures labeled A, B, C and D. Which letter indicates the structure that releases energy from glucose? [diagram of an animal cell]
Your answer: B ✗

5. The graph below shows enzyme activity at different temperatures. At what temperature does the enzyme work best? [line graph]
Your answer: 60 °C ✗
`
const QLINES = `EXAMPLE DATA — Core 2 practice exam #3 (my answer sheet vs the key)
Q1: A (correct: A)
Q2: C (correct: C)
Q3: B (correct: D)
Q4: D (correct: D)
Q5: A (correct: C)`
const REGENTS = `Living Environment Regents — scored myself with the key (Part A)
Q1: 2 (correct: 4)
Q2: 4 (correct: 4)
Q3: 1 (correct: 1)`
const SCIENCE_CSV = `question,answer,correct
"Where in the chloroplast does the Calvin cycle take place?",thylakoid,no
"What is the net ATP yield of glycolysis per glucose?",2,yes`
const KEYED_CSV = `question,your answer,correct,correct answer,explanation
"Which port does RDP use by default?",3389,yes,3389,"Remote Desktop Protocol listens on TCP 3389."
"Which RAID level stripes with parity across at least three drives?",RAID 1,no,RAID 5,"RAID 5 stripes data with distributed parity."`
const PBQ = `EXAMPLE DATA — my notes on a performance-based question (PBQ) I got wrong.

PBQ 2: SOHO wireless router configuration (simulation)
The task showed a router admin page. I had to change the admin password, set the SSID, choose the right security and disable WPS.
Result: partial credit. ✗
What I think was wrong: should have picked WPA3, and WPS should be disabled.

PBQ 4: Drag and drop — match each port to its protocol (21, 22, 25, 110, 143, 443).
Result: 4/6. Mixed up 110 (POP3) and 143 (IMAP). ✗`

/** Hand-build a one-page, text-layer PDF (same approach as the book-import smoke). */
function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  bodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — practice tests inside Study (#265) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-265-'))
  const db = require('../electron/db') as typeof import('../electron/db')
  const parse = require('../electron/test-to-notes-parse') as typeof import('../electron/test-to-notes-parse')
  const t2n = require('../electron/test-to-notes') as typeof import('../electron/test-to-notes')
  const pt = require('../electron/practice-test') as typeof import('../electron/practice-test')
  const cardsMod = require('../electron/study-cards') as typeof import('../electron/study-cards')
  const review = require('../electron/review') as typeof import('../electron/review')
  const session = require('../electron/study-session') as typeof import('../electron/study-session')
  db.initDb(path.join(tmp, 'test.sqlite'))
  const sqlite = db.getDb()

  // --- Parser: every format, every field ---
  console.log('Parser (seven formats)')
  const page = parse.parseTestResults(RESULTS_PAGE)
  assert(page.length === 3 && page.filter((i) => i.correct).length === 1, 'results page: 3 items, 1 correct, header lines dropped')
  assert(page[0].question.startsWith('A user reports pop-ups') && page[0].answer === 'A', 'results page: question and chosen letter')
  assert(page[0].correctAnswer === 'Quarantine the infected system', 'results page: the (Correct answer) option is the key, as text')
  assert(page[0].options?.length === 4 && page[0].options[1] === 'B. Quarantine the infected system', 'results page: options kept without the marker')
  assert(/quarantine the infected system so the malware cannot spread/.test(page[0].explanation ?? ''), 'results page: explanation kept')
  const mixed = parse.parseTestResults(MIXED_TEST)
  assert(mixed.length === 5 && mixed.filter((i) => i.correct).length === 1, 'mixed science test: 5 items, 1 correct, title block dropped')
  assert(mixed[1].options?.length === 4 && mixed[1].answer === '(1) carbon dioxide', 'inline (1)…(4) options split; ✗ stripped from the answer')
  const qlines = parse.parseTestResults(QLINES)
  assert(qlines.length === 5 && qlines.filter((i) => i.correct).length === 3, 'Q-lines: 5 items, 3 correct')
  assert(qlines.every((i) => i.needsText) && qlines[2].correctAnswer === 'D' && qlines[2].answer === 'B', 'Q-lines: need question text, keep answer and key')
  const regents = parse.parseTestResults(REGENTS)
  assert(regents.length === 3 && regents.filter((i) => i.correct).length === 2 && regents[0].question === 'Question 1', 'Regents "Qn: x (correct: y)": 3 items, 2 correct')
  const sciCsv = parse.parseTestResults(SCIENCE_CSV)
  assert(sciCsv.length === 2 && sciCsv[1].correct, 'science CSV parses')
  const keyed = parse.parseTestResults(KEYED_CSV)
  assert(keyed[1].correctAnswer === 'RAID 5' && /distributed parity/.test(keyed[1].explanation ?? ''), 'CSV "correct answer" and "explanation" columns are kept')
  const pbq = parse.parseTestResults(PBQ)
  assert(pbq.length === 2 && pbq.every((i) => !i.correct), 'PBQ description: 2 items, intro line dropped')
  assert(pbq[0].question === 'PBQ 2: SOHO wireless router configuration (simulation)' && /admin page/.test(pbq[0].explanation ?? ''), 'PBQ: the task line is the question, the rest the explanation')
  assert(parse.resolveOption('C', ['A. x', 'B. y', 'C. Tailgating']) === 'Tailgating', 'a letter resolves to its option text')
  assert(parse.resolveOption('(3)', ['(1) a', '(2) b', '(3) water']) === 'water', 'a (n) answer resolves too')
  assert(parse.resolveOption('Paris', ['A. x']) === 'Paris', 'free text is unchanged')
  assert(parse.splitOption('weird').label === '' && parse.splitOption('B) Two').label === 'B', 'splitOption labels')

  // --- AI parse: new fields, retry once, fallbacks announced ---
  console.log('\nAI parse')
  const ai = t2n.parseAiJson(
    JSON.stringify([{ question: 'Which attack?', answer: 'A', correct: false, correctAnswer: 'C', options: ['A. Phishing', 'B. Vishing', 'C. Tailgating'], explanation: 'Following someone in.' }, { question: 'Question 7', answer: 'B', correct: true }]),
  )
  assert(ai?.[0].correctAnswer === 'Tailgating' && ai[0].options?.length === 3 && ai[0].explanation === 'Following someone in.', 'parseAiJson keeps key, options and explanation')
  assert(ai?.[1].needsText === true, 'a numbered-only AI item needs question text')
  mockQueue.push(reply('Sorry, here is a summary.'), reply(JSON.stringify([{ question: 'Q?', answer: 'x', correct: false }])))
  let before = mockCalls
  const retried = await t2n.parseTestResultsWithAi({ text: '1. Q?\nYour answer: x ✗' })
  assert(mockCalls - before === 2 && retried.items[0].question === 'Q?' && !retried.error, 'an unexpected reply is retried once')
  mockQueue.push(reply('nope'), reply('still nope'))
  const twice = await t2n.parseTestResultsWithAi({ text: '1. Q?\nYour answer: x ✗' })
  assert(/unexpected format twice/.test(twice.error ?? '') && twice.items.length === 1, 'two unexpected replies → built-in parser, and it says so')
  before = mockCalls
  const sheet = await t2n.parseTestResultsWithAi({ text: QLINES })
  assert(mockCalls === before && sheet.items.length === 5, 'an answer sheet parses offline with no model call')
  const long = await t2n.parseTestResultsWithAi({ text: `1. Q?\nYour answer: x ✗\n${'filler '.repeat(4000)}` })
  assert(mockCalls === before && /longer than/.test(long.error ?? ''), 'a very long paste uses the built-in parser and says why')
  mockQueue.push({ ok: false, error: 'Rate limit reached for model. Please try again in 7.5s', provider: 'groq', providerLabel: 'Groq' })
  const limited = await t2n.parseTestResultsWithAi({ text: '1. Q?\nYour answer: x ✗' })
  assert(limited.rateLimited === true && limited.items.length === 1, 'a rate limit falls back and is flagged')

  // --- Drafts: titles and bodies ---
  console.log('\nDraft titles and bodies')
  const longQ = 'A user reports that their computer is very slow and pop-ups appear even when the browser is closed'
  const title = t2n.deriveTitle(longQ)
  const titleText = title.replace(/^Fix: /, '').replace(/…$/, '')
  assert(title.endsWith('…') && longQ.startsWith(titleText) && longQ[titleText.length] === ' ', `titles are not cut mid-word (${title})`)
  assert(t2n.deriveTitle('Short question?') === 'Fix: Short question?', 'short titles are whole')
  const stripped = t2n.draftBodyWithoutIds('ATP powers it [itm_abc123]. Also [itm_a, itm_b] here.', [{ title: 'Cells' }])
  assert(!/itm_/.test(stripped) && /Sources: Cells$/.test(stripped), 'draft bodies have no raw ids and list sources by title')

  // --- Pure helpers ---
  console.log('\nHelpers')
  assert(pt.practiceItemKind('The diagram below shows a cell') === 'visual' && pt.practiceItemKind('PBQ 4: Drag and drop') === 'pbq' && pt.practiceItemKind('Which port?') === 'question', 'item kinds')
  assert(pt.recallQuestion('Which organelle makes ATP? (1) nucleus (2) mitochondrion (3) ribosome') === 'Which organelle makes ATP?', 'inline options are removed (recall form)')
  assert(pt.recallQuestion('Which letter indicates the nucleus? [diagram of a cell]') === 'Which letter indicates the nucleus?', 'a bracketed figure note is removed')
  assert(pt.itemAnswer(page[0]) === 'Quarantine the infected system' && pt.itemAnswer({ question: 'q', answer: '(2) chloroplast', correct: true, options: ['(1) a', '(2) chloroplast'] }) === 'chloroplast', 'the answer is the key, or a correct learner answer')
  assert(pt.itemAnswer({ question: 'q', answer: 'x', correct: false }) === null, 'a wrong item with no key has no answer')
  assert(pt.learnerAnswer(page[0]) === 'A. Disable System Restore' && pt.learnerAnswer({ question: 'q', answer: '', correct: false }) === '', 'the learner answer reads as option text')
  assert(pt.testKey('A+', 'Core 2 #3', '2026-10-08') === pt.testKey('A+', '  core 2   #3 ', '2026-10-08') && pt.testKey('A+', 'x', '2026-10-08') !== pt.testKey('B', 'x', '2026-10-08'), 'the test key ignores case/spacing and includes the project')
  assert(/^\d{4}-\d{2}-\d{2}$/.test(pt.localDate()), 'localDate is YYYY-MM-DD')
  const body = pt.practiceTestBody('T', '2026-10-08', [{ index: 0, item: page[0], question: page[0].question }])
  assert(/Correct answer: Quarantine/.test(body) && !/Disable System Restore/.test(body), 'the test page keeps the key and never the wrong answer')

  // --- Import ---
  console.log('\nImport into Study')
  const tailgating = db.createItem({
    title: 'Social engineering attacks',
    body: 'Tailgating is following an authorized person through a secure door without badging. Phishing uses fake email. Shoulder surfing is watching someone type.',
    kind: 'note',
    status: 'active',
    para: 'resources',
    project: 'A+',
  })
  db.createItem({ title: 'Other project note', body: 'Quarantine the infected system first, then disable System Restore.', kind: 'note', status: 'active', para: 'resources', project: 'Other' })
  const r1 = pt.importPracticeTest({ project: 'A+', name: 'Core 2 practice exam', date: '2026-10-08', items: page })
  assert(r1.added === 2 && r1.skipped.length === 1 && r1.skipped[0].reason === 'answered correctly', 'wrong items become cards; the correct one is skipped')
  const testItem = db.getItem(r1.testItemId)!
  assert(testItem.kind === 'practice-test' && testItem.project === 'A+' && testItem.title === 'Core 2 practice exam · 2026-10-08', 'the test is one practice-test page in the Study project')
  const cards = sqlite.prepare(`SELECT * FROM study_cards WHERE item_id = ? ORDER BY source_key`).all(r1.testItemId) as Array<Record<string, unknown>>
  assert(cards.every((c) => c.origin === 'practice-test' && c.source_test === 'Core 2 practice exam' && c.source_test_date === '2026-10-08'), 'cards record origin, test name and date')
  const c1 = cards.find((c) => String(c.source_key).endsWith('#1'))!
  const c3 = cards.find((c) => String(c.source_key).endsWith('#3'))!
  assert(c1.answer === 'Quarantine the infected system' && /cannot spread/.test(String(c1.explanation)) && c1.q_kind === 'test', 'the card uses the test’s own answer and explanation (no generation)')
  assert(c3.link_item_id === tailgating.id && r1.linked === 1, 'a question a note covers links to that note (same project only)')
  const draftId = String(c1.link_item_id)
  const draft = db.getItem(draftId)!
  assert(r1.drafts === 1 && draft.status === 'ai-draft' && draft.project === 'A+' && !/itm_/.test(draft.body) && /Quarantine the infected system/.test(draft.body), 'no covering note → a corrective AI draft from the explanation, in the project')
  const sched = sqlite.prepare('SELECT * FROM card_schedule WHERE card_id = ?').get(c1.id) as Record<string, unknown>
  assert(sched.last_grade === 'again' && sched.last_reviewed_at != null && Number(sched.lapses) === 1, 'a wrong item starts as Missed')
  const seedLog = sqlite.prepare('SELECT * FROM review_log WHERE card_id = ?').all(c1.id) as Array<Record<string, unknown>>
  assert(seedLog.length === 1 && Number(seedLog[0].migrated) === 1, 'its seed grade is logged as migrated (not a session)')
  const queue = review.listDueReviews(undefined, 50, 'A+')
  assert(queue.length >= 2 && queue[0].origin === 'practice-test' && queue[0].last_grade === 'again', 'missed test cards come first in the session')
  const stats = review.getStudyStats('A+')
  assert(stats.lastSession === null, 'importing is not a study session')

  const r2 = pt.importPracticeTest({ project: 'A+', name: 'core 2 practice exam ', date: '2026-10-08', items: page, includeCorrect: true })
  assert(r2.testItemId === r1.testItemId && r2.alreadyAdded === 2 && r2.added === 1 && r2.drafts === 0, 're-import is idempotent; "Also add the ones I got right" adds only the new one')
  const right = sqlite.prepare('SELECT c.priority, s.last_grade, s.reps FROM study_cards c JOIN card_schedule s ON s.card_id = c.id WHERE c.source_key LIKE ?').get('%#2') as Record<string, unknown>
  assert(Number(right.priority) === pt.CORRECT_ITEM_PRIORITY && right.last_grade === null, 'a correct item is a low-priority new card')
  assert(Number((sqlite.prepare("SELECT COUNT(*) AS c FROM items WHERE kind = 'practice-test'").get() as { c: number }).c) === 1, 'still one test page')

  const sheetImport = pt.importPracticeTest({ project: 'A+', name: 'Sheet', date: '2026-10-01', items: qlines })
  assert(sheetImport.added === 0 && sheetImport.needText.length === 5 && sheetImport.testItemId, 'answer-sheet items need question text')
  const typed = pt.importPracticeTest({ project: 'A+', name: 'Sheet', date: '2026-10-01', items: qlines, questionTexts: { 2: 'Which tool repairs the Windows image?' } })
  assert(typed.added === 1 && typed.needText.length === 4 && typed.testItemId === sheetImport.testItemId, 'typed question text makes a card for that item')
  const typedCard = sqlite.prepare('SELECT question, answer FROM study_cards WHERE id = ?').get(typed.cardIds[2]) as { question: string; answer: string }
  assert(typedCard.question === 'Which tool repairs the Windows image?' && typedCard.answer === 'D', 'the typed question is the card; the key letter is the answer')

  const sci = pt.importPracticeTest({ project: 'Bio', name: 'Unit quiz', items: mixed })
  assert(sci.added === 4 && /^\d{4}-\d{2}-\d{2}$/.test(sci.date), 'mixed test: four wrong items become cards, dated today')
  const visual = sqlite.prepare("SELECT id FROM study_cards WHERE item_id = ? AND question LIKE 'The diagram%'").get(sci.testItemId) as { id: string }
  const pbqImport = pt.importPracticeTest({ project: 'A+', name: 'PBQs', items: pbq })
  const pbqCard = sqlite.prepare('SELECT question, explanation FROM study_cards WHERE id = ?').get(pbqImport.cardIds[0]) as { question: string; explanation: string }
  assert(/^Walk through the steps, in order: SOHO wireless router configuration/.test(pbqCard.question) && /admin page/.test(pbqCard.explanation), 'a PBQ becomes one walk-through-the-steps card')
  let threw = false
  try {
    pt.importPracticeTest({ project: 'A+', name: 'Empty', items: [] })
  } catch {
    threw = true
  }
  assert(threw, 'an empty import is refused')

  // --- In a session ---
  console.log('\nIn a session')
  const q1 = await session.getCardQuestion(String(c1.id))
  assert(q1.kind === 'test' && q1.answer === 'Quarantine the infected system' && /cannot spread/.test(q1.explanation ?? ''), 'the session shows the test question, answer and explanation')
  assert(q1.sourceTest?.name === 'Core 2 practice exam' && q1.sourceTest.date === '2026-10-08', 'the source test is named')
  assert(q1.linkedNote?.id === draftId && q1.linkedNote.confirmed === false && q1.citations.length === 0, 'an unconfirmed draft is not cited yet (default 2)')
  db.updateItem(draftId, { status: 'active', body: 'Quarantine first: isolate the infected PC so malware cannot spread, then disable System Restore.' })
  const q1b = await session.getCardQuestion(String(c1.id))
  assert(q1b.linkedNote?.confirmed === true && q1b.citations[0]?.id === draftId, 'once confirmed, the note is cited on reveal')
  const q3 = await session.getCardQuestion(String(c3.id))
  assert(q3.citations[0]?.id === tailgating.id, 'a card linked to an existing note cites it')
  assert((await session.getCardQuestion(visual.id)).openSource === true, 'a diagram item is an open-the-source card')
  assert(pt.linkPracticeCard(visual.id, tailgating.id) && !pt.linkPracticeCard('crd_missing', tailgating.id), 'linkPracticeCard links a practice-test card')
  const answered = session.answerStudyCard({ sessionId: 'ses_pt', cardId: String(c1.id), question: q1.question, attempt: 'Quarantine', confidence: 60, grade: 'good' })
  assert(typeof answered.dueAt === 'string', 'a practice-test card is graded like any other')
  assert(mockCalls === before + 1, 'no model call for practice-test cards')

  // --- Study this project skips (defaults 1 and 4) ---
  console.log('\nStudy this project')
  const exam = db.createItem({
    title: 'Regents exam · p.3',
    body: '11 Which structures produce insulin? (1) nuclei (2) ribosomes (3) chloroplasts (4) mitochondria\n12 During which process is ATP synthesized? (1) digestion (2) movement (3) respiration (4) excretion\n15 A mushroom on a stump is a (1) predator (2) parasite (3) decomposer (4) prey',
    kind: 'book',
    status: 'active',
    para: 'resources',
    project: 'A+',
  })
  const letters = 'Question 1\nA. one\nB. two\nC. three\nQuestion 2\nA. one\nB. two\nC. three\nQuestion 3\nA. one\nB. two\nC. three'
  assert(cardsMod.looksLikeExamPaper(exam.body) && cardsMod.looksLikeExamPaper(letters), 'exam pages are detected ((1)…(3) runs or A./B./C. lines)')
  assert(!cardsMod.looksLikeExamPaper('RAID 1 mirrors (1) two drives. RAID 5 (2) needs three.') && !cardsMod.looksLikeExamPaper(tailgating.body), 'notes are not exam pages')
  const transcript = db.createItem({
    title: 'Lecture · part 2',
    body: 'In this part of the lecture we cover the light reactions, the electron transport chain and how ATP synthase makes ATP from the proton gradient across the thylakoid membrane.',
    kind: 'transcript',
    status: 'active',
    para: 'resources',
    project: 'A+',
  })
  const enroll = cardsMod.enrollProject('A+')
  const reasons = new Map(enroll.skipped.map((s) => [s.itemId, s.reason]))
  assert(reasons.get(r1.testItemId) === cardsMod.PRACTICE_TEST_SKIP, 'the practice-test page is skipped (its questions are already cards)')
  assert(reasons.get(exam.id) === cardsMod.EXAM_PAPER_SKIP, 'an exam page imported as notes is skipped with "import it as a practice test" (default 1)')
  assert(/video transcript/.test(reasons.get(transcript.id) ?? ''), 'video transcripts stay out of Study this project (default 4)')
  assert(!reasons.has(tailgating.id), 'ordinary notes are enrolled')
  const single = review.enqueueReview(transcript.id)
  assert(single.created >= 1 && !single.alreadyEnrolled, 'a single transcript part can still be added on its own (default 4)')
  const ptEnq = review.enqueueReview(r1.testItemId)
  assert(ptEnq.alreadyEnrolled && ptEnq.created === 0 && cardsMod.listCardsForItem(r1.testItemId).every((c) => c.origin === 'practice-test'), 'Add to review never adds note cards to a practice test')
  assert(cardsMod.enrollSkipReason({ body: 'x', kind: 'practice-test', status: 'active' }) === cardsMod.PRACTICE_TEST_SKIP, 'enrollSkipReason knows practice tests')

  // --- Reading a file ---
  console.log('\nOpen file')
  const txt = path.join(tmp, 'results.txt')
  fs.writeFileSync(txt, 'Q1: A (correct: B)\r\nQ2: C (correct: C)\r\n')
  const readTxt = await pt.readPracticeTestFile(txt)
  assert(readTxt.name === 'results.txt' && readTxt.text === 'Q1: A (correct: B)\nQ2: C (correct: C)\n' && !readTxt.truncated, 'a text file is read (CRLF normalised)')
  const pdfPath = path.join(tmp, 'exam.pdf')
  fs.writeFileSync(pdfPath, buildMinimalPdf('Q1: 2 (correct: 4)'))
  const readPdf = await pt.readPracticeTestFile(pdfPath)
  assert(/Q1: 2 \(correct: 4\)/.test(readPdf.text ?? ''), `a PDF's text layer is read (${JSON.stringify(readPdf).slice(0, 80)})`)
  const empty = path.join(tmp, 'empty.csv')
  fs.writeFileSync(empty, '   ')
  assert(/empty/.test((await pt.readPracticeTestFile(empty)).error ?? ''), 'an empty file says so')
  assert(!!(await pt.readPracticeTestFile(path.join(tmp, 'missing.txt'))).error, 'a missing file returns an error')
  const big = path.join(tmp, 'big.txt')
  fs.writeFileSync(big, 'x'.repeat(pt.MAX_PRACTICE_FILE_CHARS + 10))
  const readBig = await pt.readPracticeTestFile(big)
  assert(readBig.truncated === true && readBig.text?.length === pt.MAX_PRACTICE_FILE_CHARS, 'a huge file is truncated')

  // --- Migration v10 on a v9 vault ---
  console.log('\nMigration v10')
  db.closeDb()
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const v9 = path.join(tmp, 'v9.sqlite')
  db.initDb(v9)
  const note = db.createItem({ title: 'Keep', body: 'Mitochondria make ATP for the cell.', kind: 'note', para: 'resources' })
  review.enqueueReview(note.id)
  const kept = cardsMod.listCardsForItem(note.id)[0]
  review.rateReview(kept.id, 'good')
  db.closeDb()
  const raw = new Database(v9)
  raw.exec('ALTER TABLE study_cards DROP COLUMN explanation; ALTER TABLE study_cards DROP COLUMN link_item_id')
  raw.pragma('user_version = 9')
  const schedBefore = JSON.stringify(raw.prepare('SELECT * FROM card_schedule').all())
  const logBefore = JSON.stringify(raw.prepare('SELECT * FROM review_log').all())
  raw.close()
  db.initDb(v9)
  const cols = (db.getDb().prepare('PRAGMA table_info(study_cards)').all() as { name: string }[]).map((x) => x.name)
  assert(cols.includes('explanation') && cols.includes('link_item_id'), 'a v9 vault gains explanation and link_item_id')
  assert(Number(db.getDb().pragma('user_version', { simple: true })) === db.SCHEMA_VERSION && db.SCHEMA_VERSION >= 10, 'user_version is current')
  assert(JSON.stringify(db.getDb().prepare('SELECT * FROM card_schedule').all()) === schedBefore, 'schedules are unchanged')
  assert(JSON.stringify(db.getDb().prepare('SELECT * FROM review_log').all()) === logBefore, 'review history is unchanged')
  db.closeDb()

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
