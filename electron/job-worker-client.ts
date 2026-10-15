/**
 * Main-side client for the job worker (#298). Spawns the worker lazily on the
 * first long job, forwards `ipcMain.handle` calls to it over worker
 * messaging, and surfaces progress so main can push it to the renderer.
 * The Electron main thread keeps windows, menus, dialogs, IPC routing and the
 * short DB reads/writes — long pipelines never run there again.
 */
import { Worker } from 'worker_threads'
import path from 'path'
import type { JobProgressEvent } from './types'

export type { JobProgressEvent }
export type JobType = JobProgressEvent['job']

type Pending = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: JobProgressEvent) => void
}

let worker: Worker | null = null
let workerDbPath = ''
let nextJobId = 1
const pending = new Map<number, Pending>()
/** Progress subscribers (main forwards these to the renderer). */
const progressListeners = new Set<(event: JobProgressEvent) => void>()

/** The db path must be set before the first job: main calls this right after
 * initDb so the worker opens the same WAL-mode file. */
export function setJobWorkerDbPath(dbPath: string): void {
  workerDbPath = dbPath
}

/** Subscribe to worker job progress (main forwards these to the renderer). */
export function onJobProgress(cb: (event: JobProgressEvent) => void): () => void {
  progressListeners.add(cb)
  return () => progressListeners.delete(cb)
}

function ensureWorker(): Worker {
  if (worker) return worker
  if (!workerDbPath) throw new Error('Job worker started before setJobWorkerDbPath()')
  // Built app: dist-electron/workers/job-worker.js. Smokes run the TS source
  // through tsx, where __filename still points at this .ts file (#298).
  const ext = __filename.endsWith('.ts') ? '.ts' : '.js'
  worker = new Worker(path.join(__dirname, 'workers', `job-worker${ext}`), {
    workerData: { dbPath: workerDbPath },
    execArgv: process.execArgv,
  })
  worker.on('message', (msg: { jobId?: number; type?: string; ok?: boolean } & Record<string, unknown>) => {
    const jobId = msg.jobId
    if (jobId === undefined || !pending.has(jobId)) return
    const entry = pending.get(jobId)!
    if (msg.type === 'progress') {
      const progress = msg.progress as Omit<JobProgressEvent, 'job'>
      const event: JobProgressEvent = { ...progress, job: (msg.job as JobType) ?? 'import-markdown' }
      // A throwing listener must not break the worker loop or the process —
      // progress is advisory (#298).
      try {
        entry.onProgress?.(event)
        for (const cb of progressListeners) cb(event)
      } catch {
        /* ignore listener errors */
      }
      return
    }
    pending.delete(jobId)
    if (msg.ok) entry.resolve(msg.result)
    else entry.reject(new Error(String(msg.error ?? 'Job failed')))
  })
  worker.on('error', (error) => {
    for (const entry of pending.values()) entry.reject(error instanceof Error ? error : new Error(String(error)))
    pending.clear()
    worker = null
  })
  worker.on('exit', () => {
    for (const entry of pending.values()) entry.reject(new Error('Job worker exited'))
    pending.clear()
    worker = null
  })
  return worker
}

/** Run one long job in the worker. Resolves with the job's result object. */
export function runJob<T>(
  type: JobType,
  payload: Record<string, unknown>,
  onProgress?: (progress: JobProgressEvent) => void,
): Promise<T> {
  const w = ensureWorker()
  const jobId = nextJobId++
  return new Promise<T>((resolve, reject) => {
    pending.set(jobId, { resolve: resolve as (result: unknown) => void, reject, onProgress })
    w.postMessage({ jobId, type, payload })
  })
}
