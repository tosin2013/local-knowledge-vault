/**
 * #263 — the Study session loop: generated free-recall questions (cached per
 * card and section hash), drop rules, offline fallbacks, grading and the
 * session summary.
 *
 *   npm run test:study-session
 *
 * Runs under Electron-as-Node with a temp DB and a mocked llmGenerate, so no
 * model is called.
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
let mockResult: MockGen = { ok: false, error: 'No local model detected', provider: null as unknown as string }
let mockCalls = 0
let lastPrompt = ''
function reply(text: string): MockGen {
  return { ok: true, text, provider: 'groq', providerLabel: 'Groq', model: 'openai/gpt-oss-20b', local: false, fallback: false }
}

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async (input: { prompt: string }) => {
        mockCalls++
        lastPrompt = input.prompt
        return mockResult
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
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

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

const SECTION =
  'Photosynthesis happens in the chloroplast. The light reactions split water and release oxygen gas. ' +
  'The Calvin cycle uses ATP and NADPH to fix carbon dioxide into sugar. RuBisCO is the enzyme that fixes carbon dioxide.'

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Study session loop (#263) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-263-'))
  const db = require('../electron/db') as typeof import('../electron/db')
  const cardsMod = require('../electron/study-cards') as typeof import('../electron/study-cards')
  const review = require('../electron/review') as typeof import('../electron/review')
  const s = require('../electron/study-session') as typeof import('../electron/study-session')
  db.initDb(path.join(tmp, 'test.sqlite'))

  // --- Pure helpers ---
  console.log('parseCardJson')
  const ok = s.parseCardJson('```json\n[{"question":"Q?","answer":"A [itm_1]","quote":"x"}]\n```')
  assert(ok.card?.question === 'Q?' && ok.card.answer === 'A [itm_1]' && !ok.empty, 'reads a fenced JSON array')
  assert(s.parseCardJson('Sure! {"question":"Q","answer":"A","quote":"q"} done').card?.question === 'Q', 'reads a bare object in prose')
  assert(s.parseCardJson('[]').empty && s.parseCardJson('[]').card === null, '[] means nothing study-worthy')
  assert(s.parseCardJson('').card === null && !s.parseCardJson('').empty, 'empty text is not a card')
  assert(s.parseCardJson('[not json').card === null, 'broken JSON is not a card')
  assert(s.parseCardJson('[1, 2]').card === null, 'an array without objects is not a card')
  assert(s.parseCardJson('"just a string"').card === null, 'a JSON string is not a card')

  console.log('\ndropReason (#263 drop rules)')
  const good = {
    question: 'Which enzyme attaches carbon dioxide during sugar building?',
    answer: 'RuBisCO [itm_x]',
    quote: 'RuBisCO is the enzyme that fixes carbon dioxide.',
  }
  assert(s.dropReason(good, SECTION) === null, 'a paraphrased, grounded card is kept')
  assert(
    s.dropReason({ ...good, quote: '“RuBisCO  is the **enzyme** that fixes carbon dioxide”' }, SECTION) === null,
    'quotes match despite spacing, curly quotes and Markdown',
  )
  assert(/verbatim/.test(s.dropReason({ ...good, quote: 'RuBisCO is the only enzyme in plants.' }, SECTION) ?? ''), 'quote not in the note → dropped')
  assert(/empty/.test(s.dropReason({ ...good, answer: '[itm_x]' }, SECTION) ?? ''), 'an answer that is only a citation → dropped')
  assert(/quote/.test(s.dropReason({ ...good, quote: '' }, SECTION) ?? ''), 'no quote → dropped')
  assert(
    /6\+/.test(s.dropReason({ ...good, question: 'What uses ATP and NADPH to fix carbon dioxide into sugar?', answer: 'The Calvin cycle' }, SECTION) ?? ''),
    'copying a 6-word run → dropped',
  )
  assert(
    /already/.test(s.dropReason({ ...good, question: 'What does the enzyme RuBisCO do with carbon dioxide?', answer: 'RuBisCO' }, SECTION) ?? ''),
    'answer already in the question → dropped',
  )
  assert(/passage/.test(s.dropReason({ ...good, question: 'According to the passage, which enzyme fixes CO2?' }, SECTION) ?? ''), 'meta wording → dropped')
  assert(/mentioned|passage/.test(s.dropReason({ ...good, question: 'Which enzyme is mentioned for fixing CO2?' }, SECTION) ?? ''), '"mentioned" → dropped')
  assert(/open list/.test(s.dropReason({ ...good, question: 'Name one product of the light reactions.' }, SECTION) ?? ''), 'open list → dropped')
  assert(/not shown/.test(s.dropReason({ ...good, question: 'What does the graph show about oxygen release?' }, SECTION) ?? ''), 'unseen figure → dropped')
  assert(/not shown/.test(s.dropReason({ ...good, question: 'Where does this process take place?' }, SECTION) ?? ''), '"this process" → dropped')
  assert(/multiple choice/.test(s.dropReason({ ...good, question: 'Which of the following fixes carbon dioxide?' }, SECTION) ?? ''), 'multiple choice → dropped')
  assert(s.copiesRun('a b c d e', 'a b c d e f g') === false, 'questions shorter than the run never copy')
  assert(s.stripCitations('RuBisCO [itm_abc] fixes it [itm_a, itm_b].') === 'RuBisCO fixes it.', 'stripCitations removes [itm_…] markers')

  console.log('\nbuildCloze / explainPrompt (offline fallbacks)')
  const cloze = s.buildCloze(SECTION)
  assert(!!cloze && cloze.question.startsWith('Fill the gap:') && cloze.question.includes('_____'), `cloze blanks a key term (${cloze?.question})`)
  assert(!!cloze && /^(ATP|NADPH|RuBisCO)$/.test(cloze.answer), `the gap is a strong term (${cloze?.answer})`)
  assert(!!cloze && SECTION.includes(cloze.quote), 'the cloze quote is a sentence from the section')
  assert(!!cloze && !cloze.question.includes(cloze.answer), 'the answer is not left in the prompt')
  const portCloze = s.buildCloze('Source: notes\n# Ports\nSecure web traffic uses port 443 over TCP by default today.')
  assert(portCloze?.answer === '443' || portCloze?.answer === 'TCP', `numbers and acronyms make gaps (${portCloze?.answer})`)
  assert(s.buildCloze('too short') === null, 'no usable sentence → null')
  assert(s.explainPrompt('Cells', 1, 4).includes('part 2 of 4') && s.explainPrompt('Cells', null, 1).includes('“Cells”'), 'explain prompt names the note and part')

  // --- getCardQuestion ---
  console.log('\ngetCardQuestion: generation, grounding and cache')
  const note = db.createItem({ title: 'Photosynthesis', body: SECTION, kind: 'note', para: 'resources', project: 'Bio' })
  const [card] = cardsMod.createNoteCards(note.id).created
  mockResult = reply(
    JSON.stringify([
      {
        question: 'Which enzyme attaches carbon dioxide during sugar building?',
        answer: `RuBisCO [${note.id}] [itm_notretrieved]`,
        quote: 'RuBisCO is the enzyme that fixes carbon dioxide.',
      },
    ]),
  )
  mockCalls = 0
  const q1 = await s.getCardQuestion(card.id)
  assert(q1.kind === 'generated' && q1.question.startsWith('Which enzyme'), 'a generated free-recall question')
  assert(q1.answer === 'RuBisCO', 'the stored answer has no raw [itm_] ids')
  assert(q1.citations.length === 1 && q1.citations[0].id === note.id, 'validateCitations keeps only the card’s own note')
  assert(q1.title === 'Photosynthesis' && q1.question !== q1.title, 'the prompt is never the note title')
  assert(lastPrompt.includes(`id=${note.id}`) && lastPrompt.includes('TASK (study-card generation'), 'one grounded call for this section')
  assert(q1.model === 'openai/gpt-oss-20b', 'records the model')
  const q2 = await s.getCardQuestion(card.id)
  assert(mockCalls === 1 && q2.question === q1.question, 'the next session reuses the cached question (no model call)')
  const row = db.getDb().prepare('SELECT q_kind, q_source_hash, q_model FROM study_cards WHERE id = ?').get(card.id) as Record<string, string>
  assert(row.q_kind === 'generated' && !!row.q_source_hash && row.q_model === 'openai/gpt-oss-20b', 'cached on the card with the section hash')

  db.updateItem(note.id, { body: SECTION + ' Stomata let carbon dioxide in.' })
  mockResult = reply(
    JSON.stringify([{ question: 'Through which pores does CO2 enter a leaf?', answer: 'Stomata', quote: 'Stomata let carbon dioxide in.' }]),
  )
  const q3 = await s.getCardQuestion(card.id)
  assert(mockCalls === 2 && q3.answer === 'Stomata', 'editing the section invalidates the cache and regenerates')

  console.log('\ngetCardQuestion: drops and failures')
  const n2 = db.createItem({ title: 'Light reactions', body: SECTION, kind: 'note', para: 'resources', project: 'Bio' })
  const [c2] = cardsMod.createNoteCards(n2.id).created
  mockResult = reply(JSON.stringify([{ question: 'According to the passage, what splits?', answer: 'water', quote: 'made up' }]))
  const d1 = await s.getCardQuestion(c2.id)
  assert(d1.kind === 'cloze' && !!d1.notice && /checks/.test(d1.notice), 'a dropped card falls back to a cloze, with a notice')
  const callsAfterDrop = mockCalls
  const d2 = await s.getCardQuestion(c2.id)
  assert(mockCalls === callsAfterDrop && d2.kind === 'cloze', 'dropped cards are not retried (fallback cached)')

  const n3 = db.createItem({ title: 'Offline', body: SECTION, kind: 'note', para: 'resources', project: 'Bio' })
  const [c3] = cardsMod.createNoteCards(n3.id).created
  mockResult = { ok: false, error: 'No local model detected', provider: null as unknown as string }
  const o1 = await s.getCardQuestion(c3.id)
  assert(o1.kind === 'cloze' && o1.offline === true && /AI offline/.test(o1.notice ?? ''), 'no model → cloze with an "AI offline" notice')
  mockResult = reply(JSON.stringify([{ question: 'Which gas leaves when water is split?', answer: 'Oxygen', quote: 'The light reactions split water and release oxygen gas.' }]))
  const o2 = await s.getCardQuestion(c3.id)
  assert(o2.kind === 'generated', 'an offline fallback is not cached: the next session tries the model again')

  const n4 = db.createItem({ title: 'Limited', body: SECTION, kind: 'note', para: 'resources', project: 'Bio' })
  const [c4] = cardsMod.createNoteCards(n4.id).created
  mockResult = {
    ok: false,
    error: 'Groq HTTP 429: Rate limit reached for model in organization org_01abcdef on tokens per minute (TPM). Please try again in 7.5s.',
    provider: 'groq',
    providerLabel: 'Groq',
  }
  const r1 = await s.getCardQuestion(c4.id)
  assert(r1.rateLimited === true && !r1.offline, 'a 429 is reported as rate limited, not offline (#274)')
  assert(!/org_/.test(r1.notice ?? '') && !/org_/.test(r1.question), 'the provider error (org id) never reaches the card')
  assert(/7\.5 ?s|8 ?s|try again/.test(r1.notice ?? ''), `the wait is parsed (${r1.notice})`)
  mockResult = { ok: false, error: 'Rate limit reached: tokens per day (TPD) limit 200000', provider: 'groq', providerLabel: 'Groq' }
  assert(/Daily limit/.test((await s.getCardQuestion(c4.id)).notice ?? ''), 'a daily cap says so')
  mockResult = { ok: false, error: 'HTTP 500 upstream boom', provider: 'groq', providerLabel: 'Groq' }
  const f1 = await s.getCardQuestion(c4.id)
  assert(/Groq call failed/.test(f1.notice ?? '') && !/boom/.test(f1.notice ?? ''), 'other failures name the provider, not its message')
  mockResult = reply('')
  const e1 = await s.getCardQuestion(c4.id)
  assert(e1.kind === 'cloze' && /no question/.test(e1.notice ?? ''), 'empty output (reasoning budget, #275) falls back, uncached')
  mockResult = reply('[]')
  const z1 = await s.getCardQuestion(c4.id)
  assert(/nothing study-worthy/.test(z1.notice ?? ''), '[] → fallback, cached with the reason')
  mockResult = reply('I cannot help with that.')
  const n5 = db.createItem({ title: 'Prose', body: SECTION, kind: 'note', para: 'resources', project: 'Bio' })
  const [c5] = cardsMod.createNoteCards(n5.id).created
  assert(/not a question card/.test((await s.getCardQuestion(c5.id)).notice ?? ''), 'an unreadable reply falls back')

  const bare = db.createItem({ title: 'Tiny', body: 'short words only here', kind: 'note', para: 'resources', project: 'Bio' })
  const [cb] = cardsMod.createNoteCards(bare.id).created
  mockResult = { ok: false, error: 'No local model detected' }
  const ex = await s.getCardQuestion(cb.id)
  assert(ex.kind === 'explain' && ex.answer === null && /explain the main idea/.test(ex.question), 'no cloze possible → explain prompt')

  // Cards that carry their own question (#265, #273) skip generation.
  const ts = new Date().toISOString()
  db.getDb()
    .prepare(
      `INSERT INTO study_cards (id, item_id, origin, question, answer, source_key, status, created_at, updated_at)
       VALUES ('crd_pt', ?, 'practice-test', 'What attack follows someone through a door?', 'Tailgating', 'test:x#1', 'active', ?, ?)`,
    )
    .run(note.id, ts, ts)
  const before = mockCalls
  const pt = await s.getCardQuestion('crd_pt')
  assert(pt.kind === 'test' && pt.answer === 'Tailgating' && mockCalls === before, 'a practice-test card uses its own question, no model')
  db.getDb()
    .prepare(
      `INSERT INTO study_cards (id, item_id, origin, source_key, status, created_at, updated_at)
       VALUES ('crd_empty', ?, 'reverse', 'pair:x', 'active', ?, ?)`,
    )
    .run(note.id, ts, ts)
  assert((await s.getCardQuestion('crd_empty')).kind !== 'generated', 'a non-note card without a question gets a fallback, never a model call')
  let threw = false
  try {
    await s.getCardQuestion('crd_missing')
  } catch {
    threw = true
  }
  assert(threw, 'an unknown card throws')

  // --- Session, answers, summary ---
  console.log('\nsession: answers and summary')
  const start = s.startStudySession({ project: 'Bio', limit: 3 })
  assert(start.sessionId.startsWith('ses_') && start.cards.length === 3, 'startStudySession: id + queue capped by limit')
  assert(s.startStudySession({ project: 'Bio', limit: 0 }).cards.length >= 1, 'a bad limit falls back to at least one card')
  const [a, b, c] = start.cards
  const sid = start.sessionId
  const r = s.answerStudyCard({ sessionId: sid, cardId: a.card_id, question: 'Q1', attempt: 'RuBisCO', confidence: 90, grade: 'got', answer: 'RuBisCO' })
  assert(r.state.reps === 1 && r.dueAt > new Date().toISOString(), 'Got it → scheduled forward')
  s.answerStudyCard({ sessionId: sid, cardId: b.card_id, question: 'Q2', attempt: 'water', confidence: 85, grade: 'missed' })
  s.answerStudyCard({ sessionId: sid, cardId: c.card_id, question: 'Q3', dontKnow: true, confidence: 80, grade: 'partial' })
  // The missed card comes back later in the session and is answered again.
  s.answerStudyCard({ sessionId: sid, cardId: b.card_id, question: 'Q2', attempt: 'oxygen', confidence: 60, grade: 'got' })
  const att = db.getDb().prepare('SELECT * FROM study_attempts WHERE session_id = ? ORDER BY rowid').all(sid) as Array<Record<string, unknown>>
  assert(att.length === 4 && att.every((x) => x.card_id && x.item_id && x.grade), 'every attempt stores card, note, session and grade')
  assert(att[2].attempt === 'I don’t know' && att[2].confidence === 0, '"I don\'t know" is stored with confidence 0')
  const sum = s.studySessionSummary(sid, 'Bio')
  assert(sum.cards === 3 && sum.got === 1 && sum.missed === 1 && sum.partial === 1, 'summary counts each card’s first try')
  assert(sum.retried === 1, 'and how many came back and were retried')
  assert(Math.abs(sum.accuracy - 0.5) < 1e-9, 'accuracy: (got + partial/2) / cards')
  assert(sum.confidentMisses.length === 1 && sum.confidentMisses[0].cardId === b.card_id, 'confident-but-missed is called out (85% → Missed)')
  assert(sum.calibration.count === 3 && sum.calibration.bias > 0, 'calibration over first tries (overconfident here)')
  assert(sum.revisit.length === 2, 'notes to revisit: the ones not recalled on the first try')
  assert(!!sum.nextDueAt && sum.dueByTomorrow >= 1, 'what’s next: the next due time and cards due by tomorrow')
  const empty = s.studySessionSummary('ses_none')
  assert(empty.cards === 0 && empty.accuracy === 0, 'an unknown session summarises to zero')
  let threw2 = false
  try {
    s.answerStudyCard({ sessionId: sid, cardId: 'crd_missing', question: 'q', grade: 'got' })
  } catch {
    threw2 = true
  }
  assert(threw2, 'answering an unknown card throws')
  assert(review.getCardState(a.card_id)?.reps === 1, 'the grade reached the scheduler')

  console.log('\n"Already in Study" (default 5)')
  const outside = db.createItem({ title: 'Not studied', body: 'x', kind: 'note', para: 'resources' })
  const ids = cardsMod.enrolledItemIds([note.id, outside.id, note.id])
  assert(ids.length === 1 && ids[0] === note.id, 'enrolledItemIds lists notes that have cards')
  assert(cardsMod.enrolledItemIds([]).length === 0, 'empty input → empty')
  db.closeDb()

  // --- Migration v8 → v9 keeps cards, schedules and history ---
  console.log('\nmigration v9')
  const v8 = path.join(tmp, 'v8.sqlite')
  db.initDb(v8)
  const keep = db.createItem({ title: 'Kept', body: SECTION, kind: 'note', para: 'resources', project: 'Bio' })
  const [kc] = cardsMod.createNoteCards(keep.id).created
  review.rateReview(kc.id, 'good')
  const sched = JSON.stringify(db.getDb().prepare('SELECT * FROM card_schedule').all())
  const logs = JSON.stringify(db.getDb().prepare('SELECT * FROM review_log').all())
  db.closeDb()
  const raw = new Database(v8)
  for (const col of ['q_kind', 'q_source_hash', 'q_model', 'q_at', 'q_note']) raw.exec(`ALTER TABLE study_cards DROP COLUMN ${col}`)
  for (const col of ['card_id', 'item_id', 'session_id', 'grade']) {
    if (col === 'session_id') raw.exec('DROP INDEX IF EXISTS idx_study_attempts_session')
    raw.exec(`ALTER TABLE study_attempts DROP COLUMN ${col}`)
  }
  raw.pragma('user_version = 8')
  raw.close()
  db.initDb(v8)
  const cols = (db.getDb().prepare('PRAGMA table_info(study_cards)').all() as { name: string }[]).map((x) => x.name)
  assert(cols.includes('q_kind') && cols.includes('q_source_hash'), 'v8 vault gains the question cache columns')
  assert(Number(db.getDb().pragma('user_version', { simple: true })) >= 9, 'user_version bumped')
  assert(JSON.stringify(db.getDb().prepare('SELECT * FROM card_schedule').all()) === sched, 'schedules are unchanged')
  assert(JSON.stringify(db.getDb().prepare('SELECT * FROM review_log').all()) === logs, 'review history is unchanged')
  db.closeDb()
  db.initDb(v8)
  assert(cardsMod.listCardsForItem(keep.id).length === 1, 're-opening is a no-op')
  db.closeDb()

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
