/**
 * Metadata filter + FTS5 BM25 search.
 */
import type { ItemFilters, SearchHit, SearchQueryInput, SearchQueryResult } from './types'
import { buildFilterClause, getDb } from './db'

/**
 * Convert user text into a safe FTS5 MATCH query.
 * Uses prefix matching on tokens; strips FTS special chars.
 */
export function buildFtsQuery(text: string): string {
  const tokens = text
    .trim()
    .replace(/["'*(){}[\]^:~]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return ''
  // OR across tokens with prefix so partial words still hit
  return tokens.map((t) => `"${t}"*`).join(' OR ')
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
                0.0 AS score
         FROM items
         WHERE 1=1${sql}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[]

    return { hits: rows.map(mapHit) }
  }

  // Filter metadata first via subquery, then FTS on matching rowids
  const { sql: filterSql, params: filterParams } = buildFilterClause(filters)

  // Notes-first (#138): when sourcesLast is set, transcript (source) chunks rank
  // after the user's own notes. Media chat passes sourcesLast=false to stay
  // transcript-first (it is chat with the video).
  const orderBy = input.sourcesLast ? '(i.kind = \'transcript\'), score' : 'score'

  const rows = database
    .prepare(
      `SELECT i.id, i.title, i.para, i.kind, i.project,
              snippet(items_fts, 2, '«', '»', '…', 24) AS snippet,
              bm25(items_fts) AS score
       FROM items_fts
       JOIN items i ON i.rowid = items_fts.rowid
       WHERE items_fts MATCH ?
         AND i.id IN (SELECT id FROM items WHERE 1=1${filterSql})
       ORDER BY ${orderBy}
       LIMIT ?`
    )
    .all(fts, ...filterParams, limit) as Record<string, unknown>[]

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
