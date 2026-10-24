/**
 * #296 — the Study queue as it was before the rewrite, kept verbatim as a
 * reference so the smoke tests can prove the new narrow/streamed queue returns
 * the same cards in the same order. Do not "fix" this file; it is the oracle.
 */
import type Database from 'better-sqlite3'
import { buildReviewQueue, calendarDaysUntil, newCardBudget, NEW_CARDS_PER_DAY_MAX } from '../../../electron/review'

function localDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

interface LegacyGroup {
  project: string | null
  examDate: string | null
  fresh: number
  today: number
}

function legacyGroups(db: Database.Database, project: string | undefined, now: Date): LegacyGroup[] {
  const p = project?.trim()
  const rows = db
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
    .all({ today: new Date(localDay(now)).toISOString(), project: p ?? '' }) as Array<{
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

function legacyLeft(g: LegacyGroup, now: Date): number {
  const startOfDayNew = g.fresh + g.today
  const daysLeft = g.project ? calendarDaysUntil(g.examDate, now) : null
  return Math.max(0, newCardBudget(startOfDayNew, daysLeft) - g.today)
}

/** One legacy queue row, reduced to what the comparisons need. */
export interface LegacyQueueRow {
  card_id: string
  id: string
  card_text: string
  chunk_count: number
  due_at: string
  reps: number
  last_grade: string | null
  question: string | null
}

/** The pre-#296 `dueQueue()`: every due card with bodies, ordered in JS. */
export function legacyDueQueue(
  db: Database.Database,
  before: string,
  project: string | undefined,
  now: Date,
): LegacyQueueRow[] {
  const p = project?.trim()
  const rows = db
    .prepare(
      `SELECT items.*, c.id AS card_id, c.chunk_index, c.origin, c.question, c.answer, c.quote,
              nc.body AS chunk_body,
              (SELECT COUNT(*) FROM note_chunks n2 WHERE n2.item_id = items.id) AS chunk_count,
              cs.due_at, cs.interval_days, cs.ease, cs.reps, cs.lapses, cs.last_grade, cs.last_reviewed_at
       FROM card_schedule cs
       JOIN study_cards c ON c.id = cs.card_id
       JOIN items ON items.id = c.item_id
       LEFT JOIN note_chunks nc ON nc.item_id = c.item_id AND nc.chunk_index = c.chunk_index
       WHERE items.status NOT IN ('trashed','archived') AND c.status = 'active' AND cs.due_at <= ?${p ? ' AND items.project = ?' : ''}
       ORDER BY c.priority DESC, items.created_at ASC, items.rowid, c.chunk_index, c.rowid`,
    )
    .all(before, ...(p ? [p] : [])) as Record<string, unknown>[]
  const groups = new Map<string, number>()
  for (const g of legacyGroups(db, project, now)) groups.set(g.project ?? '', legacyLeft(g, now))
  const candidates = rows.map((row) => {
    const body = String(row.body ?? '')
    const chunkText = row.chunk_body == null ? null : String(row.chunk_body)
    const item: LegacyQueueRow = {
      card_id: String(row.card_id),
      id: String(row.id),
      card_text: row.chunk_index == null ? body : (chunkText ?? body),
      chunk_count: Number(row.chunk_count ?? 0),
      due_at: String(row.due_at),
      reps: Number(row.reps ?? 0),
      last_grade: (row.last_grade as string | null) ?? null,
      question: row.question == null ? null : String(row.question),
    }
    return {
      item,
      project: row.project == null ? null : String(row.project),
      dueAt: item.due_at,
      lastGrade: item.last_grade,
      isNew: item.reps === 0 && row.last_reviewed_at == null,
    }
  })
  return buildReviewQueue(candidates, (pr) => groups.get(pr ?? '') ?? NEW_CARDS_PER_DAY_MAX).map((c) => c.item)
}

/** Reduce a current queue item to the legacy comparison shape. */
export function asLegacyRow(q: {
  card_id: string
  id: string
  card_text: string
  chunk_count: number
  due_at: string
  reps: number
  last_grade: string | null
  question: string | null
}): LegacyQueueRow {
  return {
    card_id: q.card_id,
    id: q.id,
    card_text: q.card_text,
    chunk_count: q.chunk_count,
    due_at: q.due_at,
    reps: q.reps,
    last_grade: q.last_grade,
    question: q.question,
  }
}
