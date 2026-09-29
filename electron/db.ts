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
  migrate(db)
  seedIfEmpty(db)
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

function migrate(database: Database.Database): void {
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
    clauses.push('project LIKE ?')
    params.push(`%${filters.project.trim()}%`)
  }

  if (clauses.length === 0) return { sql: '', params }
  return { sql: ' AND ' + clauses.join(' AND '), params }
}

export function listItems(filters?: ItemFilters): Item[] {
  const database = getDb()
  const { sql, params } = buildFilterClause(filters)
  const rows = database
    .prepare(`SELECT * FROM items WHERE 1=1${sql} ORDER BY updated_at DESC`)
    .all(...params) as Record<string, unknown>[]
  return rows.map(rowToItem)
}

/**
 * Exact project match (the substring LIKE in listItems is for search UX; media
 * ingest/replace must distinguish "intro" from "intro (2)").
 */
export function listItemsByProjectExact(project: string, kind?: string): Item[] {
  const database = getDb()
  const sql = kind
    ? 'SELECT * FROM items WHERE project = ? AND kind = ? ORDER BY updated_at DESC'
    : 'SELECT * FROM items WHERE project = ? ORDER BY updated_at DESC'
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
       WHERE project IS NOT NULL AND TRIM(project) != ''
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
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number }
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
    created_at: ts,
  }
  getDb()
    .prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, citations_json, hits_json, created_at)
       VALUES (@id, @session_id, @role, @content, @citations_json, @hits_json, @created_at)`
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

function seedIfEmpty(database: Database.Database): void {
  const row = database.prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number }
  if (row.c > 0) return

  const seeds: CreateItemInput[] = [
    {
      title: 'Getting Things Done — capture and clarify',
      summary: 'Core GTD workflow notes',
      body: `Productivity systems work best when capture is frictionless.
Clarify every inbox item: is it actionable? If yes, next action or project.
If not, trash, incubate, or reference. Weekly reviews keep the system honest.
PARA maps Projects (outcomes with deadlines), Areas (standards to maintain),
Resources (topics of interest), and Archives (inactive).`,
      para: 'resources',
      kind: 'note',
      status: 'active',
      project: null,
    },
    {
      title: 'Atomic Habits — book notes',
      summary: 'James Clear — identity-based habit change',
      body: `Fake book note for Local Knowledge Vault demos.
Key idea: habits compound. Focus on systems over goals.
Cue → Craving → Response → Reward. Make good habits obvious, attractive,
easy, and satisfying. Environment design beats willpower.
1% better every day is ~37x better in a year.`,
      para: 'resources',
      kind: 'book',
      status: 'active',
      project: null,
    },
    {
      title: 'Local Knowledge Vault MVP',
      summary: 'Ship searchable local notes with optional grounded Ask',
      body: `Project: build an Electron app that stores notes in SQLite with PARA metadata,
full-text search via FTS5 BM25, metadata filters, and optional Ollama Q&A
that only cites retrieved item IDs. Search must work offline without Ollama.
Success: create/list/filter/search notes, ask with citation chips.`,
      para: 'projects',
      kind: 'note',
      status: 'active',
      project: 'Local Knowledge Vault',
    },
    {
      title: 'Health & fitness standards',
      summary: 'Ongoing area of responsibility',
      body: `Area (not a project): maintain sleep, movement, and nutrition standards.
No hard deadline — continuous. Track weekly activity minutes and bedtime.
Archive old challenge logs under Archives when a challenge ends.`,
      para: 'areas',
      kind: 'note',
      status: 'active',
      project: null,
    },
    {
      title: '2023 conference notes (archived)',
      summary: 'Old talk notes moved to archives',
      body: `Archived notes from a past conference on personal knowledge management.
Topics included Zettelkasten, evergreen notes, and local-first software.
Kept for reference; no longer an active resource.`,
      para: 'archives',
      kind: 'note',
      status: 'archived',
      project: null,
    },
  ]

  const prev = db
  db = database
  try {
    for (const s of seeds) {
      createItem(s)
    }
  } finally {
    db = prev ?? database
  }
}
