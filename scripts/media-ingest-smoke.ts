/**
 * Offline smoke tests for media ingest remaining paths (#80):
 * - ingestLocalMedia: no-cue error, replaceExisting:false append
 * - ingestYoutubeMedia: URL validation, captionsPath errors, yt-dlp-missing,
 *   full stubbed yt-dlp download path (LKV_YTDLP_PATH stub script), no-English,
 *   429 metadata, failed download error wording
 * - resolveYtDlp: env hit + deterministic miss
 * - runYtDlp: spawn-error + output-cap kill
 * - ensureMediaReaderPrompt: stale-body update branch
 * - findCompanionCaptions: unreadable-dir fallback
 * - youtubeEmbedUrl, listMediaProjects (local/youtube/unknown), notesNearPlayhead
 *
 * Runs under Electron-as-Node, temp DB, no network (yt-dlp is a local stub).
 *
 *   npm run test:media-ingest
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

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

const SRT = `1
00:00:00,000 --> 00:00:02,000
hello stub world

2
00:00:02,000 --> 00:00:04,000
second line here
`

/** Fake yt-dlp driven by LKV_STUB_MODE: ok | noenglish | meta429 | fail */
const STUB_SRC = `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
const mode = process.env.LKV_STUB_MODE || 'ok'
if (args.includes('-J')) {
  if (mode === 'meta429') {
    console.error('ERROR: Unable to download video subtitles: HTTP Error 429: Too Many Requests')
    process.exit(1)
  }
  if (mode === 'noenglish') {
    console.log('{}')
    process.exit(0)
  }
  console.log(JSON.stringify({ subtitles: { en: [{ ext: 'vtt', url: 'http://example.com/cap.vtt' }] } }))
  process.exit(0)
}
if (args.includes('--print')) {
  console.log('Stub Video Title')
  process.exit(0)
}
const pIdx = args.indexOf('--print-to-file')
if (pIdx >= 0) fs.writeFileSync(args[pIdx + 2], 'Stub Video Title\\n')
if (mode === 'fail') {
  console.error('boom')
  process.exit(1)
}
const oIdx = args.indexOf('-o')
if (oIdx >= 0) {
  const file = args[oIdx + 1].replace('%(title)s', 'Stub Video Title').replace('%(ext)s', 'en.vtt')
  fs.mkdirSync(require('path').dirname(file), { recursive: true })
  fs.writeFileSync(file, 'WEBVTT\\n\\n00:00:00.000 --> 00:00:02.000\\nhello stub world\\n\\n00:00:02.000 --> 00:00:04.000\\nsecond line here\\n')
}
process.exit(0)
`

const YT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Media ingest smoke ===\n')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-ingest-'))
  const dbFile = path.join(dir, 'test.sqlite')
  const { initDb, closeDb, createItem, listItemsByProjectExact } = require('../electron/db')
  initDb(dbFile)

  const {
    ingestLocalMedia,
    ingestYoutubeMedia,
    resolveYtDlp,
    runYtDlp,
    ensureMediaReaderPrompt,
    findCompanionCaptions,
    youtubeEmbedUrl,
    listMediaProjects,
    notesNearPlayhead,
  } = require('../electron/media-ingest')
  const { updatePrompt } = require('../electron/db')

  const mediaFile = path.join(dir, 'clip.mp4')
  const capsFile = path.join(dir, 'clip.srt')
  fs.writeFileSync(mediaFile, 'not-a-real-video')
  fs.writeFileSync(capsFile, SRT)

  // --- stub yt-dlp binary ---
  const stubJs = path.join(dir, 'yt-dlp-stub.js')
  fs.writeFileSync(stubJs, STUB_SRC)
  fs.chmodSync(stubJs, 0o755)
  const savedPath = process.env.PATH
  const savedYtdlp = process.env.LKV_YTDLP_PATH
  const savedExtra = process.env.LKV_YTDLP_EXTRA_ARGS
  const savedStubMode = process.env.LKV_STUB_MODE

  try {
    console.log('ingestLocalMedia errors')
    try {
      const badCaps = path.join(dir, 'bad.srt')
      fs.writeFileSync(badCaps, 'no cues in here at all\njust junk\n')
      ingestLocalMedia({ mediaPath: mediaFile, captionsPath: badCaps })
      assert(false, 'no-cue captions should throw')
    } catch (e) {
      assert((e as Error).message.includes('No caption cues'), 'no-cue captions throw')
    }
    try {
      ingestLocalMedia({ mediaPath: path.join(dir, 'missing.mp4'), captionsPath: capsFile })
      assert(false, 'missing media should throw')
    } catch (e) {
      assert((e as Error).message.includes('Media file not found'), 'missing media throws')
    }

    console.log('ingestLocalMedia replaceExisting:false')
    const r1 = ingestLocalMedia({ mediaPath: mediaFile, captionsPath: capsFile, project: 'AppendMe' })
    ingestLocalMedia({
      mediaPath: mediaFile,
      captionsPath: capsFile,
      project: 'AppendMe',
      replaceExisting: false,
    })
    const appended = listItemsByProjectExact('AppendMe', 'transcript').length
    assert(appended === r1.noteCount * 2, `append doubles notes (${r1.noteCount} -> ${appended})`)

    console.log('ensureMediaReaderPrompt stale update')
    const fresh = ensureMediaReaderPrompt()
    updatePrompt(fresh.id, { body: 'stale body' })
    const refreshed = ensureMediaReaderPrompt()
    assert(refreshed.body !== 'stale body', 'stale reader prompt body refreshed')

    console.log('findCompanionCaptions unreadable dir')
    const roDir = path.join(dir, 'ro')
    fs.mkdirSync(roDir)
    const roCaps = path.join(roDir, 'clip.srt')
    fs.writeFileSync(roCaps, 'x')
    fs.writeFileSync(path.join(roDir, 'clip.mp4'), 'x')
    let chmodded = false
    try {
      // execute-only (no read): stat works so existsSync is true, but
      // readdirSync throws -> exercises the catch fallback
      if (typeof process.geteuid === 'function' && process.geteuid() !== 0) {
        fs.chmodSync(roDir, 0o111)
        chmodded = true
      }
    } catch {
      /* ignore */
    }
    const roFound = findCompanionCaptions(path.join(roDir, 'clip.mp4'))
    if (chmodded) fs.chmodSync(roDir, 0o700)
    assert(roFound === roCaps, 'companion found even when dir listing fails')

    console.log('resolveYtDlp')
    process.env.LKV_YTDLP_PATH = stubJs
    assert(resolveYtDlp()?.cmd === stubJs, 'LKV_YTDLP_PATH hit')
    delete process.env.LKV_YTDLP_PATH
    // Isolate from any real install: broken PATH kills `which` + python probes,
    // empty HOME kills the ~/.local/bin + userData candidates.
    const savedHome = process.env.HOME
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-empty-home-'))
    process.env.HOME = emptyHome
    process.env.PATH = '/nonexistent-dir-xyz'
    assert(resolveYtDlp() === null, 'null when nothing installed')
    process.env.PATH = savedPath
    process.env.HOME = savedHome

    console.log('runYtDlp spawn error + output cap')
    const spawnErr = await runYtDlp('/nonexistent/lkv-cmd-xyz', [], { timeoutMs: 5000 })
    assert(spawnErr.error != null && spawnErr.status === null, 'spawn failure surfaces via error')
    const bigOut = await runYtDlp(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(50000))'],
      { timeoutMs: 10000, maxBuffer: 1024 }
    )
    assert(bigOut.stdout.length <= 1024, `output capped (${bigOut.stdout.length} bytes)`)

    console.log('ingestYoutubeMedia validation')
    try {
      await ingestYoutubeMedia({ url: '   ' })
      assert(false, 'empty url should throw')
    } catch (e) {
      assert((e as Error).message.includes('YouTube URL is required'), 'empty url throws')
    }
    try {
      await ingestYoutubeMedia({ url: 'https://evil-youtube.com/watch?v=dQw4w9WgXcQ' })
      assert(false, 'foreign host should throw')
    } catch (e) {
      assert((e as Error).message.includes('Invalid YouTube URL'), 'foreign host throws')
    }
    try {
      await ingestYoutubeMedia({ url: YT_URL, captionsPath: path.join(dir, 'missing.srt') })
      assert(false, 'missing captions should throw')
    } catch (e) {
      assert((e as Error).message.includes('Captions file not found'), 'missing captions throws')
    }
    try {
      const emptyCaps = path.join(dir, 'empty.srt')
      fs.writeFileSync(emptyCaps, 'nothing parseable\n')
      await ingestYoutubeMedia({ url: YT_URL, captionsPath: emptyCaps })
      assert(false, 'cueless captions should throw')
    } catch (e) {
      assert((e as Error).message.includes('no cues'), 'cueless captions throws')
    }

    console.log('ingestYoutubeMedia yt-dlp missing')
    delete process.env.LKV_YTDLP_PATH
    const savedHome2 = process.env.HOME
    const emptyHome2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-empty-home-'))
    process.env.HOME = emptyHome2
    process.env.PATH = '/nonexistent-dir-xyz'
    try {
      await ingestYoutubeMedia({ url: YT_URL })
      assert(false, 'missing yt-dlp should throw')
    } catch (e) {
      assert((e as Error).message.includes('yt-dlp not found'), 'missing yt-dlp throws')
    }
    process.env.PATH = savedPath
    process.env.HOME = savedHome2

    console.log('ingestYoutubeMedia stubbed full path')
    process.env.LKV_YTDLP_PATH = stubJs
    process.env.LKV_YTDLP_EXTRA_ARGS = '--cookies-from-browser firefox'
    process.env.LKV_STUB_MODE = 'ok'
    const yt = await ingestYoutubeMedia({ url: YT_URL, project: 'Stub Project' })
    assert(yt.project === 'Stub Project', 'stubbed ingest keeps project override')
    assert(yt.title === 'Stub Video Title', `stubbed title from probe/file (${yt.title})`)
    assert(yt.noteCount > 0, 'stubbed ingest created notes')
    assert(yt.sourceType === 'youtube' && yt.mediaUrl === YT_URL, 'youtube source meta')
    assert(yt.promptId && yt.profileId, 'prompt + profile created')

    console.log('ingestYoutubeMedia captionsPath + title probe')
    const ytOff = await ingestYoutubeMedia({ url: YT_URL, captionsPath: capsFile })
    assert(ytOff.title === 'Stub Video Title', 'offline branch uses probed title')

    console.log('ingestYoutubeMedia stubbed failures')
    process.env.LKV_STUB_MODE = 'noenglish'
    try {
      await ingestYoutubeMedia({ url: YT_URL, project: 'NoEng' })
      assert(false, 'no-english should throw')
    } catch (e) {
      assert((e as Error).message.includes('No English captions'), 'no-english throws')
    }
    process.env.LKV_STUB_MODE = 'meta429'
    try {
      await ingestYoutubeMedia({ url: YT_URL, project: 'R429' })
      assert(false, '429 should throw')
    } catch (e) {
      assert(/rate-limit/i.test((e as Error).message), '429 metadata throws rate-limit error')
    }
    process.env.LKV_STUB_MODE = 'fail'
    try {
      await ingestYoutubeMedia({ url: YT_URL, project: 'FailDL' })
      assert(false, 'failed download should throw')
    } catch (e) {
      assert((e as Error).message.includes('yt-dlp failed: boom'), 'failed download wording')
    }
    process.env.LKV_STUB_MODE = 'ok'

    console.log('youtubeEmbedUrl / projects / playhead')
    assert(
      youtubeEmbedUrl(YT_URL) === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1',
      'embed url'
    )
    assert(youtubeEmbedUrl('https://example.com/x') === null, 'embed rejects non-youtube')

    createItem({
      title: 'legacy transcript',
      body: 'no source markers here',
      para: 'resources',
      kind: 'transcript',
      status: 'active',
      project: 'Legacy',
    })
    const projects = listMediaProjects()
    const stubProj = projects.find((p: { project: string }) => p.project === 'Stub Project')
    assert(stubProj?.mediaUrl === YT_URL, 'youtube project lists mediaUrl')
    const appendProj = projects.find((p: { project: string }) => p.project === 'AppendMe')
    assert(appendProj?.sourceType === 'local' && appendProj?.mediaPath === mediaFile, 'local project lists mediaPath')
    const legacy = projects.find((p: { project: string }) => p.project === 'Legacy')
    assert(legacy?.sourceType === 'unknown', 'marker-less project is unknown')

    const near = notesNearPlayhead('AppendMe', 1, 45)
    assert(near.length > 0, 'notes near playhead found')
    assert(notesNearPlayhead('AppendMe', 99999, 1).length === 0, 'far playhead finds nothing')
  } finally {
    if (savedYtdlp === undefined) delete process.env.LKV_YTDLP_PATH
    else process.env.LKV_YTDLP_PATH = savedYtdlp
    if (savedExtra === undefined) delete process.env.LKV_YTDLP_EXTRA_ARGS
    else process.env.LKV_YTDLP_EXTRA_ARGS = savedExtra
    if (savedStubMode === undefined) delete process.env.LKV_STUB_MODE
    else process.env.LKV_STUB_MODE = savedStubMode
    process.env.PATH = savedPath
    closeDb()
    fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
