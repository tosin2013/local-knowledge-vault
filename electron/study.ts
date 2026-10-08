/**
 * Study mode (#215) — recall-before-reveal attempts and calibration.
 *
 * The learner answers a question from their own notes before the grounded,
 * cited answer is revealed as feedback. Each attempt is stored so the panel can
 * show a calibration summary (mean confidence vs mean accuracy, bias, Brier).
 *
 * Every Vault-specific learning effect is a hypothesis; the pilot in #218
 * measures it. This module only records what the learner reported.
 */
import type {
  StudyAttempt,
  StudyAttemptInput,
  StudyCalibration,
  StudySelfGrade,
} from './types'
import { getDb, newId, nowIso } from './db'

/** Cap per free-text field so a wall of pasted text cannot bloat a row. */
export const MAX_STUDY_FIELD_CHARS = 4000

/** Self-grade as a 0..1 accuracy score: missed 0, partial 0.5, got 1. */
export function gradeScore(g: StudySelfGrade): number {
  if (g === 'got') return 1
  if (g === 'partial') return 0.5
  return 0
}

/** Round a supplied confidence to an integer within 0..100 (non-numbers → 0). */
export function clampConfidence(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

/** Coerce a value to a string and cap its length. */
function capText(value: unknown, cap = MAX_STUDY_FIELD_CHARS): string {
  const s = value == null ? '' : typeof value === 'string' ? value : String(value)
  return s.length > cap ? s.slice(0, cap) : s
}

/**
 * Calibration over a set of attempts. Empty input gives all zeros.
 * `meanConfidence` is 0..1 (confidence / 100); `meanScore` is 0..1.
 */
export function calibrationSummary(attempts: StudyAttempt[]): StudyCalibration {
  const list = Array.isArray(attempts) ? attempts : []
  const count = list.length
  if (count === 0) {
    return { count: 0, meanConfidence: 0, meanScore: 0, bias: 0, brier: 0 }
  }
  let confSum = 0
  let scoreSum = 0
  let brierSum = 0
  for (const a of list) {
    const conf = clampConfidence(a?.confidence) / 100
    const score = gradeScore(a?.self_grade)
    confSum += conf
    scoreSum += score
    brierSum += (conf - score) ** 2
  }
  const meanConfidence = confSum / count
  const meanScore = scoreSum / count
  return {
    count,
    meanConfidence,
    meanScore,
    bias: meanConfidence - meanScore,
    brier: brierSum / count,
  }
}

function rowToAttempt(row: Record<string, unknown>): StudyAttempt {
  return {
    id: String(row.id),
    question: String(row.question ?? ''),
    attempt: String(row.attempt ?? ''),
    confidence: clampConfidence(row.confidence),
    self_grade: row.self_grade as StudySelfGrade,
    self_explanation: row.self_explanation == null ? null : String(row.self_explanation),
    cited_ids: String(row.cited_ids ?? ''),
    answer: row.answer == null ? null : String(row.answer),
    created_at: String(row.created_at),
  }
}

/**
 * Persist one recall attempt. Confidence is clamped to 0–100, free-text fields
 * are capped, and cited ids are joined with commas.
 */
export function recordStudyAttempt(input: StudyAttemptInput): StudyAttempt {
  const attempt: StudyAttempt = {
    id: newId('att'),
    question: capText(input?.question),
    attempt: capText(input?.attempt),
    confidence: clampConfidence(input?.confidence),
    self_grade: input?.selfGrade ?? 'missed',
    self_explanation: input?.selfExplanation == null ? null : capText(input.selfExplanation),
    cited_ids: Array.isArray(input?.citedIds)
      ? input.citedIds.filter((id): id is string => typeof id === 'string').join(',')
      : '',
    answer: input?.answer == null ? null : capText(input.answer),
    created_at: nowIso(),
  }
  const opt = (v: unknown) => (v == null || v === '' ? null : String(v))
  getDb()
    .prepare(
      `INSERT INTO study_attempts
       (id, question, attempt, confidence, self_grade, self_explanation, cited_ids, answer, created_at,
        card_id, item_id, session_id, grade)
       VALUES (@id, @question, @attempt, @confidence, @self_grade, @self_explanation, @cited_ids, @answer, @created_at,
        @card_id, @item_id, @session_id, @grade)`,
    )
    .run({
      ...attempt,
      card_id: opt(input?.cardId),
      item_id: opt(input?.itemId),
      session_id: opt(input?.sessionId),
      grade: opt(input?.grade),
    })
  return attempt
}

/** Recent attempts, newest first. Same-millisecond rows break ties by rowid. */
export function listRecentAttempts(limit = 20): StudyAttempt[] {
  const n = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 20
  const rows = getDb()
    .prepare('SELECT * FROM study_attempts ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(n) as Record<string, unknown>[]
  return rows.map(rowToAttempt)
}

/** Calibration across the most recent 500 attempts. */
export function studyCalibration(): StudyCalibration {
  return calibrationSummary(listRecentAttempts(500))
}
