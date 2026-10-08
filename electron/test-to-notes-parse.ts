/**
 * Test to notes (#166) — pure parsers.
 *
 * Paste practice-test results as plain text or CSV and split them into
 * correct / incorrect items. Kept free of DB, LLM and Electron imports so the
 * renderer panel can parse live without dragging the main-process modules in.
 */
import type { TestToNotesItem } from './types'

/** Trim + cap each stored field so a pasted wall of text cannot bloat a prompt. */
export const MAX_TEST_FIELD_CHARS = 4000

/** Header cells a CSV first line may contain (case-insensitive). */
const CSV_COLUMNS = new Set(['question', 'answer', 'your answer', 'correct', 'correct answer', 'explanation'])

/**
 * Correctness marker scan for plain text (anywhere in a line).
 * Symbols first so “✓ (wrong)” still reads as correct. Word markers count only
 * when they stand at the end of a line (optionally in parens/brackets/dashes),
 * so a question like “Which statement is correct?” is never read as a correct
 * answer. Returns null when the text carries no marker.
 */
export function isCorrectMarker(text: string): boolean | null {
  const s = text ?? ''
  if (/[✓✔]|\[x\]/i.test(s)) return true
  if (/[✗✘]|\[\s?\]/.test(s)) return false
  if (/(?:^|[\s\-–—(\[])(?:correct|right)\s*[)\]]?\s*$/i.test(s)) return true
  if (/(?:^|[\s\-–—(\[])(?:incorrect|wrong)\s*[)\]]?\s*$/i.test(s)) return false
  return null
}

/**
 * Parse the `correct` column of a CSV row. Anchored so a stray word in a cell
 * does not flip the result. Returns null for an unrecognised/empty cell.
 */
export function parseCsvCorrectCell(value: string): boolean | null {
  const v = (value ?? '').trim()
  if (/^(y|yes|true|1|correct|right|✓|✔|x|\[x\])$/i.test(v)) return true
  if (/^(n|no|false|0|incorrect|wrong|✗|✘|\[ ?\])$/i.test(v)) return false
  return null
}

/** `1.`, `2)`, `Q3:` and `Question 4:`-style leading markers that start a new block. */
const NUMBER_PREFIX_RE = /^\s*(?:\d+\s*[.)]|Q\s*\d+\s*:)\s*/i
/** “Your answer:”, “Answer:”, “A:” (also en/em dash and hyphen). */
const ANSWER_PREFIX_RE = /^\s*(?:your\s+answer|answer|a)\s*[:：-]\s*(.*)$/i

function clampField(value: string): string {
  const trimmed = (value ?? '').trim()
  return trimmed.length > MAX_TEST_FIELD_CHARS ? trimmed.slice(0, MAX_TEST_FIELD_CHARS) : trimmed
}

/** Remove marker tokens a learner typed next to the question (e.g. “? ✓” / “(wrong)”). */
function stripQuestionMarkers(line: string): string {
  return line
    .replace(/^\s*[✓✔✗✘]\s*/, '')
    .replace(/\s*[✓✔✗✘]\s*$/, '')
    .replace(/\s*\[[x ]\]\s*$/i, '')
    .replace(/\s*\(?\b(?:correct|incorrect|right|wrong)\b\)?\s*$/i, '')
    .trim()
}

/**
 * Split a CSV line into cells, honouring double-quoted fields (with "" as an
 * escaped quote). Trailing/leading whitespace is trimmed from each cell.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells.map((c) => c.trim())
}

function parseCsvRows(raw: string, headerCells: string[]): TestToNotesItem[] {
  const questionIdx = headerCells.indexOf('question')
  const answerIdx = headerCells.findIndex((c) => c === 'answer' || c === 'your answer')
  const correctIdx = headerCells.indexOf('correct')
  const keyIdx = headerCells.indexOf('correct answer')
  const explanationIdx = headerCells.indexOf('explanation')

  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const items: TestToNotesItem[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const question = clampField(cells[questionIdx] ?? '')
    if (!question) continue
    const answer = answerIdx >= 0 ? clampField(cells[answerIdx] ?? '') : ''
    const correct =
      correctIdx >= 0 ? parseCsvCorrectCell(cells[correctIdx] ?? '') ?? false : false
    const item: TestToNotesItem = { question, answer, correct }
    const key = keyIdx >= 0 ? clampField(cells[keyIdx] ?? '') : ''
    if (key) item.correctAnswer = key
    const explanation = explanationIdx >= 0 ? clampField(cells[explanationIdx] ?? '') : ''
    if (explanation) item.explanation = explanation
    items.push(item)
  }
  return items
}

/** "Question 3 of 10   Incorrect": a results-page header that starts an item. */
const QUESTION_HEADER_RE = /^\s*question\s+\d+\s+(?:of|\/)\s*\d+\b/i
/** "Q12: B (correct: D)" / "Q1: 2 (correct: 4)": an answer-sheet line with no question text. */
const QLINE_RE = /^\s*Q(?:uestion)?\s*(\d+)\s*[:.)-]\s*([A-Za-z0-9]{1,3})\s*\(\s*(?:correct|key|answer)(?:\s+answer)?\s*[:=]\s*([A-Za-z0-9]{1,3})\s*\)\s*$/i
/** "  B. sfc /scannow   (Correct answer)" or "(2) chloroplast": one option per line. */
const OPTION_LINE_RE = /^\s*(?:([A-H])[.)]|\(([1-9A-Ha-h])\))\s+(.+)$/
/** "(1) mitochondrion (2) chloroplast (3) ribosome": several options on one line. */
const INLINE_OPTION_RE = /\(([1-9A-Ha-h])\)\s*([^()]+?)(?=\s*\([1-9A-Ha-h]\)|$)/g
const CORRECT_OPTION_RE = /\s*[(\[]\s*correct(?:\s+answer)?\s*[)\]]\s*$/i
/** "Explanation: …", "Why: …", "Rationale: …". */
const EXPLANATION_RE = /^\s*(?:explanation|rationale|why)\s*[:：-]\s*(.*)$/i
/** "Correct answer: D" on its own line. */
const KEY_LINE_RE = /^\s*(?:correct\s+answer|the\s+correct\s+answer\s+(?:is|was)|key)\s*[:：-]?\s*(.+)$/i
/** "(correct: D)" after the learner's answer. */
const INLINE_KEY_RE = /\s*\(\s*correct(?:\s+answer)?\s*[:=]\s*([^)]+)\)\s*/i

/** Remove marker tokens from a learner's answer ("(2) chloroplast ✓" → "(2) chloroplast"). */
function stripAnswerMarkers(value: string): string {
  return value
    .replace(/\s*[✓✔✗✘]\s*/g, ' ')
    .replace(/\s*\(?\b(?:correct|incorrect|right|wrong)\b\)?\s*$/i, '')
    .trim()
}

/** Split "(1) a (2) b" into ["(1) a", "(2) b"]; null when the line holds fewer than two. */
function inlineOptions(line: string): string[] | null {
  const found = [...line.matchAll(INLINE_OPTION_RE)].map((m) => `(${m[1]}) ${m[2].trim()}`)
  return found.length >= 2 ? found : null
}

/** The option label ("B", "2") and text ("sfc /scannow") of an option string. */
export function splitOption(option: string): { label: string; text: string } {
  const m = /^\s*(?:([A-Ha-h1-9])[.)]|\(([1-9A-Ha-h])\))\s*(.*)$/.exec(option ?? '')
  if (!m) return { label: '', text: (option ?? '').trim() }
  return { label: (m[1] ?? m[2] ?? '').toUpperCase(), text: m[3].trim() }
}

/**
 * Turn a letter or number answer into the option it names: "B" → "sfc /scannow"
 * when the options are known. Anything else is returned unchanged.
 */
export function resolveOption(answer: string, options?: string[]): string {
  const a = (answer ?? '').trim()
  if (!a || !options || options.length === 0) return a
  const label = /^\(?([A-Ha-h1-9])\)?[.)]?(?:\s|$)/.exec(a)?.[1]?.toUpperCase()
  if (!label) return a
  const hit = options.map(splitOption).find((o) => o.label === label)
  if (!hit) return a
  // "(2) chloroplast" already carries the text; keep the option's own wording.
  return hit.text
}

/** Parse "Q12: B (correct: D)" answer-sheet lines (question text missing). */
function parseAnswerSheet(lines: string[]): TestToNotesItem[] | null {
  const hits = lines.map((l) => QLINE_RE.exec(l)).filter((m): m is RegExpExecArray => !!m)
  if (hits.length < 2) return null
  return hits.map((m) => {
    const answer = m[2].toUpperCase()
    const correctAnswer = m[3].toUpperCase()
    return { question: `Question ${m[1]}`, answer, correctAnswer, correct: answer === correctAnswer, needsText: true }
  })
}

/**
 * Split plain text into blocks on blank lines and/or leading number markers
 * (`1.`, `1)`, `Q1:`, `Question 3 of 10`). Within a block the first line is
 * the question, an answer-prefixed line is the learner's answer, option lines
 * become `options` (one marked "(Correct answer)" is the key), an
 * "Explanation:" line is kept, and a correctness marker anywhere sets
 * `correct`. Unmarked items default to incorrect (the learner should still
 * review them). Header and junk blocks (a title, a score line) with no answer,
 * marker, options or question mark are dropped (#265).
 */
export function parsePlainText(raw: string): TestToNotesItem[] {
  const lines = raw.split('\n')
  const sheet = parseAnswerSheet(lines)
  if (sheet) return sheet

  const blocks: string[][] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) blocks.push(current)
    current = []
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (current.length > 0 && (NUMBER_PREFIX_RE.test(line) || QUESTION_HEADER_RE.test(line))) flush()
    current.push(line)
  }
  flush()

  const items: TestToNotesItem[] = []
  for (const block of blocks) {
    let start = 0
    let correct: boolean | null = null
    let numbered = NUMBER_PREFIX_RE.test(block[0])
    if (QUESTION_HEADER_RE.test(block[0])) {
      correct = isCorrectMarker(block[0])
      numbered = true
      start = 1
    }
    const questionLines: string[] = []
    const options: string[] = []
    let answer = ''
    let correctAnswer = ''
    let explanation = ''
    let inExplanation = false
    let hasAnswerLine = false
    for (let i = start; i < block.length; i++) {
      const line = block[i]
      const isFirst = questionLines.length === 0
      const marker = isCorrectMarker(line)
      const explanationMatch = EXPLANATION_RE.exec(line)
      const answerMatch = !isFirst ? ANSWER_PREFIX_RE.exec(line) : null
      const keyMatch = !isFirst ? KEY_LINE_RE.exec(line) : null
      const inline = !isFirst ? inlineOptions(line) : null
      const optionMatch = !isFirst && !inline ? OPTION_LINE_RE.exec(line) : null
      if (explanationMatch && !isFirst) {
        explanation = explanationMatch[1].trim()
        inExplanation = true
      } else if (keyMatch) {
        correctAnswer = stripAnswerMarkers(keyMatch[1])
        inExplanation = false
      } else if (answerMatch && !answer) {
        hasAnswerLine = true
        let value = answerMatch[1]
        const inlineKey = INLINE_KEY_RE.exec(value)
        if (inlineKey) {
          correctAnswer = inlineKey[1].trim()
          value = value.replace(INLINE_KEY_RE, ' ')
        }
        answer = clampField(stripAnswerMarkers(value))
        inExplanation = false
      } else if (inline) {
        options.push(...inline)
        inExplanation = false
      } else if (optionMatch) {
        const isKey = CORRECT_OPTION_RE.test(line)
        const label = optionMatch[1] ?? optionMatch[2]
        const text = optionMatch[3].replace(CORRECT_OPTION_RE, '').trim()
        const option = optionMatch[1] ? `${label}. ${text}` : `(${label}) ${text}`
        options.push(option)
        if (isKey) correctAnswer = text
        inExplanation = false
      } else if (inExplanation) {
        explanation = `${explanation} ${line.trim()}`.trim()
      } else if (isFirst) {
        questionLines.push(line)
      } else if (!answer && options.length === 0) {
        // A question that wraps onto a second line.
        questionLines.push(line)
      }
      if (marker !== null && !(optionMatch && CORRECT_OPTION_RE.test(line))) correct = marker
    }
    // A performance-based question (PBQ) description: the first line names the
    // task, the rest describes what happened (kept as the explanation).
    if (/^\s*PBQ\b/i.test(questionLines[0] ?? '') && questionLines.length > 1 && !explanation) {
      explanation = questionLines.slice(1).join(' ').replace(/\s+/g, ' ').trim()
      questionLines.splice(1)
    }
    const question = clampField(
      stripQuestionMarkers(questionLines.join(' ').replace(NUMBER_PREFIX_RE, '').replace(/\s+/g, ' ')),
    )
    if (!question) continue
    const looksLikeItem =
      numbered || hasAnswerLine || correct !== null || options.length > 0 || /\?\s*$/.test(question)
    if (!looksLikeItem) continue
    const item: TestToNotesItem = { question, answer, correct: correct ?? false }
    if (options.length > 0) item.options = options.map(clampField)
    if (correctAnswer) item.correctAnswer = clampField(resolveOption(correctAnswer, options))
    if (explanation) item.explanation = clampField(explanation)
    items.push(item)
  }
  return items
}

/**
 * Parse pasted practice-test results. CSV is used when the first non-empty
 * line is a header made only of `question` / `answer` / `correct` cells;
 * everything else is treated as plain text.
 */
export function parseTestResults(text: string): TestToNotesItem[] {
  const raw = (text ?? '').replace(/\r\n?/g, '\n')
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? ''
  const headerCells = splitCsvLine(firstLine).map((c) => c.toLowerCase())
  const nonEmpty = headerCells.filter((c) => c.length > 0)
  const isCsvHeader =
    nonEmpty.includes('question') && nonEmpty.every((c) => CSV_COLUMNS.has(c))
  return isCsvHeader ? parseCsvRows(raw, headerCells) : parsePlainText(raw)
}

/** Counts used by the panel summary line. */
export function summarizeAttempts(items: TestToNotesItem[]): {
  total: number
  correct: number
  wrong: number
} {
  let correct = 0
  for (const it of items ?? []) {
    if (it?.correct) correct++
  }
  const total = items?.length ?? 0
  return { total, correct, wrong: total - correct }
}
