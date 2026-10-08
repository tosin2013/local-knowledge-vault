import type { ReviewGrade } from '../../../electron/types'

/**
 * The one Study grading scale (#264): Missed / Partly / Got it, stored as the
 * SM-2 grades again / hard / good. Easy is gone from the UI; old `easy`
 * grades read as Got it.
 */
export const STUDY_GRADES: ReadonlyArray<{ grade: ReviewGrade; label: string }> = [
  { grade: 'again', label: 'Missed' },
  { grade: 'hard', label: 'Partly' },
  { grade: 'good', label: 'Got it' },
]

/** The scale label for a stored grade (legacy `easy` → Got it). */
export function gradeLabel(grade: string | null | undefined): string {
  if (grade === 'again') return 'Missed'
  if (grade === 'hard') return 'Partly'
  if (grade === 'good' || grade === 'easy') return 'Got it'
  return ''
}
