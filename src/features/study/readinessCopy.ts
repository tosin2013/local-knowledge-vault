/**
 * Display copy for the exam-readiness panel (#420). Evidence only: these
 * helpers never say "you're ready" or predict a score.
 */
import type { ProjectReadiness, ReadinessTrend, ReadinessWeekCounts } from '../../../electron/types'
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function weekParts(w: ReadinessWeekCounts): string {
  const parts: string[] = []
  if (w.got) parts.push(`${w.got} got it`)
  if (w.partial) parts.push(`${w.partial} partly`)
  if (w.missed) parts.push(`${w.missed} missed`)
  return parts.length ? parts.join(', ') : 'no reviews'
}

/** "Strong: 18 notes, Shaky: 4, Not studied: 2, 6 days to exam". */
export function readinessSummary(r: ProjectReadiness): string {
  const parts = [
    `Strong: ${plural(r.strong.length, 'note')}`,
    `Shaky: ${plural(r.shaky.length, 'note')}`,
    `Not studied: ${plural(r.unstudied.length, 'note')}`,
  ]
  const days = daysToExamPhrase(r.daysToExam)
  if (days) parts.push(days)
  return parts.join(', ')
}

/** "6 days to exam", "1 day to exam", "Exam today", "Exam passed". */
export function daysToExamPhrase(days: number | null | undefined): string | null {
  if (days == null) return null
  if (days < 0) return 'Exam passed'
  if (days === 0) return 'Exam today'
  if (days === 1) return '1 day to exam'
  return `${days} days to exam`
}

/** "12 cards due before the exam", or "3 cards due now" when there is no date. */
export function dueBeforeLabel(r: ProjectReadiness): string | null {
  if (r.dueBeforeExam <= 0) return null
  return r.examDate
    ? `${plural(r.dueBeforeExam, 'card')} due before the exam`
    : `${plural(r.dueBeforeExam, 'card')} due now`
}

/** "This week: 8 got it, 1 missed. Previous week: 5 got it, 3 missed." */
export function trendLabel(trend: ReadinessTrend | null | undefined): string | null {
  if (!trend) return null
  return `This week: ${weekParts(trend.thisWeek)}. Previous week: ${weekParts(trend.lastWeek)}.`
}

export function workOnWeakSpotsLabel(count: number): string {
  if (count <= 0) return 'Work on weak spots'
  return `Work on weak spots (${count})`
}

/** Caption under the counts: honesty, not a score prediction. */
export const READINESS_CAPTION =
  'This is what your reviews show, not a prediction of your exam score.'
