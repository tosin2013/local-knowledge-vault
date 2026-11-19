/**
 * Exam readiness (#420): group a project's notes into Strong / Shaky /
 * Not studied from data Vault already stores (review grades, lapses,
 * confidence, the exam date, and notes not yet reviewed). This is evidence,
 * never a verdict — it never says "you're ready" or predicts a score.
 *
 * Teach-mode misses (#419) and Talk-it-through quiz grades (#417) show up
 * once they have been written to `study_attempts` / `review_log` (quiz
 * grades already are; Teach checks are not stored today).
 */
import { getDb } from './db'
import { calendarDaysUntil, enqueueReview } from './review'
import { enrollSkipReason, type EnrollCandidate } from './study-cards'
import type {
  PrepareWeakSpotsResult,
  ProjectReadiness,
  ReadinessGroup,
  ReadinessNote,
  ReadinessTrend,
  ReadinessWeekCounts,
  ReviewGrade,
  StudySelfGrade,
} from './types'

export type { PrepareWeakSpotsResult, ProjectReadiness, ReadinessGroup, ReadinessNote, ReadinessTrend, ReadinessWeekCounts }

/** Same threshold as CONFIDENT in study-session.ts: a first try at or above this that wasn't Got it. */
export const CONFIDENT_MISS = 70

/** Signals already stored for one live note, used by the grouping rules. */
export interface NoteReadinessSignals {
  itemId: string
  title: string
  /** Active cards on this note (0 = never enrolled). */
  cards: number
  /** At least one card has been reviewed, or a study attempt exists. */
  reviewed: boolean
  /** Highest lapse count among the note's cards. */
  lapses: number
  /**
   * The weakest latest grade among reviewed cards (`again` < `hard` <
   * `good` / `easy`). null when nothing has been reviewed.
   */
  worstLastGrade: ReviewGrade | null
  /**
   * Confident (≥ {@link CONFIDENT_MISS}) attempts graded Missed or Partly that
   * have not been followed by a later Got it on the same card.
   */
  openConfidentMisses: number
  /** Active cards due at or before the exam (or now, when there is no date). */
  dueBeforeExam: number
  lastReviewedAt: string | null
}

const GRADE_RANK: Record<ReviewGrade, number> = {
  again: 0,
  hard: 1,
  good: 2,
  easy: 2,
}

/** The Study-scale label for an SM-2 grade (easy counts as Got it). */
export function gradeEvidenceLabel(grade: ReviewGrade | StudySelfGrade | null | undefined): string | null {
  if (grade === 'again' || grade === 'missed') return 'Missed'
  if (grade === 'hard' || grade === 'partial') return 'Partly'
  if (grade === 'good' || grade === 'easy' || grade === 'got') return 'Got it'
  return null
}

/** The weaker of two last grades; nulls are ignored. Pure. */
export function worseGrade(a: ReviewGrade | null, b: ReviewGrade | null): ReviewGrade | null {
  if (!a) return b
  if (!b) return a
  return GRADE_RANK[a] <= GRADE_RANK[b] ? a : b
}

/**
 * Strong / Shaky / Not studied from one note's signals. Pure.
 *
 *  - Not studied: never reviewed (and no study attempts).
 *  - Shaky: the latest grade on any card is Missed or Partly, or there is a
 *    confident answer that was wrong and has not been corrected since.
 *  - Strong: reviewed, and none of those current weaknesses apply. Earlier
 *    lapses and cards due before the exam stay on the note as evidence.
 */
export function classifyNote(s: Pick<NoteReadinessSignals, 'reviewed' | 'worstLastGrade' | 'openConfidentMisses'>): ReadinessGroup {
  if (!s.reviewed) return 'unstudied'
  if (s.worstLastGrade === 'again' || s.worstLastGrade === 'hard') return 'shaky'
  if (s.openConfidentMisses > 0) return 'shaky'
  return 'strong'
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Short evidence lines for a note. Pure. Never a verdict ("you're ready").
 */
export function evidenceFor(s: NoteReadinessSignals, examDate: string | null): string[] {
  const reasons: string[] = []
  if (!s.reviewed) {
    reasons.push(s.cards > 0 ? 'Enrolled, not reviewed yet' : 'Not studied yet')
  } else {
    const label = gradeEvidenceLabel(s.worstLastGrade)
    if (label) reasons.push(`Last review: ${label}`)
  }
  if (s.lapses > 0) reasons.push(plural(s.lapses, 'lapse'))
  if (s.openConfidentMisses > 0) {
    reasons.push(
      s.openConfidentMisses === 1
        ? '1 confident answer that was wrong'
        : `${s.openConfidentMisses} confident answers that were wrong`,
    )
  }
  if (s.dueBeforeExam > 0) {
    reasons.push(
      examDate
        ? `${plural(s.dueBeforeExam, 'card')} due before the exam`
        : `${plural(s.dueBeforeExam, 'card')} due now`,
    )
  }
  return reasons
}

/** Turn signals into a listed note (group + evidence). Pure. */
export function noteFromSignals(s: NoteReadinessSignals, examDate: string | null): ReadinessNote {
  return {
    itemId: s.itemId,
    title: s.title,
    group: classifyNote(s),
    reasons: evidenceFor(s, examDate),
    cards: s.cards,
    lastGrade: s.worstLastGrade,
    lapses: s.lapses,
    openConfidentMisses: s.openConfidentMisses,
    dueBeforeExam: s.dueBeforeExam,
    lastReviewedAt: s.lastReviewedAt,
  }
}

const emptyWeek = (): ReadinessWeekCounts => ({ got: 0, partial: 0, missed: 0 })

function addGrade(bucket: ReadinessWeekCounts, grade: string): void {
  if (grade === 'good' || grade === 'easy') bucket.got++
  else if (grade === 'hard') bucket.partial++
  else if (grade === 'again') bucket.missed++
}

function weekTotal(w: ReadinessWeekCounts): number {
  return w.got + w.partial + w.missed
}

/**
 * Split review-log grades into the last 7 days and the 7 days before that.
 * Returns null when both windows are empty, so the panel can stay quiet. Pure.
 */
export function trendFromLog(
  log: Array<{ grade: string; reviewedAt: string }>,
  now: Date = new Date(),
): ReadinessTrend | null {
  const thisWeek = emptyWeek()
  const lastWeek = emptyWeek()
  const t1 = now.getTime() - 7 * 86_400_000
  const t2 = now.getTime() - 14 * 86_400_000
  const nowMs = now.getTime()
  for (const row of log) {
    const t = new Date(row.reviewedAt).getTime()
    if (Number.isNaN(t) || t > nowMs || t < t2) continue
    if (t >= t1) addGrade(thisWeek, row.grade)
    else addGrade(lastWeek, row.grade)
  }
  if (weekTotal(thisWeek) === 0 && weekTotal(lastWeek) === 0) return null
  return { thisWeek, lastWeek }
}

/** Format a week of grades as "8 got it, 2 partly, 1 missed", omitting zeros. Pure. */
export function formatWeekCounts(w: ReadinessWeekCounts): string {
  const parts: string[] = []
  if (w.got) parts.push(`${w.got} got it`)
  if (w.partial) parts.push(`${w.partial} partly`)
  if (w.missed) parts.push(`${w.missed} missed`)
  return parts.length ? parts.join(', ') : 'no reviews'
}

/**
 * Cut-off for "due before the exam": the start of the exam day in local time,
 * so a card due on exam day is not counted as due *before* it. When there is
 * no date, or the exam is today or has passed, the cut-off is `now`. Pure.
 */
export function dueBeforeExamCutoff(examDate: string | null | undefined, now: Date = new Date()): string {
  const days = calendarDaysUntil(examDate, now)
  if (days == null || days <= 0) return now.toISOString()
  const v = (examDate ?? '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return now.toISOString()
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString()
}

function isReviewed(reps: number, lastReviewedAt: string | null): boolean {
  return reps > 0 || !!lastReviewedAt
}

function compareWeak(a: ReadinessNote, b: ReadinessNote): number {
  const rank = (n: ReadinessNote) => {
    if (n.lastGrade === 'again') return 0
    if (n.lastGrade === 'hard') return 1
    if (n.openConfidentMisses > 0) return 2
    return 3
  }
  const r = rank(a) - rank(b)
  if (r !== 0) return r
  if (b.openConfidentMisses !== a.openConfidentMisses) return b.openConfidentMisses - a.openConfidentMisses
  if (b.lapses !== a.lapses) return b.lapses - a.lapses
  return a.title.localeCompare(b.title)
}

/**
 * Group notes and attach evidence. Pure (no database).
 */
export function buildReadiness(
  project: string,
  examDate: string | null,
  notes: NoteReadinessSignals[],
  log: Array<{ grade: string; reviewedAt: string }>,
  now: Date = new Date(),
): ProjectReadiness {
  const listed = notes.map((s) => noteFromSignals(s, examDate))
  const strong = listed.filter((n) => n.group === 'strong').sort((a, b) => a.title.localeCompare(b.title))
  const shaky = listed.filter((n) => n.group === 'shaky').sort(compareWeak)
  const unstudied = listed.filter((n) => n.group === 'unstudied').sort((a, b) => a.title.localeCompare(b.title))
  return {
    project,
    examDate,
    daysToExam: calendarDaysUntil(examDate, now),
    dueBeforeExam: notes.reduce((n, s) => n + s.dueBeforeExam, 0),
    strong,
    shaky,
    unstudied,
    trend: trendFromLog(log, now),
    weakItemIds: [...shaky, ...unstudied].map((n) => n.itemId),
  }
}

interface CardRow {
  item_id: string
  title: string
  body: string
  kind: string
  status: string
  card_id: string | null
  last_grade: string | null
  lapses: number | null
  reps: number | null
  last_reviewed_at: string | null
  due_at: string | null
}

interface AttemptRow {
  item_id: string | null
  card_id: string | null
  confidence: number
  self_grade: string
  created_at: string
}

/**
 * A confident Missed/Partly attempt is "open" until a later Got it on the
 * same card (or the same note, when the attempt has no card). Pure.
 */
export function openConfidentMissCount(
  attempts: Array<{ cardId: string | null; itemId: string; confidence: number; selfGrade: string; createdAt: string }>,
  itemId: string,
  cardIds: string[],
): number {
  const mine = attempts
    .filter((a) => a.itemId === itemId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.cardId?.localeCompare(b.cardId ?? '') || 0)
  const keys = new Set(cardIds)
  const byKey = new Map<string, typeof mine>()
  for (const a of mine) {
    const key = a.cardId && keys.has(a.cardId) ? a.cardId : itemId
    const list = byKey.get(key) ?? []
    list.push(a)
    byKey.set(key, list)
  }
  let open = 0
  for (const list of byKey.values()) {
    let outstanding = 0
    for (const a of list) {
      if (a.selfGrade === 'got') outstanding = 0
      else if (a.confidence >= CONFIDENT_MISS && (a.selfGrade === 'missed' || a.selfGrade === 'partial')) outstanding++
    }
    open += outstanding
  }
  return open
}

function signalsFromRows(
  itemId: string,
  title: string,
  cards: CardRow[],
  attempts: AttemptRow[],
  cutoff: string,
): NoteReadinessSignals {
  const active = cards.filter((c) => c.card_id)
  let lapses = 0
  let worstLastGrade: ReviewGrade | null = null
  let lastReviewedAt: string | null = null
  let dueBeforeExam = 0
  let reviewed = false
  const cardIds: string[] = []
  for (const c of active) {
    cardIds.push(String(c.card_id))
    const cardLapses = Number(c.lapses ?? 0)
    if (cardLapses > lapses) lapses = cardLapses
    const grade = c.last_grade as ReviewGrade | null
    if (grade === 'again' || grade === 'hard' || grade === 'good' || grade === 'easy') {
      worstLastGrade = worseGrade(worstLastGrade, grade)
    }
    if (c.last_reviewed_at && (!lastReviewedAt || c.last_reviewed_at > lastReviewedAt)) {
      lastReviewedAt = String(c.last_reviewed_at)
    }
    if (isReviewed(Number(c.reps ?? 0), c.last_reviewed_at)) reviewed = true
    if (c.due_at && String(c.due_at) <= cutoff) dueBeforeExam++
  }
  const mapped = attempts.map((a) => ({
    cardId: a.card_id,
    itemId: a.item_id ?? itemId,
    confidence: Number(a.confidence ?? 0),
    selfGrade: String(a.self_grade),
    createdAt: String(a.created_at),
  }))
  if (!reviewed && mapped.some((a) => a.itemId === itemId)) reviewed = true
  return {
    itemId,
    title,
    cards: active.length,
    reviewed,
    lapses,
    worstLastGrade,
    openConfidentMisses: openConfidentMissCount(mapped, itemId, cardIds),
    dueBeforeExam,
    lastReviewedAt,
  }
}

function eligibleNote(row: Pick<CardRow, 'body' | 'kind' | 'status'>, hasCards: boolean): boolean {
  if (hasCards) return true
  return enrollSkipReason(row as EnrollCandidate) == null
}

/**
 * Readiness for one project, from the existing tables only.
 */
export function getProjectReadiness(project: string, now: Date = new Date()): ProjectReadiness {
  const name = (project ?? '').trim()
  if (!name) {
    return buildReadiness('', null, [], [], now)
  }
  const database = getDb()
  const examRow = database.prepare('SELECT exam_date FROM project_settings WHERE name = ?').get(name) as
    | { exam_date: string | null }
    | undefined
  const examDate = examRow?.exam_date ? String(examRow.exam_date) : null
  const cutoff = dueBeforeExamCutoff(examDate, now)

  const cardRows = database
    .prepare(
      `SELECT i.id AS item_id, i.title AS title, i.body AS body, i.kind AS kind, i.status AS status,
              c.id AS card_id, cs.last_grade AS last_grade, cs.lapses AS lapses, cs.reps AS reps,
              cs.last_reviewed_at AS last_reviewed_at, cs.due_at AS due_at
       FROM items i
       LEFT JOIN study_cards c ON c.item_id = i.id AND c.status = 'active'
       LEFT JOIN card_schedule cs ON cs.card_id = c.id
       WHERE i.project = ? AND i.status NOT IN ('trashed','archived')
       ORDER BY i.title, i.id, c.chunk_index, c.rowid`,
    )
    .all(name) as CardRow[]

  const attempts = database
    .prepare(
      `SELECT a.item_id AS item_id, a.card_id AS card_id, a.confidence AS confidence,
              a.self_grade AS self_grade, a.created_at AS created_at
       FROM study_attempts a
       JOIN items i ON i.id = a.item_id
       WHERE i.project = ? AND i.status NOT IN ('trashed','archived')`,
    )
    .all(name) as AttemptRow[]

  const log = database
    .prepare(
      `SELECT l.grade AS grade, l.reviewed_at AS reviewedAt
       FROM review_log l
       JOIN study_cards c ON c.id = l.card_id
       JOIN items i ON i.id = c.item_id
       WHERE i.project = ? AND i.status NOT IN ('trashed','archived') AND l.migrated = 0`,
    )
    .all(name) as Array<{ grade: string; reviewedAt: string }>

  const byItem = new Map<string, CardRow[]>()
  for (const row of cardRows) {
    const list = byItem.get(row.item_id) ?? []
    list.push(row)
    byItem.set(row.item_id, list)
  }
  const notes: NoteReadinessSignals[] = []
  for (const [itemId, rows] of byItem) {
    const head = rows[0]
    const hasCards = rows.some((r) => r.card_id)
    if (!eligibleNote(head, hasCards)) continue
    notes.push(signalsFromRows(itemId, String(head.title ?? ''), rows, attempts, cutoff))
  }
  return buildReadiness(name, examDate, notes, log, now)
}

/**
 * Enroll unstudied notes that have no cards yet, and return the weak-spot
 * note ids (shaky first, then not studied) for a focused session.
 */
export function prepareWeakSpots(
  project: string,
  options: { pairs?: boolean } = {},
  now: Date = new Date(),
): PrepareWeakSpotsResult {
  const readiness = getProjectReadiness(project, now)
  let enrolled = 0
  for (const note of readiness.unstudied) {
    if (note.cards > 0) continue
    const res = enqueueReview(note.itemId, { pairs: options.pairs })
    if (!res.alreadyEnrolled && res.created > 0) enrolled++
  }
  // Re-read so newly enrolled notes stay in the unstudied group (still not reviewed).
  const next = getProjectReadiness(project, now)
  return { itemIds: next.weakItemIds, enrolled }
}
