/**
 * Metadata filter + FTS5 BM25 search (trigram tokenizer: substring + CJK).
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
  const terms = tokenizeFts(text)
  if (terms.length === 0) return ''
  return terms.map((t) => `"${t}"`).join(' OR ')
}

/**
 * Minimum BM25 rank to keep a hit. FTS5 bm25() is ≤ 0 with larger (closer to
 * zero) meaning better; this floor drops only clearly-irrelevant matches (#37).
 */
const MIN_BM25 = -15

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
                0.0 AS score
         FROM items
         WHERE status != 'trashed'${sql}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[]

    return { hits: rows.map(mapHit) }
  }

  // Filter metadata first via subquery, then FTS on matching rowids
  const { sql: filterSql, params: filterParams } = buildFilterClause(filters)

  // Unconfirmed AI-draft notes (#137) never outrank confirmed notes or source
  // passages, so model text does not become authority merely by being saved.
  // Notes-first (#138): when sourcesLast is set, transcript (source) chunks also
  // rank after the user's own notes. Media chat passes sourcesLast=false to stay
  // transcript-first (it is chat with the video).
  const orderBy = input.sourcesLast
    ? "(i.kind = 'transcript' OR i.status = 'ai-draft'), score"
    : "(i.status = 'ai-draft'), score"

  const rows = database
    .prepare(
      `SELECT i.id, i.title, i.para, i.kind, i.project,
              snippet(items_fts, 2, '«', '»', '…', 24) AS snippet,
              bm25(items_fts) AS score
       FROM items_fts
       JOIN items i ON i.rowid = items_fts.rowid
       WHERE items_fts MATCH ?
         AND bm25(items_fts) > ?
         AND i.id IN (SELECT id FROM items WHERE status != 'trashed'${filterSql})
       ORDER BY ${orderBy}
       LIMIT ?`
    )
    .all(fts, MIN_BM25, ...filterParams, limit) as Record<string, unknown>[]

  return { hits: rows.map(mapHit) }
}

function mapHit(row: Record<string, unknown>): SearchHit {
  return {
    id: String(row.id),
    title: String(row.title),
    snippet: String(row.snippet ?? ''),
    score: Number(row.score ?? 0),
    para: row.para as SearchHit['para'],
    kind: String(row.kind),
    project: row.project == null ? null : String(row.project),
  }
}

/** Re-export for tests */
export type { ItemFilters }
