import { describe, expect, it } from 'vitest'
import { addedMessage, readPairsPref, writePairsPref } from '../../src/features/study/pairsPref'

describe('two-way list card preference (#273)', () => {
  it('is on by default and remembers off', () => {
    window.localStorage.removeItem('lkv.study.pairs')
    expect(readPairsPref()).toBe(true)
    writePairsPref(false)
    expect(readPairsPref()).toBe(false)
    writePairsPref(true)
    expect(readPairsPref()).toBe(true)
    window.localStorage.removeItem('lkv.study.pairs')
  })

  it('words the "Add to review" result', () => {
    expect(addedMessage('Acronyms', 80, 80)).toBe('Added “Acronyms” to Study as 80 two-way list cards (each item both ways).')
    expect(addedMessage('Cells', 23, 22)).toBe('Added “Cells” to Study as 22 two-way list cards and 1 section card.')
    expect(addedMessage('Cells', 24, 22)).toBe('Added “Cells” to Study as 22 two-way list cards and 2 section cards.')
    expect(addedMessage('Notes', 4)).toBe('Added “Notes” to Study as 4 cards (one per section).')
    expect(addedMessage('Notes', 1)).toBe('Added “Notes” to Study.')
  })
})
