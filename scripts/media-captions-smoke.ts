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
import { ingestLocalMedia, ensureMediaReaderPrompt } from '../electron/media-ingest'

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
