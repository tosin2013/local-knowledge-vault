/**
 * Two-way cards for list-like notes (#273): acronym lists, port tables,
 * command lists and term definitions. Pattern-based, no model.
 *
 * - Markdown table rows become `first cell → the other cells`, labelled with
 *   the header row.
 * - `TERM - def`, `TERM: def`, `TERM = def`, `TERM — def` lines become pairs
 *   when TERM is at most 5 words. Headings, URLs, frontmatter and blank lines
 *   are ignored; label words such as "Example:" or "Tip:" are not terms.
 * - A note is list-like when at least {@link LIST_LIKE_MIN_RATIO} of its
 *   content lines are pairs (and it has at least {@link LIST_LIKE_MIN_PAIRS}).
 *   Only list-like notes get pair cards; other notes keep generated questions.
 *
 * Each pair makes a forward card (`AES → ?`) and, unless its back is shared by
 * another pair, a reverse card (`Advanced Encryption Standard → ?`). Cards are
 * ordinary `study_cards` rows: origin `reverse`, `q_kind = 'pair'`, the source
 * line as the quote, and a stable `source_key` per term and direction, so an
 * edit keeps unchanged pairs' schedules and retires pairs whose line is gone.
 */
import { getDb, newId, nowIso } from './db'
import { hashText } from './text-hash'

export const LIST_LIKE_MIN_RATIO = 0.6
export const LIST_LIKE_MIN_PAIRS = 3
/** Words of prose outside the pairs that still deserve a section card. */
export const PROSE_SECTION_MIN_WORDS = 30
export const MAX_TERM_WORDS = 5

export type PairSource = 'line' | 'table'

export interface ExtractedPair {
  source: PairSource
  term: string
  definition: string
  /** The source line as written (the quote on the card). */
  line: string
  /** Table rows: the header row's labels (first is the term's label). */
  header?: string[]
  /** Table rows: the other cells, one per header label. */
  cells?: string[]
}

export interface PairExtraction {
  pairs: ExtractedPair[]
  /** Content lines considered (blank lines, headings, URLs, frontmatter, table header/separator rows excluded). */
  lines: number
  /** pairs.length / lines (0 when there are no lines). */
  ratio: number
  listLike: boolean
  /** Content words on lines that are not pairs. */
  proseWords: number
}

const LINE_PAIR_RE =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\**([A-Za-z0-9][\w/().+#' ]{0,40}?)\**\s*(?: - | — | – |: |= )\s*(.{3,200})$/
const TABLE_SEPARATOR_CELL = /^:?-{2,}:?$/
const BODY_HEADER_LINE = /^(source|page|pages|url|fetched|imported|author)s?:/i
/** Labels people put before a colon that are not terms ("Example: …", "Tip: …"). */
const LABEL_WORDS = new Set(
  (
    'example examples eg e.g ex note notes nb tip tips trick tricks hint hints remember reminder evidence why how ' +
    'what summary key important warning todo also see ps update updated share related mnemonic answer question ' +
    'q a result results score date time'
  ).split(' '),
)

function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== '---') return lines
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  return end > 0 ? lines.slice(end + 1) : lines
}

function cleanCell(cell: string): string {
  return cell.replace(/\*\*|__|`/g, '').trim()
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
}

/** Pairs in a note body and whether the note is list-like. Pure. */
export function extractPairs(body: string): PairExtraction {
  const lines = stripFrontmatter((body ?? '').split(/\r?\n/))
  const pairs: ExtractedPair[] = []
  let counted = 0
  let proseWords = 0
  let header: string[] | null = null

  for (const raw of lines) {
    const s = raw.trim()
    if (!s.startsWith('|')) header = null
    if (!s || /^#{1,6}\s/.test(s) || /^(?:-{3,}|\*{3,}|_{3,})$/.test(s)) continue
    if (/https?:\/\//i.test(s) || BODY_HEADER_LINE.test(s)) continue

    if (s.startsWith('|') && s.endsWith('|') && s.length > 1) {
      const cells = s.slice(1, -1).split('|').map(cleanCell)
      if (cells.every((c) => TABLE_SEPARATOR_CELL.test(c))) continue
      if (!header) {
        header = cells
        continue
      }
      counted++
      if (cells.length >= 2 && cells[0] && cells.slice(1).some((c) => c)) {
        const labels = header.slice(1)
        const rest = cells.slice(1)
        pairs.push({
          source: 'table',
          term: cells[0],
          definition: rest
            .map((c, i) => (labels[i] ? `${labels[i]}: ${c}` : c))
            .filter((x) => !/:\s*$/.test(x))
            .join('; '),
          line: s,
          header,
          cells: rest,
        })
      } else {
        proseWords += wordsOf(cells.join(' ')).length
      }
      continue
    }

    counted++
    const m = LINE_PAIR_RE.exec(s)
    const term = m ? m[1].trim() : ''
    const label = term.toLowerCase().replace(/[.:]+$/, '')
    if (m && term && term.split(/\s+/).length <= MAX_TERM_WORDS && !LABEL_WORDS.has(label)) {
      pairs.push({ source: 'line', term, definition: m[2].trim(), line: s })
    } else {
      proseWords += wordsOf(s).length
    }
  }
  const ratio = counted === 0 ? 0 : pairs.length / counted
  return {
    pairs,
    lines: counted,
    ratio,
    listLike: pairs.length >= LIST_LIKE_MIN_PAIRS && ratio >= LIST_LIKE_MIN_RATIO,
    proseWords,
  }
}

/** True for "AES - Advanced Encryption Standard"-style pairs. */
export function isAcronymPair(term: string, definition: string): boolean {
  // AES, BIOS, I/O, NVMe, PoE: starts with a capital and has at least two.
  if (!/^[A-Z][A-Za-z0-9/&+-]{1,7}$/.test(term) || (term.match(/[A-Z]/g) ?? []).length < 2) return false
  const first = definition.replace(/^[^A-Za-z]+/, '')[0]
  return !!first && first.toUpperCase() === term[0] && /^[A-Z]/.test(definition.replace(/^[^A-Za-z]+/, ''))
}

export type PairDirection = 'f' | 'r'

export interface PairCardSpec {
  key: string
  direction: PairDirection
  question: string
  answer: string
  quote: string
  /** Hash of the question and answer (an edit changes it). */
  hash: string
}

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** True when the reverse question gives its own answer away ("vacuole" in the Vacuole definition). */
function leaksTerm(term: string, question: string): boolean {
  const t = normalizeTerm(term)
  if (!t) return true
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(question)
}

function reverseFront(pair: ExtractedPair): { question: string; back: string } | null {
  if (pair.source === 'table') {
    const label0 = (pair.header?.[0] ?? '').trim()
    const label1 = (pair.header?.[1] ?? '').trim()
    const value = (pair.cells?.[0] ?? '').trim()
    if (!value) return null
    if (/^ports?$/i.test(label0)) return { question: `${value} uses which port?`, back: value }
    const what = label0 ? label0.toLowerCase() : 'entry'
    return { question: label1 ? `Which ${what} goes with ${label1} “${value}”?` : `Which ${what} goes with “${value}”?`, back: value }
  }
  if (isAcronymPair(pair.term, pair.definition)) {
    return { question: `What is the acronym for ${pair.definition}?`, back: pair.definition }
  }
  return { question: `Name the term: “${pair.definition}”`, back: pair.definition }
}

function forwardFront(pair: ExtractedPair): string {
  if (pair.source === 'table') {
    const label0 = (pair.header?.[0] ?? '').trim()
    return `${label0 ? `${label0} ` : ''}${pair.term} → ?`
  }
  if (isAcronymPair(pair.term, pair.definition)) return `What does ${pair.term} stand for?`
  return `${pair.term} → ?`
}

/**
 * The cards for a note's pairs, forward cards first (in list order), then
 * reverse cards. A reverse card is left out when its back (for example the
 * protocol) is shared by another pair, since it would have two right answers.
 * Pure.
 */
export function pairCardSpecs(itemId: string, pairs: ExtractedPair[]): PairCardSpec[] {
  const seen = new Map<string, number>()
  const keyed = pairs.map((pair) => {
    const norm = normalizeTerm(pair.term)
    const n = (seen.get(norm) ?? 0) + 1
    seen.set(norm, n)
    return { pair, base: `pair:${itemId}:${hashText(n > 1 ? `${norm}#${n}` : norm)}` }
  })
  const backs = new Map<string, number>()
  for (const { pair } of keyed) {
    const r = reverseFront(pair)
    if (r) backs.set(normalizeTerm(r.back), (backs.get(normalizeTerm(r.back)) ?? 0) + 1)
  }
  const forward: PairCardSpec[] = []
  const reverse: PairCardSpec[] = []
  for (const { pair, base } of keyed) {
    const fq = forwardFront(pair)
    forward.push({
      key: `${base}:f`,
      direction: 'f',
      question: fq,
      answer: pair.definition,
      quote: pair.line,
      hash: hashText(`${fq}\n${pair.definition}`),
    })
    const r = reverseFront(pair)
    if (r && (backs.get(normalizeTerm(r.back)) ?? 0) === 1 && !leaksTerm(pair.term, r.question)) {
      reverse.push({
        key: `${base}:r`,
        direction: 'r',
        question: r.question,
        answer: pair.term,
        quote: pair.line,
        hash: hashText(`${r.question}\n${pair.term}`),
      })
    }
  }
  return [...forward, ...reverse]
}

export interface PairCardsResult {
  /** Card ids created by this call. */
  created: string[]
  /** Pairs found in the note. */
  pairs: number
  listLike: boolean
  /** Words of prose outside the pairs (enough of it also gets section cards). */
  proseWords: number
}

const INSERT_PAIR_CARD = `INSERT OR IGNORE INTO study_cards
   (id, item_id, chunk_index, chunk_hash, note_hash, origin, question, answer, quote, source_key, priority, status,
    q_kind, q_source_hash, q_at, created_at, updated_at)
 VALUES (@id, @item_id, NULL, @chunk_hash, @note_hash, 'reverse', @question, @answer, @quote, @source_key, 0, 'active',
    'pair', @hash, @ts, @ts, @ts)`
const INSERT_SCHEDULE = `INSERT OR IGNORE INTO card_schedule
   (card_id, due_at, interval_days, ease, reps, lapses, last_grade, last_reviewed_at, created_at, updated_at)
 VALUES (?, ?, 0, 2.5, 0, 0, NULL, NULL, ?, ?)`

/**
 * Create the pair cards for a list-like note (#273). Idempotent by
 * `source_key`; a note that isn't list-like gets none. Returns what it did.
 */
export function createPairCards(itemId: string): PairCardsResult {
  const database = getDb()
  const item = database.prepare('SELECT id, body FROM items WHERE id = ?').get(itemId) as
    | { id: string; body: string }
    | undefined
  if (!item) throw new Error(`Note not found: ${itemId}`)
  const ex = extractPairs(item.body)
  const result: PairCardsResult = { created: [], pairs: ex.pairs.length, listLike: ex.listLike, proseWords: ex.proseWords }
  if (!ex.listLike) return result
  const ts = nowIso()
  const noteHash = hashText(item.body)
  const insertCard = database.prepare(INSERT_PAIR_CARD)
  const insertSchedule = database.prepare(INSERT_SCHEDULE)
  database.transaction(() => {
    for (const spec of pairCardSpecs(itemId, ex.pairs)) {
      const id = newId('crd')
      const res = insertCard.run({
        id,
        item_id: itemId,
        chunk_hash: hashText(spec.quote),
        note_hash: noteHash,
        question: spec.question,
        answer: spec.answer,
        quote: spec.quote,
        source_key: spec.key,
        hash: spec.hash,
        ts,
      })
      if (res.changes > 0) {
        insertSchedule.run(id, ts, ts, ts)
        result.created.push(id)
      }
    }
  })()
  return result
}

export interface PairSyncResult {
  kept: number
  updated: number
  added: number
  retired: number
}

/**
 * Re-extract a note's pairs after an edit (#273). Unchanged pairs keep their
 * card and schedule; a pair whose wording changed keeps its schedule and gets
 * the new question and answer; pairs whose line is gone are retired (history
 * kept); new pairs are added while the note is still list-like. Notes with no
 * pair cards are left alone.
 */
export function syncPairCards(itemId: string): PairSyncResult {
  const database = getDb()
  const result: PairSyncResult = { kept: 0, updated: 0, added: 0, retired: 0 }
  const rows = database
    .prepare(`SELECT id, source_key, q_source_hash, status FROM study_cards WHERE item_id = ? AND origin = 'reverse'`)
    .all(itemId) as Array<{ id: string; source_key: string; q_source_hash: string | null; status: string }>
  if (rows.length === 0) return result
  const item = database.prepare('SELECT body FROM items WHERE id = ?').get(itemId) as { body: string } | undefined
  if (!item) return result
  const ex = extractPairs(item.body)
  const specs = pairCardSpecs(itemId, ex.pairs)
  const byKey = new Map(rows.map((r) => [r.source_key, r]))
  const wanted = new Set(specs.map((s) => s.key))
  const ts = nowIso()
  const noteHash = hashText(item.body)

  const keep = database.prepare(`UPDATE study_cards SET status = 'active', note_hash = ?, updated_at = ? WHERE id = ?`)
  const update = database.prepare(
    `UPDATE study_cards SET question = ?, answer = ?, quote = ?, chunk_hash = ?, q_source_hash = ?, q_at = ?,
       note_hash = ?, status = CASE WHEN status = 'retired' THEN 'active' ELSE status END, updated_at = ?
     WHERE id = ?`,
  )
  const retire = database.prepare(`UPDATE study_cards SET status = 'retired', updated_at = ? WHERE id = ?`)
  const insertCard = database.prepare(INSERT_PAIR_CARD)
  const insertSchedule = database.prepare(INSERT_SCHEDULE)
  database.transaction(() => {
    for (const spec of specs) {
      const row = byKey.get(spec.key)
      if (row) {
        if (row.q_source_hash === spec.hash) {
          if (row.status === 'retired') keep.run(noteHash, ts, row.id)
          result.kept++
        } else {
          update.run(spec.question, spec.answer, spec.quote, hashText(spec.quote), spec.hash, ts, noteHash, ts, row.id)
          result.updated++
        }
        continue
      }
      if (!ex.listLike) continue
      const id = newId('crd')
      const res = insertCard.run({
        id,
        item_id: itemId,
        chunk_hash: hashText(spec.quote),
        note_hash: noteHash,
        question: spec.question,
        answer: spec.answer,
        quote: spec.quote,
        source_key: spec.key,
        hash: spec.hash,
        ts,
      })
      if (res.changes > 0) {
        insertSchedule.run(id, ts, ts, ts)
        result.added++
      }
    }
    for (const row of rows) {
      if (!wanted.has(row.source_key) && row.status !== 'retired') {
        retire.run(ts, row.id)
        result.retired++
      }
    }
  })()
  return result
}
