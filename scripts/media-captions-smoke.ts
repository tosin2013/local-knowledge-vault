/**
 * Unit smoke: SRT parse + chunk (+ optional temp-db ingest).
 *
 *   ELECTRON_RUN_AS_NODE=1 electron -r tsx/cjs scripts/media-captions-smoke.ts
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  chunkCues,
  dedupeRollingCues,
  formatTimestamp,
  parseCaptions,
  parseSrt,
  parseTStartFromBody,
} from '../electron/media-captions'
import { closeDb, createItem, getItem, initDb, listItems, listItemsByProjectExact, runInTransaction } from '../electron/db'
import {
  buildYtDlpSubtitleArgs,
  describeYtDlpFailure,
  ingestYoutubeMedia,
  normalizeYoutubeUrl,
  pickCaptionTrack,
  ingestLocalMedia,
  ensureMediaReaderPrompt,
  runYtDlp,
} from '../electron/media-ingest'
import {
  registerMediaFile,
  resolveMediaFile,
  mediaMimeType,
  mediaProtocolUrlForPath,
} from '../electron/media-protocol'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

// ---- #18: media protocol registry (opaque ids, extension allowlist, no traversal) ----
{
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-media-'))
  const goodMp4 = path.join(mediaDir, 'clip.mp4')
  const badTxt = path.join(mediaDir, 'notes.txt')
  const noExt = path.join(mediaDir, 'id_rsa')
  const keyFile = path.join(mediaDir, 'secret.key')
  const jsonFile = path.join(mediaDir, 'lkv-providers.json')
  fs.writeFileSync(goodMp4, 'mp4-bytes')
  fs.writeFileSync(badTxt, 'txt')
  fs.writeFileSync(noExt, 'ssh-key')
  fs.writeFileSync(keyFile, 'key')
  fs.writeFileSync(jsonFile, '{}')

  assert(registerMediaFile(goodMp4) != null, 'registers a .mp4 file')
  assert(registerMediaFile(badTxt) === null, 'rejects non-media extension (.txt)')
  assert(registerMediaFile(noExt) === null, 'rejects extension-less path (e.g. ~/.ssh/id_rsa)')
  assert(registerMediaFile(keyFile) === null, 'rejects .key files (provider keys)')
  assert(registerMediaFile(jsonFile) === null, 'rejects .json files (settings)')
  assert(registerMediaFile(mediaDir) === null, 'rejects a directory')
  assert(registerMediaFile(path.join(mediaDir, 'missing.mp4')) === null, 'rejects non-existent file')

  const id = registerMediaFile(goodMp4)!
  assert(resolveMediaFile(id) === goodMp4, 'resolves opaque id to registered path')
  assert(resolveMediaFile('deadbeef') === null, 'unknown id resolves to null')
  assert(mediaMimeType(goodMp4) === 'video/mp4', 'MIME type for .mp4')
  const url = mediaProtocolUrlForPath(goodMp4)!
  assert(/^lkvmedia:\/\/media\//.test(url), `opaque media URL (${url})`)
  assert(!url.includes('clip.mp4') && !url.includes(mediaDir), 'media URL never leaks the filesystem path')
  assert(mediaProtocolUrlForPath(badTxt) === null, 'non-media path yields no URL')

  fs.rmSync(mediaDir, { recursive: true, force: true })
}

const fixture = path.join(__dirname, '..', 'fixtures', 'sample.srt')
const raw = fs.readFileSync(fixture, 'utf8')
const cues = parseSrt(raw)
assert(cues.length >= 6, `expected ≥6 cues, got ${cues.length}`)
assert(cues[0].text.includes('Welcome'), 'first cue text')
assert(Math.abs(cues[0].startSec - 0) < 0.01, 'first start')
assert(cues[1].startSec > 2, 'second cue starts after 2s')

const auto = parseCaptions(raw, 'sample.srt')
assert(auto.length === cues.length, 'parseCaptions matches parseSrt')

const chunks = chunkCues(cues, { targetSec: 45, maxChars: 700 })
assert(chunks.length >= 1, 'at least one chunk')
assert(chunks.length < cues.length || cues.length <= 3, 'chunking should merge some cues')
for (const ch of chunks) {
  assert(ch.endSec >= ch.startSec, 'chunk time order')
  assert(ch.text.length > 0, 'chunk text')
  assert(formatTimestamp(ch.startSec).includes(':'), 'timestamp format')
}


const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.500
Alpha line

00:00:01.500 --> 00:00:03.000
Beta <i>line</i>
`
const vttCues = parseCaptions(vtt, 'x.vtt')
assert(vttCues.length === 2, 'vtt cues')
assert(vttCues[0].text === 'Alpha line', 'vtt strip tags / text')
assert(vttCues[1].text === 'Beta line', 'vtt italic stripped')

// ---- #29: YouTube auto-caption rolling cues are deduplicated ----
const rolling = `WEBVTT

00:00:00.000 --> 00:00:02.000
welcome to the show

00:00:02.000 --> 00:00:04.000
welcome to the show today we talk about

00:00:04.000 --> 00:00:04.010
welcome to the show today we talk about

00:00:04.010 --> 00:00:06.000
today we talk about inflation

00:00:06.000 --> 00:00:08.000
inflation and rates
`
const rollingCues = parseCaptions(rolling, 'auto.vtt')
assert(
  JSON.stringify(rollingCues.map((c) => c.text)) ===
    JSON.stringify([
      'welcome to the show',
      'today we talk about',
      'inflation',
      'inflation and rates',
    ]),
  `rolling cues deduplicated (got: ${JSON.stringify(rollingCues.map((c) => c.text))})`
)
const rollingText = rollingCues.map((c) => c.text).join(' ')
assert(!/welcome to the show welcome/.test(rollingText), 'no repeated line in the rolling transcript')
assert(!/today we talk about today/.test(rollingText), 'no repeated mid-line in the rolling transcript')
assert(dedupeRollingCues([]).length === 0, 'dedupe handles empty input')
const plainRepeat = dedupeRollingCues([
  { startSec: 0, endSec: 2, text: 'hello' },
  { startSec: 2, endSec: 4, text: 'hello' },
])
assert(plainRepeat.length === 1 && plainRepeat[0].text === 'hello', 'exact-repeat cue dropped')
const noOverlap = dedupeRollingCues([
  { startSec: 0, endSec: 2, text: 'alpha' },
  { startSec: 2, endSec: 4, text: 'beta' },
])
assert(noOverlap.length === 2, 'non-overlapping cues untouched')

const manyChunks = chunkCues(cues, { targetSec: 8, maxChars: 120 })
assert(manyChunks.length >= 2, `small window should yield multiple chunks, got ${manyChunks.length}`)

// yt-dlp subtitle invocation (#26): no forced android client (it returns no automatic
// captions and 429s on PO-token-gated caption URLs), title in the same run, retries,
// English regional variants, and user-supplied extra args placed before the URL.
const ytArgs = buildYtDlpSubtitleArgs('https://www.youtube.com/watch?v=abc', '/tmp/x', [
  '--cookies-from-browser',
  'firefox',
])
assert(!ytArgs.some((a) => a.includes('player_client')), 'no forced player_client')
assert(ytArgs.includes('--print-to-file'), 'title captured in the same run')
assert(ytArgs.includes('--retries') && ytArgs.includes('--retry-sleep'), 'retries with backoff')
const langs = ytArgs[ytArgs.indexOf('--sub-langs') + 1]
assert(/\ben\b/.test(langs) && langs.includes('en-US') && langs.includes('en-GB'), `sub-langs: ${langs}`)
assert(ytArgs[ytArgs.length - 1] === 'https://www.youtube.com/watch?v=abc', 'URL is last')
assert(ytArgs[ytArgs.length - 2] === '--', '-- separates options from the URL (no injection)')
assert(ytArgs.indexOf('--cookies-from-browser') < ytArgs.length - 1, 'extra args before URL')

// URL validation (#22): exact YouTube hosts only, video id must match ^[\w-]{11}$.
assert(
  normalizeYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ') ===
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'normalizes a watch URL'
)
assert(
  normalizeYoutubeUrl('https://youtu.be/dQw4w9WgXcQ') === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'normalizes a youtu.be share link'
)
assert(
  normalizeYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ') ===
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'normalizes a shorts link'
)
assert(normalizeYoutubeUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ') === null, 'rejects evil-youtube.com')
assert(normalizeYoutubeUrl('--exec=rm -rf /') === null, 'rejects an option-injection string')
assert(normalizeYoutubeUrl('https://www.youtube.com/watch?v=short') === null, 'rejects an invalid video id')
assert(normalizeYoutubeUrl('not a url') === null, 'rejects non-URL input')

const rateLimited = describeYtDlpFailure(
  "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests",
  1
)
assert(/rate.?limit/i.test(rateLimited) && rateLimited.includes('curl-cffi'), `429 message: ${rateLimited}`)
assert(describeYtDlpFailure('ERROR: boom', 1).startsWith('yt-dlp failed: ERROR: boom'), 'generic failure')
assert(/no captions/i.test(describeYtDlpFailure('', 0)), 'exit 0 without files means no captions')

// Caption track choice (#49): for auto-caption videos YouTube's 'en' is a machine translation
// (tlang=en) that gets rate-limited; the original transcript is 'en-orig'.
const ORIG = 'https://www.youtube.com/api/timedtext?v=x&kind=asr&lang=en&fmt=vtt'
const TRANSLATED = 'https://www.youtube.com/api/timedtext?v=x&kind=asr&lang=uk&tlang=en&fmt=vtt'
const autoOnly = {
  subtitles: {},
  automatic_captions: { en: [{ ext: 'vtt', url: TRANSLATED }], 'en-orig': [{ ext: 'vtt', url: ORIG }] },
}
assert(JSON.stringify(pickCaptionTrack(autoOnly)) === JSON.stringify({ lang: 'en-orig', auto: true }), 'auto: prefer en-orig over translated en')
const manual = { subtitles: { en: [{ ext: 'vtt', url: ORIG }] }, automatic_captions: autoOnly.automatic_captions }
assert(JSON.stringify(pickCaptionTrack(manual)) === JSON.stringify({ lang: 'en', auto: false }), 'manual English wins')
const regional = { subtitles: { 'en-GB': [{ ext: 'vtt', url: ORIG }] }, automatic_captions: {} }
assert(pickCaptionTrack(regional)?.lang === 'en-GB', 'manual regional English')
const autoOriginalEn = { subtitles: {}, automatic_captions: { en: [{ ext: 'vtt', url: ORIG }] } }
assert(JSON.stringify(pickCaptionTrack(autoOriginalEn)) === JSON.stringify({ lang: 'en', auto: true }), 'auto en without tlang is original')
const onlyTranslated = { subtitles: {}, automatic_captions: { en: [{ ext: 'vtt', url: TRANSLATED }] } }
assert(pickCaptionTrack(onlyTranslated)?.translated === true, 'translation only as flagged last resort')
assert(pickCaptionTrack({ subtitles: {}, automatic_captions: {} }) === null, 'no English captions → null')

const autoTrackArgs = buildYtDlpSubtitleArgs('https://www.youtube.com/watch?v=abc', '/tmp/x', [], { lang: 'en-orig', auto: true })
assert(autoTrackArgs[autoTrackArgs.indexOf('--sub-langs') + 1] === 'en-orig', 'download exactly the chosen track')
assert(autoTrackArgs.includes('--write-auto-subs') && !autoTrackArgs.includes('--write-subs'), 'auto track: auto subs only')
const manualTrackArgs = buildYtDlpSubtitleArgs('https://www.youtube.com/watch?v=abc', '/tmp/x', [], { lang: 'en', auto: false })
assert(manualTrackArgs.includes('--write-subs') && !manualTrackArgs.includes('--write-auto-subs'), 'manual track: manual subs only')

console.log('OK parse+chunk:', {
  cues: cues.length,
  chunks: chunks.length,
  firstTitleWindow: `${formatTimestamp(chunks[0].startSec)}–${formatTimestamp(chunks[0].endSec)}`,
})

// Optional: ingest into temp DB with a tiny silent-less media stub path
void (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-media-'))
  const dbPath = path.join(tmp, 'test.sqlite')
  const mediaStub = path.join(tmp, 'demo.mp4')
  const captionsCopy = path.join(tmp, 'demo.srt')
  fs.writeFileSync(mediaStub, 'not-a-real-video')
  fs.copyFileSync(fixture, captionsCopy)

  initDb(dbPath)
  ensureMediaReaderPrompt()
  const result = ingestLocalMedia({
    mediaPath: mediaStub,
    captionsPath: captionsCopy,
    project: 'Media Demo',
  })
  assert(result.noteCount === chunks.length || result.noteCount > 0, 'notes created')
  assert(result.promptId, 'prompt id')
  assert(result.profileId, 'profile id')
  const items = listItems({ project: 'Media Demo', kind: 'transcript' })
  assert(items.length === result.noteCount, 'list matches')
  const t0 = parseTStartFromBody(items[0].body)
  assert(t0 != null, 't_start in body')
  console.log('OK ingest:', {
    project: result.project,
    notes: result.noteCount,
    sampleTitle: items[0].title,
    t_start: t0,
    mediaProtocolUrl: result.mediaProtocolUrl,
  })

  // ---- #28: re-ingest collision isolation + atomic delete/create ----
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-collision-a-'))
  const mediaA = path.join(dirA, 'intro.mp4')
  const capsA = path.join(dirA, 'intro.srt')
  fs.writeFileSync(mediaA, 'video-a')
  fs.copyFileSync(fixture, capsA)
  const rA = ingestLocalMedia({ mediaPath: mediaA, captionsPath: capsA })
  assert(rA.project === 'intro', `first file gets project "intro" (got "${rA.project}")`)

  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-collision-b-'))
  const mediaB = path.join(dirB, 'intro.mp4')
  const capsB = path.join(dirB, 'intro.srt')
  fs.writeFileSync(mediaB, 'video-b')
  fs.copyFileSync(fixture, capsB)
  const rB = ingestLocalMedia({ mediaPath: mediaB, captionsPath: capsB })
  assert(
    rB.project === 'intro (2)',
    `second file with the same stem gets a suffixed project (got "${rB.project}")`
  )
  assert(
    listItemsByProjectExact('intro', 'transcript').length === rA.noteCount,
    "file A's notes survive file B's ingest"
  )

  // A hand-written "Media — " note in the same-named project must never be deleted.
  const handNote = createItem({
    title: 'Media — my ideas',
    body: 'personal notes',
    para: 'resources',
    kind: 'note',
    project: 'intro',
  })

  // Re-ingesting file A replaces only its own notes.
  const rA2 = ingestLocalMedia({ mediaPath: mediaA, captionsPath: capsA })
  assert(rA2.project === 'intro', 're-ingest of A keeps project "intro"')
  assert(
    listItemsByProjectExact('intro', 'transcript').length === rA.noteCount,
    "re-ingest replaces A's notes (same count)"
  )
  assert(
    listItemsByProjectExact('intro (2)', 'transcript').length === rB.noteCount,
    "B's notes untouched by A's re-ingest"
  )
  assert(getItem(handNote.id) !== null, 'hand-written "Media — …" note survives re-ingest')

  // The delete+create transaction rolls back on failure.
  const beforeTx = listItems({}).length
  let rolledBack = false
  try {
    runInTransaction(() => {
      createItem({ title: 'tx-temp', body: 'x', para: 'resources' })
      throw new Error('boom')
    })
  } catch {
    rolledBack = true
  }
  assert(rolledBack && listItems({}).length === beforeTx, 'transaction rolls back on failure')

  // ---- #25: yt-dlp must run async (no main-process freeze) and surface timeout/error clearly ----

  // Pure-function error wording first.
  assert(
    /timed out/.test(describeYtDlpFailure('', null, { timedOut: true })),
    'timeout produces a clear message'
  )
  assert(
    /Failed to run yt-dlp/.test(describeYtDlpFailure('', null, { error: new Error('ENOENT') })),
    'spawn error surfaces'
  )

  // runYtDlp: a fast-exiting stub resolves with stdout and status 0.
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-stub-'))
  const fastStub = path.join(stubDir, 'fast.js')
  fs.writeFileSync(fastStub, "console.log('hello-out'); process.exit(0)\n")
  const fast = await runYtDlp(process.execPath, [fastStub], { timeoutMs: 5000 })
  assert(fast.status === 0, `fast stub status 0, got ${fast.status}`)
  assert(fast.stdout.trim() === 'hello-out', `fast stub stdout: ${fast.stdout}`)
  assert(fast.timedOut === false, 'fast stub did not time out')

  // A non-zero exit is captured as status, not thrown.
  const failStub = path.join(stubDir, 'fail.js')
  fs.writeFileSync(failStub, "console.error('boom'); process.exit(3)\n")
  const fail = await runYtDlp(process.execPath, [failStub], { timeoutMs: 5000 })
  assert(fail.status === 3, `fail stub status 3, got ${fail.status}`)
  assert(fail.stderr.trim() === 'boom', `fail stub stderr: ${fail.stderr}`)

  // A stub that never exits is killed on timeout; the promise still resolves promptly.
  const slowStub = path.join(stubDir, 'slow.js')
  fs.writeFileSync(slowStub, 'setTimeout(() => {}, 60_000)\n')
  const slowStarted = Date.now()
  const slow = await runYtDlp(process.execPath, [slowStub], { timeoutMs: 300 })
  const elapsedMs = Date.now() - slowStarted
  assert(slow.timedOut === true, 'slow stub timed out')
  assert(slow.status === null, `slow stub killed → status null, got ${slow.status}`)
  assert(elapsedMs < 5000, `timeout resolved promptly (${elapsedMs}ms)`)

  fs.rmSync(stubDir, { recursive: true, force: true })

  // ingestYoutubeMedia is async and its offline branch (captionsPath) still works.
  const ytPromise = ingestYoutubeMedia({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    captionsPath: captionsCopy,
  })
  assert(ytPromise instanceof Promise, 'ingestYoutubeMedia returns a Promise (async)')
  const ytResult = await ytPromise
  assert(ytResult.noteCount > 0, 'youtube offline ingest created notes')
  console.log('OK async:', { timeoutResolvedMs: elapsedMs, ytNotes: ytResult.noteCount })

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('media-captions-smoke: PASS')
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
