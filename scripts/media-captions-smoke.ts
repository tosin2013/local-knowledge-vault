/**
 * Unit smoke: SRT parse + chunk (+ optional temp-db ingest).
 *
 *   ELECTRON_RUN_AS_NODE=1 electron -r tsx/cjs scripts/media-captions-smoke.ts
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Item } from '../electron/types'
import {
  chunkCues,
  decodeCaptions,
  dedupeRollingCues,
  formatTimestamp,
  parseCaptions,
  parseSrt,
  parseTStartFromBody,
} from '../electron/media-captions'
import { closeDb, createItem, getDb, getItem, initDb, listItems, listItemsByProjectExact, runInTransaction } from '../electron/db'
import {
  buildYtDlpSubtitleArgs,
  describeYtDlpFailure,
  ingestYoutubeMedia,
  itemToMediaHit,
  normalizeYoutubeUrl,
  pickCaptionTrack,
  ingestLocalMedia,
  ensureMediaReaderPrompt,
  notesNearPlayhead,
  runYtDlp,
} from '../electron/media-ingest'
import {
  registerMediaFile,
  resolveMediaFile,
  mediaMimeType,
  mediaProtocolUrlForPath,
  handleMediaRequest,
  parseByteRange,
} from '../electron/media-protocol'
import { findCompanionCaptions } from '../electron/media-ingest'

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

// ---- #326: lkvmedia range requests (206 + Content-Range so <video> can seek) ----
// net.fetch(file://…) answered ranged requests with 200 and no Content-Range, so
// `video.seekable` stayed [[0,0]] and every seek snapped back to 0:00.
void (async () => {
  const rangeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-range-'))
  const big = path.join(rangeDir, 'lecture.mp4')
  // 2 MiB stand-in for a long recording: byte i is i % 251, so a seek far into
  // the file is verified byte-exactly (the HTTP shape matters, not the runtime).
  const size = 2 * 1024 * 1024
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buf[i] = i % 251
  fs.writeFileSync(big, buf)
  const id = registerMediaFile(big)!
  const rangeUrl = `lkvmedia://media/${id}`
  const req = (range: string | null) =>
    handleMediaRequest({
      url: rangeUrl,
      headers: { get: (n: string) => (n.toLowerCase() === 'range' ? range : null) },
    })

  // Non-ranged: the whole file, still advertising range support.
  const full = await req(null)
  assert(full.status === 200, `no Range header → 200 (got ${full.status})`)
  assert(full.headers.get('accept-ranges') === 'bytes', '200 advertises Accept-Ranges: bytes')
  assert(full.headers.get('content-length') === String(size), '200 carries the full Content-Length')
  assert(full.headers.get('content-type') === 'video/mp4', '200 carries the media MIME type')
  assert(Buffer.from(await full.arrayBuffer()).equals(buf), '200 body is the whole file')

  // Ranged: the citation-seek shape — a request for bytes far into a long file.
  const seek = await req('bytes=1900000-1900999')
  assert(seek.status === 206, `Range → 206 (got ${seek.status})`)
  assert(
    seek.headers.get('content-range') === `bytes 1900000-1900999/${size}`,
    `206 carries Content-Range (got ${seek.headers.get('content-range')})`
  )
  assert(seek.headers.get('content-length') === '1000', '206 carries the slice Content-Length')
  assert(
    Buffer.from(await seek.arrayBuffer()).equals(buf.subarray(1900000, 1901000)),
    '206 body is exactly the requested slice'
  )

  // Open-ended and suffix ranges.
  const openEnded = await req(`bytes=${size - 100}-`)
  assert(
    openEnded.status === 206 &&
      openEnded.headers.get('content-range') === `bytes ${size - 100}-${size - 1}/${size}`,
    'open-ended range is clamped to the file'
  )
  const suffix = await req('bytes=-100')
  assert(
    suffix.status === 206 &&
      suffix.headers.get('content-range') === `bytes ${size - 100}-${size - 1}/${size}`,
    `suffix range returns the file tail (got ${suffix.headers.get('content-range')})`
  )
  assert(Buffer.from(await suffix.arrayBuffer()).equals(buf.subarray(size - 100)), 'suffix body is the tail')

  // Unsatisfiable → 416 in the RFC shape; unparseable unit → ignored, full 200.
  const tooFar = await req('bytes=999999999-')
  assert(tooFar.status === 416, `range beyond EOF → 416 (got ${tooFar.status})`)
  assert(tooFar.headers.get('content-range') === `bytes */${size}`, '416 carries "bytes */size"')
  assert((await req('bytes=zz-zz')).status === 200, 'malformed Range is ignored → 200')

  // parseByteRange corner cases.
  assert(parseByteRange(null, 10) === null, 'absent header → null')
  assert(parseByteRange('chunks=0-5', 10) === null, 'unknown unit is ignored → null')
  assert(parseByteRange('bytes=-0', 10) === 'unsatisfiable', 'bytes=-0 is unsatisfiable')
  assert(parseByteRange('bytes=0-', 0) === 'unsatisfiable', 'any range on an empty file is unsatisfiable')
  assert(
    JSON.stringify(parseByteRange('bytes=5-10,20-25', 100)) === JSON.stringify({ start: 5, end: 10 }),
    'multi-range: the first range is served'
  )

  // The #18 guardrails still hold through the handler.
  assert(
    (await handleMediaRequest({ url: 'lkvmedia://media/deadbeef', headers: { get: () => null } })).status === 404,
    'unknown id → 404'
  )
  assert(
    (await handleMediaRequest({ url: 'lkvmedia://media/', headers: { get: () => null } })).status === 400,
    'missing id → 400'
  )

  // A file deleted after registration 404s instead of crashing.
  fs.rmSync(big, { force: true })
  const gone = await req(null)
  assert(gone.status === 404, `deleted file → 404 (got ${gone.status})`)

  fs.rmSync(rangeDir, { recursive: true, force: true })
  console.log('OK lkvmedia range: 206 + Content-Range served, seek offsets verified')
})().catch((err) => {
  console.error(err)
  process.exit(1)
})

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

// ---- #30: caption parsing edge cases ----
const utf16Body = '\uFEFF1\n00:00:00,000 --> 00:00:02,000\nHello world\n'
const utf16le = Buffer.from(utf16Body, 'utf16le')
utf16le[0] = 0xff
utf16le[1] = 0xfe
const decodedUtf16 = decodeCaptions(utf16le)
const cues16 = parseCaptions(decodedUtf16, 'x.srt')
assert(cues16.length === 1 && cues16[0].text === 'Hello world', 'UTF-16 SRT decodes and parses')
const utf16NoBom = Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nHi\n', 'utf16le')
assert(decodeCaptions(utf16NoBom).includes('00:00:02,000'), 'UTF-16 without BOM detected via NUL bytes')

const blankLineCue = `1
00:00:00,000 --> 00:00:03,000
first line

second line
`
const blankCues = parseCaptions(blankLineCue, 'x.srt')
assert(blankCues.length === 1, 'blank line inside cue does not split it')
assert(
  blankCues[0].text === 'first line second line',
  `blank-line cue text joined (got: ${JSON.stringify(blankCues[0].text)})`
)

const badTs = `1
00:00:00,000 --> 99:99:99,999
valid text

2
xx:yy --> 00:00:05,000
junk
`
const badTsCues = parseCaptions(badTs, 'x.srt')
assert(
  badTsCues.length === 1 && badTsCues[0].text === 'valid text',
  'cues with invalid timestamps are skipped, not collapsed to 0'
)

const unordered = [
  { startSec: 10, endSec: 12, text: 'second' },
  { startSec: 0, endSec: 2, text: 'first' },
]
const orderedChunks = chunkCues(unordered, { targetSec: 60, maxChars: 1000 })
assert(orderedChunks.length === 1, 'unsorted cues merge into one chunk')
assert(
  orderedChunks[0].startSec === 0 && orderedChunks[0].endSec === 12,
  'chunk spans the sorted range (no end<start)'
)
assert(/first.*second/s.test(orderedChunks[0].text), 'chunk text follows time order')

{
  const compDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-companion-'))
  fs.writeFileSync(path.join(compDir, 'clip.mp4'), 'x')
  for (const name of ['clip.en-US.vtt', 'clip2.eng.srt', 'clip3.SRT']) {
    fs.writeFileSync(path.join(compDir, name), 'x')
  }
  assert(
    findCompanionCaptions(path.join(compDir, 'clip.mp4')) === path.join(compDir, 'clip.en-US.vtt'),
    'regional .en-US.vtt found for the same stem'
  )
  assert(
    findCompanionCaptions(path.join(compDir, 'clip2.mp4')) ===
      path.join(compDir, 'clip2.eng.srt'),
    'companion .eng.srt found'
  )
  assert(
    findCompanionCaptions(path.join(compDir, 'clip3.mp4')) === path.join(compDir, 'clip3.SRT'),
    'upper-case .SRT found'
  )
  assert(
    findCompanionCaptions(path.join(compDir, 'other.mp4')) === null,
    'no companion for an unrelated stem'
  )
  fs.rmSync(compDir, { recursive: true, force: true })
}

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
  assert(/^Media Demo · \d{1,2}:\d{2}/.test(items[0].title), `transcript title carries the source title (got "${items[0].title}")`)
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

  // ---- #331: notesNearPlayhead returns chunks in t_start order, not updated_at ----
  {
    const proj = 'Order test'
    const chunk = (start: number, end: number, text: string) =>
      createItem({
        title: `T ${start}`,
        body: `${text}\n\nt_start: ${start.toFixed(3)}\nt_end: ${end.toFixed(3)}\nkind_tag: transcript`,
        para: 'resources',
        kind: 'transcript',
        project: proj,
      })
    const late = chunk(6340, 6355, 'late chunk')
    const early = chunk(6260, 6275, 'early chunk')
    const middle = chunk(6300, 6320, 'middle chunk')
    // Force updated_at DESC ≠ t_start order (a re-ingest or edit reshuffles it).
    const db = getDb()
    const setUpdated = (id: string, ts: string) => db.prepare('UPDATE items SET updated_at = ? WHERE id = ?').run(ts, id)
    setUpdated(late.id, '2030-01-01T00:00:00.000Z') // newest updated_at, latest t_start
    setUpdated(early.id, '2030-01-03T00:00:00.000Z') // oldest updated_at, earliest t_start
    setUpdated(middle.id, '2030-01-02T00:00:00.000Z')
    const near = notesNearPlayhead(proj, 6300, 45)
    assert(near.length === 3, `all three chunks are near 6300 (got ${near.length})`)
    const starts = near.map((n) => parseTStartFromBody(n.body))
    assert(
      JSON.stringify(starts) === JSON.stringify([6260, 6300, 6340]),
      `near-playhead chunks are in ascending t_start order (got ${JSON.stringify(starts)})`
    )
    // A transcript note without t_start/t_end metadata is skipped, not included.
    const noMeta = createItem({
      title: 'Broken chunk',
      body: 'chunk text without timing metadata',
      para: 'resources',
      kind: 'transcript',
      project: proj,
    })
    setUpdated(noMeta.id, '2030-01-04T00:00:00.000Z')
    const stillNear = notesNearPlayhead(proj, 6300, 45)
    assert(stillNear.length === 3, `metadata-less transcript is skipped (got ${stillNear.length})`)
  }

  // ---- #161: itemToMediaHit strips metadata and ranks the window above BM25 ----
  {
    const hitItem = {
      id: 'itm_window',
      title: 'T 84',
      para: 'resources',
      kind: 'transcript',
      project: 'P',
      body: 'real words here\n\nt_start: 84.500\nt_end: 128.000\nkind_tag: transcript',
      summary: null,
      status: 'active',
      created_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:00:00.000Z',
    } as Item
    const h = itemToMediaHit(hitItem)
    assert(h.score === 1000, 'near-window hit ranks above keyword scores')
    assert(h.passage === 'real words here', 'passage is the chunk text with metadata stripped')
    assert(!/t_start|kind_tag|source_/.test(h.snippet), 'snippet has no machine metadata lines')
    assert(h.project === 'P' && h.kind === 'transcript', 'hit keeps its item identity')
  }

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
