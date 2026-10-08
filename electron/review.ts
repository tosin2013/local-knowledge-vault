/**
 * Spaced-review scheduling (#216).
 *
 * A simple SM-2-style scheduler over study cards (#259 card model). The pure
 * helpers (`anchorFirstIntervalDays`, `scheduleReview`) hold all the math so
 * the smoke test can exercise them without a database; the accessors below
 * persist each card's state in `card_schedule` and every grade in
 * `review_log` (migration v7, which replaced the note-keyed `review_schedule`).
 *
 * FSRS is deliberately out of scope — this is a first, explainable pass.
 */
import { getDb, newId } from './db'
import { createNoteCards } from './study-cards'
import type {
  ReviewEnqueueResult,
  ReviewGrade,
  ReviewQueueItem,
  ReviewScheduleRow,
  ReviewState,
  StudyCardOrigin,
  StudySelfGrade,
  StudySessionSummary,
  StudyStats,
} from './types'

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

/* ---- Exam-aware spacing (#264) ---- */

/** Most new cards introduced per day, with or without an exam. */
export const NEW_CARDS_PER_DAY_MAX = 25

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

/** Local midnight of a calendar day. */
function localDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Whole calendar days from `now` to the exam day, in local time: 1 = the exam
 * is tomorrow, 0 = today, negative = passed. null when there is no date.
 */
export function calendarDaysUntil(examDate: string | null | undefined, now: Date = new Date()): number | null {
  const v = (examDate ?? '').trim()
  if (!v) return null
  const m = ISO_DAY.exec(v)
  const exam = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v)
  if (Number.isNaN(exam.getTime())) return null
  return Math.round((localDay(exam) - localDay(now)) / MS_PER_DAY)
}

/**
 * Cap an interval so the next review never lands after the exam (#264).
 * Exact rule, with `daysLeft` = calendar days to the exam and
 * `remaining = daysLeft − 1` (the last useful review day is the day before):
 *
 *  - no exam date, the exam is today or tomorrow, it has passed, or the card
 *    is due again now (interval 0) → unchanged (plain SM-2);
 *  - `remaining ≤ 3` → at most `remaining`, so the last review lands on the
 *    day before the exam (1–3 days before it);
 *  - otherwise, an interval over half the remaining time is cut to
 *    `floor(remaining / 2)`, so at least one more review still fits before
 *    the final one.
 *
 * The cap is an inference from the purpose of exam prep, not a published
 * parameter (see #264).
 */
export function capIntervalForExam(
  intervalDays: number,
  daysLeft: number | null,
): { intervalDays: number; capped: boolean } {
  if (daysLeft == null || daysLeft <= 1 || intervalDays <= 0) return { intervalDays, capped: false }
  const remaining = daysLeft - 1
  if (remaining <= 3) {
    return intervalDays > remaining ? { intervalDays: remaining, capped: true } : { intervalDays, capped: false }
  }
  if (intervalDays <= remaining / 2) return { intervalDays, capped: false }
  return { intervalDays: Math.max(1, Math.floor(remaining / 2)), capped: true }
}

/**
 * New cards to introduce per day (#264): the cards not yet seen, spread over
 * the days left minus two (the last two days are for review only), at most
 * {@link NEW_CARDS_PER_DAY_MAX}. With no exam date, the maximum applies.
 *
 *   60 cards, exam in 14 days → ceil(60 / 12) = 5 a day
 *   150 cards, exam in 30 days → ceil(150 / 28) = 6 a day
 */
export function newCardBudget(remainingNew: number, daysLeft: number | null): number {
  if (remainingNew <= 0) return 0
  if (daysLeft == null) return Math.min(NEW_CARDS_PER_DAY_MAX, remainingNew)
  const days = Math.max(1, daysLeft - 2)
  return Math.min(NEW_CARDS_PER_DAY_MAX, remainingNew, Math.ceil(remainingNew / days))
}

/**
 * How many new cards the daily maximum can't reach before the exam (#264), so
 * the UI can say so instead of silently cramming. 0 with no exam, or once it
 * has passed.
 */
export function unreachableNewCards(remainingNew: number, daysLeft: number | null): number {
  if (daysLeft == null || daysLeft < 0 || remainingNew <= 0) return 0
  const capacity = NEW_CARDS_PER_DAY_MAX * Math.max(1, daysLeft - 2)
  return Math.max(0, remainingNew - capacity)
}

/** A due card as the queue builder sees it. */
export interface QueueCandidate {
  project: string | null
  dueAt: string
  lastGrade: string | null
  /** Never reviewed (a new card). */
  isNew: boolean
}

const GRADE_RANK: Record<string, number> = { again: 0, hard: 1 }

/**
 * Order a session queue (#264): missed (Again) cards first, then Partly
 * (Hard), then other due cards by due date, then new cards — in the order
 * given (priority, then reading order) and only up to each project's
 * allowance for today. Pure.
 */
export function buildReviewQueue<T extends QueueCandidate>(
  cards: T[],
  allowanceFor: (project: string | null) => number,
): T[] {
  const reviewed = cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.isNew)
    .sort((a, b) => {
      const ra = GRADE_RANK[a.c.lastGrade ?? ''] ?? 2
      const rb = GRADE_RANK[b.c.lastGrade ?? ''] ?? 2
      if (ra !== rb) return ra - rb
      if (a.c.dueAt !== b.c.dueAt) return a.c.dueAt < b.c.dueAt ? -1 : 1
      return a.i - b.i
    })
    .map(({ c }) => c)
  const left = new Map<string, number>()
  const fresh: T[] = []
  for (const c of cards) {
    if (!c.isNew) continue
    const key = c.project ?? ''
    if (!left.has(key)) left.set(key, Math.max(0, allowanceFor(c.project)))
    const n = left.get(key) ?? 0
    if (n <= 0) continue
    left.set(key, n - 1)
    fresh.push(c)
  }
  return [...reviewed, ...fresh]
}

/** The three-level Study scale (#264) on the SM-2 grades. */
export const SELF_GRADE_TO_REVIEW: Readonly<Record<StudySelfGrade, ReviewGrade>> = Object.freeze({
  missed: 'again',
  partial: 'hard',
  got: 'good',
})

/**
 * Normalise a grade from either scale to an SM-2 grade. Old `easy` grades are
 * kept as they are (they read as "Got it" in the UI). Throws on anything else.
 */
export function toReviewGrade(grade: string): ReviewGrade {
  if (grade === 'again' || grade === 'hard' || grade === 'good' || grade === 'easy') return grade
  if (grade in SELF_GRADE_TO_REVIEW) return SELF_GRADE_TO_REVIEW[grade as StudySelfGrade]
  throw new Error(`Unknown grade: ${grade}`)
}

/** How a stored SM-2 grade reads on the three-level scale; `easy` is "Got it". */
export function reviewGradeToSelfGrade(grade: string | null | undefined): StudySelfGrade | null {
  if (grade === 'again') return 'missed'
  if (grade === 'hard') return 'partial'
  if (grade === 'good' || grade === 'easy') return 'got'
  return null
}

/**
 * The next schedule state after grading an item.
 *
 * Ease is clamped to [1.3, 3.0] and the interval to [0, 730] days.
 *  - again: reset reps, count a lapse, ease −0.2, stay due now.
 *  - hard:  expand slowly (×1.2), ease −0.15.
 *  - good:  expand by ease (1 → 3 after the first two reps).
 *  - easy:  expand by ease × 1.3, ease +0.15 (legacy: the UI's three-level
 *           scale sends again / hard / good; old `easy` grades still apply).
 *
 * With a target exam date the first Good is anchored (Cepeda) and every
 * interval is capped by {@link capIntervalForExam}.
 */
export function scheduleReview(
  prev: ReviewState,
  grade: ReviewGrade,
  opts: { targetDate?: string; now?: Date } = {},
): { state: ReviewState; dueAt: string; capped: boolean } {
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

  // Exam cap (#264): never schedule past the exam date.
  const cap = capIntervalForExam(clamp(nextInterval, 0, INTERVAL_MAX), target ? calendarDaysUntil(target, now) : null)
  const state: ReviewState = {
    intervalDays: cap.intervalDays,
    ease: clamp(nextEase, EASE_MIN, EASE_MAX),
    reps: nextReps,
    lapses: nextLapses,
  }
  const dueAt = new Date(now.getTime() + state.intervalDays * MS_PER_DAY).toISOString()
  return { state, dueAt, capped: cap.capped }
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
  const body = String(row.body ?? '')
  const chunkText = row.chunk_body == null ? null : String(row.chunk_body)
  return {
    id: String(row.id),
    title: String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    body,
    para: row.para as ReviewQueueItem['para'],
    kind: String(row.kind),
    status: String(row.status),
    project: row.project == null ? null : String(row.project),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    card_id: String(row.card_id),
    chunk_index: row.chunk_index == null ? null : Number(row.chunk_index),
    chunk_count: Number(row.chunk_count ?? 0),
    // A chunk card reveals its chunk; if the note was edited and that chunk is
    // gone, fall back to the whole body rather than showing nothing.
    card_text: row.chunk_index == null ? body : (chunkText ?? body),
    origin: String(row.origin ?? 'note') as StudyCardOrigin,
    question: row.question == null ? null : String(row.question),
    answer: row.answer == null ? null : String(row.answer),
    quote: row.quote == null ? null : String(row.quote),
    due_at: String(row.due_at),
    interval_days: Number(row.interval_days ?? 0),
    ease: Number(row.ease ?? DEFAULT_EASE),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
    last_grade: (row.last_grade as ReviewGrade | null) ?? null,
    last_reviewed_at: row.last_reviewed_at == null ? null : String(row.last_reviewed_at),
  }
}

/** The schedule of one card, or null when it has none. */
export function getCardState(cardId: string): ReviewState | null {
  const row = getDb().prepare('SELECT * FROM card_schedule WHERE card_id = ?').get(cardId) as
    | Record<string, unknown>
    | undefined
  return row ? rowToState(row) : null
}

/** The note's first card id (whole-note card, else the lowest chunk), or null. */
function firstCardId(itemId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT c.id FROM study_cards c JOIN card_schedule cs ON cs.card_id = c.id
       WHERE c.item_id = ? ORDER BY c.chunk_index IS NOT NULL, c.chunk_index, c.created_at LIMIT 1`,
    )
    .get(itemId) as { id: string } | undefined
  return row?.id ?? null
}

/** The state of a note's first card, or null when the note is not in review. */
export function getReviewState(itemId: string): ReviewState | null {
  const cardId = firstCardId(itemId)
  return cardId ? getCardState(cardId) : null
}

/** Every stored card schedule, for diagnostics and dashboards. */
export function listReviewStates(): ReviewScheduleRow[] {
  const rows = getDb()
    .prepare(
      `SELECT cs.*, c.item_id, c.chunk_index FROM card_schedule cs
       JOIN study_cards c ON c.id = cs.card_id ORDER BY cs.due_at ASC`,
    )
    .all() as Record<string, unknown>[]
  return rows.map((row) => ({
    cardId: String(row.card_id),
    itemId: String(row.item_id),
    chunkIndex: row.chunk_index == null ? null : Number(row.chunk_index),
    dueAt: String(row.due_at),
    ...rowToState(row),
    lastGrade: (row.last_grade as ReviewGrade | null) ?? null,
    lastReviewedAt: row.last_reviewed_at == null ? null : String(row.last_reviewed_at),
  }))
}

/** Live, active cards (note not trashed/archived), optionally in one project. */
function dueWhere(project?: string): { sql: string; params: unknown[] } {
  const p = project?.trim()
  return {
    sql:
      `items.status NOT IN ('trashed','archived') AND c.status = 'active' AND cs.due_at <= ?` +
      (p ? ' AND items.project = ?' : ''),
    params: p ? [p] : [],
  }
}

/** Start of the local day containing `now`, as an ISO string. */
function startOfLocalDay(now: Date): string {
  return new Date(localDay(now)).toISOString()
}

interface NewCardGroup {
  project: string | null
  examDate: string | null
  /** New (never reviewed) cards left now. */
  fresh: number
  /** Cards first reviewed today. */
  today: number
}

/** New-card counts per project for the scope (#264). */
function newCardGroups(project: string | undefined, now: Date): NewCardGroup[] {
  const p = project?.trim()
  const rows = getDb()
    .prepare(
      `SELECT items.project AS project, ps.exam_date AS exam_date,
              COALESCE(SUM(CASE WHEN cs.reps = 0 AND cs.last_reviewed_at IS NULL THEN 1 ELSE 0 END), 0) AS fresh,
              COALESCE(SUM(CASE WHEN (SELECT MIN(l.reviewed_at) FROM review_log l
                                      WHERE l.card_id = c.id AND l.migrated = 0) >= @today
                                THEN 1 ELSE 0 END), 0) AS today
       FROM study_cards c
       JOIN card_schedule cs ON cs.card_id = c.id
       JOIN items ON items.id = c.item_id
       LEFT JOIN project_settings ps ON ps.name = items.project
       WHERE items.status NOT IN ('trashed','archived') AND c.status = 'active'${p ? ' AND items.project = @project' : ''}
       GROUP BY items.project`,
    )
    .all({ today: startOfLocalDay(now), project: p ?? '' }) as Array<{
    project: string | null
    exam_date: string | null
    fresh: number
    today: number
  }>
  return rows.map((r) => ({
    project: r.project == null ? null : String(r.project),
    examDate: r.exam_date ? String(r.exam_date) : null,
    fresh: Number(r.fresh),
    today: Number(r.today),
  }))
}

/** Today's new-card allowance for one group: the day's budget minus what was already introduced. */
function groupAllowance(g: NewCardGroup, now: Date): { budget: number; left: number; unreachable: number } {
  // Budget from the cards that were new at the start of the day, so it stays put during the day.
  const startOfDayNew = g.fresh + g.today
  const daysLeft = g.project ? calendarDaysUntil(g.examDate, now) : null
  const budget = newCardBudget(startOfDayNew, daysLeft)
  return {
    budget,
    left: Math.max(0, budget - g.today),
    unreachable: unreachableNewCards(startOfDayNew, daysLeft),
  }
}

/** The day's new-card budget for a scope (summed over its projects). */
export function getNewCardBudget(
  project?: string,
  now: Date = new Date(),
): { perDay: number; leftToday: number; unreachable: number } {
  let perDay = 0
  let leftToday = 0
  let unreachable = 0
  for (const g of newCardGroups(project, now)) {
    const a = groupAllowance(g, now)
    perDay += a.budget
    leftToday += a.left
    unreachable += a.unreachable
  }
  return { perDay, leftToday, unreachable }
}

/** Every due card for the scope, in session order (#264). */
function dueQueue(before: string, project: string | undefined, now: Date): ReviewQueueItem[] {
  const where = dueWhere(project)
  const rows = getDb()
    .prepare(
      `SELECT items.*, c.id AS card_id, c.chunk_index, c.origin, c.question, c.answer, c.quote,
              nc.body AS chunk_body,
              (SELECT COUNT(*) FROM note_chunks n2 WHERE n2.item_id = items.id) AS chunk_count,
              cs.due_at, cs.interval_days, cs.ease, cs.reps, cs.lapses, cs.last_grade, cs.last_reviewed_at
       FROM card_schedule cs
       JOIN study_cards c ON c.id = cs.card_id
       JOIN items ON items.id = c.item_id
       LEFT JOIN note_chunks nc ON nc.item_id = c.item_id AND nc.chunk_index = c.chunk_index
       WHERE ${where.sql}
       ORDER BY c.priority DESC, items.created_at ASC, items.rowid, c.chunk_index`,
    )
    .all(before, ...where.params) as Record<string, unknown>[]
  const items = rows.map(rowToQueueItem)
  const groups = new Map<string, number>()
  for (const g of newCardGroups(project, now)) groups.set(g.project ?? '', groupAllowance(g, now).left)
  const candidates = items.map((item) => ({
    item,
    project: item.project,
    dueAt: item.due_at,
    lastGrade: item.last_grade,
    isNew: item.reps === 0 && item.last_reviewed_at == null,
  }))
  return buildReviewQueue(candidates, (p) => groups.get(p ?? '') ?? NEW_CARDS_PER_DAY_MAX).map((c) => c.item)
}

/**
 * The review session queue: cards due at or before `before` (default: now)
 * on live notes, missed first, then Partly, then due by date, then today's
 * new cards within each project's daily budget (#264).
 */
export function listDueReviews(before?: string, limit = 50, project?: string): ReviewQueueItem[] {
  return dueQueue(before ?? nowIso(), project, new Date()).slice(0, Math.max(0, limit))
}

/** How many cards the session queue holds now (the same cards `listDueReviews` returns, unlimited). */
export function countDueReviews(before?: string, project?: string): number {
  return dueQueue(before ?? nowIso(), project, new Date()).length
}

/**
 * Put a note into review: create its cards (one whole-note card, or one per
 * chunk for a long note), each due now. Re-enqueuing a note that already has
 * cards leaves them untouched (never resurrects a schedule).
 */
export function enqueueReview(itemId: string): ReviewEnqueueResult {
  const kind = getDb().prepare('SELECT kind FROM items WHERE id = ?').get(itemId) as { kind: string } | undefined
  if (kind?.kind === 'practice-test') {
    // Its questions are already cards (#265); never add note cards on top.
    const n = getDb().prepare('SELECT COUNT(*) AS c FROM study_cards WHERE item_id = ?').get(itemId) as { c: number }
    return { created: 0, cards: Number(n.c), alreadyEnrolled: true }
  }
  const { created, alreadyEnrolled } = createNoteCards(itemId)
  const total = getDb()
    .prepare('SELECT COUNT(*) AS c FROM study_cards WHERE item_id = ?')
    .get(itemId) as { c: number }
  return { created: created.length, cards: Number(total.c), alreadyEnrolled }
}

/** Remove a note from review (all of its cards and their history). Returns true when any existed. */
export function removeReview(itemId: string): boolean {
  const result = getDb().prepare('DELETE FROM study_cards WHERE item_id = ?').run(itemId)
  return result.changes > 0
}

/**
 * The exam date that applies to a card: its note's *current* project's saved
 * exam date (#261). Notes with no project, or a project with no date, have
 * none, so they get plain spacing with no exam anchor or cap.
 */
export function examDateForCard(cardId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT ps.exam_date AS exam_date
       FROM study_cards c
       JOIN items i ON i.id = c.item_id
       LEFT JOIN project_settings ps ON ps.name = i.project
       WHERE c.id = ?`,
    )
    .get(cardId) as { exam_date: string | null } | undefined
  return row?.exam_date ? String(row.exam_date) : null
}

/**
 * Record a grade for a card, persist the next schedule and log the review.
 * Pass a card id; a note id (legacy callers) grades that note's first card.
 * Missing state is treated as a fresh card (interval 0, ease 2.5).
 */
export function rateReview(
  cardOrItemId: string,
  grade: ReviewGrade,
  opts: { targetDate?: string | null } = {},
): ReviewState {
  const database = getDb()
  const isCard = !!database.prepare('SELECT 1 FROM study_cards WHERE id = ?').get(cardOrItemId)
  const cardId = isCard ? cardOrItemId : firstCardId(cardOrItemId)
  if (!cardId) throw new Error('This note is not in review.')

  const prev = getCardState(cardId) ?? {
    intervalDays: 0,
    ease: DEFAULT_EASE,
    reps: 0,
    lapses: 0,
  }
  // `opts.targetDate` overrides the project's date (tests); `null` means none.
  const examDate = opts.targetDate !== undefined ? opts.targetDate : examDateForCard(cardId)
  const { state, dueAt } = scheduleReview(prev, grade, { targetDate: examDate ?? undefined })
  const ts = nowIso()

  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO card_schedule
           (card_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
         VALUES (@card_id, @due_at, @interval_days, @ease, @reps, @lapses, @last_grade, @last_reviewed_at, @created_at, @updated_at)
         ON CONFLICT(card_id) DO UPDATE SET
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
        card_id: cardId,
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
    database
      .prepare(
        `INSERT INTO review_log (id, card_id, grade, reviewed_at, interval_days, ease, due_at, migrated)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(newId('rvl'), cardId, grade, ts, state.intervalDays, state.ease, dueAt)
  })()
  return state
}

/** One logged review (newest first), for history and session stats. */
export interface ReviewLogRow {
  cardId: string
  grade: ReviewGrade
  reviewedAt: string
  migrated: boolean
}

/** The review history of one card, newest first. */
export function listReviewLog(cardId: string): ReviewLogRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM review_log WHERE card_id = ? ORDER BY reviewed_at DESC')
    .all(cardId) as Record<string, unknown>[]
  return rows.map((r) => ({
    cardId: String(r.card_id),
    grade: String(r.grade) as ReviewGrade,
    reviewedAt: String(r.reviewed_at),
    migrated: Number(r.migrated) === 1,
  }))
}

/** Reviews closer together than this belong to the same session (#262). */
export const SESSION_GAP_MS = 30 * 60 * 1000

/**
 * Group the most recent run of reviews into a session summary. Pure. `log`
 * may be in any order; migrated rows should be left out by the caller.
 */
export function summarizeLastSession(
  log: Array<{ grade: string; reviewedAt: string }>,
  gapMs = SESSION_GAP_MS,
): StudySessionSummary | null {
  const rows = log
    .map((r) => ({ grade: r.grade, t: new Date(r.reviewedAt).getTime(), at: r.reviewedAt }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => b.t - a.t)
  if (rows.length === 0) return null
  const session = [rows[0]]
  for (let i = 1; i < rows.length; i++) {
    if (session[session.length - 1].t - rows[i].t >= gapMs) break
    session.push(rows[i])
  }
  let got = 0
  let partial = 0
  let missed = 0
  for (const r of session) {
    if (r.grade === 'good' || r.grade === 'easy') got++
    else if (r.grade === 'hard') partial++
    else missed++
  }
  return {
    reviewed: session.length,
    got,
    partial,
    missed,
    score: got / session.length,
    startedAt: session[session.length - 1].at,
    endedAt: session[0].at,
  }
}

/** Study home numbers for a project ('' / undefined = every project). */
export function getStudyStats(project?: string, now: Date = new Date()): StudyStats {
  const database = getDb()
  const name = (project ?? '').trim()
  const scope = name ? ' AND i.project = @project' : ''
  const params = { project: name, now: now.toISOString() }
  const live = `i.status NOT IN ('trashed', 'archived')`
  const cards = database
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN cs.reps = 0 AND cs.last_reviewed_at IS NULL THEN 1 ELSE 0 END), 0) AS fresh,
              COUNT(DISTINCT c.item_id) AS notes
       FROM study_cards c
       JOIN card_schedule cs ON cs.card_id = c.id
       JOIN items i ON i.id = c.item_id
       WHERE c.status = 'active' AND ${live}${scope}`,
    )
    .get(params) as { total: number; fresh: number; notes: number }
  const notes = database
    .prepare(`SELECT COUNT(*) AS c FROM items i WHERE ${live}${scope}`)
    .get(params) as { c: number }
  const log = database
    .prepare(
      `SELECT l.grade AS grade, l.reviewed_at AS reviewedAt
       FROM review_log l
       JOIN study_cards c ON c.id = l.card_id
       JOIN items i ON i.id = c.item_id
       WHERE l.migrated = 0${scope}
       ORDER BY l.reviewed_at DESC
       LIMIT 500`,
    )
    .all(params) as Array<{ grade: string; reviewedAt: string }>
  const exam = name
    ? (database.prepare('SELECT exam_date FROM project_settings WHERE name = ?').get(name) as
        | { exam_date: string | null }
        | undefined)
    : undefined
  const budget = getNewCardBudget(name || undefined, now)
  return {
    project: name || null,
    examDate: exam?.exam_date ? String(exam.exam_date) : null,
    // The session queue's size (due reviews + today's new cards within budget).
    due: dueQueue(now.toISOString(), name || undefined, now).length,
    totalCards: Number(cards.total),
    newCards: Number(cards.fresh),
    liveNotes: Number(notes.c),
    enrolledNotes: Number(cards.notes),
    lastSession: summarizeLastSession(log),
    newPerDay: budget.perDay,
    newLeftToday: budget.leftToday,
    unreachable: budget.unreachable,
  }
}
