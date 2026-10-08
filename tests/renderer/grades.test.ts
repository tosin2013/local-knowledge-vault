import { describe, expect, it } from 'vitest'
import { STUDY_GRADES, gradeLabel } from '../../src/features/study/grades'

describe('Study grading scale (#264)', () => {
  it('is Missed / Partly / Got it on again / hard / good', () => {
    expect(STUDY_GRADES.map((g) => `${g.label}=${g.grade}`)).toEqual(['Missed=again', 'Partly=hard', 'Got it=good'])
  })

  it('reads old easy grades as Got it', () => {
    expect(gradeLabel('easy')).toBe('Got it')
    expect(gradeLabel('good')).toBe('Got it')
    expect(gradeLabel('hard')).toBe('Partly')
    expect(gradeLabel('again')).toBe('Missed')
    expect(gradeLabel(null)).toBe('')
  })
})
