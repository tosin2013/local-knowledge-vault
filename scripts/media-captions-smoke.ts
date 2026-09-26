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
  formatTimestamp,
  parseCaptions,
  parseSrt,
  parseTStartFromBody,
} from '../electron/media-captions'
import { closeDb, initDb, listItems } from '../electron/db'
import {
  buildYtDlpSubtitleArgs,
  describeYtDlpFailure,
  pickCaptionTrack,
  ingestLocalMedia,
  ensureMediaReaderPrompt,
} from '../electron/media-ingest'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
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
assert(ytArgs.indexOf('--cookies-from-browser') < ytArgs.length - 1, 'extra args before URL')

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

closeDb()
fs.rmSync(tmp, { recursive: true, force: true })
console.log('media-captions-smoke: PASS')
