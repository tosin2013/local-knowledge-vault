import { describe, expect, it } from 'vitest'
import type { ProjectReadiness } from '../../electron/types'
import {
  READINESS_CAPTION,
  daysToExamPhrase,
  dueBeforeLabel,
  readinessSummary,
  trendLabel,
  workOnWeakSpotsLabel,
} from '../../src/features/study/readinessCopy'

const base: ProjectReadiness = {
  project: 'Biology',
  examDate: '2026-11-25',
  daysToExam: 6,
  dueBeforeExam: 12,
  strong: [{ itemId: '1', title: 'A', group: 'strong', reasons: ['Last review: Got it'], cards: 1, lastGrade: 'good', lapses: 0, openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: null }],
  shaky: [
    { itemId: '2', title: 'B', group: 'shaky', reasons: ['Last review: Missed'], cards: 1, lastGrade: 'again', lapses: 1, openConfidentMisses: 0, dueBeforeExam: 1, lastReviewedAt: null },
    { itemId: '3', title: 'C', group: 'shaky', reasons: ['Last review: Partly'], cards: 1, lastGrade: 'hard', lapses: 0, openConfidentMisses: 0, dueBeforeExam: 0, lastReviewedAt: null },
  ],
  unstudied: [],
  trend: { thisWeek: { got: 8, partial: 0, missed: 1 }, lastWeek: { got: 5, partial: 2, missed: 3 } },
  weakItemIds: ['2', '3'],
}

describe('readinessCopy (#420)', () => {
  it('summarizes counts and days to the exam without saying the learner is ready', () => {
    expect(readinessSummary(base)).toBe('Strong: 1 note, Shaky: 2 notes, Not studied: 0 notes, 6 days to exam')
    expect(readinessSummary({ ...base, strong: [], shaky: [], unstudied: [base.strong[0]!, base.shaky[0]!], daysToExam: 1 })).toBe(
      'Strong: 0 notes, Shaky: 0 notes, Not studied: 2 notes, 1 day to exam',
    )
    expect(readinessSummary({ ...base, daysToExam: 0 })).toMatch(/Exam today/)
    expect(readinessSummary({ ...base, daysToExam: -2 })).toMatch(/Exam passed/)
    expect(readinessSummary({ ...base, daysToExam: null })).toBe('Strong: 1 note, Shaky: 2 notes, Not studied: 0 notes')
    expect(readinessSummary(base).toLowerCase()).not.toMatch(/ready/)
  })

  it('names the days-to-exam phrase', () => {
    expect(daysToExamPhrase(null)).toBeNull()
    expect(daysToExamPhrase(undefined)).toBeNull()
    expect(daysToExamPhrase(-1)).toBe('Exam passed')
    expect(daysToExamPhrase(0)).toBe('Exam today')
    expect(daysToExamPhrase(1)).toBe('1 day to exam')
    expect(daysToExamPhrase(6)).toBe('6 days to exam')
  })

  it('labels cards due before the exam or due now', () => {
    expect(dueBeforeLabel(base)).toBe('12 cards due before the exam')
    expect(dueBeforeLabel({ ...base, dueBeforeExam: 1 })).toBe('1 card due before the exam')
    expect(dueBeforeLabel({ ...base, examDate: null, dueBeforeExam: 3 })).toBe('3 cards due now')
    expect(dueBeforeLabel({ ...base, dueBeforeExam: 0 })).toBeNull()
  })

  it('formats the week-to-week trend and omits empty buckets', () => {
    expect(trendLabel(base.trend)).toBe('This week: 8 got it, 1 missed. Previous week: 5 got it, 2 partly, 3 missed.')
    expect(trendLabel({ thisWeek: { got: 0, partial: 0, missed: 0 }, lastWeek: { got: 0, partial: 0, missed: 0 } })).toBe(
      'This week: no reviews. Previous week: no reviews.',
    )
    expect(trendLabel(null)).toBeNull()
    expect(trendLabel(undefined)).toBeNull()
  })

  it('labels the weak-spots button', () => {
    expect(workOnWeakSpotsLabel(0)).toBe('Work on weak spots')
    expect(workOnWeakSpotsLabel(4)).toBe('Work on weak spots (4)')
  })

  it('keeps the caption honest', () => {
    expect(READINESS_CAPTION).toMatch(/not a prediction/)
    expect(READINESS_CAPTION.toLowerCase()).not.toMatch(/you're ready|you are ready/)
  })
})
