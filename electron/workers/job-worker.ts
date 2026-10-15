/**
 * The job worker (#298): a worker_threads worker that owns its own
 * better-sqlite3 connection and runs the long pipelines — Markdown import,
 * book/PDF import, project enrollment — so the Electron main thread never
 * blocks on them and the UI stays responsive.
 *
 * Protocol (with the main process, electron/job-worker-client.ts):
 *   → { jobId, type: 'import-markdown' | 'import-book' | 'enroll-project', payload }
 *   ← { jobId, type: 'progress', progress: { done, total, label } }
 *   ← { jobId, ok: true, result }
 *   ← { jobId, ok: false, error }
 *
 * The worker is spawned with `workerData.dbPath` (the main process has already
 * run initDb + migrations there), opens its own connection to the same
 * WAL-mode file, and answers one job at a time, in order.
 */
import { parentPort, workerData } from 'worker_threads'
import { initDb } from '../db'
import { importMarkdownFolder } from '../import-markdown'
import { importBookFromPath } from '../book-import'
import { enrollProject } from '../study-cards'
import type { JobProgressEvent } from '../types'

export interface JobProgress {
  done: number
  total: number
  label: string
}

interface JobMessage {
  jobId: number
  type: 'import-markdown' | 'import-book' | 'enroll-project'
  payload: Record<string, unknown>
}

function post(message: unknown): void {
  parentPort?.postMessage(message)
}

const emitProgress = (job: JobMessage['type'], jobId: number) =>
  (p: JobProgress) => post({ jobId, type: 'progress', progress: { job, ...p } satisfies JobProgressEvent })

if (!parentPort) {
  // Not actually running as a worker — nothing to do.
  process.exit(1)
}

initDb(String(workerData.dbPath))

parentPort.on('message', (msg: { jobId: number; type?: string; payload: Record<string, unknown> }) => {
  // Graceful shutdown lets this thread's V8 coverage flush (c8/#298) and
  // commits nothing — jobs are already complete.
  if (msg.type === 'shutdown') process.exit(0)
  const { jobId, type, payload } = msg
  const jobType = type as JobMessage['type']
  const progress = emitProgress(jobType, jobId)
  try {
    switch (jobType) {
      case 'import-markdown': {
        const result = importMarkdownFolder(String(payload.dir), progress)
        post({ jobId, ok: true, result })
        break
      }
      case 'import-book': {
        void importBookFromPath(String(payload.filePath), progress).then(
          (result) => post({ jobId, ok: true, result }),
          (error: unknown) => post({ jobId, ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
        break
      }
      case 'enroll-project': {
        const result = enrollProject(String(payload.project ?? ''), { pairs: payload.pairs !== false }, progress)
        post({ jobId, ok: true, result })
        break
      }
      default:
        post({ jobId, ok: false, error: `Unknown job type: ${String(type)}` })
    }
  } catch (error) {
    post({ jobId, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})
