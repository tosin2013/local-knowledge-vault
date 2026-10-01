/**
 * SQLite schema, migrations, CRUD for Local Knowledge Vault.
 * Uses better-sqlite3 + FTS5 with content sync triggers.
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type {
  ChatMessage,
  ChatMode,
  ChatProfile,
  ChatRole,
  ChatSession,
  CreateChatProfileInput,
  CreateItemInput,
  CreatePromptInput,
  CreateSessionInput,
  Item,
  ItemFilters,
  Prompt,
  ProjectResult,
  ProjectSummary,
  UpdateChatProfilePatch,
  UpdateItemPatch,
  UpdatePromptPatch,
} from './types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb first.')
  return db
}

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // Was this vault created before the seeded flag existed? An existing vault
  // must never get sample notes re-injected on launch (#41).
  const alreadyExisting = tableExists(db, 'items')
  migrate(db)
  seedGuideNotes(db, alreadyExisting)
  seedPromptsIfEmpty(db)
  ensureFriendlyGroundedHelper(db)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * Versioned migrations driven by `PRAGMA user_version` (#41). `migrateV1` is
 * the original schema; every statement is an idempotent `CREATE IF NOT EXISTS`,
 * so it is safe to run against a fresh file or a pre-versioned v0.2 vault.
 * Future schema changes append `migrateV2`, `migrateV3`, … and bump
 * `SCHEMA_VERSION` rather than editing v1 in place.
 */
const SCHEMA_VERSION = 2

function migrate(database: Database.Database): void {
  const version = Number(database.pragma('user_version', { simple: true }))
  if (version < 1) {
    migrateV1(database)
  }
  if (version < 2) {
    migrateV2(database)
  }
  database.pragma(`user_version = ${SCHEMA_VERSION}`)
}

/** v2 (#45): record which provider wrote each assistant message. */
function migrateV2(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(chat_messages)`).all() as { name: string }[]
  if (!cols.some((c) => c.name === 'provider_json')) {
    database.exec(`ALTER TABLE chat_messages ADD COLUMN provider_json TEXT`)
  }
}

function migrateV1(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      body TEXT NOT NULL DEFAULT '',
      para TEXT NOT NULL CHECK(para IN ('projects','areas','resources','archives')),
      kind TEXT NOT NULL DEFAULT 'note',
      status TEXT NOT NULL DEFAULT 'active',
      project TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title,
      summary,
      body,
      tokenize='trigram',
      content='items',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, summary, body)
      VALUES (new.rowid, new.title, new.summary, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, summary, body)
      VALUES ('delete', old.rowid, old.title, old.summary, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, summary, body)
      VALUES ('delete', old.rowid, old.title, old.summary, old.body);
      INSERT INTO items_fts(rowid, title, summary, body)
      VALUES (new.rowid, new.title, new.summary, new.body);
    END;

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      mode TEXT NOT NULL DEFAULT 'grounded',
      filters_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      citations_json TEXT,
      hits_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt_id TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_profiles_name
      ON chat_profiles(name);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  ensureTrigramFts(database)
}

/** Project the self-documenting first-run guide notes are seeded into (#163). */
export const VAULT_GUIDE_PROJECT = 'Vault guide'

/** Key in the `meta` table recording that guide notes were already seeded (#41). */
// Legacy name kept so existing v0.2 vaults are never re-seeded on upgrade.
const GUIDE_NOTES_SEEDED_KEY = 'sample_notes_seeded'

/** Key in the `meta` table recording the ids of the seeded guide notes (#139). */
// Legacy name kept so the "Remove guide" ids survive an upgrade.
const GUIDE_NOTE_IDS_KEY = 'sample_note_ids'

/** Key recording which version of the guide content was seeded (#163). */
const GUIDE_VERSION_KEY = 'vault_guide_version'

/** Bump when the guide notes change so existing installs refresh them (#163). */
const GUIDE_VERSION = 1

function tableExists(database: Database.Database, name: string): boolean {
  const row = database
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name)
  return !!row
}

function getMeta(database: Database.Database, key: string): string | null {
  const row = database.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? String(row.value) : null
}

function setMeta(database: Database.Database, key: string, value: string): void {
  database
    .prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}

/**
 * Older vaults created `items_fts` with the default unicode61 tokenizer, which
 * cannot segment CJK text (a whole run like "東京の天気" becomes one token, so
 * a substring such as "天気" misses). Rebuild it with the trigram tokenizer for
 * substring + CJK matching (#37). Idempotent: no-op when already trigram.
 */
function ensureTrigramFts(database: Database.Database): void {
  const row = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items_fts'`)
    .get() as { sql?: string } | undefined
  if (row?.sql && /trigram/.test(row.sql)) return

  database.exec(`
    DROP TRIGGER IF EXISTS items_ai;
    DROP TRIGGER IF EXISTS items_ad;
    DROP TRIGGER IF EXISTS items_au;
    DROP TABLE IF EXISTS items_fts;
    CREATE VIRTUAL TABLE items_fts USING fts5(
      title,
      summary,
      body,
      tokenize='trigram',
      content='items',
      content_rowid='rowid'
    );
    CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, summary, body)
      VALUES (new.rowid, new.title, new.summary, new.body);
    END;
    CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, summary, body)
      VALUES ('delete', old.rowid, old.title, old.summary, old.body);
    END;
    CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, summary, body)
      VALUES ('delete', old.rowid, old.title, old.summary, old.body);
      INSERT INTO items_fts(rowid, title, summary, body)
      VALUES (new.rowid, new.title, new.summary, new.body);
    END;
    INSERT INTO items_fts(items_fts) VALUES('rebuild');
  `)
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function rowToItem(row: Record<string, unknown>): Item {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    body: String(row.body ?? ''),
    para: row.para as Item['para'],
    kind: String(row.kind),
    status: String(row.status),
    project: row.project == null ? null : String(row.project),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function buildFilterClause(filters?: ItemFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  if (!filters) return { sql: '', params }

  if (filters.para) {
    clauses.push('para = ?')
    params.push(filters.para)
  }
  if (filters.kind) {
    clauses.push('kind = ?')
    params.push(filters.kind)
  }
  if (filters.status) {
    clauses.push('status = ?')
    params.push(filters.status)
  }
  if (filters.project && filters.project.trim()) {
    // Exact match (#127): a project filter must not leak "intro" into "intro (2)".
    clauses.push('project = ?')
    params.push(filters.project.trim())
  }

  if (clauses.length === 0) return { sql: '', params }
  return { sql: ' AND ' + clauses.join(' AND '), params }
}

export function listItems(filters?: ItemFilters): Item[] {
  const database = getDb()
  const { sql, params } = buildFilterClause(filters)
  const rows = database
    .prepare(`SELECT * FROM items WHERE status != 'trashed'${sql} ORDER BY updated_at DESC`)
    .all(...params) as Record<string, unknown>[]
  return rows.map(rowToItem)
}

/**
 * Exact project match. Media ingest/replace uses this to distinguish
 * "intro" from "intro (2)" — listItems is also exact now, but this helper
 * adds an optional kind filter and is kept for clarity.
 */
export function listItemsByProjectExact(project: string, kind?: string): Item[] {
  const database = getDb()
  const sql = kind
    ? "SELECT * FROM items WHERE project = ? AND kind = ? AND status != 'trashed' ORDER BY updated_at DESC"
    : "SELECT * FROM items WHERE project = ? AND status != 'trashed' ORDER BY updated_at DESC"
  const rows = (kind
    ? database.prepare(sql).all(project, kind)
    : database.prepare(sql).all(project)) as Record<string, unknown>[]
  return rows.map(rowToItem)
}

/* ---- Projects (first-class, derived from the `project` field on notes) ---- */

/** Distinct project names with note counts, ordered case-insensitively. */
export function listProjects(): ProjectSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT project AS name, COUNT(*) AS count
       FROM items
       WHERE project IS NOT NULL AND TRIM(project) != '' AND status != 'trashed'
       GROUP BY project
       ORDER BY project COLLATE NOCASE`
    )
    .all() as Array<{ name: string; count: number }>
  return rows.map((r) => ({ name: String(r.name), count: Number(r.count) }))
}

/** Rename a project (exact match) across notes and chat profiles. */
export function renameProject(from: string, to: string): ProjectResult {
  const prev = (from ?? '').trim()
  const next = (to ?? '').trim()
  if (!prev || !next) throw new Error('Both project names are required')
  if (prev === next) return { count: 0 }
  const database = getDb()
  const items = database
    .prepare('UPDATE items SET project = ?, updated_at = ? WHERE project = ?')
    .run(next, nowIso(), prev)
  database.prepare('UPDATE chat_profiles SET project = ? WHERE project = ?').run(next, prev)
  return { count: items.changes }
}

/** Move every note (and chat profile) from `from` into `into`. */
export function mergeProject(from: string, into: string): ProjectResult {
  const src = (from ?? '').trim()
  const dst = (into ?? '').trim()
  if (!src || !dst) throw new Error('Both project names are required')
  if (src === dst) return { count: 0 }
  const database = getDb()
  const items = database
    .prepare('UPDATE items SET project = ?, updated_at = ? WHERE project = ?')
    .run(dst, nowIso(), src)
  database.prepare('UPDATE chat_profiles SET project = ? WHERE project = ?').run(dst, src)
  return { count: items.changes }
}

/** Delete every note (and chat profile) under a project name. */
export function deleteProject(name: string): ProjectResult {
  const n = (name ?? '').trim()
  if (!n) throw new Error('Project name is required')
  const database = getDb()
  const items = database.prepare('DELETE FROM items WHERE project = ?').run(n)
  database.prepare('DELETE FROM chat_profiles WHERE project = ?').run(n)
  return { count: items.changes }
}

export function getItem(id: string): Item | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM items WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToItem(row) : null
}

export function createItem(input: CreateItemInput): Item {
  const database = getDb()
  const id = newId('itm')
  const ts = nowIso()
  const item: Item = {
    id,
    title: input.title.trim() || 'Untitled',
    summary: input.summary ?? null,
    body: input.body ?? '',
    para: input.para ?? 'resources',
    kind: input.kind ?? 'note',
    status: input.status ?? 'active',
    project: input.project ?? null,
    created_at: ts,
    updated_at: ts,
  }
  database
    .prepare(
      `INSERT INTO items (id, title, summary, body, para, kind, status, project, created_at, updated_at)
       VALUES (@id, @title, @summary, @body, @para, @kind, @status, @project, @created_at, @updated_at)`
    )
    .run(item)
  return item
}

export function updateItem(id: string, patch: UpdateItemPatch): Item | null {
  const existing = getItem(id)
  if (!existing) return null

  const updated: Item = {
    ...existing,
    title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
    summary: patch.summary !== undefined ? patch.summary : existing.summary,
    body: patch.body !== undefined ? patch.body : existing.body,
    para: patch.para !== undefined ? patch.para : existing.para,
    kind: patch.kind !== undefined ? patch.kind : existing.kind,
    status: patch.status !== undefined ? patch.status : existing.status,
    project: patch.project !== undefined ? patch.project : existing.project,
    updated_at: nowIso(),
  }

  getDb()
    .prepare(
      `UPDATE items SET title=@title, summary=@summary, body=@body, para=@para,
       kind=@kind, status=@status, project=@project, updated_at=@updated_at WHERE id=@id`
    )
    .run(updated)
  return updated
}

export function deleteItem(id: string): boolean {
  const result = getDb().prepare('DELETE FROM items WHERE id = ?').run(id)
  return result.changes > 0
}

/* ---- Trash (soft-delete) ---- */

/** Move a note to the trash (status='trashed'). Reversible via restoreItem. */
export function trashItem(id: string): boolean {
  const result = getDb()
    .prepare("UPDATE items SET status = 'trashed', updated_at = ? WHERE id = ? AND status != 'trashed'")
    .run(nowIso(), id)
  return result.changes > 0
}

/** Restore a trashed note back to active. */
export function restoreItem(id: string): boolean {
  const result = getDb()
    .prepare("UPDATE items SET status = 'active', updated_at = ? WHERE id = ?")
    .run(nowIso(), id)
  return result.changes > 0
}

/** Trashed notes, newest first. */
export function listTrashedItems(): Item[] {
  const rows = getDb()
    .prepare("SELECT * FROM items WHERE status = 'trashed' ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[]
  return rows.map(rowToItem)
}

/** Permanently delete everything in the trash. Returns the number removed. */
export function emptyTrash(): number {
  const result = getDb().prepare("DELETE FROM items WHERE status = 'trashed'").run()
  return result.changes
}

/** Run a function in a transaction. On success commits; on error rolls back and re-throws. */
export function runInTransaction<T>(fn: () => T): T {
  const db = getDb()
  db.prepare('BEGIN').run()
  try {
    const result = fn()
    db.prepare('COMMIT').run()
    return result
  } catch (err) {
    db.prepare('ROLLBACK').run()
    throw err
  }
}

export function countItems(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM items WHERE status != 'trashed'")
    .get() as { c: number }
  return row.c
}

/** Exported for search.ts filter reuse */
export { buildFilterClause }

/* ---- Chat sessions ---- */

function rowToSession(row: Record<string, unknown>): ChatSession {
  return {
    id: String(row.id),
    title: String(row.title),
    mode: (row.mode as ChatMode) || 'grounded',
    filters_json: row.filters_json == null ? null : String(row.filters_json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    role: row.role as ChatRole,
    content: String(row.content),
    citations_json: row.citations_json == null ? null : String(row.citations_json),
    hits_json: row.hits_json == null ? null : String(row.hits_json),
    provider_json: row.provider_json == null ? null : String(row.provider_json),
    created_at: String(row.created_at),
  }
}

export function listSessions(): ChatSession[] {
  const rows = getDb()
    .prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
    .all() as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function createSession(input?: CreateSessionInput): ChatSession {
  const id = newId('ses')
  const ts = nowIso()
  const session: ChatSession = {
    id,
    title: input?.title?.trim() || 'New chat',
    mode: input?.mode ?? 'grounded',
    filters_json: input?.filters ? JSON.stringify(input.filters) : null,
    created_at: ts,
    updated_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO chat_sessions (id, title, mode, filters_json, created_at, updated_at)
       VALUES (@id, @title, @mode, @filters_json, @created_at, @updated_at)`
    )
    .run(session)
  return session
}

export function getSession(id: string): ChatSession | null {
  const row = getDb().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToSession(row) : null
}

export function deleteSession(id: string): boolean {
  const result = getDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  return result.changes > 0
}

export function updateSessionTitle(id: string, title: string): ChatSession | null {
  const existing = getSession(id)
  if (!existing) return null
  const updated: ChatSession = {
    ...existing,
    title: title.trim() || existing.title,
    updated_at: nowIso(),
  }
  getDb()
    .prepare('UPDATE chat_sessions SET title = @title, updated_at = @updated_at WHERE id = @id')
    .run(updated)
  return updated
}

export function touchSession(id: string): void {
  getDb()
    .prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?')
    .run(nowIso(), id)
}

export function listMessages(sessionId: string): ChatMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as Record<string, unknown>[]
  return rows.map(rowToMessage)
}

export function appendMessage(input: {
  session_id: string
  role: ChatRole
  content: string
  citations_json?: string | null
  hits_json?: string | null
  provider_json?: string | null
}): ChatMessage {
  const id = newId('msg')
  const ts = nowIso()
  const msg: ChatMessage = {
    id,
    session_id: input.session_id,
    role: input.role,
    content: input.content,
    citations_json: input.citations_json ?? null,
    hits_json: input.hits_json ?? null,
    provider_json: input.provider_json ?? null,
    created_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, citations_json, hits_json, provider_json, created_at)
       VALUES (@id, @session_id, @role, @content, @citations_json, @hits_json, @provider_json, @created_at)`
    )
    .run(msg)
  touchSession(input.session_id)
  return msg
}

/* ---- Prompts ---- */

function rowToPrompt(row: Record<string, unknown>): Prompt {
  return {
    id: String(row.id),
    name: String(row.name),
    body: String(row.body),
    description: row.description == null ? null : String(row.description),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function listPrompts(): Prompt[] {
  const rows = getDb()
    .prepare('SELECT * FROM prompts ORDER BY name ASC')
    .all() as Record<string, unknown>[]
  return rows.map(rowToPrompt)
}

export function getPrompt(id: string): Prompt | null {
  const row = getDb().prepare('SELECT * FROM prompts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToPrompt(row) : null
}

export function createPrompt(input: CreatePromptInput): Prompt {
  const id = newId('prm')
  const ts = nowIso()
  const prompt: Prompt = {
    id,
    name: input.name.trim() || 'Untitled prompt',
    body: input.body ?? '',
    description: input.description ?? null,
    created_at: ts,
    updated_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO prompts (id, name, body, description, created_at, updated_at)
       VALUES (@id, @name, @body, @description, @created_at, @updated_at)`
    )
    .run(prompt)
  return prompt
}

export function updatePrompt(id: string, patch: UpdatePromptPatch): Prompt | null {
  const existing = getPrompt(id)
  if (!existing) return null
  const updated: Prompt = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim() || existing.name : existing.name,
    body: patch.body !== undefined ? patch.body : existing.body,
    description: patch.description !== undefined ? patch.description : existing.description,
    updated_at: nowIso(),
  }
  getDb()
    .prepare(
      `UPDATE prompts SET name=@name, body=@body, description=@description, updated_at=@updated_at
       WHERE id=@id`
    )
    .run(updated)
  return updated
}

export function deletePrompt(id: string): boolean {
  const result = getDb().prepare('DELETE FROM prompts WHERE id = ?').run(id)
  return result.changes > 0
}

/* ---- Chat profiles ---- */

function rowToChatProfile(row: Record<string, unknown>): ChatProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    prompt_id: String(row.prompt_id),
    project: String(row.project ?? ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function listChatProfiles(): ChatProfile[] {
  const rows = getDb()
    .prepare('SELECT * FROM chat_profiles ORDER BY name COLLATE NOCASE ASC')
    .all() as Record<string, unknown>[]
  return rows.map(rowToChatProfile)
}

export function getChatProfile(id: string): ChatProfile | null {
  const row = getDb().prepare('SELECT * FROM chat_profiles WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToChatProfile(row) : null
}

/** Unique name: if taken, append " (2)", " (3)", … */
function uniqueProfileName(desired: string, excludeId?: string): string {
  const base = desired.trim() || 'Untitled profile'
  const rows = getDb()
    .prepare('SELECT id, name FROM chat_profiles')
    .all() as Array<{ id: string; name: string }>
  const taken = new Set(
    rows.filter((r) => r.id !== excludeId).map((r) => r.name.toLowerCase()),
  )
  if (!taken.has(base.toLowerCase())) return base
  let n = 2
  while (taken.has(`${base} (${n})`.toLowerCase())) n += 1
  return `${base} (${n})`
}

export function createChatProfile(input: CreateChatProfileInput): ChatProfile {
  const id = newId('prf')
  const ts = nowIso()
  const profile: ChatProfile = {
    id,
    name: uniqueProfileName(input.name),
    prompt_id: (input.promptId ?? '').trim(),
    project: (input.project ?? '').trim(),
    created_at: ts,
    updated_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO chat_profiles (id, name, prompt_id, project, created_at, updated_at)
       VALUES (@id, @name, @prompt_id, @project, @created_at, @updated_at)`,
    )
    .run(profile)
  return profile
}

export function updateChatProfile(id: string, patch: UpdateChatProfilePatch): ChatProfile | null {
  const existing = getChatProfile(id)
  if (!existing) return null
  const nextName =
    patch.name !== undefined ? uniqueProfileName(patch.name, id) : existing.name
  const updated: ChatProfile = {
    ...existing,
    name: nextName,
    prompt_id:
      patch.promptId !== undefined ? patch.promptId.trim() : existing.prompt_id,
    project: patch.project !== undefined ? patch.project.trim() : existing.project,
    updated_at: nowIso(),
  }
  getDb()
    .prepare(
      `UPDATE chat_profiles SET name=@name, prompt_id=@prompt_id, project=@project, updated_at=@updated_at
       WHERE id=@id`,
    )
    .run(updated)
  return updated
}

export function deleteChatProfile(id: string): boolean {
  const result = getDb().prepare('DELETE FROM chat_profiles WHERE id = ?').run(id)
  return result.changes > 0
}

/** Friendlier default voice — avoid leading with vault/SQLite/FTS/PARA jargon. */
export const GROUNDED_HELPER_BODY = `You are a friendly helper for the user's personal notes.

Tone:
- Answer in plain, everyday language. Prefer short paragraphs.
- Do not lead with how the vault works (SQLite, FTS5, PARA, BM25, Electron, etc.) unless the user asks how the app or search works.
- Stay warm and practical; explain ideas from the notes, not the storage engine.

Grounding (always):
- Use only the retrieved passages for facts.
- Cite supporting notes with square-bracket item IDs exactly as given, e.g. [itm_abc123].
- If the passages are not enough, say you don't know from these notes — do not invent.`

export const GROUNDED_HELPER_DESC =
  'Friendly everyday answers from your notes — cites itm_ IDs; skips vault jargon unless asked'


/** True when body still looks like an old technical / ultra-terse seed. */
function groundedBodyLooksStale(body: string): boolean {
  const b = (body ?? '').trim()
  if (!b) return true
  if (/SQLite|FTS5|BM25|better-sqlite|PARA metadata/i.test(b)) return true
  // Legacy one-liner seed
  if (/^Be precise and stick closely to the retrieved passages/i.test(b)) return true
  return false
}

/**
 * One-time-ish ensure: rename Grounded default → Grounded helper and refresh
 * body when it still looks like the old technical / terse seed.
 */
export function ensureFriendlyGroundedHelper(database?: Database.Database): void {
  const database_ = database ?? getDb()
  const prev = db
  db = database_
  try {
    const prompts = listPrompts()
    const existing =
      prompts.find((p) => p.name === 'Grounded helper') ||
      prompts.find((p) => p.name === 'Grounded default')
    if (!existing) {
      createPrompt({
        name: 'Grounded helper',
        body: GROUNDED_HELPER_BODY,
        description: GROUNDED_HELPER_DESC,
      })
      return
    }
    const needsName = existing.name !== 'Grounded helper'
    const needsBody = groundedBodyLooksStale(existing.body)
    if (needsName || needsBody) {
      updatePrompt(existing.id, {
        ...(needsName ? { name: 'Grounded helper' } : {}),
        ...(needsBody
          ? { body: GROUNDED_HELPER_BODY, description: GROUNDED_HELPER_DESC }
          : {}),
      })
    }
  } finally {
    db = prev ?? database_
  }
}

function seedPromptsIfEmpty(database: Database.Database): void {
  const row = database.prepare('SELECT COUNT(*) AS c FROM prompts').get() as { c: number }
  if (row.c > 0) {
    ensureFriendlyGroundedHelper(database)
    return
  }

  const seeds: CreatePromptInput[] = [
    {
      name: 'Grounded helper',
      body: GROUNDED_HELPER_BODY,
      description: GROUNDED_HELPER_DESC,
    },
    {
      name: 'Concise bullets',
      body: 'Answer in concise bullet points. Each bullet should cite a source when possible.',
      description: 'Short bullet-list answers with citations',
    },
    {
      name: 'Socratic coach',
      body: 'Respond as a Socratic coach: clarify the question, ask one follow-up if needed, then answer from the passages.',
      description: 'Coaching tone with clarifying questions',
    },
  ]

  const prev = db
  db = database
  try {
    for (const s of seeds) {
      createPrompt(s)
    }
  } finally {
    db = prev ?? database
  }
}

/**
 * Seed the self-documenting "Vault guide" notes (#163), which replace the
 * older "Getting started" samples. Behaviour:
 *
 * - Fresh install: insert the guide, record its ids + content version.
 * - Pre-existing vault that predates seeding: mark seeded, inject nothing.
 * - Already seeded, notes still present, but an older content version: delete
 *   and re-insert so the guide stays current across releases.
 * - Already seeded and the user removed the guide: never re-seed.
 */
function seedGuideNotes(database: Database.Database, alreadyExisting: boolean): void {
  const seeded = getMeta(database, GUIDE_NOTES_SEEDED_KEY) === '1'
  if (seeded) {
    if (!guideNotesStillPresent(database)) return // user removed them — respect it
    if (guideVersion(database) < GUIDE_VERSION) refreshGuide(database)
    return
  }

  if (alreadyExisting) {
    // Pre-#41 vault: it already had its chance to show (and maybe remove) the
    // samples — mark seeded without injecting anything.
    setMeta(database, GUIDE_NOTES_SEEDED_KEY, '1')
    setMeta(database, GUIDE_VERSION_KEY, String(GUIDE_VERSION))
    return
  }

  insertGuide(database)
}

function guideVersion(database: Database.Database): number {
  const raw = getMeta(database, GUIDE_VERSION_KEY)
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : 0
}

function guideNotesStillPresent(database: Database.Database): boolean {
  const ids = getGuideNoteIds(database)
  if (ids.length === 0) return false
  const get = database.prepare('SELECT 1 FROM items WHERE id = ?')
  return ids.some((id) => !!get.get(id))
}

/** The guide, dogfooding PARA groups, kinds, status and projects (#163). */
const GUIDE_SEEDS: CreateItemInput[] = [
  {
    title: 'Welcome to Vault',
    summary: 'What Vault is, and how this self-documenting guide works',
    body: `This note is part of the Vault guide, a project that teaches Vault using its own concepts. Every note here is a real note, so the examples are searchable and citable — try asking about "PARA" or "citations".

When you are ready, remove the guide with the "Remove guide" button in the notes rail. It will not come back.`,
    para: 'resources',
    kind: 'note',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'PARA: Projects, Areas, Resources, Archives',
    summary: 'The four note groups and when to use each',
    body: `Vault organises notes into four PARA groups:

- Projects — short, goal-driven efforts with an end date (plan a trip, ship a feature).
- Areas — ongoing responsibilities you maintain over time (health, finances, a team).
- Resources — reference material you reach for (articles, books, docs, snippets).
- Archives — anything inactive you want to keep out of the way.

Pick the group that matches how you use the note. Groups are filters you can combine with a project, type and status.`,
    para: 'areas',
    kind: 'docs',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'Kinds and status',
    summary: 'What a note type and status mean',
    body: `Every note has a type (kind) and a status.

Kinds: note (default), article, book, docs, blog, reference, and transcript (media captions). Kinds are free-form labels to help you filter.

Status: active (searchable and used in answers), archived (kept but out of the way), and ai-draft (a note saved from an answer, waiting for you to confirm it).`,
    para: 'resources',
    kind: 'docs',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'Citations: the [itm_…] badges',
    summary: 'How answers cite the notes they used',
    body: `Answers cite the notes they used with a marker like [itm_abc123]. In the chat these render as numbered links like [1] that open the source note, plus a chip you can click.

Citations only point at notes that were actually retrieved, so you can trace any claim back to its source.`,
    para: 'resources',
    kind: 'note',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'Projects and project-scoped Ask',
    summary: 'How projects group notes and scope your questions',
    body: `A project groups related notes together. Set a note's project from its editor, or type a new name to create one.

In Ask, choose a project (under Customize → Project) to ground answers in just those notes. Leave it on "All" to search everything.`,
    para: 'projects',
    kind: 'note',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'Profiles and personalities',
    summary: 'Personalities change style, never the grounding rules',
    body: `A personality changes how answers are written — for example concise bullets or a Socratic coach — but never the grounding rules. Answers still come only from your notes and still cite them.

Save a personality and project together as a profile to reuse it in one click.`,
    para: 'areas',
    kind: 'note',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'Media chat',
    summary: 'Turn a video or audio transcript into searchable notes',
    body: `Media chat turns a video or audio transcript into searchable, citable notes. Paste a YouTube URL or open a local media file with its captions.

It is available from the Plugins menu. You can then ask about the media and jump to the exact moment a citation came from.`,
    para: 'areas',
    kind: 'note',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'How grounding works',
    summary: 'Why answers are cited and can say "I don\'t know"',
    body: `Vault first searches your notes, then sends only the matching passages to the model with fixed rules: answer from those passages, cite them, and say so when they don't cover the question.

If nothing matches, Vault answers "I couldn't find that in your notes" without calling a model. Short, focused notes that reuse your own words search best.`,
    para: 'archives',
    kind: 'docs',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
  {
    title: 'Adding your own notes',
    summary: 'The three ways to get content into Vault',
    body: `Add content three ways:

- New note — write one from scratch.
- Import Markdown — bulk-import a folder of Markdown or Obsidian notes.
- Add from URL — fetch a web page and save it as a note.

Once your own notes are in, you can remove this guide with the "Remove guide" button.`,
    para: 'projects',
    kind: 'note',
    status: 'active',
    project: VAULT_GUIDE_PROJECT,
  },
]

function insertGuide(database: Database.Database): void {
  const ids = GUIDE_SEEDS.map((s) => createItem(s).id)
  setMeta(database, GUIDE_NOTE_IDS_KEY, JSON.stringify(ids))
  setMeta(database, GUIDE_NOTES_SEEDED_KEY, '1')
  setMeta(database, GUIDE_VERSION_KEY, String(GUIDE_VERSION))
}

/** Delete the existing guide notes and re-seed the current content. */
function refreshGuide(database: Database.Database): void {
  const ids = getGuideNoteIds(database)
  runInTransaction(() => {
    const del = database.prepare('DELETE FROM items WHERE id = ?')
    for (const id of ids) del.run(id)
    insertGuide(database)
  })
}

/** Read the ids of the seeded guide notes from the `meta` table. */
function getGuideNoteIds(database: Database.Database): string[] {
  const raw = getMeta(database, GUIDE_NOTE_IDS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Guide notes that still exist (empty once the user removed them, or for pre-#139 vaults). */
export function listSampleNotes(): Item[] {
  const database = getDb()
  const ids = getGuideNoteIds(database)
  if (ids.length === 0) return []
  const found: Item[] = []
  const get = database.prepare('SELECT * FROM items WHERE id = ?')
  for (const id of ids) {
    const row = get.get(id) as Record<string, unknown> | undefined
    if (row) found.push(rowToItem(row))
  }
  return found
}

/** Delete the seeded guide notes in one transaction. Returns how many were removed. */
export function removeSampleNotes(): number {
  const database = getDb()
  const ids = getGuideNoteIds(database)
  if (ids.length === 0) return 0
  return runInTransaction(() => {
    const del = database.prepare('DELETE FROM items WHERE id = ?')
    let removed = 0
    for (const id of ids) {
      removed += del.run(id).changes
    }
    return removed
  })
}
