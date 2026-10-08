/**
 * Exam-date helpers for the Study tab (#261). Dates are `YYYY-MM-DD` calendar
 * days; "days to go" counts local calendar days, so an exam tomorrow is 1 and
 * an exam today is 0 regardless of the time of day.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Local midnight of a `YYYY-MM-DD` date, or null when it isn't one. */
export function parseExamDate(value: string | null | undefined): Date | null {
  const m = ISO_DATE.exec((value ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole calendar days from `now` to the exam (negative once it has passed). */
export function daysToExam(examDate: string | null | undefined, now: Date = new Date()): number | null {
  const exam = parseExamDate(examDate)
  if (!exam) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((exam.getTime() - today.getTime()) / 86_400_000)
}

/** "Jun 1, 2026" for display. */
export function formatExamDate(examDate: string | null | undefined): string {
  const d = parseExamDate(examDate)
  if (!d) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "14 days to go", "Tomorrow", "Today", or "Exam passed". */
export function daysToGoLabel(days: number | null): string {
  if (days == null) return ''
  if (days < 0) return 'Exam passed'
  if (days === 0) return 'Exam today'
  if (days === 1) return '1 day to go'
  return `${days} days to go`
}

/** Most new cards a day (mirrors NEW_CARDS_PER_DAY_MAX in electron/review.ts, #264). */
export const NEW_CARDS_PER_DAY_MAX = 25
