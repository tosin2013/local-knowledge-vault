/**
 * How many cards one Study session asks. Mirrors `SESSION_DEFAULT_CARDS` in
 * electron/study-session.ts: a session is a short sitting, and "Study more"
 * on the summary starts the next one with whatever is still due (#385).
 */
export const SESSION_CARDS = 20

/** How many of `due` cards a session of `cap` cards will ask. */
export function sessionCardCount(due: number, cap: number = SESSION_CARDS): number {
  return Math.max(0, Math.min(due, cap))
}

/** The Study home start button: say up front when a session asks fewer cards than are due. */
export function startSessionLabel(due: number, cap: number = SESSION_CARDS): string {
  if (due <= 0) return 'Nothing due'
  const n = sessionCardCount(due, cap)
  return n < due ? `Start session (${n} of ${due} due)` : `Start session (${due} due)`
}

/** The session intro heading, e.g. "20 of 21 cards ready" when the cap applies. */
export function sessionReadyLabel(due: number, cap: number = SESSION_CARDS): string {
  const n = sessionCardCount(due, cap)
  return n < due ? `${n} of ${due} cards ready` : due === 1 ? '1 card ready' : `${due} cards ready`
}
