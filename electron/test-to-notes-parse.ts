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
const CSV_COLUMNS = new Set(['question', 'answer', 'your answer', 'correct'])

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

  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const items: TestToNotesItem[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const question = clampField(cells[questionIdx] ?? '')
    if (!question) continue
    const answer = answerIdx >= 0 ? clampField(cells[answerIdx] ?? '') : ''
    const correct =
      correctIdx >= 0 ? parseCsvCorrectCell(cells[correctIdx] ?? '') ?? false : false
    items.push({ question, answer, correct })
  }
  return items
}

/**
 * Split plain text into blocks on blank lines and/or leading number markers
 * (`1.`, `1)`, `Q1:`). Within a block the first line is the question, an
 * answer-prefixed line is the learner's answer, and a correctness marker
 * anywhere sets `correct`. Unmarked items default to incorrect (the learner
 * should still review them).
 */
export function parsePlainText(raw: string): TestToNotesItem[] {
  const lines = raw.split('\n')
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
    if (current.length > 0 && NUMBER_PREFIX_RE.test(line)) flush()
    current.push(line)
  }
  flush()

  const items: TestToNotesItem[] = []
  for (const block of blocks) {
    const question = clampField(stripQuestionMarkers(block[0].replace(NUMBER_PREFIX_RE, '')))
    if (!question) continue
    let answer = ''
    let correct: boolean | null = null
    for (let i = 0; i < block.length; i++) {
      const line = block[i]
      if (i > 0 && !answer) {
        const m = ANSWER_PREFIX_RE.exec(line)
        if (m) answer = clampField(m[1])
      }
      const marker = isCorrectMarker(line)
      if (marker !== null) correct = marker
    }
    items.push({ question, answer, correct: correct ?? false })
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
