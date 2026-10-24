/**
 * #296 — Study home, session start and the session summary on a large vault.
 *
 *   npm run test:study-queue-perf
 *
 * Builds a synthetic 5,000-note vault (~20k cards once every project is
 * enrolled with pairs), then for a freshly enrolled vault and for one with a
 * review history:
 *   1. proves the rewritten queue returns the same cards in the same order as
 *      the old one (kept verbatim in scripts/fixtures/study-queue),
 *   2. times review:stats, study:startSession (20), review:listDue (50),
 *      review:countDue and the session summary against the old queue, and
 *      asserts they are several times faster and inside a generous absolute
 *      budget (the issue's target is < 100 ms; CI runners vary, so the hard
 *      ceiling here is 250 ms and the speed-up is the stable check).
 *
 * Runs under Electron-as-Node (better-sqlite3 ABI). No model is called.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs')
const os = require('os') as typeof import('os')
const path = require('path') as typeof import('path')

const db = require('../electron/db') as typeof import('../electron/db')
const cards = require('../electron/study-cards') as typeof import('../electron/study-cards')
const review = require('../electron/review') as typeof import('../electron/review')
const session = require('../electron/study-session') as typeof import('../electron/study-session')
const { legacyDueQueue, asLegacyRow } = require('./fixtures/study-queue/legacy-due-queue') as typeof import('./fixtures/study-queue/legacy-due-queue')

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

function median(fn: () => unknown, reps = 5): number {
  const ts: number[] = []
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint()
    fn()
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  ts.sort((a, b) => a - b)
  return ts[Math.floor(ts.length / 2)]
}

const NOTES = 5000
const BUDGET_MS = 250
const MIN_SPEEDUP = 2
const WORDS = (
  'kubernetes operator pod service ingress route deployment namespace cluster node etcd certificate exam ' +
  'networking subnet port protocol dns firewall proxy cache index query vector search memory study review ' +
  'card question answer project archive resource policy security playbook inventory role template storage'
).split(' ')

let seed = 7
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const word = () => WORDS[Math.floor(rnd() * WORDS.length)]
function sentence(): string {
  const s = Array.from({ length: 8 + Math.floor(rnd() * 10) }, word).join(' ')
  return s[0].toUpperCase() + s.slice(1) + '.'
}
function body(chars: number): string {
  const parts: string[] = []
  let len = 0
  let h = 1
  while (len < chars) {
    const p = (rnd() < 0.2 ? `## Section ${h++}\n\n` : '') + Array.from({ length: 3 + Math.floor(rnd() * 4) }, sentence).join(' ')
    parts.push(p)
    len += p.length + 2
  }
  return parts.join('\n\n')
}
function glossary(n: number): string {
  return Array.from({ length: 6 }, (_, k) => `- Term${n}x${k}: ${sentence()}`).join('\n')
}

function sameQueue(label: string, limit: number, project?: string): void {
  const now = new Date()
  const want = legacyDueQueue(db.getDb(), now.toISOString(), project, now).slice(0, limit)
  const got = review.listDueReviews(undefined, limit, project).map(asLegacyRow)
  assert(JSON.stringify(got) === JSON.stringify(want), `${label}: same ${want.length} cards in the same order as the old queue`)
}

function timeAll(label: string): void {
  const d = db.getDb()
  const legacyAll = () => legacyDueQueue(d, new Date().toISOString(), undefined, new Date())
  const oldMs = median(legacyAll, 3)
  const t = {
    'review:stats': median(() => review.getStudyStats()),
    'study:startSession (20)': median(() => session.startStudySession({ limit: 20 })),
    'review:listDue (50)': median(() => review.listDueReviews(undefined, 50)),
    'review:countDue': median(() => review.countDueReviews()),
    'study summary': median(() => session.studySessionSummary('ses_none')),
  }
  console.log(`  ${label}: old queue alone ${oldMs.toFixed(1)} ms; ` + Object.entries(t).map(([k, v]) => `${k} ${v.toFixed(1)} ms`).join(', '))
  for (const [k, v] of Object.entries(t)) {
    assert(v < BUDGET_MS, `${label}: ${k} ${v.toFixed(1)} ms < ${BUDGET_MS} ms (target < 100 ms)`)
  }
  for (const k of ['review:stats', 'study:startSession (20)', 'review:listDue (50)'] as const) {
    // The old stats / start / list each ran (at least) the whole old queue.
    assert(oldMs / t[k] >= MIN_SPEEDUP, `${label}: ${k} is ≥ ${MIN_SPEEDUP}× faster than the old queue (${(oldMs / t[k]).toFixed(1)}×)`)
  }
}

function main(): void {
  console.log('\n=== Local Knowledge Vault — Study queue on a 5k-note vault (#296) ===\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-296-'))
  db.initDb(path.join(tmp, 'vault.sqlite'))
  const projects = ['CKA Prep', 'RHCE', 'Homelab', 'Reading', 'Work', null, 'Networking+', 'Security+']
  const t0 = Date.now()
  for (let made = 0; made < NOTES; ) {
    db.runInTransaction(() => {
      for (let i = 0; i < 250 && made < NOTES; i++, made++) {
        const r = rnd()
        db.createItem({
          title: `Synthetic ${made} ${word()}`,
          body: r < 0.1 ? glossary(made) : body(r < 0.3 ? 2500 + Math.floor(rnd() * 3000) : 300 + Math.floor(rnd() * 800)),
          kind: 'note',
          para: 'resources',
          project: projects[made % projects.length],
        })
      }
    })
  }
  for (const p of db.listProjects()) cards.enrollProject(p.name, { pairs: true })
  db.setProjectExamDate('CKA Prep', new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10))
  const total = (db.getDb().prepare('SELECT COUNT(*) AS c FROM study_cards').get() as { c: number }).c
  console.log(`  built ${NOTES} notes / ${total} cards in ${Date.now() - t0} ms`)
  assert(total > 10_000, `a large card set (${total} cards)`)

  console.log('\nfreshly enrolled (every card new)')
  sameQueue('fresh, all projects, 20', 20)
  sameQueue('fresh, all projects, unlimited', 100_000)
  sameQueue('fresh, CKA Prep, 50', 50, 'CKA Prep')
  timeAll('fresh')

  console.log('\nwith a review history (missed / partly / due / new)')
  const ids = (db.getDb().prepare('SELECT id FROM study_cards ORDER BY rowid').all() as { id: string }[]).map((r) => r.id)
  const grades = ['again', 'hard', 'good', 'again', 'easy'] as const
  db.runInTransaction(() => {
    for (let i = 0; i < ids.length; i += 13) review.rateReview(ids[i], grades[(i / 13) % grades.length], { targetDate: null })
  })
  db.getDb()
    .prepare(
      "UPDATE card_schedule SET due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || (rowid % 20) || ' days') WHERE last_grade IN ('good','hard','easy') AND rowid % 2 = 0",
    )
    .run()
  sameQueue('history, all projects, 20', 20)
  sameQueue('history, all projects, unlimited', 100_000)
  sameQueue('history, Homelab, 50', 50, 'Homelab')
  timeAll('history')

  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

try {
  main()
} catch (e) {
  console.error(e)
  process.exit(1)
}
