/**
 * Teach mode in Talk it through (#418): the walk through a lesson plan, kept
 * pure so the order and the learner's commands are testable. Checking an answer
 * happens in the main process (teach:check), which applies the tutor rules.
 */
import type { TeachConcept, TeachPlan } from '../../../electron/types'

export type ConceptStatus = 'covered' | 'missed' | 'skipped'
export type TeachPhase = 'check' | 'followup' | 'why'

export interface TeachState {
  concepts: TeachConcept[]
  index: number
  phase: TeachPhase
  /** The question the learner is answering now. */
  question: string
  hintsGiven: number
  status: Record<string, ConceptStatus>
  /** Right answers so far (every other one gets a "why" question). */
  rightCount: number
}

export type TeachCommand = 'slower' | 'example' | 'skip' | 'back' | 'repeat' | 'stop' | 'hint'

const norm = (t: string) => (t ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** A teach command, only when the whole utterance is the command. Pure. */
export function parseTeachCommand(text: string): TeachCommand | null {
  const t = norm(text)
  if (/^((can you |please )?(go |say it |talk )?slower( please)?|slow down( please)?)$/.test(t)) return 'slower'
  if (/^((can you )?(give me |show me )?an? (example|instance)( please)?|example( please)?|for example)$/.test(t)) return 'example'
  if (/^(skip( it| this( one)?)?|next( one| concept)?)$/.test(t)) return 'skip'
  if (/^(go back|back|previous( one| concept)?|last one)$/.test(t)) return 'back'
  if (/^(repeat( that)?|say (that|it) again|again please|what was the question)$/.test(t)) return 'repeat'
  if (/^(stop|stop teaching|end|end lesson|thats all|im done|goodbye|bye)$/.test(t)) return 'stop'
  if (/^((give me |can i (get|have) )?(a |another )?hint( please)?|help( me)?)$/.test(t)) return 'hint'
  return null
}

export function startTeach(plan: TeachPlan): TeachState {
  return { concepts: plan.concepts, index: 0, phase: 'check', question: plan.concepts[0]?.check ?? '', hintsGiven: 0, status: {}, rightCount: 0 }
}

export function current(st: TeachState): TeachConcept | null {
  return st.concepts[st.index] ?? null
}

/** How a concept is introduced: explanation, the note's example, then a quick check. Pure. */
export function conceptSpeech(st: TeachState): string {
  const c = current(st)
  if (!c) return ''
  const example = c.example ? ` For example: ${c.example}` : ''
  return `Concept ${st.index + 1} of ${st.concepts.length}: ${c.title}. ${c.explain}${example} Quick check: ${c.check}`
}

export function exampleSpeech(c: TeachConcept): string {
  if (c.example) return `Here’s the example from your note: ${c.example}`
  return c.quote
    ? `Your note doesn’t give an example for this one. Here’s what it says: “${c.quote}”`
    : 'Your note doesn’t give an example for this one.'
}

/** Move to a concept (clamped), resetting the question. Pure. */
export function goTo(st: TeachState, index: number): TeachState {
  const i = Math.max(0, Math.min(index, st.concepts.length))
  return { ...st, index: i, phase: 'check', question: st.concepts[i]?.check ?? '', hintsGiven: 0 }
}

export function mark(st: TeachState, status: ConceptStatus): TeachState {
  const c = current(st)
  if (!c) return st
  // A concept that needed re-explaining stays missed even if the follow-up goes
  // well, and skipping (after going back) doesn't undo an earlier result.
  const was = st.status[c.id]
  if ((was === 'missed' && status !== 'missed') || (was && status === 'skipped')) return st
  return { ...st, status: { ...st.status, [c.id]: status } }
}

export function isDone(st: TeachState): boolean {
  return st.index >= st.concepts.length
}

export interface TeachSummary {
  say: string
  covered: TeachConcept[]
  missed: TeachConcept[]
  /** Notes behind the missed concepts (for Study cards). */
  missedNoteIds: string[]
}

export function summarize(st: TeachState): TeachSummary {
  const covered = st.concepts.filter((c) => st.status[c.id] === 'covered')
  const missed = st.concepts.filter((c) => st.status[c.id] === 'missed')
  const skipped = st.concepts.filter((c) => st.status[c.id] === 'skipped').length
  const parts = [`That’s the lesson: ${covered.length} of ${st.concepts.length} concepts went smoothly.`]
  if (missed.length) parts.push(`We went back over ${missed.map((c) => c.title).join(', ')}.`)
  if (skipped) parts.push(`You skipped ${skipped}.`)
  if (missed.length) parts.push('You can add those to Study so they come back for review.')
  return { say: parts.join(' '), covered, missed, missedNoteIds: [...new Set(missed.map((c) => c.sourceId))] }
}
