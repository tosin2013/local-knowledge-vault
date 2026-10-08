import { describe, expect, it } from 'vitest'
import { daysToExam, daysToGoLabel, formatExamDate, parseExamDate } from '../../src/features/study/examDate'

describe('examDate helpers', () => {
  it('parses only YYYY-MM-DD', () => {
    expect(parseExamDate('2026-06-01')?.getDate()).toBe(1)
    expect(parseExamDate('June 1')).toBeNull()
    expect(parseExamDate('')).toBeNull()
    expect(parseExamDate(null)).toBeNull()
  })

  it('counts calendar days regardless of the time of day', () => {
    const lateEvening = new Date(2026, 9, 8, 23, 30)
    const earlyMorning = new Date(2026, 9, 8, 0, 5)
    expect(daysToExam('2026-10-22', lateEvening)).toBe(14)
    expect(daysToExam('2026-10-22', earlyMorning)).toBe(14)
    expect(daysToExam('2026-10-09', lateEvening)).toBe(1)
    expect(daysToExam('2026-10-08', lateEvening)).toBe(0)
    expect(daysToExam('2026-10-01', lateEvening)).toBe(-7)
    expect(daysToExam(null, lateEvening)).toBeNull()
  })

  it('labels days to go', () => {
    expect(daysToGoLabel(14)).toBe('14 days to go')
    expect(daysToGoLabel(1)).toBe('1 day to go')
    expect(daysToGoLabel(0)).toBe('Exam today')
    expect(daysToGoLabel(-2)).toBe('Exam passed')
    expect(daysToGoLabel(null)).toBe('')
  })

  it('formats for display', () => {
    expect(formatExamDate('2099-06-01')).toBe('Jun 1, 2099')
    expect(formatExamDate('nope')).toBe('')
  })
})
