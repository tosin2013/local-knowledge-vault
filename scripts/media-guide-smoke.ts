/**
 * #365 — Study guide / research notes built while watching: chapters, the
 * prompt contract, reply checks (window-only citations, gaps as questions,
 * unsupported claims from the learner's own words), checkpoints, ai-draft
 * rewrite-to-confirm, exact quotes, key terms, Review these, cards through the
 * bookmark-card path without duplicates, the v16 migration, rename/delete.
 *
 *   npm run test:media-guide
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


const VIDEO = 'https://www.youtube.com/watch?v=mit6100l001'
const PROJECT = 'MIT 6.100L'
const LINES: Array<[number, string]> = [
  [0, 'Welcome to 6.100L. Today we talk about what computation is and how a computer stores knowledge.'],
  [60, 'Declarative knowledge is a statement of fact, while imperative knowledge is a recipe, a how-to.'],
  [120, 'An algorithm is a sequence of simple steps, with a flow of control and a way to stop.'],
  [180, 'Python objects have a type, such as int, float, bool, and NoneType, and the type tells you what you can do.'],
  [700, 'Variables bind names to values with the equals sign, and you can rebind a name to a new value later.'],
  [760, 'Expressions combine objects and operators, and Python evaluates them to a single value.'],
]

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Study guide / research notes (#365) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-365-'))
  const dbFile = path.join(tmp, 'vault.sqlite')
  const db = require('../electron/db') as typeof import('../electron/db')
  const captions = require('../electron/media-captions') as typeof import('../electron/media-captions')
  const bm = require('../electron/media-bookmarks') as typeof import('../electron/media-bookmarks')
  const ch = require('../electron/media-chapters') as typeof import('../electron/media-chapters')
  const g = require('../electron/media-guide') as typeof import('../electron/media-guide')

  // --- Migration v15 → v16 only adds tables ---
  console.log('migration v16')
  db.initDb(dbFile)
  const kept = db.createItem({ title: 'Kept', body: 'Still here.', kind: 'note', para: 'resources', project: PROJECT })
  db.closeDb()
  const raw = new Database(dbFile)
  raw.exec('DROP TABLE media_guide_entries; DROP TABLE media_guides; DROP TABLE media_chapters;')
  raw.pragma('user_version = 15')
  raw.close()
  db.initDb(dbFile)
  const d = db.getDb()
  assert(db.SCHEMA_VERSION >= 16 && Number(d.pragma('user_version', { simple: true })) === db.SCHEMA_VERSION, 'user_version is current (≥ 16)')
  for (const t of ['media_chapters', 'media_guides', 'media_guide_entries']) {
    assert(!!d.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(t), `${t} exists`)
  }
  assert(db.getItem(kept.id)?.title === 'Kept', 'existing notes survive')

  // --- Seed a transcript ---
  const ids: Record<number, string> = {}
  for (const [sec, text] of LINES) {
    ids[sec] = db.createItem({
      title: captions.mediaNoteTitle(sec, 'Lecture 1'),
      body: captions.buildTranscriptNoteBody({ text, startSec: sec, endSec: sec + 60, sourceUrl: VIDEO }),
      kind: 'transcript',
      para: 'resources',
      project: PROJECT,
    }).id
  }
  // Another video's transcript in the same project never leaks into this guide.
  db.createItem({
    title: 'Other · 00:00',
    body: captions.buildTranscriptNoteBody({ text: 'Recursion calls a function from inside itself.', startSec: 0, endSec: 60, sourceUrl: 'https://youtu.be/other' }),
    kind: 'transcript',
    para: 'resources',
    project: PROJECT,
  })
  const related = db.createItem({ title: 'My Python types cheat sheet', body: 'int float bool NoneType — type tells you what operations work.', kind: 'note', para: 'resources', project: PROJECT })

  // --- Chapters ---
  console.log('\nchapters')
  const parsed = ch.parseYtChapters({
    chapters: [
      { start_time: 600, end_time: 1200, title: ' Variables ' },
      { start_time: 0, end_time: 600, title: 'Intro' },
      { start_time: 'x', end_time: 5 },
      { start_time: 50, end_time: 40, title: 'bad' },
      null,
    ],
  })
  assert(parsed.length === 2 && parsed[0].title === 'Intro' && parsed[1].title === 'Variables', 'yt-dlp chapters are parsed, sorted, trimmed; bad ones dropped')
  assert(ch.parseYtChapters({}).length === 0 && ch.parseYtChapters(null).length === 0, 'no chapters → empty')
  assert(ch.saveVideoChapters(VIDEO, parsed) === 2 && ch.listVideoChapters(VIDEO).length === 2, 'chapters saved per video')
  ch.saveVideoChapters(VIDEO, parsed)
  assert(ch.listVideoChapters(VIDEO).length === 2, 'saving again replaces (no duplicates)')
  assert(ch.saveVideoChapters('  ', parsed) === 0, 'no key → nothing saved')

  // --- Prompt contract (pure) ---
  console.log('\nprompt contract')
  const chunks = g.videoChunks(PROJECT, VIDEO)
  assert(chunks.length === LINES.length && chunks.every((c) => !/source_url|t_start/.test(c.text)), 'video chunks: only this video, metadata stripped')
  const first = g.chunksInRange(chunks, 0, 600)
  assert(first.length === 4, 'range picks chunks overlapping [start, end)')
  const block = g.rangeBlock(first)
  assert(block.startsWith(`[${ids[0]} @ 00:00]`) && block.split('\n').length === 4, 'range block is `[itm @ time] text`')
  assert(g.rangeBlock(first, 300).length <= 300, 'range block is capped')
  assert(g.rangeBlock([]) === '', 'empty range → empty block')
  const sp = g.summaryCheckPrompt(block, 'my words', '00:00–10:00')
  assert(sp.length < 3600 && /do not answer them/.test(sp) && /exact words from the summary/.test(sp) && /JSON only/.test(sp), 'summary-check prompt: short, gaps as questions, claims from the summary, JSON')
  assert(/"gaps":\[\{"q"/.test(sp) && /"unsupported"/.test(sp) && /"covered"/.test(sp), 'summary-check JSON shape')
  const tp = g.textCheckPrompt('passage', 'definition of "x"', 'mine')
  assert(tp.length < 400 && /supported\|partly\|unsupported/.test(tp), 'text-check prompt is short with a fixed verdict set')
  const dp = g.draftPrompt(block, '00:00–10:00')
  assert(/\[itm_id\]/.test(dp) && /only the transcript/.test(dp), 'draft prompt asks for cited bullets from the transcript only')
  assert(g.GUIDE_SYSTEM.length < 200 && /ONLY the transcript/.test(g.GUIDE_SYSTEM), 'system line is short and grounded')

  // --- Pure checks ---
  console.log('\nreply checks')
  const c120 = chunks.find((c) => c.start === 120)!
  assert(g.sanitizeGap('What three things does an algorithm need?', c120) === 'What three things does an algorithm need?', 'a real question is kept')
  assert(/at 02:00\?$/.test(g.sanitizeGap('An algorithm is a sequence of simple steps.', c120)), 'a statement (not a question) becomes a rewatch prompt')
  assert(/at 02:00\?$/.test(g.sanitizeGap('Is an algorithm a sequence of simple steps, with a flow of control?', c120)), 'a gap copying 6+ transcript words (the answer) is replaced')
  const summary = 'Declarative knowledge is facts and imperative knowledge is a recipe. Python was invented in 1975 by NASA.'
  const good = JSON.stringify({
    covered: [{ point: 'Declarative vs imperative knowledge', id: ids[60] }, { point: 'made up', id: 'itm_nothere' }],
    gaps: [
      { q: 'What does an algorithm need to have?', id: ids[120] },
      { q: 'dup', id: ids[120] },
      { q: 'What does an object’s type tell you?', id: ids[180] },
      { q: 'Outside window?', id: ids[700] },
    ],
    unsupported: [{ claim: 'Python was invented in 1975 by NASA', why: 'Not in the transcript.' }, { claim: 'words the learner never wrote', why: 'x' }],
  })
  const pc = g.parseSummaryCheck(good, first, summary)!
  assert(pc.covered.length === 1 && pc.covered[0].itemId === ids[60] && pc.covered[0].sec === 60, 'covered points must cite a window note')
  assert(pc.gaps.length === 2 && pc.gaps.every((x) => x.text.endsWith('?')) && !pc.gaps.some((x) => x.itemId === ids[700]), 'gaps: window-only, one per note, questions')
  assert(pc.unsupported.length === 1 && pc.unsupported[0].claim === 'Python was invented in 1975 by NASA', 'unsupported claims must be the learner’s own words')
  assert(g.parseSummaryCheck('not json', first, summary) === null && g.parseSummaryCheck('{"covered":[]}', first, summary) === null && g.parseSummaryCheck('[1]', first, summary) === null, 'unusable replies → null')
  assert(g.parseSummaryCheck('```json\n' + good + '\n```', first, summary) !== null, 'fenced JSON is accepted')
  const oc = g.overlapSummaryCheck(first, summary)
  assert(oc.covered.length >= 1 && oc.covered.some((x) => x.itemId === ids[60]), 'no-model check finds what the learner covered')
  assert(oc.gaps.length >= 1 && oc.gaps.length <= g.GUIDE_MAX_GAPS && oc.gaps.every((x) => /^What does the speaker explain at /.test(x.text)), 'no-model gaps are rewatch questions, never answers')
  assert(oc.unsupported.some((u) => /NASA/.test(u.claim)), 'no-model check flags the unsupported sentence')
  assert(g.parseVerdict('{"verdict":"partly","note":"x [itm_a1]"}')?.verdict === 'partly' && g.parseVerdict('{"verdict":"maybe"}') === null, 'verdict parsing')
  assert(g.overlap('', 'x') === 0 && g.overlap('python types', 'Python types matter') === 1, 'overlap helper')

  // Quotes
  const q1 = g.findExactQuote(chunks, 'imperative knowledge is a recipe, a how-to')
  assert(!!q1 && q1.sec === 60 && q1.itemId === ids[60] && q1.text === 'imperative knowledge is a recipe, a how-to', 'exact quote found with its time')
  assert(!!g.findExactQuote(chunks, '“imperative   knowledge\nis a recipe, a how-to”'), 'whitespace and curly quotes aside, still exact')
  assert(g.findExactQuote(chunks, 'imperative knowledge is a recipe or how-to') === null, 'a paraphrase is not a quote')
  assert(g.findExactQuote(chunks, 'Imperative Knowledge is a recipe') === null, 'case must match')
  assert(!!g.findExactQuote(chunks, 'way to stop. Python objects have a type'), 'a quote can cross a caption boundary')
  assert(g.findExactQuote(chunks, 'ab') === null, 'too-short quote refused')

  // Confirm rule
  const draft = '- An algorithm is a sequence of simple steps [itm_x]'
  assert(g.confirmRejection(draft, draft) !== null, 'unchanged draft cannot be confirmed')
  assert(g.confirmRejection(draft, '  ' + draft.toUpperCase() + ' ') !== null, 'case/space-only edits do not count')
  assert(g.confirmRejection(draft, '') !== null, 'empty confirm refused')
  assert(g.confirmRejection(draft, 'An algorithm: simple steps, control flow, and it must stop.') === null, 'a rewrite confirms')
  assert(g.confirmRejection(draft, undefined, 'sequence of simple steps') !== null, 'a line copied from the draft is refused')
  assert(g.confirmRejection(draft, undefined, 'ok') !== null, 'a too-short line is refused')
  assert(g.confirmRejection(draft, undefined, 'Recipes with steps that eventually stop') === null, 'an own-words line confirms')
  assert(g.confirmRejection(draft, undefined, 'one\ntwo three four') !== null, 'own-words summary is one line')

  // Review date
  const now = new Date(2026, 9, 24)
  assert(g.suggestReviewDate(null, now).date === '2026-10-25', 'no exam date → tomorrow')
  assert(g.suggestReviewDate('2026-11-20', now).date === '2026-11-02', 'exam in 27 days → review in ~9 days')
  assert(g.suggestReviewDate('2026-10-25', now).date === '2026-10-24', 'exam tomorrow → today')
  assert(g.suggestReviewDate('2026-10-27', now).date === '2026-10-25', 'never later than the day before the exam')
  assert(g.suggestReviewDate('2026-10-01', now).date === '2026-10-25', 'past exam date → tomorrow')

  // --- Guide lifecycle ---
  console.log('\nstudy guide')
  await rejects(() => g.startGuide({ videoKey: '', project: PROJECT, mode: 'study' }), /Open a video/, 'start needs a video')
  await rejects(() => g.startGuide({ videoKey: VIDEO, project: '', mode: 'study' }), /media project/, 'start needs a project')
  const guide = g.startGuide({ videoKey: VIDEO, project: PROJECT, videoTitle: 'Lecture 1', sourceType: 'youtube', mode: 'study' })
  const note = db.getItem(guide.itemId!)!
  assert(note.title === 'Study guide: Lecture 1' && note.project === PROJECT && note.status === 'active', 'note "Study guide: <title>" in the project')
  assert(guide.checkpointMin === 10 && !guide.checkpointsOff && guide.chapters.length === 2, 'defaults: every 10 min, chapters loaded')
  assert(g.startGuide({ videoKey: VIDEO, project: PROJECT, mode: 'study' }).id === guide.id, 'starting again reopens the same guide')
  assert(g.listGuides(VIDEO).length === 1, 'one guide per video and mode')
  assert(g.updateGuideSettings({ guideId: guide.id, checkpointMin: 5 }).checkpointMin === 5, 'checkpoint interval changes')
  assert(g.updateGuideSettings({ guideId: guide.id, checkpointsOff: true }).checkpointsOff, 'checkpoints can be turned off')
  assert(g.updateGuideSettings({ guideId: guide.id, snoozedUntilSec: 900 }).snoozedUntilSec === 900, 'snooze')
  const s2 = g.updateGuideSettings({ guideId: guide.id, checkpointsOff: false, snoozedUntilSec: null, checkpointMin: 10, lastCheckpointSec: 30 })
  assert(!s2.checkpointsOff && s2.snoozedUntilSec === null && s2.lastCheckpointSec === 30, 'settings restore')
  await rejects(() => g.updateGuideSettings({ guideId: guide.id, checkpointMin: 0 }), /1–120/, 'interval bounds')
  await rejects(() => g.updateGuideSettings({ guideId: 'gde_nope' }), /no longer exists/, 'unknown guide')

  // Summary check with a model reply
  mockCalls = 0
  mockQueue.push(reply(good))
  await rejects(() => g.checkSummary({ guideId: guide.id, startSec: 0, endSec: 600, text: '  ' }), /Write your summary/, 'empty summary refused (you write first)')
  await rejects(() => g.checkSummary({ guideId: guide.id, startSec: 600, endSec: 600, text: 'x' }), /end must be after/, 'bad range refused')
  const check = await g.checkSummary({ guideId: guide.id, startSec: 0, endSec: 600, text: summary })
  assert(mockCalls === 1 && prompts[prompts.length - 1].includes(summary) && prompts[prompts.length - 1].includes(ids[60]), 'one model call with the summary and the window')
  assert(!prompts[prompts.length - 1].includes(ids[700]), 'only that part of the transcript is sent')
  assert(check.covered.length === 1 && check.gaps.length === 2 && check.unsupported.length === 1 && !check.notice, 'check returns covered / gaps / unsupported')
  assert(check.citations.length === 3 && check.citations.every((c) => c.id.startsWith('itm_')), 'cited by transcript note')
  assert(db.getItem(guide.itemId!)!.body.indexOf(summary) === -1, 'checking saves nothing')
  // Offline fallback
  mockResult = OFFLINE
  const off = await g.checkSummary({ guideId: guide.id, startSec: 0, endSec: 600, text: summary })
  assert(!!off.notice && /No model/.test(off.notice) && off.gaps.length > 0, 'offline: word-overlap check with a notice')
  mockQueue.push(reply('nope'))
  const bad = await g.checkSummary({ guideId: guide.id, startSec: 0, endSec: 600, text: summary })
  assert(!!bad.notice && /didn’t pass/.test(bad.notice), 'unusable model reply → fallback with a notice')
  const none = await g.checkSummary({ guideId: guide.id, startSec: 3000, endSec: 3600, text: summary })
  assert(/no transcript/.test(none.notice ?? '') && none.gaps.length === 0, 'no transcript in range → says so')

  // Save checkpoint: verbatim summary + chosen gaps only
  const afterSave = g.saveCheckpoint({ guideId: guide.id, startSec: 0, endSec: 600, text: summary, check, gapIndexes: [1] })
  const sumEntry = afterSave.entries.find((e) => e.section === 'summary')!
  assert(sumEntry.text === summary && !sumEntry.aiDraft && sumEntry.confirmed, 'summary kept verbatim as the learner’s own')
  const gapEntries = afterSave.entries.filter((e) => e.section === 'gap')
  assert(gapEntries.length === 1 && gapEntries[0].startSec === 180, 'only the chosen gap is kept')
  assert(afterSave.lastCheckpointSec === 600 && afterSave.snoozedUntilSec === null, 'checkpoint moves the marker')
  let md = db.getItem(guide.itemId!)!.body
  assert(md.includes(`## [00:00](${bm.timestampLink(VIDEO, 0)})–[10:00](${bm.timestampLink(VIDEO, 600)}) · Intro`), 'heading by timestamp range with links and chapter')
  assert(md.includes('Rewatch for:') && md.includes(`[03:00](${bm.timestampLink(VIDEO, 180)})`), 'gap listed under its range with a link')
  assert(g.saveCheckpoint({ guideId: guide.id, startSec: 0, endSec: 300, text: '' }).lastCheckpointSec === 600, 'empty summary (skip) saves nothing new and never moves back')

  // Draft on request → ai-draft until rewritten
  console.log('\nai-draft')
  mockQueue.push(reply(`- Variables bind names to values [${ids[700]}]\n- Not cited\n- Bad cite [itm_zzz]\n- Expressions evaluate to one value [${ids[760]}]`))
  const drafted = await g.draftSection({ guideId: guide.id, startSec: 600, endSec: 1200 })
  const dEntry = drafted.entries.find((e) => e.aiDraft)!
  assert(!!dEntry && !dEntry.confirmed && dEntry.text.split('\n').length === 2, 'draft keeps only cited, in-window bullets')
  assert(drafted.hasUnconfirmedDraft && db.getItem(guide.itemId!)!.status === 'ai-draft', 'note is ai-draft while a draft is unconfirmed')
  md = db.getItem(guide.itemId!)!.body
  assert(md.includes('ai-draft — rewrite to confirm'), 'draft section is marked in the note')
  await rejects(() => g.confirmEntry({ entryId: dEntry.id, text: dEntry.text }), /unchanged/, 'confirming the draft as-is is refused')
  await rejects(() => g.confirmEntry({ entryId: dEntry.id, ownLine: 'Variables bind names to values' }), /copied from the draft/, 'copied line refused')
  const confirmed = g.confirmEntry({ entryId: dEntry.id, ownLine: 'Names point at values and expressions boil down to one value' })
  const cEntry = confirmed.entries.find((e) => e.id === dEntry.id)!
  assert(cEntry.confirmed && cEntry.text.startsWith('**In my words:** Names point'), 'own-words line confirms the draft')
  assert(!confirmed.hasUnconfirmedDraft && db.getItem(guide.itemId!)!.status === 'active', 'note returns to active')
  assert(!db.getItem(guide.itemId!)!.body.includes('rewrite to confirm'), 'marker gone after confirming')
  assert(g.confirmEntry({ entryId: dEntry.id, text: 'again' }).entries.find((e) => e.id === dEntry.id)!.text === cEntry.text, 'confirming twice is a no-op')
  mockResult = OFFLINE
  const d2 = await g.draftSection({ guideId: guide.id, startSec: 0, endSec: 120 })
  const d2e = d2.entries.filter((e) => e.aiDraft && !e.confirmed)[0]
  assert(!!d2e && d2e.text.includes(`[${ids[0]}]`), 'offline draft: transcript sentences, cited, still an ai-draft')
  const rewritten = g.confirmEntry({ entryId: d2e.id, text: 'Computation = how a computer stores and uses knowledge.' })
  assert(rewritten.entries.find((e) => e.id === d2e.id)!.text === 'Computation = how a computer stores and uses knowledge.', 'a rewrite replaces the draft')
  await rejects(() => g.draftSection({ guideId: guide.id, startSec: 4000, endSec: 4100 }), /no transcript/, 'draft needs transcript')
  await rejects(() => g.confirmEntry({ entryId: 'gen_nope', text: 'x' }), /no longer exists/, 'unknown entry')

  // Key terms
  console.log('\nkey terms')
  mockQueue.push(reply('{"verdict":"supported","note":"The transcript says so."}'))
  const t1 = await g.addEntry({ guideId: guide.id, section: 'term', term: 'algorithm', text: 'steps + control flow + a stopping point', sec: 100 })
  const term = t1.entries.find((e) => e.section === 'term')!
  assert(term.term === 'algorithm' && term.startSec === 120 && (term.check as { verdict: string }).verdict === 'supported', 'term checked against where the transcript mentions it')
  assert(prompts[prompts.length - 1].includes('definition of "algorithm"') && prompts[prompts.length - 1].includes('sequence of simple steps'), 'term prompt carries the definition and the passage')
  const callsBefore = mockCalls
  const t2 = await g.addEntry({ guideId: guide.id, section: 'term', term: 'recursion', text: 'calling yourself' })
  const t2e = t2.entries.find((e) => e.term === 'recursion')!
  assert(mockCalls === callsBefore && (t2e.check as { verdict: string }).verdict === 'not-found', 'term not in this video → “doesn’t mention”, no model call')
  mockResult = OFFLINE
  const t3 = await g.addEntry({ guideId: guide.id, section: 'term', term: 'type', text: 'type tells you what you can do with an object', sec: 180 })
  assert((t3.entries.find((e) => e.term === 'type')!.check as { verdict: string }).verdict === 'supported', 'offline term check by overlap')
  await rejects(() => g.addEntry({ guideId: guide.id, section: 'term', term: '', text: 'x' }), /Name the key term/, 'term name required')
  await rejects(() => g.addEntry({ guideId: guide.id, section: 'term', term: 'x', text: '' }), /own words/, 'definition required')
  md = db.getItem(guide.itemId!)!.body
  assert(md.includes('## Key terms') && md.includes('**algorithm** — steps + control flow') && md.includes('✓ transcript supports this') && md.includes('✗ not in the transcript'), 'Key terms section with check marks')

  // Review these: bookmarks + tutor misses
  console.log('\nreview these')
  const conf = bm.addBookmark({ videoKey: VIDEO, project: PROJECT, positionSec: 750, label: 'Rebinding?', tag: 'Confused' })
  bm.addBookmark({ videoKey: VIDEO, project: PROJECT, positionSec: 30, label: 'Exam stuff', tag: 'Exam' })
  d.prepare(
    `INSERT INTO media_tutor_questions (id, quiz_id, video_key, project, center_sec, window_sec, question, answer, hint, key_term, quote, rewatch_sec, source_ids, kind, model, hints_used, confidence, grade, created_at, revealed_at)
     VALUES ('tq_1','tz_1',?,?,180,45,'What does a type tell you?','what you can do','','type','the type tells you',180,'[]','short','m',0,'high','partial',?,?)`,
  ).run(VIDEO, PROJECT, db.nowIso(), db.nowIso())
  const withReview = g.getGuide(guide.id)
  assert(withReview.review.length === 3, 'bookmarks and tutor misses are listed')
  assert(withReview.review[0].refId === conf.id || withReview.review[0].confidentWrong, 'Confused / confident-but-wrong come first')
  assert(withReview.review.some((r) => r.kind === 'tutor-miss' && r.confidentWrong), 'tutor miss marked confident-but-wrong')
  g.getGuide(guide.id)
  g.updateGuideSettings({ guideId: guide.id })
  md = (g.saveCheckpoint({ guideId: guide.id, startSec: 600, endSec: 660, text: '' }), db.getItem(guide.itemId!)!.body)
  assert(md.includes('## Review these') && md.includes('Rebinding? — Confused') && md.includes('Exam tutor (confident but wrong): What does a type tell you?'), 'Review these section in the note')

  // Cards: through the bookmark-card path, never duplicates
  console.log('\ncards')
  const cardsBefore = (d.prepare('SELECT COUNT(*) n FROM study_cards').get() as { n: number }).n
  const made = g.makeGuideCards(guide.id, now)
  const termsAndGaps = g.getGuide(guide.id).entries.filter((e) => (e.section === 'term' || e.section === 'gap') && e.startSec != null)
  assert(made.created === termsAndGaps.length && made.existing === 0, 'one card per key term / kept gap')
  assert(made.reviewDate === '2026-10-25' && /No exam date/.test(made.reviewNote), 'review date suggested (no exam date → tomorrow)')
  const cardsMid = (d.prepare('SELECT COUNT(*) n FROM study_cards').get() as { n: number }).n
  assert(cardsMid - cardsBefore === made.created, 'Study cards created')
  db.setProjectExamDate(PROJECT, '2026-11-20')
  const again = g.makeGuideCards(guide.id, now)
  assert(again.created === 0 && again.existing === made.created, 'making cards again → no duplicates')
  assert((d.prepare('SELECT COUNT(*) n FROM study_cards').get() as { n: number }).n === cardsMid, 'card count unchanged')
  assert(again.reviewDate === '2026-11-02' && /27 days/.test(again.reviewNote), 'review date from the exam date')
  assert(g.getGuide(guide.id).review.length === 3, 'card bookmarks stay out of Review these')
  const linked = d.prepare('SELECT COUNT(*) n FROM media_bookmark_cards bc JOIN media_bookmarks b ON b.id = bc.bookmark_id WHERE b.video_key = ?').get(VIDEO) as { n: number }
  assert(linked.n === made.created, 'cards are linked to bookmarks (#334 path)')
  const empty = g.startGuide({ videoKey: 'https://youtu.be/other', project: PROJECT, mode: 'study' })
  await rejects(() => g.makeGuideCards(empty.id), /key term or keep a gap/, 'nothing to card → explains')

  // --- Research notes ---
  console.log('\nresearch notes')
  const rn = g.startGuide({ videoKey: VIDEO, project: PROJECT, videoTitle: 'Lecture 1', sourceType: 'youtube', mode: 'research' })
  assert(rn.id !== guide.id && db.getItem(rn.itemId!)!.title === 'Research notes: Lecture 1', 'research notes are a separate note')
  assert(g.listGuides(VIDEO).length === 2, 'both modes listed for the video')
  await rejects(() => g.addEntry({ guideId: rn.id, section: 'quote', text: 'imperative knowledge is a recipe or a how-to', sec: 60 }), /doesn’t match the transcript exactly.*claim/, 'inexact quote refused, suggests a claim')
  const rq = await g.addEntry({ guideId: rn.id, section: 'quote', text: 'imperative  knowledge is a recipe, a how-to', sec: 2000 })
  const qe = rq.entries.find((e) => e.section === 'quote')!
  assert(qe.text === 'imperative knowledge is a recipe, a how-to' && qe.startSec === 60 && qe.itemRef === ids[60], 'exact quote stored with its timestamp and note')
  mockQueue.push(reply('{"verdict":"partly","note":"Only part is said."}'))
  const rc = await g.addEntry({ guideId: rn.id, section: 'claim', text: 'Python objects always have a type', sec: 180 })
  assert((rc.entries.find((e) => e.section === 'claim')!.check as { verdict: string }).verdict === 'partly', 'claim checked')
  mockResult = OFFLINE
  const rv = await g.addEntry({ guideId: rn.id, section: 'evidence', text: 'zebra quantum banana', sec: 10 })
  assert((rv.entries.find((e) => e.section === 'evidence')!.check as { verdict: string }).verdict === 'not-found', 'evidence with no match → not found')
  await g.addEntry({ guideId: rn.id, section: 'take', text: 'The recipe analogy works for me.' })
  const rqq = await g.addEntry({ guideId: rn.id, section: 'question', text: 'How does Python pick a type for 3/2?', sec: 760 })
  assert(rqq.entries.filter((e) => e.section === 'take' || e.section === 'question').length === 2, 'take and open question saved (unchecked)')
  const rel = g.relatedNotes(rn.id)
  assert(rel.some((r) => r.itemId === related.id) && !rel.some((r) => r.itemId === rn.itemId || r.itemId === guide.itemId), 'connections: related vault notes, not the guide notes')
  assert(!rel.some((r) => /^Lecture 1 ·/.test(r.title)), 'connections never include transcripts')
  const conn = g.connectNote({ guideId: rn.id, itemId: related.id })
  g.connectNote({ guideId: rn.id, itemId: related.id })
  assert(conn.entries.filter((e) => e.section === 'connection').length === 1, 'connecting twice keeps one link')
  assert(!g.relatedNotes(rn.id, 'types cheat sheet').some((r) => r.itemId === related.id), 'linked notes drop out of suggestions')
  await rejects(() => g.connectNote({ guideId: rn.id, itemId: 'itm_nope' }), /no longer exists/, 'connect to missing note refused')
  md = db.getItem(rn.itemId!)!.body
  for (const h of ['## Claims', '## Evidence given', '## Quotes', '## My take', '## Open questions', '## Connections', '## Review these']) assert(md.includes(h), `research note has "${h}"`)
  assert(md.includes('> “imperative knowledge is a recipe, a how-to” — [01:00]'), 'quote rendered with its timestamp')
  assert(md.includes('[[My Python types cheat sheet]]'), 'connection rendered as a wiki link')
  const del = g.deleteEntry(rqq.entries.find((e) => e.section === 'question')!.id)
  assert(!del.entries.some((e) => e.section === 'question'), 'entry delete')
  await rejects(() => g.deleteEntry('gen_nope'), /no longer exists/, 'delete missing entry')

  // Deleted note is recreated on the next change
  db.deleteItem(rn.itemId!)
  assert(g.getGuide(rn.id).itemId === null, 'deleted note → itemId null')
  const re = g.startGuide({ videoKey: VIDEO, project: PROJECT, mode: 'research' })
  assert(!!re.itemId && db.getItem(re.itemId)!.body.includes('## Quotes'), 'reopening recreates the note from the entries')

  // --- Project rename / delete ---
  console.log('\nproject rename / delete')
  db.renameProject(PROJECT, 'MIT 6.100L (fall)')
  assert(g.getGuide(guide.id).project === 'MIT 6.100L (fall)', 'rename moves guides')
  db.deleteProject('MIT 6.100L (fall)')
  assert((d.prepare('SELECT COUNT(*) n FROM media_guides').get() as { n: number }).n === 0, 'delete removes guides')
  assert((d.prepare('SELECT COUNT(*) n FROM media_guide_entries').get() as { n: number }).n === 0, 'entries cascade')

  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
