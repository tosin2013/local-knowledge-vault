import { describe, expect, it } from 'vitest'
import { guessTestName, importSummary, linkSummary, todayLocal } from '../../src/features/study/practiceTest'

describe('practice-test helpers (#265)', () => {
  it('summarises an import', () => {
    expect(importSummary({ added: 1, needText: [], skipped: [], alreadyAdded: 0 })).toBe('1 card added')
    expect(importSummary({ added: 4, needText: [1, 2], skipped: [{ index: 0, question: 'q', reason: 'r' }], alreadyAdded: 3 })).toBe(
      '4 cards added, 2 need question text, 1 skipped, 3 already in Study',
    )
    expect(linkSummary({ linked: 0, drafts: 0 })).toBe('')
    expect(linkSummary({ linked: 2, drafts: 1 })).toBe('2 linked to your notes · 1 corrective draft to confirm in your own words')
    expect(linkSummary({ linked: 0, drafts: 3 })).toBe('3 corrective drafts to confirm in your own words')
  })

  it('guesses a test name from the first line', () => {
    expect(guessTestName('Practice Exam: Core 2 (220-1202) — Results\nScore: 6/10')).toBe('Practice Exam: Core 2 (220-1202)')
    expect(guessTestName('EXAMPLE DATA — x\nUnit 2–3 Biology practice quiz — my results\n1. Q?')).toBe('Unit 2–3 Biology practice quiz')
    expect(guessTestName('1. What is 2 + 2? ✗')).toBe('')
    expect(guessTestName('question,answer,correct\nQ?,a,no')).toBe('')
    expect(guessTestName('')).toBe('')
  })

  it('formats today as YYYY-MM-DD', () => {
    expect(todayLocal(new Date(2026, 9, 8))).toBe('2026-10-08')
  })
})
