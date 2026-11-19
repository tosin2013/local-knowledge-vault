/**
 * The spoken quiz inside Talk it through (#413), as a pure state machine so the
 * tutor rules are testable: ask first, hints in steps, the cited answer only
 * after the learner has tried, then a self-grade that feeds spaced review.
 */
import type { ReviewGrade, StudyCardQuestion } from '../../../electron/types'
import { parseSpokenCommand, parseSpokenConfidence, parseSpokenGrade, splitSentences, studyHint } from './speech'

export const NOT_IN_NOTES = 'I couldn’t find that in your notes.'
const LETTERS = 'ABCDEFGH'

export type QuizStage = 'answer' | 'confidence' | 'grade'

export interface QuizCardState {
  q: StudyCardQuestion
  stage: QuizStage
  hintLevel: number
  attempt: string
  dontKnow: boolean
  confidence: number
  picked: string | null
}

export type QuizOutcome = { type: 'grade'; grade: ReviewGrade } | { type: 'skip' } | { type: 'stop' }

export interface QuizStep {
  next: QuizCardState
  /** What Vault says (and shows) next. */
  say: string
  outcome?: QuizOutcome
}

export function isMultipleChoice(q: StudyCardQuestion): boolean {
  return q.mode === 'mc' && (q.options?.length ?? 0) > 1
}

export function startCard(q: StudyCardQuestion): QuizCardState {
  return { q, stage: 'answer', hintLevel: 0, attempt: '', dontKnow: false, confidence: 50, picked: null }
}

/** The question as spoken: multiple choice reads its options. */
export function questionSpeech(q: StudyCardQuestion): string {
  if (!isMultipleChoice(q)) return q.question
  const opts = q.options!.map((o, i) => `${LETTERS[i]}: ${o.text}.`).join(' ')
  return `${q.question} ${opts} Say a letter.`
}

function optionText(q: StudyCardQuestion, key: string | null | undefined): string {
  const i = (q.options ?? []).findIndex((o) => o.key === key)
  return i >= 0 ? `${LETTERS[i]}, ${q.options![i].text}` : ''
}

/** The cited answer, spoken after the attempt; "I couldn't find that in your notes" when there's nothing to show. */
export function revealSpeech(q: StudyCardQuestion): string {
  const from = q.title ? ` That’s from your note “${q.title}”.` : ''
  if (isMultipleChoice(q) && q.answerKey) return `The answer is ${optionText(q, q.answerKey)}.${from}`
  if (q.answer) return `Your note says: ${q.answer.replace(/[.\s]+$/, '')}.${from}`
  if (q.quote) return `Your note says: “${q.quote}”.${from}`
  const section = splitSentences(q.sectionText ?? '').slice(0, 2).join(' ')
  if (section) return `Compare with your note${q.title ? ` “${q.title}”` : ''}: ${section}`
  return NOT_IN_NOTES
}

/** A spoken option letter ("B", "option c", "the answer is a"). */
export function parseOptionLetter(text: string, count: number): number | null {
  const m = /^(?:(?:it s|its|the answer is|answer|option|letter)\s+)?([a-h])\.?$/i.exec(
    (text ?? '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z\s.]/g, '').replace(/\s+/g, ' ').trim()
  )
  if (!m) return null
  const i = m[1].charCodeAt(0) - 97
  return i < count ? i : null
}

const ASK_GRADE = 'Did you get it? Say got it, partly, or missed.'

function reveal(st: QuizCardState): QuizStep {
  const said = revealSpeech(st.q)
  if (st.dontKnow) return { next: { ...st, stage: 'grade' }, say: `${said} Let’s mark this one missed; it’ll come back soon.`, outcome: { type: 'grade', grade: 'again' } }
  if (isMultipleChoice(st.q)) {
    const right = st.picked != null && st.picked === st.q.answerKey
    return right
      ? { next: { ...st, stage: 'grade' }, say: `That’s right. ${said}`, outcome: { type: 'grade', grade: 'good' } }
      : { next: { ...st, stage: 'grade' }, say: `Not quite. ${said}`, outcome: { type: 'grade', grade: 'again' } }
  }
  return { next: { ...st, stage: 'grade' }, say: `${said} ${ASK_GRADE}` }
}

/** One learner turn (spoken or typed) during a quiz card. Pure. */
export function quizInput(st: QuizCardState, text: string): QuizStep {
  const cmd = parseSpokenCommand(text)
  if (cmd === 'stop') return { next: st, say: 'Okay, stopping the quiz.', outcome: { type: 'stop' } }
  if (st.stage === 'answer') {
    if (cmd === 'repeat') return { next: st, say: questionSpeech(st.q) }
    if (cmd === 'skip') return { next: st, say: 'Skipping this one.', outcome: { type: 'skip' } }
    if (cmd === 'hint') {
      const level = st.hintLevel + 1
      const hint = isMultipleChoice(st.q) ? (level === 1 ? studyHint(st.q, 1) : null) : studyHint(st.q, level)
      if (!hint) return { next: st, say: 'That’s all the hints I have. Give it your best try, or say I don’t know.' }
      return { next: { ...st, hintLevel: level }, say: `Hint: ${hint}` }
    }
    if (cmd === 'dontKnow') return reveal({ ...st, dontKnow: true, confidence: 0, attempt: '' })
    if (isMultipleChoice(st.q)) {
      const i = parseOptionLetter(text, st.q.options!.length)
      if (i == null) return { next: st, say: `Say a letter from A to ${LETTERS[st.q.options!.length - 1]}, or say hint.` }
      const o = st.q.options![i]
      return { next: { ...st, picked: o.key, attempt: o.text, stage: 'confidence' }, say: 'How sure are you, from 0 to 100?' }
    }
    if (!text.trim()) return { next: st, say: 'I didn’t catch that. Try again, or say hint.' }
    return { next: { ...st, attempt: text.trim(), stage: 'confidence' }, say: 'How sure are you, from 0 to 100?' }
  }
  if (st.stage === 'confidence') {
    const c = parseSpokenConfidence(text)
    const step = reveal({ ...st, confidence: c ?? 50 })
    return c == null ? { ...step, say: `I’ll put that at 50 percent. ${step.say}` } : step
  }
  const grade = parseSpokenGrade(text)
  if (!grade) return { next: st, say: ASK_GRADE }
  return { next: st, say: grade === 'good' ? 'Nice.' : grade === 'hard' ? 'Okay, partly.' : 'Okay, it’ll come back soon.', outcome: { type: 'grade', grade } }
}
