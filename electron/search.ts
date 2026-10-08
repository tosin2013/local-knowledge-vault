/**
 * Metadata filter + FTS5 BM25 search (trigram tokenizer: substring + CJK).
 * Long notes are also searched at chunk level (#219) and the two ranked lists
 * are fused with Reciprocal Rank Fusion so a relevant section inside a long
 * note still surfaces the note.
 */
import type { ItemFilters, SearchHit, SearchQueryInput, SearchQueryResult } from './types'
import { buildFilterClause, getDb } from './db'

/**
 * Words too common to be useful retrieval terms. Dropping these is what makes
 * "I couldn't find that in your notes" actually fire for off-topic questions
 * instead of OR-matching every stopword (`it's` → `"s"*`) (#37).
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'or', 'but', 'if', 'then', 'else', 'so', 'for', 'nor', 'yet',
  'of', 'in', 'on', 'at', 'to', 'from', 'by', 'with', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'against', 'between',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'having', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'can', 'could',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'them', 'me', 'him', 'her', 'us',
  'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'not', 'no', 'yes', 'there', 'here', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very', 'just',
  'than', 'as', 'because', 'also',
])

/** RRF smoothing constant: larger de-emphasises rank differences between lists. */
const RRF_K = 60

/**
 * Turn user text into safe FTS5 query terms. Lowercases, strips FTS special
 * characters, then drops stopwords. Terms shorter than 3 characters are kept:
 * the trigram tokenizer matches nothing for them (it never errors), and keeping
 * them means a short query like "it's" yields "no results" instead of degrading
 * to an empty query that would list every note (#37).
 */
export function tokenizeFts(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .replace(/["'*(){}[\]^:~]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !STOPWORDS.has(t))
}

/**
 * Convert user text into a safe FTS5 MATCH query. Every term is quoted so a
 * token can never inject an FTS5 operator (e.g. "foo-bar" or "AND"), and joined
 * with OR so a note matching any term still ranks (recall preserved for #138).
 */
export function buildFtsQuery(text: string): string {
  // Deduplicate: chat merges earlier turns into the query, and a repeated term
  // would count once per repeat in the BM25 score (#196).
  const terms = [...new Set(tokenizeFts(text))]
  if (terms.length === 0) return ''
  return terms.map((t) => `"${t}"`).join(' OR ')
}

interface Candidate {
  id: string
  title: string
  para: SearchHit['para']
  kind: string
  project: string | null
  status: string
  snippet: string
  /** Raw BM25 (lower is better) — kept for the advanced score readout. */
  score: number
  /** Full matching chunk text when the note matched at chunk level. */
  passage?: string
}

function mapCandidate(row: Record<string, unknown>): Candidate {
  return {
    id: String(row.id),
    title: String(row.title),
    para: row.para as SearchHit['para'],
    kind: String(row.kind),
    project: row.project == null ? null : String(row.project),
    status: String(row.status),
    snippet: String(row.snippet ?? ''),
    score: Number(row.score ?? 0),
    passage: row.passage == null ? undefined : String(row.passage),
  }
}

function demoteExpr(sourcesLast?: boolean): string {
  // Unconfirmed AI-draft notes (#137) never outrank confirmed notes or source
  // passages, so model text does not become authority merely by being saved.
  // Notes-first (#138): transcript chunks also demote when sourcesLast is set.
  return sourcesLast
    ? "(i.kind = 'transcript' OR i.status = 'ai-draft')"
    : "(i.status = 'ai-draft')"
}

/** Keep only the best chunk per item (chunks arrive ranked by BM25). */
function dedupeByItem(list: Candidate[]): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const c of list) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

export function searchQuery(input: SearchQueryInput): SearchQueryResult {
  const database = getDb()
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
  const filters = input.filters
  const fts = buildFtsQuery(input.text ?? '')

  // Empty text → list by filters only (no BM25 score)
  if (!fts) {
    const { sql, params } = buildFilterClause(filters)
    const rows = database
      .prepare(
        `SELECT id, title, para, kind, project,
                substr(COALESCE(summary, body), 1, 160) AS snippet,
                0.0 AS score, status
         FROM items
         WHERE status != 'trashed'${sql}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[]

    return { hits: rows.map((r) => toHit(mapCandidate(r))) }
  }

  // Filter metadata first via subquery, then FTS on matching rowids
  const { sql: filterSql, params: filterParams } = buildFilterClause(filters)
  const demote = demoteExpr(input.sourcesLast)

  // Note-level matches (title / summary / body).
  const noteRows = database
    .prepare(
      `SELECT i.id, i.title, i.para, i.kind, i.project, i.status,
              snippet(items_fts, 2, '«', '»', '…', 24) AS snippet,
              bm25(items_fts) AS score
       FROM items_fts
       JOIN items i ON i.rowid = items_fts.rowid
       WHERE items_fts MATCH ?
         AND i.id IN (SELECT id FROM items WHERE status != 'trashed'${filterSql})
       ORDER BY ${demote}, bm25(items_fts)
       LIMIT ?`
    )
    .all(fts, ...filterParams, limit) as Record<string, unknown>[]

  // Chunk-level matches (a relevant section inside a long note).
  const chunkRows = database
    .prepare(
      `SELECT i.id, i.title, i.para, i.kind, i.project, i.status,
              nc.body AS passage,
              snippet(note_chunks_fts, 0, '«', '»', '…', 24) AS snippet,
              bm25(note_chunks_fts) AS score
       FROM note_chunks_fts
       JOIN note_chunks nc ON nc.rowid = note_chunks_fts.rowid
       JOIN items i ON i.id = nc.item_id
       WHERE note_chunks_fts MATCH ?
         AND i.id IN (SELECT id FROM items WHERE status != 'trashed'${filterSql})
       ORDER BY ${demote}, bm25(note_chunks_fts)
       LIMIT ?`
    )
    .all(fts, ...filterParams, limit) as Record<string, unknown>[]

  const noteList = noteRows.map(mapCandidate)
  const chunkList = dedupeByItem(chunkRows.map(mapCandidate))

  // Reciprocal rank fusion over the two lists.
  const rrf = new Map<string, number>()
  noteList.forEach((c, rank) => rrf.set(c.id, (rrf.get(c.id) ?? 0) + 1 / (RRF_K + rank)))
  chunkList.forEach((c, rank) => rrf.set(c.id, (rrf.get(c.id) ?? 0) + 1 / (RRF_K + rank)))

  // Prefer chunk-level snippet/passage when a note matched in both lists.
  const byId = new Map<string, Candidate>()
  for (const c of noteList) byId.set(c.id, c)
  for (const c of chunkList) {
    const existing = byId.get(c.id)
    if (existing) {
      existing.snippet = c.snippet
      existing.passage = c.passage
    } else {
      byId.set(c.id, c)
    }
  }

  const merged = [...rrf.entries()].map(([id, rrfScore]) => ({ ...byId.get(id)!, rrf: rrfScore }))
  const isDemoted = (c: Candidate) =>
    c.status === 'ai-draft' || (input.sourcesLast && c.kind === 'transcript')
  merged.sort((a, b) => {
    const aDemoted = isDemoted(a) ? 1 : 0
    const bDemoted = isDemoted(b) ? 1 : 0
    if (aDemoted !== bDemoted) return aDemoted - bDemoted
    return b.rrf - a.rrf
  })

  return { hits: merged.slice(0, limit).map(toHit) }
}

function toHit(c: Candidate): SearchHit {
  const hit: SearchHit = {
    id: c.id,
    title: c.title,
    snippet: c.snippet,
    score: c.score,
    para: c.para,
    kind: c.kind,
    project: c.project,
  }
  if (c.passage !== undefined) hit.passage = c.passage
  return hit
}

/** Re-export for tests */
export type { ItemFilters }
