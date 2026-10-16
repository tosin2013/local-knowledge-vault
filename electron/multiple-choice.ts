/**
 * Multiple-choice practice-test questions (#324).
 *
 * An imported practice-test item with two or more options and a correct answer
 * that names one of them is asked the way the exam asks it: as multiple
 * choice. The option the learner picks is logged on every attempt, a wrong pick
 * is graded Missed automatically (so missed-first ordering, #264, brings it
 * back first), and the next reveal says which wrong answer was picked last
 * time. After {@link MC_PROMOTE_AFTER} correct answers in a row the card is
 * asked as free recall with the options hidden; missing the free-recall version
 * drops it back to multiple choice.
 *
 * Basis (docs/local-knowledge-vault-study-effects-on-learning.md §2): recall
 * tests give larger benefits than recognition tests (Rowland 2014), so a card
 * moves on to recall once it is answered right; feedback after a multiple-choice
 * test sharply reduces later intrusion of wrong options (Butler & Roediger
 * 2008), so every wrong pick is named and corrected on the next reveal. Asking
 * an exam's multiple-choice items in its own format is an inference from exam
 * prep, and every Vault-specific effect is a hypothesis (#218).
 *
 * Generated note questions never use this mode: only imported items carry
 * options.
 */
import { getDb } from './db'
import { splitOption } from './test-to-notes-parse'
import type { McOption, RepeatedPick, ReviewGrade, TestToNotesItem } from './types'

/** Correct multiple-choice answers in a row before the card is asked as free recall. */
export const MC_PROMOTE_AFTER = 2

const LETTERS = 'ABCDEFGH'

function norm(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\(correct(?: answer)?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The options and answer key of an item, or null when it isn't multiple
 * choice: fewer than two options, or a correct answer (the key, else the
 * learner's own answer on an item marked correct) that names none of them.
 * Unlabelled options get positional letters.
 */
export function mcFromItem(item: TestToNotesItem): { options: McOption[]; answer: string } | null {
  const raw = (item?.options ?? []).map((o) => String(o ?? '').trim()).filter(Boolean)
  if (raw.length < 2 || raw.length > LETTERS.length) return null
  const seen = new Set<string>()
  const options: McOption[] = raw.map((o, i) => {
    const { label, text } = splitOption(o)
    let key = label || LETTERS[i]
    if (seen.has(key)) key = LETTERS[i]
    seen.add(key)
    return { key, text: text.replace(/\s*\(correct(?: answer)?\)\s*$/i, '').trim() }
  })
  if (options.some((o) => !o.text)) return null
  const pick = (value: string | undefined): string | null => {
    const v = (value ?? '').trim()
    if (!v) return null
    const label = /^\(?([A-Ha-h1-9])\)?(?:[.):]|\s|$)/.exec(v)?.[1]?.toUpperCase()
    if (label) {
      const byKey = options.find((o) => o.key === label)
      if (byKey) return byKey.key
    }
    const n = norm(splitOption(v).text || v)
    const byText = options.find((o) => norm(o.text) === n)
    return byText?.key ?? null
  }
  const answer = pick(item.correctAnswer) ?? (item.correct ? pick(item.answer) : null)
  return answer ? { options, answer } : null
}

/** Parse stored options; anything unreadable is treated as "not multiple choice". */
export function parseOptions(json: string | null | undefined): McOption[] | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as unknown
    if (!Array.isArray(v)) return null
    const out = v
      .filter((o): o is McOption => !!o && typeof o.key === 'string' && typeof o.text === 'string')
      .map((o) => ({ key: o.key, text: o.text }))
    return out.length >= 2 ? out : null
  } catch {
    return null
  }
}

/** Options whose meaning depends on their position ("All of the above", "Both A and B"). */
const POSITIONAL_RE = /\b(?:all|none|both|neither) of the (?:above|below|preceding)\b|\b(?:both|either|neither) [A-H] (?:and|or|nor) [A-H]\b|^(?:both|neither)\b|\bonly [A-H](?: and [A-H])?\b/i

/** True when shuffling would change what an option means. */
export function hasPositionalOption(options: McOption[]): boolean {
  return options.some((o) => POSITIONAL_RE.test(o.text))
}

/**
 * The options in the order to show them on this review: shuffled (Fisher-Yates)
 * so the answer is remembered rather than its letter, unless an option refers
 * to the others by position.
 */
export function shuffleOptions(options: McOption[], rand: () => number = Math.random): McOption[] {
  const out = options.slice()
  if (hasPositionalOption(options)) return out
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** A crude stem, so "disable" matches "disabling" and "scan" matches "scans". */
function stem(w: string): string {
  return w.length > 5 ? w.slice(0, 5) : w.replace(/s$/, '')
}

function contentWords(s: string): string[] {
  return norm(s)
    .split(' ')
    .filter((w) => w.length > 2 && !STOP.has(w))
}
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'not', 'its', 'into', 'than', 'then'])

/**
 * One line from the cited source (the test's explanation, or the learner's
 * confirmed note) that mentions a wrong option, so the reveal can say why it
 * is wrong. Returns null when no sentence names it: Vault never invents one.
 */
export function whyWrongLine(optionText: string, sources: Array<string | null | undefined>): string | null {
  const want = contentWords(optionText).map(stem)
  if (want.length === 0) return null
  const whole = norm(optionText)
  for (const src of sources) {
    // Lines first (notes are often bullets), then sentences; list-like lines
    // ("phishing, vishing, smishing, …") name the option without saying why.
    const sentences = (src ?? '')
      .split(/\n+/)
      .map((l) => l.replace(/^\s*(?:[-*•>]|#+|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
      .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/))
      .map((s) => s.trim())
      .filter((s) => s && (s.match(/,/g)?.length ?? 0) <= 3 && !s.startsWith('|'))
    for (const s of sentences) {
      const n = ` ${norm(s)} `
      const words = new Set(contentWords(s).map(stem))
      const hits = want.filter((w) => words.has(w)).length
      if ((whole.length > 2 && n.includes(` ${whole} `)) || hits >= Math.max(1, Math.ceil(want.length * 0.75))) {
        return s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s
      }
    }
  }
  return null
}

export type McMode = 'mc' | 'recall'

/** How a card with options is asked now. */
export function mcMode(streak: number, enabled: boolean): McMode {
  return enabled && streak < MC_PROMOTE_AFTER ? 'mc' : 'recall'
}

/**
 * The streak after an answer. Asked as multiple choice: a correct pick graded
 * Got it adds one, anything else (a wrong pick, or a correct pick marked as a
 * guess) resets it. Asked as free recall after promotion: a miss drops the card
 * back to multiple choice (0); anything else keeps it in recall.
 */
export function nextStreak(prev: number, mode: McMode, grade: ReviewGrade, correctPick: boolean | null): number {
  if (mode === 'mc') return correctPick && (grade === 'good' || grade === 'easy') ? prev + 1 : 0
  if (prev < MC_PROMOTE_AFTER) return prev
  return grade === 'again' ? 0 : prev
}

/**
 * "Answers you keep picking": wrong options picked more than once on the same
 * card, most-picked first. Scoped to a project, or to a set of cards (a
 * session); only live, active cards.
 */
export function listRepeatedPicks(opts: { project?: string; cardIds?: string[]; limit?: number } = {}): RepeatedPick[] {
  const p = opts.project?.trim()
  const ids = opts.cardIds
  if (ids && ids.length === 0) return []
  const params: unknown[] = []
  let where = `l.chosen_option IS NOT NULL AND c.mc_answer IS NOT NULL AND l.chosen_option != c.mc_answer
    AND c.status = 'active' AND i.status NOT IN ('trashed','archived')`
  if (p) {
    where += ' AND i.project = ?'
    params.push(p)
  }
  if (ids) {
    where += ` AND c.id IN (${ids.map(() => '?').join(',')})`
    params.push(...ids)
  }
  const rows = getDb()
    .prepare(
      `SELECT c.id AS card_id, c.item_id, c.question, c.mc_options, c.mc_answer, l.chosen_option,
              COUNT(*) AS times, MAX(l.reviewed_at) AS last_at
       FROM review_log l
       JOIN study_cards c ON c.id = l.card_id
       JOIN items i ON i.id = c.item_id
       WHERE ${where}
       GROUP BY c.id, l.chosen_option
       HAVING COUNT(*) > 1
       ORDER BY times DESC, last_at DESC
       LIMIT ?`,
    )
    .all(...params, Math.max(1, opts.limit ?? 10)) as Array<Record<string, unknown>>
  const out: RepeatedPick[] = []
  for (const r of rows) {
    const options = parseOptions(r.mc_options as string | null)
    const chosen = options?.find((o) => o.key === r.chosen_option)
    const answer = options?.find((o) => o.key === r.mc_answer)
    if (!chosen || !answer) continue
    out.push({
      cardId: String(r.card_id),
      itemId: String(r.item_id),
      question: String(r.question ?? ''),
      picked: chosen.text,
      answer: answer.text,
      times: Number(r.times),
    })
  }
  return out
}

/** The most recent wrong pick on a card, and whether it was the card's latest multiple-choice attempt. */
export function lastWrongPick(cardId: string, answerKey: string): { key: string; latest: boolean } | null {
  const rows = getDb()
    .prepare(
      `SELECT chosen_option FROM review_log WHERE card_id = ? AND chosen_option IS NOT NULL
       ORDER BY reviewed_at DESC, rowid DESC LIMIT 20`,
    )
    .all(cardId) as Array<{ chosen_option: string }>
  const i = rows.findIndex((r) => r.chosen_option !== answerKey)
  return i < 0 ? null : { key: rows[i].chosen_option, latest: i === 0 }
}
