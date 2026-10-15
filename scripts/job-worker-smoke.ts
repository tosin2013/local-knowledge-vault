/**
 * #298 — the job worker: long pipelines (Markdown import, project enrollment)
 * run on a worker thread with their own DB connection while the main thread
 * stays responsive.
 *
 *   npm run test:job-worker
 *
 * Spawns the real worker entry over worker_threads against a seeded vault,
 * then:
 *   1. runs a 220-file Markdown import through the worker → result matches a
 *      direct import into a second vault (same counts), progress events
 *      arrive, and a 20 ms main-thread heartbeat keeps ticking throughout
 *      (the "UI stays alive" criterion),
 *   2. enrolls the imported notes → counts match the direct-call smoke's
 *      expectations and progress arrives,
 *   3. proves main-thread visibility: the main connection sees every imported
 *      note immediately (WAL).
 *
 * Runs under Electron-as-Node (worker_threads + better-sqlite3 ABI).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs')
const os = require('os') as typeof import('os')
const path = require('path') as typeof import('path')
const { Worker } = require('worker_threads') as typeof import('worker_threads')

const db = require('../electron/db') as typeof import('../electron/db')
const importMarkdown = require('../electron/import-markdown') as typeof import('../electron/import-markdown')
const studyCards = require('../electron/study-cards') as typeof import('../electron/study-cards')

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

const FILE_COUNT = 1200
const NOTE_COUNT = FILE_COUNT + 9 // + the seeded guide notes // + the seeded guide notes

function writeMarkdownVault(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < FILE_COUNT; i++) {
    const body = [
      '---',
      `title: Imported note ${i}`,
      'para: resources',
      `project: Bulk`,
      '---',
      '',
      `# Imported note ${i}`,
      '',
      'Body text for the worker import smoke. '.repeat(20),
    ].join('\n')
    fs.writeFileSync(path.join(dir, `note-${String(i).padStart(4, '0')}.md`), body)
  }
  // Error branches: a too-large file (cap 2 MB) and an unparsable one (#298).
  const huge = path.join(dir, 'huge.md')
  fs.writeFileSync(huge, 'x')
  fs.truncateSync(huge, 2 * 1024 * 1024 + 1)
  fs.writeFileSync(path.join(dir, 'empty.md'), '')
}

interface JobDone {
  jobId: number
  ok: boolean
  result?: unknown
  error?: string
}

/** Spawn the worker entry the way the client does (tsx-friendly execArgv). */
function spawnWorker(dbPath: string): Worker {
  const ext = __filename.endsWith('.ts') ? '.ts' : '.js'
  const entry = path.join(__dirname, '..', 'electron', 'workers', `job-worker${ext}`)
  return new Worker(entry, { workerData: { dbPath }, execArgv: process.execArgv })
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — job worker (#298) ===\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-298-'))
  const dbPath = path.join(dir, 'vault.sqlite')

  // Regression guard for #314: the electron build must emit the worker file
  // the app spawns (dist-electron/workers/job-worker.js). The smoke otherwise
  // runs the TS source through tsx, so a missing emit was invisible to CI.
  const builtWorker = path.join(__dirname, '..', 'dist-electron', 'workers', 'job-worker.js')
  assert(
    fs.existsSync(builtWorker),
    'the electron build emitted dist-electron/workers/job-worker.js (run `npm run build` if missing)'
  )

  // Main thread owns the first connection (#292 startup order).
  db.initDb(dbPath)

  const worker = spawnWorker(dbPath)
  const jobs = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: { done: number; total: number; label: string }) => void }>()
  let nextJobId = 1
  const runJob = <T,>(type: string, payload: Record<string, unknown>, onProgress?: (p: { done: number; total: number; label: string }) => void): Promise<T> => {
    const jobId = nextJobId++
    const entry = { resolve: undefined as unknown as (v: unknown) => void, reject: undefined as unknown as (e: Error) => void }
    jobs.set(jobId, entry)
    worker.postMessage({ jobId, type, payload })
    return new Promise<T>((resolve, reject) => {
      entry.resolve = resolve as (v: unknown) => void
      entry.reject = reject
      entry.onProgress = onProgress
    })
  }
  worker.on('message', (msg: { jobId: number; type?: string; ok?: boolean; result?: unknown; error?: string; progress?: { done: number; total: number; label: string } }) => {
    const entry = jobs.get(msg.jobId)
    if (!entry) return
    if (msg.type === 'progress' && msg.progress) {
      entry.onProgress?.(msg.progress)
      return
    }
    jobs.delete(msg.jobId)
    if (msg.ok) entry.resolve(msg.result)
    else entry.reject(new Error(msg.error ?? 'job failed'))
  })
  worker.on('error', (e) => {
    console.error('worker error:', e)
    process.exit(1)
  })

  // --- 1) Markdown import through the worker, heartbeat on main ---
  console.log('markdown import in the worker')
  const mdDir = path.join(dir, 'notes')
  writeMarkdownVault(mdDir)
  let heartbeats = 0
  let lastBeat = Date.now()
  let maxBeatGap = 0
  const heartbeat = setInterval(() => { heartbeats++; const now = Date.now(); maxBeatGap = Math.max(maxBeatGap, now - lastBeat); lastBeat = now }, 20)
  const importProgressEvents: Array<{ done: number; total: number; label: string }> = []
  const importResult = (await runJob<import('../electron/types').MarkdownImportResult>('import-markdown', { dir: mdDir }, (p) => importProgressEvents.push(p)))
  clearInterval(heartbeat)
  assert(importResult.imported === FILE_COUNT, `imported all ${FILE_COUNT} files (${importResult.imported})`)
  assert(importResult.errors.length === 1, 'the oversized file is reported as an error')
  assert(importResult.skipped === 2, 'the oversized and unparsable files are skipped')
  assert(importResult.itemIds.length === FILE_COUNT, 'one id per imported note')

  // Responsiveness is proven by the max heartbeat GAP (a frozen main thread
  // would gap by the whole job, seconds); the count only depends on how fast
  // the job finished.
  assert(heartbeats >= 2 && maxBeatGap < 500, `the main thread stayed responsive during the import (${heartbeats} beats, max gap ${maxBeatGap} ms)`)
  const importProgress = importProgressEvents
  assert(importProgress.length >= 1, 'progress events arrived during the import')
  assert(
    importProgress[importProgress.length - 1]?.done === FILE_COUNT + 2,
    'progress reaches the full file count (imported + skipped)'
  )

  console.log('main-thread visibility (WAL)')
  assert(db.countItems() >= NOTE_COUNT, `the main connection sees the imported notes immediately (${db.countItems()} counted)`)

  console.log('project payload threading (#276)')
  const mdDir3 = path.join(dir, 'notes-pinned')
  writeMarkdownVault(mdDir3)
  const pinned = (await runJob<import('../electron/types').MarkdownImportResult>('import-markdown', { dir: mdDir3, project: 'WorkerPinned' }))
  assert(pinned.imported === FILE_COUNT, `the pinned-project run imported all files (${pinned.imported})`)
  const pinnedItems = db.listItemsByProjectExact('WorkerPinned')
  assert(pinnedItems.length === FILE_COUNT, `every worker-imported note landed in the pinned project (${pinnedItems.length})`)

  console.log('enrollment in the worker')
  const enrollProgressEvents: Array<{ done: number; total: number; label: string }> = []
  const enrollResult = (await runJob<import('../electron/types').EnrollProjectResult>('enroll-project', { project: 'Bulk', pairs: true }, (p) => enrollProgressEvents.push(p)))
  assert(enrollResult.project === 'Bulk', 'enrollment ran for the seeded project')
  assert(enrollResult.notes === FILE_COUNT, `every imported note enrolled (${enrollResult.notes})`)
  assert(enrollResult.cards >= FILE_COUNT, `cards created (${enrollResult.cards})`)
  const enrollProgress = enrollProgressEvents
  assert(enrollProgress.length >= 1, 'enrollment reported progress')

  console.log('results match a direct import')
  const mdDir2 = path.join(dir, 'notes-direct')
  writeMarkdownVault(mdDir2)
  const direct = importMarkdown.importMarkdownFolder(mdDir2)
  assert(direct.imported === importResult.imported, 'worker and direct imports agree on counts')
  // enrolledItemIds samples at most 500 ids — check the tail of the import.
  const tail = importResult.itemIds.slice(-500)
  const enrolled = studyCards.enrolledItemIds(tail)
  assert(enrolled.length === tail.length, 'the last imported notes are all enrolled')

  db.closeDb()
  // Graceful shutdown: the worker exits itself so its V8 coverage flushes.
  worker.postMessage({ type: 'shutdown' })
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5000)
    worker.on('exit', () => { clearTimeout(timeout); resolve() })
  })
  fs.rmSync(dir, { recursive: true, force: true })

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
