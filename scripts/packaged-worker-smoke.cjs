/**
 * Packaged-build smoke (#318): run with the *packaged* Electron binary in Node mode, e.g.
 *   ELECTRON_RUN_AS_NODE=1 release/linux-unpacked/local-knowledge-vault scripts/packaged-worker-smoke.cjs release/linux-unpacked/resources
 * It starts dist-electron/workers/job-worker.js from inside app.asar (exactly as the
 * app does), imports one Markdown note into a throwaway database, and exits 0 only
 * if the worker answers. This catches a worker missing from the package (#314) and a
 * better-sqlite3 binary that the packaged runtime can't load.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Worker } = require('worker_threads')

const resources = path.resolve(process.argv[2] || 'release/linux-unpacked/resources')
const workerPath = path.join(resources, 'app.asar', 'dist-electron', 'workers', 'job-worker.js')
if (!fs.existsSync(workerPath)) {
  console.error(`FAIL: worker missing from package: ${workerPath}`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-packaged-smoke-'))
const notes = path.join(tmp, 'notes')
fs.mkdirSync(notes)
fs.writeFileSync(path.join(notes, 'mitochondria.md'), '# Mitochondria\n\nThe mitochondrion makes ATP.\n')

const worker = new Worker(workerPath, { workerData: { dbPath: path.join(tmp, 'vault.db') } })
const timer = setTimeout(() => {
  console.error('FAIL: job worker did not answer within 30 s')
  process.exit(1)
}, 30_000)
worker.on('error', (error) => {
  console.error('FAIL: job worker error:', error)
  process.exit(1)
})
worker.on('message', (msg) => {
  if (msg.type === 'progress') return
  clearTimeout(timer)
  if (!msg.ok) {
    console.error('FAIL: import job failed:', msg.error)
    process.exit(1)
  }
  console.log('OK: packaged job worker imported', JSON.stringify(msg.result))
  worker.postMessage({ type: 'shutdown' })
  worker.on('exit', () => process.exit(0))
})
worker.postMessage({ jobId: 1, type: 'import-markdown', payload: { dir: notes, project: 'Smoke' } })
