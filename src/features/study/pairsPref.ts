/**
 * "Two-way cards for lists" (#273): whether enrolling a list-like note
 * (acronyms, a port table, term definitions) makes forward and reverse list
 * cards. On by default; the choice is remembered on this device.
 */
const KEY = 'lkv.study.pairs'

export function readPairsPref(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function writePairsPref(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

/** "Added “Acronyms” to Study as 80 two-way list cards." */
export function addedMessage(title: string, created: number, pairCards = 0): string {
  const sections = created - pairCards
  if (pairCards > 0 && sections > 0) {
    return `Added “${title}” to Study as ${pairCards} two-way list cards and ${sections} section ${sections === 1 ? 'card' : 'cards'}.`
  }
  if (pairCards > 0) return `Added “${title}” to Study as ${pairCards} two-way list cards (each item both ways).`
  return created > 1 ? `Added “${title}” to Study as ${created} cards (one per section).` : `Added “${title}” to Study.`
}
