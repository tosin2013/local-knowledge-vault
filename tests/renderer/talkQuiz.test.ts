import { describe, expect, it } from 'vitest'
import type { StudyCardQuestion } from '../../electron/types'
import {
  NOT_IN_NOTES,
  parseOptionLetter,
  questionSpeech,
  quizInput,
  revealSpeech,
  startCard,
} from '../../src/features/voice/talkQuiz'

function q(over: Partial<StudyCardQuestion> = {}): StudyCardQuestion {
  return {
    cardId: 'c1',
    itemId: 'itm_1',
    title: 'Cells',
    project: null,
    origin: 'note',
    kind: 'fact',
    question: 'What do mitochondria make?',
    answer: 'ATP',
    quote: 'Mitochondria make ATP.',
    sectionText: 'Mitochondria make ATP. They have two membranes.',
    chunkIndex: null,
    chunkCount: 1,
    citations: [{ id: 'itm_1', title: 'Cells' }],
    ...over,
  } as StudyCardQuestion
}

const mc = () =>
  q({
    mode: 'mc',
    options: [
      { key: 'x', text: 'Glucose' },
      { key: 'y', text: 'ATP' },
    ],
    answerKey: 'y',
  } as Partial<StudyCardQuestion>)

describe('spoken quiz (#413)', () => {
  it('asks first, then confidence, then reveals the cited answer and asks for a grade', () => {
    let st = startCard(q())
    let step = quizInput(st, 'glucose')
    expect(step.next.stage).toBe('confidence')
    expect(step.say).toMatch(/How sure/)
    expect(step.next.attempt).toBe('glucose')
    step = quizInput(step.next, 'pretty sure')
    expect(step.next.confidence).toBe(70)
    expect(step.next.stage).toBe('grade')
    expect(step.say).toContain('Your note says: ATP.')
    expect(step.say).toContain('“Cells”')
    expect(step.outcome).toBeUndefined()
    st = step.next
    expect(quizInput(st, 'hmm').say).toMatch(/got it, partly, or missed/)
    expect(quizInput(st, 'missed').outcome).toEqual({ type: 'grade', grade: 'again' })
    expect(quizInput(st, 'partly').say).toBe('Okay, partly.')
    expect(quizInput(st, 'got it').say).toBe('Nice.')
  })

  it('defaults confidence when it cannot hear a number', () => {
    const st = quizInput(startCard(q()), 'ATP').next
    const step = quizInput(st, 'purple')
    expect(step.next.confidence).toBe(50)
    expect(step.say).toMatch(/^I’ll put that at 50 percent/)
  })

  it('hints in steps before giving up', () => {
    let st = startCard(q())
    const h1 = quizInput(st, 'hint')
    expect(h1.say).toBe('Hint: Think about your note “Cells”.')
    st = h1.next
    st = quizInput(st, 'hint').next
    st = quizInput(st, 'hint').next
    expect(st.hintLevel).toBe(3)
    expect(quizInput(st, 'hint').say).toMatch(/all the hints/)
  })

  it('handles repeat, skip, stop, empty and I don’t know', () => {
    const st = startCard(q())
    expect(quizInput(st, 'repeat').say).toBe('What do mitochondria make?')
    expect(quizInput(st, 'skip').outcome).toEqual({ type: 'skip' })
    expect(quizInput(st, 'stop').outcome).toEqual({ type: 'stop' })
    expect(quizInput(st, '  ').say).toMatch(/didn’t catch/)
    const dk = quizInput(st, 'no idea')
    expect(dk.outcome).toEqual({ type: 'grade', grade: 'again' })
    expect(dk.next.dontKnow).toBe(true)
    expect(dk.next.confidence).toBe(0)
  })

  it('runs multiple choice by letter and grades the pick', () => {
    const st = startCard(mc())
    expect(questionSpeech(mc())).toBe('What do mitochondria make? A: Glucose. B: ATP. Say a letter.')
    expect(quizInput(st, 'banana').say).toMatch(/Say a letter from A to B/)
    expect(quizInput(st, 'hint').say).toMatch(/^Hint:/)
    expect(quizInput(quizInput(st, 'hint').next, 'hint').say).toMatch(/all the hints/)
    const picked = quizInput(st, 'option b').next
    expect(picked.picked).toBe('y')
    const right = quizInput(picked, '90')
    expect(right.outcome).toEqual({ type: 'grade', grade: 'good' })
    expect(right.say).toMatch(/^That’s right\. The answer is B, ATP/)
    const wrong = quizInput(quizInput(st, 'A').next, '90')
    expect(wrong.outcome).toEqual({ type: 'grade', grade: 'again' })
    expect(wrong.say).toMatch(/^Not quite/)
  })

  it('reveals the quote, the section, or says it isn’t in the notes', () => {
    expect(questionSpeech(q())).toBe('What do mitochondria make?')
    expect(revealSpeech(q({ answer: null }))).toBe('Your note says: “Mitochondria make ATP.”. That’s from your note “Cells”.')
    expect(revealSpeech(q({ answer: null, quote: null }))).toBe('Compare with your note “Cells”: Mitochondria make ATP. They have two membranes.')
    expect(revealSpeech(q({ answer: null, quote: null, sectionText: '', title: '' }))).toBe(NOT_IN_NOTES)
  })

  it('parses option letters', () => {
    expect(parseOptionLetter("it's c", 4)).toBe(2)
    expect(parseOptionLetter('the answer is a.', 2)).toBe(0)
    expect(parseOptionLetter('d', 2)).toBeNull()
    expect(parseOptionLetter('maybe', 2)).toBeNull()
  })
})
