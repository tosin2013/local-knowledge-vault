import { describe, expect, it } from 'vitest'
import {
  SESSION_CARDS,
  sessionCardCount,
  sessionReadyLabel,
  startSessionLabel,
} from '../../src/features/study/sessionSize'
import { SESSION_DEFAULT_CARDS } from '../../electron/study-session'

describe('Study session size (#385)', () => {
  it('matches the main-process session default', () => {
    expect(SESSION_CARDS).toBe(SESSION_DEFAULT_CARDS)
  })

  it('caps a session at the session size', () => {
    expect(sessionCardCount(21)).toBe(20)
    expect(sessionCardCount(7)).toBe(7)
    expect(sessionCardCount(-1)).toBe(0)
    expect(sessionCardCount(5, 3)).toBe(3)
  })

  it('says how many of the due cards the session will ask', () => {
    expect(startSessionLabel(0)).toBe('Nothing due')
    expect(startSessionLabel(7)).toBe('Start session (7 due)')
    expect(startSessionLabel(20)).toBe('Start session (20 due)')
    expect(startSessionLabel(21)).toBe('Start session (20 of 21 due)')
  })

  it('labels the session intro the same way', () => {
    expect(sessionReadyLabel(1)).toBe('1 card ready')
    expect(sessionReadyLabel(7)).toBe('7 cards ready')
    expect(sessionReadyLabel(21)).toBe('20 of 21 cards ready')
    expect(sessionReadyLabel(21, 50)).toBe('21 cards ready')
  })
})
