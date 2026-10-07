/**
 * Spaced-review scheduling (#216).
 *
 * A simple SM-2-style scheduler over the user's own notes. The pure helpers
 * (`anchorFirstIntervalDays`, `scheduleReview`) hold all the math so the smoke
 * test can exercise them without a database; the accessors below persist each
 * note's state in `review_schedule` (migration v3).
 *
 * FSRS is deliberately out of scope — this is a first, explainable pass.
 */
import { getDb } from './db'
import type { ReviewGrade, ReviewQueueItem, ReviewScheduleRow, ReviewState } from './types'

const MS_PER_DAY = 86_400_000
const EASE_MIN = 1.3
const EASE_MAX = 3.0
const INTERVAL_MAX = 730

/** The SM-2 starting interval, in days. */
const FIRST_INTERVAL = 1
const SECOND_INTERVAL = 3
const DEFAULT_EASE = 2.5

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function nowIso(): string {
  return new Date().toISOString()
}

function daysUntil(targetDate: string, now: Date): number {
  const target = new Date(targetDate)
  if (Number.isNaN(target.getTime())) return 0
  return (target.getTime() - now.getTime()) / MS_PER_DAY
}

/**
 * The first interval after a Good answer when the learner has a target exam
 * date. Cepeda-style shrinking fraction (Cepeda et al. 2008): a larger share of
 * a short horizon is spent in the first gap, a smaller share of a long one.
 *   ≤ 7 days  → 30%   (≈ 20–40% for a one-week horizon)
 *   ≤ 30 days → 15%
 *   > 30 days → 7%
 * Result is rounded and clamped to [1, 60] days.
 */
export function anchorFirstIntervalDays(daysUntilTarget: number): number {
  if (daysUntilTarget <= 0) return 1
  const fraction = daysUntilTarget <= 7 ? 0.3 : daysUntilTarget <= 30 ? 0.15 : 0.07
  return clamp(Math.round(daysUntilTarget * fraction), 1, 60)
}

/**
 * The next schedule state after grading an item.
 *
 * Ease is clamped to [1.3, 3.0] and the interval to [0, 730] days.
 *  - again: reset reps, count a lapse, ease −0.2, stay due now.
 *  - hard:  expand slowly (×1.2), ease −0.15.
 *  - good:  expand by ease (1 → 3 after the first two reps).
 *  - easy:  expand by ease × 1.3, ease +0.15.
 */
export function scheduleReview(
  prev: ReviewState,
  grade: ReviewGrade,
  opts: { targetDate?: string; now?: Date } = {},
): { state: ReviewState; dueAt: string } {
  const now = opts.now ?? new Date()
  const prevEase = clamp(prev.ease, EASE_MIN, EASE_MAX)
  const reps = prev.reps
  const intervalDays = prev.intervalDays
  const lapses = prev.lapses

  const target = opts.targetDate?.trim()
  const first = target ? anchorFirstIntervalDays(daysUntil(target, now)) : FIRST_INTERVAL

  let nextEase = prevEase
  let nextReps = reps
  let nextLapses = lapses
  let nextInterval = intervalDays

  switch (grade) {
    case 'again':
      nextReps = 0
      nextLapses = lapses + 1
      nextEase = prevEase - 0.2
      nextInterval = 0
      break
    case 'hard':
      nextReps = reps + 1
      nextEase = prevEase - 0.15
      nextInterval = reps === 0 ? FIRST_INTERVAL : Math.max(1, Math.round(intervalDays * 1.2))
      break
    case 'good':
      nextReps = reps + 1
      nextInterval = reps === 0 ? first : reps === 1 ? SECOND_INTERVAL : Math.round(intervalDays * prevEase)
      break
    case 'easy':
      nextReps = reps + 1
      nextEase = prevEase + 0.15
      nextInterval =
        reps === 0 ? Math.max(first, SECOND_INTERVAL) : Math.round(intervalDays * prevEase * 1.3)
      break
  }

  const state: ReviewState = {
    intervalDays: clamp(nextInterval, 0, INTERVAL_MAX),
    ease: clamp(nextEase, EASE_MIN, EASE_MAX),
    reps: nextReps,
    lapses: nextLapses,
  }
  const dueAt = new Date(now.getTime() + state.intervalDays * MS_PER_DAY).toISOString()
  return { state, dueAt }
}

/* ---- DB accessors ---- */

function rowToState(row: Record<string, unknown>): ReviewState {
  return {
    intervalDays: Number(row.interval_days ?? 0),
    ease: Number(row.ease ?? DEFAULT_EASE),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
  }
}

function rowToQueueItem(row: Record<string, unknown>): ReviewQueueItem {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    body: String(row.body ?? ''),
    para: row.para as ReviewQueueItem['para'],
    kind: String(row.kind),
    status: String(row.status),
    project: row.project == null ? null : String(row.project),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    due_at: String(row.due_at),
    interval_days: Number(row.interval_days ?? 0),
    ease: Number(row.ease ?? DEFAULT_EASE),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
    last_grade: (row.last_grade as ReviewGrade | null) ?? null,
    last_reviewed_at: row.last_reviewed_at == null ? null : String(row.last_reviewed_at),
  }
}

/** The state for one note, or null when it is not in review. */
export function getReviewState(itemId: string): ReviewState | null {
  const row = getDb()
    .prepare('SELECT * FROM review_schedule WHERE item_id = ?')
    .get(itemId) as Record<string, unknown> | undefined
  return row ? rowToState(row) : null
}

/** Every stored schedule row, for diagnostics and future dashboards. */
export function listReviewStates(): ReviewScheduleRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM review_schedule ORDER BY due_at ASC')
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    itemId: String(row.item_id),
    dueAt: String(row.due_at),
    ...rowToState(row),
    lastGrade: (row.last_grade as ReviewGrade | null) ?? null,
    lastReviewedAt: row.last_reviewed_at == null ? null : String(row.last_reviewed_at),
  }))
}

/**
 * Notes that are due at or before `before` (default: now), earliest first.
 * Trashed and archived notes are excluded so the queue only offers live items.
 */
export function listDueReviews(before?: string, limit = 50): ReviewQueueItem[] {
  const at = before ?? nowIso()
  const rows = getDb()
    .prepare(
      `SELECT items.*, rs.due_at, rs.interval_days, rs.ease, rs.reps, rs.lapses,
              rs.last_grade, rs.last_reviewed_at
       FROM review_schedule rs
       JOIN items ON items.id = rs.item_id
       WHERE items.status NOT IN ('trashed','archived') AND rs.due_at <= ?
       ORDER BY rs.due_at ASC
       LIMIT ?`,
    )
    .all(at, limit) as Record<string, unknown>[]
  return rows.map(rowToQueueItem)
}

/** How many live notes are due at or before `before` (default: now). */
export function countDueReviews(before?: string): number {
  const at = before ?? nowIso()
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM review_schedule rs
       JOIN items ON items.id = rs.item_id
       WHERE items.status NOT IN ('trashed','archived') AND rs.due_at <= ?`,
    )
    .get(at) as { c: number }
  return Number(row.c)
}

/**
 * Put a note into review. A new row is due immediately; an existing row is left
 * untouched (re-enqueuing never resurrects a note you already scheduled).
 */
export function enqueueReview(itemId: string, _opts: { targetDate?: string } = {}): ReviewState {
  const database = getDb()
  const existing = database
    .prepare('SELECT * FROM review_schedule WHERE item_id = ?')
    .get(itemId) as Record<string, unknown> | undefined
  if (existing) return rowToState(existing)

  const ts = nowIso()
  database
    .prepare(
      `INSERT INTO review_schedule
         (item_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
       VALUES (@item_id, @due_at, 0, @ease, 0, 0, NULL, NULL, @created_at, @updated_at)`,
    )
    .run({
      item_id: itemId,
      due_at: ts,
      ease: DEFAULT_EASE,
      created_at: ts,
      updated_at: ts,
    })
  return { intervalDays: 0, ease: DEFAULT_EASE, reps: 0, lapses: 0 }
}

/** Remove a note from review. Returns true when a row existed. */
export function removeReview(itemId: string): boolean {
  const result = getDb().prepare('DELETE FROM review_schedule WHERE item_id = ?').run(itemId)
  return result.changes > 0
}

/**
 * Record a grade for a note and persist the next schedule. Missing state is
 * treated as a fresh item (interval 0, ease 2.5).
 */
export function rateReview(
  itemId: string,
  grade: ReviewGrade,
  opts: { targetDate?: string } = {},
): ReviewState {
  const database = getDb()
  const prev = getReviewState(itemId) ?? {
    intervalDays: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
  }
  const { state, dueAt } = scheduleReview(prev, grade, { targetDate: opts.targetDate })
  const ts = nowIso()

  database
    .prepare(
      `INSERT INTO review_schedule
         (item_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
       VALUES (@item_id, @due_at, @interval_days, @ease, @reps, @lapses, @last_grade, @last_reviewed_at, @created_at, @updated_at)
       ON CONFLICT(item_id) DO UPDATE SET
         due_at = excluded.due_at,
         interval_days = excluded.interval_days,
         ease = excluded.ease,
         reps = excluded.reps,
         lapses = excluded.lapses,
         last_grade = excluded.last_grade,
         last_reviewed_at = excluded.last_reviewed_at,
         updated_at = excluded.updated_at`,
    )
    .run({
      item_id: itemId,
      due_at: dueAt,
      interval_days: state.intervalDays,
      ease: state.ease,
      reps: state.reps,
      lapses: state.lapses,
      last_grade: grade,
      last_reviewed_at: ts,
      created_at: ts,
      updated_at: ts,
    })
  return state
}
