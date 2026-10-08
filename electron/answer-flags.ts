/**
 * Shared answer-warning constants (#38, #235). Standalone so both the answer
 * pipeline (`generate.ts`) and the persistence layer (`db.ts`) can use them
 * without an import cycle.
 */

/** Warning shown when an answer with substance cites none of the retrieved notes. */
export const UNCITED_LABEL = '⚠ No notes cited — this answer may not be grounded in your notes.'

/** The label as a literal regex source, escaped. */
const UNCITED_LABEL_ESCAPED = UNCITED_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Remove a previously-embedded warning label from stored text (#235): rows
 * written before the label became per-message metadata still carry it in
 * `content`. Stripping on read keeps it out of the UI, exports and saved notes.
 */
export function stripUncitedLabel(text: string): string {
  if (!text.startsWith(UNCITED_LABEL)) return text
  return text.slice(UNCITED_LABEL.length).replace(/^\s*\n*/, '').trim()
}