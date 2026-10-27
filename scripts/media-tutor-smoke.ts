/**
 * #364 — Exam tutor in Media chat: the prompt contract (short, quiz-before-
 * telling, JSON shapes), reply checks (verbatim quote, window-only citations,
 * objectives only from a cited objectives note), the attempt → confidence →
 * reveal guard, graduated hints, grading, the why-check, practice from a miss
 * without duplicate cards, the v15 migration and project rename/delete.
 *
 *   npm run test:media-tutor
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
const OFFLINE: MockGen = { ok: false, error: 'No local model detected' }
let mockResult: MockGen = OFFLINE
const mockQueue: MockGen[] = []
let mockCalls = 0
const prompts: string[] = []
const systems: string[] = []
function reply(text: string): MockGen {
  return { ok: true, text, provider: 'ollama', providerLabel: 'Ollama', model: 'qwen3:8b', local: true, fallback: false }
}
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async (input: { prompt: string; system?: string }) => {
        mockCalls++
        prompts.push(input.prompt)
        systems.push(input.system ?? '')
        return mockQueue.length > 0 ? mockQueue.shift()! : mockResult
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
async function rejects(fn: () => Promise<unknown> | unknown, re: RegExp, msg: string): Promise<void> {
  try {
    await fn()
    assert(false, msg)
  } catch (e) {
    assert(re.test(e instanceof Error ? e.message : String(e)), `${msg} (${e instanceof Error ? e.message : e})`)
  }
}

const VIDEO = 'https://www.youtube.com/watch?v=aplus000001'
const PROJECT = 'A+ Core 1'
const LINES: Array<[number, string]> = [
  [570, 'Dynamic Host Configuration Protocol, or DHCP, hands out IP addresses to clients automatically when they join the network.'],
  [600, 'Secure web traffic over HTTPS uses port 443 by default, while plain HTTP uses port 80.'],
  [630, 'The Domain Name System translates host names like example.com into IP addresses for every lookup.'],
  [660, 'Simple Mail Transfer Protocol sends email between mail servers, and it listens on port 25.'],
  [2400, 'Laser printers use a fuser assembly that melts toner onto the paper with heat and pressure.'],
]

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Exam tutor (#364) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-364-'))
  const dbFile = path.join(tmp, 'vault.sqlite')
  const db = require('../electron/db') as typeof import('../electron/db')
  const captions = require('../electron/media-captions') as typeof import('../electron/media-captions')
  const bm = require('../electron/media-bookmarks') as typeof import('../electron/media-bookmarks')
  const t = require('../electron/media-tutor') as typeof import('../electron/media-tutor')
  const defs = require('../electron/media-persona-defs') as typeof import('../electron/media-persona-defs')

  // --- Migration v14 → v15 only adds a table ---
  console.log('migration v15')
  db.initDb(dbFile)
  const kept = db.createItem({ title: 'Kept', body: 'Still here.', kind: 'note', para: 'resources', project: PROJECT })
  bm.addBookmark({ videoKey: VIDEO, project: PROJECT, positionSec: 12 })
  db.closeDb()
  const raw = new Database(dbFile)
  raw.exec('DROP TABLE media_tutor_questions;')
  raw.pragma('user_version = 14')
  raw.close()
  db.initDb(dbFile)
  const d = db.getDb()
  assert(db.SCHEMA_VERSION === 15 && Number(d.pragma('user_version', { simple: true })) === 15, 'user_version is 15')
  assert(!!d.prepare("SELECT name FROM sqlite_master WHERE name = 'media_tutor_questions'").get(), 'media_tutor_questions exists')
  assert(db.getItem(kept.id)?.title === 'Kept' && bm.listBookmarks(VIDEO).length === 1, 'existing notes and bookmarks survive')

  // --- Seed a transcript + an objectives note ---
  const ids: Record<number, string> = {}
  for (const [sec, text] of LINES) {
    const it = db.createItem({
      title: captions.mediaNoteTitle(sec, 'A+ Core 1'),
      body: captions.buildTranscriptNoteBody({ text, startSec: sec, endSec: sec + 30, sourceUrl: VIDEO }),
      kind: 'transcript',
      para: 'resources',
      project: PROJECT,
    })
    ids[sec] = it.id
  }
  const objectivesNote = db.createItem({
    title: 'CompTIA A+ 220-1201 exam objectives',
    body: '# Objectives\n- 1.1 Given a scenario, monitor mobile device hardware and use appropriate replacement techniques.\n- 2.1 Compare and contrast Transmission Control Protocol ports, protocols, and their purposes such as HTTPS and DNS.\n- 3.6 Given a scenario, deploy and maintain laser printers and the fuser.\nNot an objective line',
    kind: 'note',
    para: 'resources',
    project: PROJECT,
  })

  // --- Persona ---
  console.log('\nExam tutor voice')
  const tutor = defs.getMediaPersonaById('exam-tutor')
  assert(!!tutor && /instead of answering/.test(tutor.description), 'built-in Exam tutor explains it quizzes rather than answers')
  assert(!!tutor && tutor.body.includes(defs.MEDIA_HARD_RULES), 'same grounding rules as the other voices')

  // --- Prompt contract (pure) ---
  console.log('\nprompt contract')
  const chunks: import('../electron/media-tutor').WindowChunk[] = LINES.slice(0, 4).map(([s, text]) => ({ id: ids[s], start: s, end: s + 30, text }))
  const block = t.passagesBlock(chunks)
  assert(block.split('\n').length === 4 && block.startsWith(`[${ids[570]} @ 09:30]`), 'passages are `[itm @ time] text`, in order')
  assert(t.passagesBlock(chunks, 150).split('\n').length === 1, 'passages are capped for small models')
  assert(t.passagesBlock([{ id: 'itm_x', start: 0, end: 1, text: 'x'.repeat(500) }], 100).length === 100, 'a single long chunk is cut, not dropped')
  const objectives = t.projectObjectives(PROJECT)
  assert(objectives.length === 3 && objectives[1].code === '2.1' && objectives[1].itemId === objectivesNote.id, 'objectives are parsed from the objectives note only')
  assert(t.parseObjectives('Objective 4.2: Explain RAID levels\n### 5.1 Troubleshoot\n4.2 duplicate', 'itm_o', 'O').map((o) => o.code).join() === '4.2,5.1', 'objective lines: codes, headings, no duplicates')
  const cands = t.candidateObjectives(objectives, chunks.map((c) => c.text).join(' '))
  assert(cands[0]?.code === '2.1' && !cands.some((c) => c.code === '1.1'), `candidates share words with the window (${cands.map((c) => c.code)})`)
  assert(t.matchObjective('2.1 Compare…', cands)?.code === '2.1' && t.matchObjective('9.9', cands) === null && t.matchObjective('', cands) === null && t.matchObjective({}, cands) === null, 'only a listed objective code can be tagged')
  assert(t.matchObjective(2.1, cands)?.code === '2.1', 'a numeric objective code is accepted')
  const qp = t.quizPrompt(block, 2, cands)
  assert(qp.length < 3200, `quiz prompt stays short (${qp.length} chars)`)
  assert(/Write 2 short-answer recall questions/.test(qp) && /JSON array only/.test(qp), 'quiz prompt asks for N recall questions as JSON')
  assert(/never put the answer in the question/.test(qp) && /no multiple choice/.test(qp) && /exact words copied/.test(qp), 'quiz prompt: no answer in the question, no MC, verbatim quote')
  assert(/Exam objectives/.test(qp) && qp.includes('2.1 Compare'), 'objectives are listed when the project has an objectives note')
  assert(!/Exam objectives/.test(t.quizPrompt(block, 1, [])) && /Write 1 short-answer recall question a/.test(t.quizPrompt(block, 1, [])), 'no objectives section without an objectives note; singular wording')
  assert(t.TUTOR_SYSTEM.length < 200 && /ONLY the transcript/.test(t.TUTOR_SYSTEM) && /Never add outside facts/.test(t.TUTOR_SYSTEM), 'system line is short and grounded')
  const gp = t.gradePrompt('Port 443', 'HTTPS uses port 443', '443')
  assert(gp.length < 400 && /missed\|partial\|got/.test(gp) && /no new facts/.test(gp), 'grading prompt is short, uses Study grades, no new facts')
  const wp = t.whyPrompt('Passage text', 'because')
  assert(wp.length < 300 && /supported\|partly\|unsupported/.test(wp), 'why prompt is short')

  console.log('\nreply checks (pure)')
  assert(t.parseQuizReply('```json\n[{"q":"Q?","a":"A","quote":"x","hint":"h","term":"T","obj":"2.1"}]\n```')[0]?.term === 'T', 'reads fenced JSON')
  assert(t.parseQuizReply('{"question":"Q?","answer":"A"}')[0]?.answer === 'A', 'reads a single object with long keys')
  assert(t.parseQuizReply('nope').length === 0 && t.parseQuizReply('[oops').length === 0 && t.parseQuizReply('[1, "x"]').length === 0, 'garbage is no questions')
  assert(t.chunkForQuote('“Secure web traffic over HTTPS uses port 443”', chunks)?.id === ids[600], 'a verbatim quote finds its chunk (quotes and case ignored)')
  assert(t.chunkForQuote('HTTPS always uses port 8443', chunks) === null && t.chunkForQuote('', chunks) === null, 'a paraphrase is not a quote')
  assert(t.revealsAnswer('It is DNS of course', 'DNS [itm_1]') && !t.revealsAnswer('Think of name lookups', 'DNS'), 'revealsAnswer')
  assert(!t.revealsAnswer('anything', '[itm_1]'), 'an empty answer reveals nothing')
  assert(t.termHint('HTTPS', 'Port 443') === 'Key term: HTTPS', 'key term hint')
  assert(/starts with “D” \(3 characters\)/.test(t.termHint('DNS', 'DNS')) && !/DNS/.test(t.termHint('DNS', 'DNS')), 'a key term that is the answer becomes a first-letter hint')
  assert(/first word/.test(t.termHint('', 'Domain Name System')) && /stresses/.test(t.termHint('', '!!!')), 'multi-word and empty answers')

  const drafts = t.parseQuizReply(
    JSON.stringify([
      { q: 'Which port does secure web browsing use by default?', a: `Port 443 [${ids[600]}] [itm_notinwindow]`, quote: 'Secure web traffic over HTTPS uses port 443 by default', hint: 'Think of the secure version of web pages.', term: 'HTTPS', obj: '2.1' },
      { q: 'Which made-up protocol is mentioned?', a: 'Nope', quote: 'not in the transcript at all', hint: '', term: '', obj: '9.9' },
      { q: 'Which service converts host names into numeric addresses?', a: 'DNS', quote: 'The Domain Name System translates host names', hint: 'It is DNS', term: 'DNS', obj: '7.7' },
      { q: 'Which port does secure web browsing use by default?', a: 'Port 443', quote: 'Secure web traffic over HTTPS uses port 443 by default', hint: '', term: '', obj: '' },
    ]),
  )
  const checked = t.checkDrafts(drafts, chunks, cands, 3)
  assert(checked.length === 2, `invented, unquoted and duplicate questions are dropped (${checked.length})`)
  assert(checked[0].sources.join() === ids[600] && checked[0].rewatch === 600, 'citations are limited to window notes; rewatch is the quote’s chunk')
  assert(checked[0].objective?.code === '2.1' && checked[1].objective === null, 'an invented objective code is dropped')
  assert(checked[1].hint === '' && checked[1].sources.join() === ids[630], 'a hint that gives the answer away is dropped; uncited answers cite the quote’s chunk')
  assert(t.checkDrafts(drafts, chunks, cands, 1).length === 1, 'at most N questions')
  const cl = t.clozeQuestions(chunks, 2)
  assert(cl.length === 2 && cl.every((c) => c.kind === 'cloze' && c.question.includes('_____')), 'offline fallback: fill-the-gap from the window')

  console.log('\ngrading + why (pure)')
  assert(t.overlapGrade('Port 443', 'port 443') === 'got' && t.overlapGrade('Port 443', '443') === 'partial' && t.overlapGrade('Port 443', 'port 80 maybe') === 'partial', 'overlap grade')
  assert(t.overlapGrade('Port 443', '') === 'missed' && t.overlapGrade('DNS', 'no idea') === 'missed' && t.overlapGrade('a', 'b') === 'missed', 'overlap grade misses')
  assert(t.parseGrade('{"grade":"Got it","missed":""}')?.grade === 'got' && t.parseGrade('{"grade":"partly"}')?.grade === 'partial', 'grade synonyms map to Study grades')
  assert(t.parseGrade('{"grade":"excellent"}') === null && t.parseGrade('[1]') === null && t.parseGrade('nope') === null, 'unknown grades are rejected')
  assert(t.parseWhy('{"verdict":"not supported","note":"n"}')?.verdict === 'unsupported' && t.parseWhy('{"verdict":"partial"}')?.verdict === 'partly' && t.parseWhy('{"verdict":"?"}') === null && t.parseWhy('x') === null, 'why verdicts')
  const now = new Date(2026, 9, 24, 10)
  assert(/in 10 days \(2026-11-03\)\. Make this a Study card/.test(t.examNoteFor('2026-11-03', true, now) ?? ''), 'exam note for a miss suggests a card before the exam')
  assert(t.examNoteFor('2026-10-24', false, now) === 'Your exam is today (2026-10-24).' && /tomorrow/.test(t.examNoteFor('2026-10-25', false, now) ?? ''), 'exam today / tomorrow')
  assert(t.examNoteFor(null, true, now) === null && t.examNoteFor('2026-01-01', true, now) === null, 'no note without a (future) exam date')

  // --- The loop against the DB ---
  console.log('\nquiz (model)')
  mockQueue.push(reply(JSON.stringify(drafts.map((x) => ({ q: x.question, a: x.answer, quote: x.quote, hint: x.hint, term: x.term, obj: x.obj })))))
  const before = mockCalls
  const quiz = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, windowSec: 45, count: 3 })
  assert(mockCalls === before + 1, 'one model call writes the quiz')
  assert(systems[systems.length - 1] === t.TUTOR_SYSTEM && prompts[prompts.length - 1].includes(ids[600]), 'the call uses the short system line and the window passages')
  assert(quiz.questions.length === 2 && quiz.questions[0].text.startsWith('Which port'), 'checked questions come back')
  const wire = JSON.stringify(quiz)
  assert(!/\b443\b/.test(wire) && !/Secure web traffic/.test(wire) && !/secure version/.test(wire) && !wire.includes(ids[600]), 'the renderer gets no answer, quote, hint or citation before the reveal')
  assert(quiz.questions[0].objective?.itemId === objectivesNote.id && /^2\.1 /.test(quiz.questions[0].objective.label), 'the objective tag cites the objectives note')
  assert(quiz.questions[1].objective === null, 'no objective tag without a matching objective')
  assert(quiz.windowStartSec === 570 && quiz.windowEndSec === 660 && quiz.bookmarkId === null && quiz.examDate === null, 'quiz window and no exam date yet')

  console.log('\nhints')
  const q1 = quiz.questions[0].id
  const h1 = t.tutorHint({ questionId: q1, level: 1 })
  const h2 = t.tutorHint({ questionId: q1, level: 2 })
  const h3 = t.tutorHint({ questionId: q1, level: 3 })
  assert(h1.level === 1 && /secure version/.test(h1.text) && !h1.last && h1.seekSec === null, 'hint 1 is a nudge')
  assert(h2.level === 2 && h2.text === 'Key term: HTTPS' && !/443/.test(h2.text), 'hint 2 is a key term, not the answer')
  assert(h3.level === 3 && h3.seekSec === 600 && h3.last && /Rewatch from 10:00/.test(h3.text), 'hint 3 points at the moment to rewatch')
  assert(t.tutorHint({ questionId: q1, level: 9 }).level === 3 && t.tutorHint({ questionId: q1, level: 0 }).level === 1, 'levels are clamped')
  const q2 = quiz.questions[1].id
  assert(/Think about/.test(t.tutorHint({ questionId: q2, level: 1 }).text), 'a missing nudge falls back to a generic one')
  assert(/starts with “D”/.test(t.tutorHint({ questionId: q2, level: 2 }).text), 'the key term that is the answer is never shown')

  console.log('\nreveal guard')
  const callsBeforeGuard = mockCalls
  await rejects(() => t.tutorReveal({ questionId: q1, confidence: 'low' }), /Type an answer/, 'no reveal without an attempt')
  await rejects(() => t.tutorReveal({ questionId: q1, attempt: 'port 443', confidence: '' as never }), /Low, Medium or High/, 'no reveal without a confidence pick')
  await rejects(() => t.tutorReveal({ questionId: 'tq_missing', attempt: 'x', confidence: 'low' }), /no longer exists/, 'unknown question')
  assert(mockCalls === callsBeforeGuard && !(d.prepare('SELECT revealed_at FROM media_tutor_questions WHERE id = ?').get(q1) as { revealed_at: string | null }).revealed_at, 'the guard never calls the model or records a reveal')
  await rejects(() => t.tutorWhy({ questionId: q1, why: 'x' }), /Answer the question first/, 'no why-check before the reveal')
  await rejects(() => Promise.resolve(t.tutorPractice({ questionId: q1 })), /Answer the question first/, 'no practice before the reveal')

  console.log('\nreveal + why')
  const r1 = await t.tutorReveal({ questionId: q1, attempt: 'Port 443', confidence: 'high' }, now)
  assert(mockCalls === callsBeforeGuard, 'an exact answer is graded without a model call')
  assert(r1.grade === 'got' && r1.answer === 'Port 443' && r1.rewatchSec === 600 && r1.citations.map((c) => c.id).join() === ids[600], 'Got it, with the cited answer and the rewatch time')
  assert(r1.askWhy && !r1.offerPractice && r1.examNote === null, 'a right answer asks why and offers no practice')
  await rejects(() => Promise.resolve(t.tutorHint({ questionId: q1, level: 1 })), /already been answered/, 'no hints after the reveal')
  mockQueue.push(reply('{"verdict":"supported","note":"Yes — HTTPS is the secure web protocol on 443."}'))
  const w1 = await t.tutorWhy({ questionId: q1, why: 'Because HTTPS is secure web traffic and it uses 443.' })
  assert(w1.verdict === 'supported' && /secure web/.test(w1.note) && w1.citations[0]?.id === ids[600], 'the why-sentence is checked against the cited passage')
  assert(prompts[prompts.length - 1].includes('Secure web traffic over HTTPS'), 'the why prompt carries the cited passage')
  await rejects(() => t.tutorWhy({ questionId: q1, why: '  ' }), /one sentence/, 'an empty why is refused')
  mockResult = OFFLINE
  const w2 = await t.tutorWhy({ questionId: q1, why: 'Because mail servers listen on port 25.' })
  assert(w2.verdict !== 'supported', `offline why-check falls back to word overlap (${w2.verdict})`)
  const w3 = await t.tutorWhy({ questionId: q1, why: 'Secure web traffic over HTTPS uses port 443 by default.' })
  assert(w3.verdict === 'supported', 'offline: a reason taken from the passage is supported')
  const w4 = await t.tutorWhy({ questionId: q1, why: 'Bananas are yellow fruit.' })
  assert(w4.verdict === 'unsupported' && /doesn’t say/.test(w4.note), 'offline: an unrelated reason is not supported')

  console.log('\nmiss → practice (no duplicates)')
  db.setProjectExamDate(PROJECT, '2026-11-03')
  const r2 = await t.tutorReveal({ questionId: q2, dontKnow: true, confidence: 'low' }, now)
  assert(r2.grade === 'missed' && !r2.askWhy && r2.offerPractice && /No problem/.test(r2.feedback), "I don't know counts as an attempt and is graded Missed")
  assert(/in 10 days/.test(r2.examNote ?? ''), 'the exam date is mentioned when suggesting review')
  const p1 = t.tutorPractice({ questionId: q2, videoTitle: 'A+ Core 1', sourceType: 'youtube' })
  assert(p1.bookmarkCreated && p1.bookmark.tag === 'Confused' && p1.bookmark.positionSec === 630 && p1.cardId === null, 'a miss becomes a Confused bookmark at the moment')
  const p2 = t.tutorPractice({ questionId: q2, makeCard: true })
  assert(!p2.bookmarkCreated && p2.bookmark.id === p1.bookmark.id && !!p2.cardId && p2.cardCreated, 'then a Study card through the bookmark-card path')
  const p3 = t.tutorPractice({ questionId: q2, makeCard: true })
  assert(p3.cardId === p2.cardId && !p3.cardCreated, 'making the card again adds no duplicate')
  const cardCount = (d.prepare('SELECT COUNT(*) AS n FROM media_bookmark_cards WHERE bookmark_id = ?').get(p1.bookmark.id) as { n: number }).n
  assert(cardCount === 1, 'one card link for the bookmark')

  mockQueue.push(reply(JSON.stringify([{ q: 'What does DNS turn host names into?', a: `IP addresses [${ids[630]}]`, quote: 'translates host names like example.com into IP addresses', hint: 'numbers', term: 'lookup', obj: '' }])))
  const quiz2 = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 640, windowSec: 15, count: 1 })
  const q3 = quiz2.questions[0].id
  mockQueue.push(reply('{"grade":"partial","missed":"You said names, not addresses."}'))
  const r3 = await t.tutorReveal({ questionId: q3, attempt: 'host names', confidence: 'high' }, now)
  assert(r3.grade === 'partial' && r3.feedback === 'You said names, not addresses.', 'a partial answer is graded by the model')
  assert(r3.offerPractice && r3.askWhy, 'confident but only partly right: offer practice and still ask why')
  const p4 = t.tutorPractice({ questionId: q3 })
  assert(!p4.bookmarkCreated && p4.bookmark.id === p1.bookmark.id, 'another miss at the same moment reuses the Confused bookmark')
  assert(bm.listBookmarks(VIDEO).filter((b) => b.tag === 'Confused').length === 1, 'still one Confused bookmark')

  console.log('\nfallbacks')
  mockResult = OFFLINE
  const off = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 9 })
  assert(off.questions.length === 3 && off.questions.every((q) => q.kind === 'cloze') && /AI offline/.test(off.notice ?? ''), 'offline: up to 3 fill-the-gap questions with a notice')
  const offQ = off.questions[0].id
  const offR = await t.tutorReveal({ questionId: offQ, attempt: 'something unrelated', confidence: 'medium' }, now)
  assert(/matching words/.test(offR.notice ?? '') && offR.grade === 'missed', 'offline grading by word match, with a notice')
  assert(/Not this time/.test(offR.feedback), 'default feedback for a miss')
  mockQueue.push(reply('[]'))
  const bad = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 1 })
  assert(bad.questions[0].kind === 'cloze' && /didn’t pass/.test(bad.notice ?? ''), 'an unusable reply falls back with a notice')
  mockQueue.push({ ok: false, error: 'HTTP 429 rate limit org_123', provider: 'groq', providerLabel: 'Groq' })
  const rl = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 1 })
  assert(/Groq is rate limited/.test(rl.notice ?? '') && !/org_/.test(rl.notice ?? ''), 'rate limits are named without the provider text')
  mockQueue.push({ ok: false, error: 'HTTP 500 boom', provider: 'groq', providerLabel: 'Groq' })
  const boom = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 0 })
  assert(/Groq could not write questions/.test(boom.notice ?? '') && !/boom/.test(boom.notice ?? '') && boom.questions.length === 2, 'other failures: plain notice, default count')
  const jsq = (await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 1 })).questions[0].id
  mockQueue.push(reply('not json'))
  const jsr = await t.tutorReveal({ questionId: jsq, attempt: 'IP', confidence: 'low' }, now)
  assert(['missed', 'partial', 'got'].includes(jsr.grade) && !jsr.notice, 'an unreadable grade reply falls back to word match')
  const sj = (await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 1 })).questions[0].id
  const sr = await t.tutorReveal({ questionId: sj, justShowMe: true, confidence: 'low' }, now)
  assert(sr.grade === 'missed' && /asked to see/.test(sr.feedback), '"Just show me" is explicit and graded Missed')

  console.log('\nbookmark quiz + limits')
  const b = bm.addBookmark({ videoKey: VIDEO, project: PROJECT, positionSec: 2410, label: 'printers' })
  const bq = await t.tutorQuiz({ videoKey: VIDEO, project: '', centerSec: 0, bookmarkId: b.id, count: 1 })
  assert(bq.bookmarkId === b.id && bq.centerSec === 2410, 'a bookmark quiz is about the bookmark’s moment')
  await rejects(() => t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 9000 }), /nothing around/, 'no transcript → honest refusal')
  await rejects(() => t.tutorQuiz({ videoKey: '', project: PROJECT, centerSec: 1 }), /Open a video/, 'needs a video')
  await rejects(() => t.tutorQuiz({ videoKey: VIDEO, project: '', centerSec: 1 }), /Open a media project/, 'needs a project')
  await rejects(() => t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 1, bookmarkId: 'bmk_gone' }), /no longer exists/, 'a deleted bookmark')
  const tiny = db.createItem({
    title: 'tiny',
    body: captions.buildTranscriptNoteBody({ text: 'Okay.', startSec: 5000, endSec: 5005, sourceUrl: VIDEO }),
    kind: 'transcript',
    para: 'resources',
    project: PROJECT,
  })
  await rejects(() => t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 5002, windowSec: 3 }), /too short/, 'too little transcript to quiz')
  db.deleteItem(tiny.id)

  console.log('\nobjective tags need the cited note')
  db.trashItem(objectivesNote.id)
  const row = d.prepare('SELECT * FROM media_tutor_questions WHERE id = ?').get(q1) as Parameters<typeof t.publicQuestion>[0]
  assert(t.publicQuestion(row, 0, 1).objective === null, 'trashing the objectives note drops the tag')
  mockQueue.push(reply(JSON.stringify([{ q: 'Which port does secure web browsing use by default?', a: 'Port 443', quote: 'Secure web traffic over HTTPS uses port 443 by default', hint: '', term: '', obj: '2.1' }])))
  const noObj = await t.tutorQuiz({ videoKey: VIDEO, project: PROJECT, centerSec: 615, count: 1 })
  assert(noObj.questions[0].objective === null && !/Exam objectives/.test(prompts[prompts.length - 1]), 'without an objectives note there are no objectives in the prompt or tags')

  console.log('\nreview list (#365)')
  const misses = t.listTutorMisses(VIDEO)
  assert(misses.some((m) => m.questionId === q2 && !m.confidentWrong) && misses.some((m) => m.questionId === q3 && m.confidentWrong), 'misses and confident-but-wrong answers are listed')
  assert(!misses.some((m) => m.questionId === q1), 'right answers are not')
  assert(misses.every((m, i) => i === 0 || misses[i - 1].rewatchSec <= m.rewatchSec), 'in video order')

  console.log('\nprojects')
  db.renameProject(PROJECT, 'A+ 220-1201')
  assert(t.listTutorMisses(VIDEO).every((m) => m.project === 'A+ 220-1201'), 'rename moves tutor questions')
  db.deleteProject('A+ 220-1201')
  assert(t.listTutorMisses(VIDEO).length === 0, 'delete removes them')

  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
