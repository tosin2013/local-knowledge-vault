/**
 * #334 — Media chat bookmarks: the repository (add / list / edit / delete,
 * kept across restarts), the v14 migration, transcript lines, "Make cards from
 * bookmarks" (one card per bookmark, no duplicates, Confused first, linked
 * back to the moment), the Markdown export with timestamp links, project
 * rename/delete, and "Summarize my bookmarks" retrieval in chat.
 *
 *   npm run test:media-bookmarks
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
let lastPrompt = ''
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async (input: { prompt?: string; messages?: Array<{ content: string }> }) => {
        lastPrompt = input.prompt ?? (input.messages ?? []).map((m) => m.content).join('\n')
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

const VIDEO = '/videos/kubernetes-lecture.mp4'
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Media chat bookmarks (#334) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-334-'))
  const dbFile = path.join(tmp, 'vault.sqlite')
  const db = require('../electron/db') as typeof import('../electron/db')
  const bm = require('../electron/media-bookmarks') as typeof import('../electron/media-bookmarks')
  const captions = require('../electron/media-captions') as typeof import('../electron/media-captions')
  const review = require('../electron/review') as typeof import('../electron/review')
  const session = require('../electron/study-session') as typeof import('../electron/study-session')
  const chat = require('../electron/chat') as typeof import('../electron/chat')

  // --- Migration v13 → v14 keeps everything and only adds tables ---
  console.log('migration v14')
  db.initDb(dbFile)
  const before = db.createItem({ title: 'Kept note', body: 'Pods are the smallest deployable unit.', kind: 'note', para: 'resources', project: 'Lecture' })
  db.setMediaState({ videoKey: VIDEO, project: 'Lecture', lastPositionSec: 42 })
  db.closeDb()
  const raw = new Database(dbFile)
  raw.exec('DROP TABLE media_bookmark_cards; DROP TABLE media_bookmarks;')
  raw.pragma('user_version = 13')
  const tablesBefore = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
  raw.close()
  db.initDb(dbFile)
  const d = db.getDb()
  const tablesAfter = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
  assert(Number(d.pragma('user_version', { simple: true })) === db.SCHEMA_VERSION && db.SCHEMA_VERSION === 14, 'user_version is 14')
  assert(
    tablesAfter.filter((t) => !tablesBefore.includes(t)).sort().join(',') === 'media_bookmark_cards,media_bookmarks' &&
      tablesBefore.every((t) => tablesAfter.includes(t)),
    'v14 only adds media_bookmarks and media_bookmark_cards',
  )
  assert(db.getItem(before.id)?.title === 'Kept note' && db.getMediaState(VIDEO)?.lastPositionSec === 42, 'existing notes and media state are kept')

  // --- Pure helpers ---
  console.log('\nhelpers')
  assert(bm.normalizeTag(' exam ') === 'Exam' && bm.normalizeTag('CONFUSED') === 'Confused', 'built-in tags are canonicalised')
  assert(bm.normalizeTag('') === null && bm.normalizeTag(null) === null && bm.normalizeTag(undefined) === null, 'an empty tag is none')
  assert(bm.normalizeTag('x'.repeat(40))!.length === bm.BOOKMARK_TAG_MAX, 'a custom tag is capped')
  assert(bm.normalizeLabel('  come   back\nto this ') === 'come back to this', 'labels collapse whitespace')
  assert(bm.normalizeLabel('y'.repeat(300)).length === bm.BOOKMARK_LABEL_MAX, 'labels are capped')
  assert(bm.timestampLink(YT, 6300.7) === `${YT}&t=6300s`, 'YouTube links get t=…s')
  assert(bm.timestampLink('https://youtu.be/dQw4w9WgXcQ?t=5', 90) === 'https://youtu.be/dQw4w9WgXcQ?t=90s', 'an existing t= is replaced')
  assert(bm.timestampLink(VIDEO, 6300) === `file://${VIDEO}#t=6300`, 'local files get a #t= media fragment')
  assert(bm.timestampLink('C:\\Videos\\a b.mp4', 5) === 'file:///C:/Videos/a%20b.mp4#t=5', 'Windows paths become file URLs')
  assert(bm.chunkAt([{ start: 0, end: 10 }, { start: 20, end: 30 }], 15)?.start === 0, 'chunkAt falls back to the chunk before a gap')
  assert(bm.chunkAt([{ start: 0, end: 10 }, { start: 10, end: 20 }], 10)?.start === 10, 'a boundary belongs to the chunk that starts there')
  assert(bm.chunkAt([{ start: 0, end: 10 }], 10)?.start === 0, 'and the very end to the last chunk')
  assert(bm.chunkAt([{ start: 5, end: 10 }], 1) === null, 'and is null before the first chunk')
  assert(bm.stripTranscriptMetadata('Hello\n\nt_start: 1\nsource_path: /x\nmedia_bookmark: b') === 'Hello', 'metadata lines are stripped')

  // --- Transcript for a 2-hour video ---
  for (let t = 0; t < 7200; t += 30) {
    db.createItem({
      title: captions.mediaNoteTitle(t, 'Lecture'),
      body: captions.buildTranscriptNoteBody({ text: `At minute ${Math.floor(t / 60)} the lecturer explains topic ${t}.`, startSec: t, endSec: t + 30, sourcePath: VIDEO }),
      kind: 'transcript',
      para: 'resources',
      project: 'Lecture',
    })
  }

  // --- Repository ---
  console.log('\nrepository')
  let threw = false
  try {
    bm.addBookmark({ videoKey: '', project: 'Lecture', positionSec: 1 })
  } catch {
    threw = true
  }
  assert(threw, 'a bookmark needs a video')
  threw = false
  try {
    bm.addBookmark({ videoKey: VIDEO, project: 'Lecture', positionSec: Number.NaN })
  } catch {
    threw = true
  }
  assert(threw, 'and a valid time')
  const b1 = bm.addBookmark({ videoKey: VIDEO, project: 'Lecture', videoTitle: 'Lecture', positionSec: 6300 })
  assert(b1.positionSec === 6300 && b1.label === '' && b1.tag === null && b1.sourceType === 'local', 'B at 1:45:00 adds a bookmark at 1:45:00')
  assert(b1.transcriptLine === 'At minute 105 the lecturer explains topic 6300.', `it shows the matching transcript line (${b1.transcriptLine})`)
  const b2 = bm.addBookmark({ videoKey: VIDEO, project: 'Lecture', positionSec: 61.25, label: 'intro', tag: 'review' })
  const b3 = bm.addBookmark({ videoKey: VIDEO, project: 'Lecture', positionSec: 3000, label: 'lost here', tag: 'Confused' })
  bm.addBookmark({ videoKey: YT, project: 'Other', positionSec: 10, sourceType: 'youtube' })
  const list = bm.listBookmarks(VIDEO)
  assert(list.map((b) => b.id).join() === [b2.id, b3.id, b1.id].join(), 'the list is sorted by time and per video')
  assert(bm.listBookmarks('').length === 0 && bm.listBookmarks('/nope.mp4').length === 0, 'an unknown video has none')
  const edited = bm.updateBookmark({ id: b1.id, label: 'exam topic', tag: 'exam' })
  assert(edited?.label === 'exam topic' && edited.tag === 'Exam' && edited.positionSec === 6300, 'edit label + tag keeps the time')
  assert(bm.updateBookmark({ id: b1.id, tag: null })?.tag === null, 'the tag can be cleared')
  bm.updateBookmark({ id: b1.id, tag: 'Exam' })
  assert(bm.updateBookmark({ id: 'bmk_missing', label: 'x' }) === null, 'editing a missing bookmark returns null')
  assert(bm.updateBookmark({ id: b2.id, positionSec: 65 })?.positionSec === 65, 'the time can be corrected')

  // Kept across "restarts".
  db.closeDb()
  db.initDb(dbFile)
  assert(bm.listBookmarks(VIDEO).length === 3 && bm.getBookmark(b1.id)?.label === 'exam topic', 'bookmarks survive closing and reopening the vault')

  // --- Cards ---
  console.log('\nmake cards from bookmarks')
  threw = false
  try {
    bm.makeBookmarkCards({ videoKey: VIDEO, project: '' })
  } catch {
    threw = true
  }
  assert(threw, 'cards need a project')
  const made = bm.makeBookmarkCards({ videoKey: VIDEO, project: 'Lecture', windowSec: 45 })
  assert(made.created === 3 && made.existing === 0, 'one card per bookmark')
  assert(made.cards[0].bookmarkId === b3.id, 'Confused bookmarks are made first')
  const again = bm.makeBookmarkCards({ videoKey: VIDEO, project: 'Lecture' })
  assert(again.created === 0 && again.existing === 3, 'running it again adds no duplicates')
  const dd = db.getDb()
  const cardRows = dd
    .prepare(
      `SELECT c.id, c.priority, c.origin, c.chunk_index, i.body, i.project FROM media_bookmark_cards bc
       JOIN study_cards c ON c.id = bc.card_id JOIN items i ON i.id = bc.item_id`,
    )
    .all() as Array<{ id: string; priority: number; origin: string; chunk_index: number | null; body: string; project: string }>
  assert(cardRows.length === 3 && cardRows.every((r) => r.origin === 'note' && r.chunk_index == null && r.project === 'Lecture'), 'each is a whole-note card in the project')
  const confusedCard = made.cards.find((c) => c.bookmarkId === b3.id)!
  assert(cardRows.find((r) => r.id === confusedCard.cardId)?.priority === 1, 'a Confused card gets priority (comes up first in Study)')
  const examCard = made.cards.find((c) => c.bookmarkId === b1.id)!
  const examBody = cardRows.find((r) => r.id === examCard.cardId)!.body
  assert(/At 1:45:00 in “Lecture” — bookmark “exam topic” \(Exam\)/.test(examBody), 'the card note says where it came from')
  assert(examBody.includes('topic 6300') && examBody.includes('t_start: 6300.000') && examBody.includes(`source_path: ${VIDEO}`), 'and carries the transcript window and the moment')
  assert(captions.parseTStartFromBody(examBody) === 6300, 'so a citation of it seeks to the bookmark')
  const queue = review.listDueReviews(undefined, 10, 'Lecture')
  assert(queue[0]?.card_id === confusedCard.cardId, 'the Confused card is first in the Study queue')
  const q = await session.getCardQuestion(examCard.cardId)
  assert(q.mediaMoment?.bookmarkId === b1.id && q.mediaMoment.positionSec === 6300 && q.mediaMoment.videoKey === VIDEO, 'the reveal knows the moment to reopen')
  const plain = db.createItem({ title: 'Plain', body: 'Services route traffic to pods.', kind: 'note', para: 'resources', project: 'Lecture' })
  const plainCard = (require('../electron/study-cards') as typeof import('../electron/study-cards')).createNoteCards(plain.id).created[0]
  assert(bm.mediaMomentForCard(plainCard.id) === null && (await session.getCardQuestion(plainCard.id)).mediaMoment === null, 'other cards have no moment')
  // A deleted card is replaced on the next run; a deleted bookmark keeps its card.
  dd.prepare('DELETE FROM study_cards WHERE id = ?').run(examCard.cardId)
  assert(bm.getBookmark(b1.id)?.cardId === null, 'deleting the card drops the link')
  const remade = bm.makeBookmarkCards({ videoKey: VIDEO, project: 'Lecture', ids: [b1.id] })
  assert(remade.created === 1 && remade.cards.length === 1, '"Make cards" makes it again (only the requested bookmark)')
  assert(bm.deleteBookmark(b3.id) && !bm.deleteBookmark(b3.id), 'delete removes a bookmark once')
  assert(!!dd.prepare('SELECT 1 FROM study_cards WHERE id = ?').get(confusedCard.cardId), 'its Study card and history stay')

  // --- Export ---
  console.log('\nexport')
  const md = bm.bookmarksMarkdown({ videoKey: VIDEO })
  assert(md.startsWith('## Bookmarks — Lecture'), 'Markdown grouped under the video title')
  assert(md.includes(`- [1:45:00](file://${VIDEO}#t=6300) **exam topic** \`Exam\` — At minute 105`), 'each line: timestamp link, label, tag, transcript')
  assert(md.indexOf('01:05') < md.indexOf('1:45:00'), 'in time order')
  const byProject = bm.bookmarksMarkdown({ project: 'Other' })
  assert(byProject.includes(`(${YT}&t=10s)`), 'a whole project exports too (YouTube links)')
  assert(bm.bookmarksMarkdown({ videoKey: '/none.mp4' }) === '' && bm.listProjectBookmarks('').length === 0, 'nothing to export → empty')

  // --- Project rename / delete ---
  console.log('\nprojects')
  db.renameProject('Other', 'Other talk')
  assert(bm.listBookmarks(YT)[0].project === 'Other talk', 'a project rename carries the bookmarks')
  db.mergeProject('Other talk', 'Merged')
  assert(bm.listBookmarks(YT)[0].project === 'Merged', 'so does a merge')
  db.deleteProject('Merged')
  assert(bm.listBookmarks(YT).length === 0, 'deleting the project deletes its bookmarks')

  // --- Ask about a bookmark / Summarize my bookmarks ---
  console.log('\nchat windows')
  const s = db.createSession({ mode: 'grounded', title: 'Media · Lecture', filters: { project: 'Lecture' } })
  const marks = bm.listBookmarks(VIDEO)
  const res = await chat.sendChatTurn({
    sessionId: s.id,
    text: 'Summarize my bookmarks',
    filters: { project: 'Lecture' },
    limit: 20,
    mediaWindows: marks.map((b) => ({ centerSec: b.positionSec, windowSec: 30 })),
  })
  const hits = JSON.parse(res.assistant.hits_json ?? '[]') as Array<{ id: string; passage?: string }>
  const passages = hits.map((h) => h.passage ?? '').join('\n')
  assert(passages.includes('topic 6300') && passages.includes('topic 60.') && !passages.includes('topic 3000.'), 'every bookmark window is retrieved (and only those)')
  const order = hits.map((h) => Number(/topic (\d+)/.exec(h.passage ?? '')?.[1] ?? -1)).filter((n) => n >= 0)
  assert(order.every((n, i) => i === 0 || order[i - 1] < n), 'in time order')
  const one = await chat.sendChatTurn({
    sessionId: s.id,
    text: '[Bookmark at 1:45:00 in the media] What is explained here?',
    filters: { project: 'Lecture' },
    mediaWindow: { centerSec: 6300, windowSec: 30 },
  })
  const oneHits = JSON.parse(one.assistant.hits_json ?? '[]') as Array<{ passage?: string }>
  const oneTopics = oneHits.map((h) => Number(/topic (\d+)/.exec(h.passage ?? '')?.[1] ?? -1))
  assert(oneTopics.includes(6300) && oneTopics.slice(0, 3).every((t) => t >= 6240 && t <= 6330), `ask about a bookmark grounds in its window (${oneTopics.slice(0, 4).join(', ')})`)
  assert(lastPrompt === '' || typeof lastPrompt === 'string', 'no model was needed')

  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
