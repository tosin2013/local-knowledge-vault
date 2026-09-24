"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/electron/index.js
var require_electron = __commonJS({
  "node_modules/electron/index.js"(exports2, module2) {
    var fs2 = require("fs");
    var path2 = require("path");
    var pathFile = path2.join(__dirname, "path.txt");
    function getElectronPath() {
      let executablePath;
      if (fs2.existsSync(pathFile)) {
        executablePath = fs2.readFileSync(pathFile, "utf-8");
      }
      if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
        return path2.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath || "electron");
      }
      if (executablePath) {
        return path2.join(__dirname, "dist", executablePath);
      } else {
        throw new Error("Electron failed to install correctly, please delete node_modules/electron and try installing again");
      }
    }
    module2.exports = getElectronPath();
  }
});

// electron/db.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_crypto = require("crypto");
var db = null;
function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb first.");
  return db;
}
function initDb(dbPath2) {
  db = new import_better_sqlite3.default(dbPath2);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedIfEmpty(db);
  seedPromptsIfEmpty(db);
  return db;
}
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
function migrate(database) {
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
  `);
}
function newId(prefix) {
  return `${prefix}_${(0, import_crypto.randomUUID)().replace(/-/g, "").slice(0, 16)}`;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function rowToItem(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    body: String(row.body ?? ""),
    para: row.para,
    kind: String(row.kind),
    status: String(row.status),
    project: row.project == null ? null : String(row.project),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
function buildFilterClause(filters2) {
  const clauses = [];
  const params = [];
  if (!filters2) return { sql: "", params };
  if (filters2.para) {
    clauses.push("para = ?");
    params.push(filters2.para);
  }
  if (filters2.kind) {
    clauses.push("kind = ?");
    params.push(filters2.kind);
  }
  if (filters2.status) {
    clauses.push("status = ?");
    params.push(filters2.status);
  }
  if (filters2.project && filters2.project.trim()) {
    clauses.push("project LIKE ?");
    params.push(`%${filters2.project.trim()}%`);
  }
  if (clauses.length === 0) return { sql: "", params };
  return { sql: " AND " + clauses.join(" AND "), params };
}
function getItem(id) {
  const database = getDb();
  const row = database.prepare("SELECT * FROM items WHERE id = ?").get(id);
  return row ? rowToItem(row) : null;
}
function createItem(input) {
  const database = getDb();
  const id = newId("itm");
  const ts = nowIso();
  const item = {
    id,
    title: input.title.trim() || "Untitled",
    summary: input.summary ?? null,
    body: input.body ?? "",
    para: input.para ?? "resources",
    kind: input.kind ?? "note",
    status: input.status ?? "active",
    project: input.project ?? null,
    created_at: ts,
    updated_at: ts
  };
  database.prepare(
    `INSERT INTO items (id, title, summary, body, para, kind, status, project, created_at, updated_at)
       VALUES (@id, @title, @summary, @body, @para, @kind, @status, @project, @created_at, @updated_at)`
  ).run(item);
  return item;
}
function rowToSession(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    mode: row.mode || "grounded",
    filters_json: row.filters_json == null ? null : String(row.filters_json),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
function rowToMessage(row) {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    role: row.role,
    content: String(row.content),
    citations_json: row.citations_json == null ? null : String(row.citations_json),
    hits_json: row.hits_json == null ? null : String(row.hits_json),
    created_at: String(row.created_at)
  };
}
function createSession(input) {
  const id = newId("ses");
  const ts = nowIso();
  const session = {
    id,
    title: input?.title?.trim() || "New chat",
    mode: input?.mode ?? "grounded",
    filters_json: input?.filters ? JSON.stringify(input.filters) : null,
    created_at: ts,
    updated_at: ts
  };
  getDb().prepare(
    `INSERT INTO chat_sessions (id, title, mode, filters_json, created_at, updated_at)
       VALUES (@id, @title, @mode, @filters_json, @created_at, @updated_at)`
  ).run(session);
  return session;
}
function getSession(id) {
  const row = getDb().prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
  return row ? rowToSession(row) : null;
}
function updateSessionTitle(id, title) {
  const existing = getSession(id);
  if (!existing) return null;
  const updated = {
    ...existing,
    title: title.trim() || existing.title,
    updated_at: nowIso()
  };
  getDb().prepare("UPDATE chat_sessions SET title = @title, updated_at = @updated_at WHERE id = @id").run(updated);
  return updated;
}
function touchSession(id) {
  getDb().prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(nowIso(), id);
}
function listMessages(sessionId) {
  const rows = getDb().prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);
  return rows.map(rowToMessage);
}
function appendMessage(input) {
  const id = newId("msg");
  const ts = nowIso();
  const msg = {
    id,
    session_id: input.session_id,
    role: input.role,
    content: input.content,
    citations_json: input.citations_json ?? null,
    hits_json: input.hits_json ?? null,
    created_at: ts
  };
  getDb().prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, citations_json, hits_json, created_at)
       VALUES (@id, @session_id, @role, @content, @citations_json, @hits_json, @created_at)`
  ).run(msg);
  touchSession(input.session_id);
  return msg;
}
function rowToPrompt(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    body: String(row.body),
    description: row.description == null ? null : String(row.description),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
function getPrompt(id) {
  const row = getDb().prepare("SELECT * FROM prompts WHERE id = ?").get(id);
  return row ? rowToPrompt(row) : null;
}
function createPrompt(input) {
  const id = newId("prm");
  const ts = nowIso();
  const prompt = {
    id,
    name: input.name.trim() || "Untitled prompt",
    body: input.body ?? "",
    description: input.description ?? null,
    created_at: ts,
    updated_at: ts
  };
  getDb().prepare(
    `INSERT INTO prompts (id, name, body, description, created_at, updated_at)
       VALUES (@id, @name, @body, @description, @created_at, @updated_at)`
  ).run(prompt);
  return prompt;
}
function seedPromptsIfEmpty(database) {
  const row = database.prepare("SELECT COUNT(*) AS c FROM prompts").get();
  if (row.c > 0) return;
  const seeds = [
    {
      name: "Grounded default",
      body: "Be precise and stick closely to the retrieved passages. Prefer short paragraphs.",
      description: "Default grounded style \u2014 faithful to sources"
    },
    {
      name: "Concise bullets",
      body: "Answer in concise bullet points. Each bullet should cite a source when possible.",
      description: "Short bullet-list answers with citations"
    },
    {
      name: "Socratic coach",
      body: "Respond as a Socratic coach: clarify the question, ask one follow-up if needed, then answer from the passages.",
      description: "Coaching tone with clarifying questions"
    }
  ];
  const prev = db;
  db = database;
  try {
    for (const s of seeds) {
      createPrompt(s);
    }
  } finally {
    db = prev ?? database;
  }
}
function seedIfEmpty(database) {
  const row = database.prepare("SELECT COUNT(*) AS c FROM items").get();
  if (row.c > 0) return;
  const seeds = [
    {
      title: "Getting Things Done \u2014 capture and clarify",
      summary: "Core GTD workflow notes",
      body: `Productivity systems work best when capture is frictionless.
Clarify every inbox item: is it actionable? If yes, next action or project.
If not, trash, incubate, or reference. Weekly reviews keep the system honest.
PARA maps Projects (outcomes with deadlines), Areas (standards to maintain),
Resources (topics of interest), and Archives (inactive).`,
      para: "resources",
      kind: "note",
      status: "active",
      project: null
    },
    {
      title: "Atomic Habits \u2014 book notes",
      summary: "James Clear \u2014 identity-based habit change",
      body: `Fake book note for Local Knowledge Vault demos.
Key idea: habits compound. Focus on systems over goals.
Cue \u2192 Craving \u2192 Response \u2192 Reward. Make good habits obvious, attractive,
easy, and satisfying. Environment design beats willpower.
1% better every day is ~37x better in a year.`,
      para: "resources",
      kind: "book",
      status: "active",
      project: null
    },
    {
      title: "Local Knowledge Vault MVP",
      summary: "Ship searchable local notes with optional grounded Ask",
      body: `Project: build an Electron app that stores notes in SQLite with PARA metadata,
full-text search via FTS5 BM25, metadata filters, and optional Ollama Q&A
that only cites retrieved item IDs. Search must work offline without Ollama.
Success: create/list/filter/search notes, ask with citation chips.`,
      para: "projects",
      kind: "note",
      status: "active",
      project: "Local Knowledge Vault"
    },
    {
      title: "Health & fitness standards",
      summary: "Ongoing area of responsibility",
      body: `Area (not a project): maintain sleep, movement, and nutrition standards.
No hard deadline \u2014 continuous. Track weekly activity minutes and bedtime.
Archive old challenge logs under Archives when a challenge ends.`,
      para: "areas",
      kind: "note",
      status: "active",
      project: null
    },
    {
      title: "2023 conference notes (archived)",
      summary: "Old talk notes moved to archives",
      body: `Archived notes from a past conference on personal knowledge management.
Topics included Zettelkasten, evergreen notes, and local-first software.
Kept for reference; no longer an active resource.`,
      para: "archives",
      kind: "note",
      status: "archived",
      project: null
    }
  ];
  const prev = db;
  db = database;
  try {
    for (const s of seeds) {
      createItem(s);
    }
  } finally {
    db = prev ?? database;
  }
}

// electron/llm-settings.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var DEFAULTS = {
  provider: "auto",
  grokEnabled: false,
  grokModel: "grok-4.3",
  groqEnabled: false,
  groqModel: "openai/gpt-oss-20b"
};
var SETTINGS_FILE = "lkv-llm.json";
var KEY_FILE = "lkv-xai-key";
var GROQ_KEY_FILE = "lkv-groq-key";
var userDataOverride = null;
var cachedSettings = null;
function setLlmUserDataDir(dir) {
  userDataOverride = dir;
  cachedSettings = null;
}
function resolveUserDataDir() {
  if (userDataOverride) return userDataOverride;
  try {
    const electron = require_electron();
    if (electron?.app?.getPath) {
      return electron.app.getPath("userData");
    }
  } catch {
  }
  const fallback = import_path.default.join(import_os.default.tmpdir(), "lkv-userdata");
  import_fs.default.mkdirSync(fallback, { recursive: true });
  return fallback;
}
function settingsPath() {
  return import_path.default.join(resolveUserDataDir(), SETTINGS_FILE);
}
function keyPath() {
  return import_path.default.join(resolveUserDataDir(), KEY_FILE);
}
function groqKeyPath() {
  return import_path.default.join(resolveUserDataDir(), GROQ_KEY_FILE);
}
function readSettingsFile() {
  try {
    const p = settingsPath();
    if (!import_fs.default.existsSync(p)) return {};
    const raw = import_fs.default.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function isProviderChoice(v) {
  return v === "auto" || v === "ollama" || v === "grok" || v === "groq";
}
function mergeLlmSettings(partial, base = DEFAULTS) {
  const provider = isProviderChoice(partial?.provider) ? partial.provider : base.provider;
  const grokEnabled = typeof partial?.grokEnabled === "boolean" ? partial.grokEnabled : base.grokEnabled;
  const grokModel = typeof partial?.grokModel === "string" && partial.grokModel.trim() ? partial.grokModel.trim() : base.grokModel;
  const groqEnabled = typeof partial?.groqEnabled === "boolean" ? partial.groqEnabled : base.groqEnabled;
  const groqModel = typeof partial?.groqModel === "string" && partial.groqModel.trim() ? partial.groqModel.trim() : base.groqModel;
  return { provider, grokEnabled, grokModel, groqEnabled, groqModel };
}
function getLlmSettings() {
  if (cachedSettings) return { ...cachedSettings };
  const merged = mergeLlmSettings(readSettingsFile(), DEFAULTS);
  cachedSettings = merged;
  return { ...merged };
}
function envXaiKey() {
  const a = process.env.LKV_XAI_API_KEY?.trim();
  if (a) return a;
  const b = process.env.XAI_API_KEY?.trim();
  if (b) return b;
  return null;
}
function envGroqKey() {
  const a = process.env.LKV_GROQ_API_KEY?.trim();
  if (a) return a;
  const b = process.env.GROQ_API_KEY?.trim();
  if (b) return b;
  return null;
}
function readKeyFileAt(p) {
  try {
    if (!import_fs.default.existsSync(p)) return null;
    const v = import_fs.default.readFileSync(p, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}
function getXaiApiKey() {
  return envXaiKey() ?? readKeyFileAt(keyPath());
}
function hasXaiApiKey() {
  return !!getXaiApiKey();
}
function getGroqApiKey() {
  return envGroqKey() ?? readKeyFileAt(groqKeyPath());
}
function hasGroqApiKey() {
  return !!getGroqApiKey();
}

// electron/search.ts
function buildFtsQuery(text) {
  const tokens = text.trim().replace(/["'*(){}[\]^:~]/g, " ").split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}
function searchQuery(input) {
  const database = getDb();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const filters2 = input.filters;
  const fts = buildFtsQuery(input.text ?? "");
  if (!fts) {
    const { sql, params } = buildFilterClause(filters2);
    const rows2 = database.prepare(
      `SELECT id, title, para, kind, project,
                substr(COALESCE(summary, body), 1, 160) AS snippet,
                0.0 AS score
         FROM items
         WHERE 1=1${sql}
         ORDER BY updated_at DESC
         LIMIT ?`
    ).all(...params, limit);
    return { hits: rows2.map(mapHit) };
  }
  const { sql: filterSql, params: filterParams } = buildFilterClause(filters2);
  const rows = database.prepare(
    `SELECT i.id, i.title, i.para, i.kind, i.project,
              snippet(items_fts, 2, '\xAB', '\xBB', '\u2026', 24) AS snippet,
              bm25(items_fts) AS score
       FROM items_fts
       JOIN items i ON i.rowid = items_fts.rowid
       WHERE items_fts MATCH ?
         AND i.id IN (SELECT id FROM items WHERE 1=1${filterSql})
       ORDER BY score
       LIMIT ?`
  ).all(fts, ...filterParams, limit);
  return { hits: rows.map(mapHit) };
}
function mapHit(row) {
  return {
    id: String(row.id),
    title: String(row.title),
    snippet: String(row.snippet ?? ""),
    score: Number(row.score ?? 0),
    para: row.para,
    kind: String(row.kind),
    project: row.project == null ? null : String(row.project)
  };
}

// electron/ollama.ts
var OLLAMA_BASE = process.env.LKV_OLLAMA_URL ?? "http://127.0.0.1:11434";
var FETCH_TIMEOUT_MS = 4e3;
async function fetchWithTimeout(url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function ollamaHealth() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) {
      return { ok: false, error: `Ollama HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name);
    return { ok: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
function pickModel(models) {
  const envModel = process.env.LKV_OLLAMA_MODEL;
  if (envModel) return envModel;
  if (!models.length) return null;
  const preferred = models.find((m) => /^llama3\.2/i.test(m));
  if (preferred) return preferred;
  const llama = models.find((m) => /llama/i.test(m));
  if (llama) return llama;
  return models[0];
}
async function ollamaGenerate(model, prompt) {
  try {
    const res = await fetchWithTimeout(
      `${OLLAMA_BASE}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2 }
        })
      },
      12e4
    );
    if (!res.ok) {
      return { ok: false, error: `Ollama generate HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, text: data.response ?? "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// electron/grok.ts
var DEFAULT_BASE = "https://api.x.ai/v1";
var HEALTH_TIMEOUT_MS = 8e3;
var GENERATE_TIMEOUT_MS = 12e4;
function baseUrl() {
  const env = process.env.LKV_XAI_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return DEFAULT_BASE;
}
async function fetchWithTimeout2(url, init, timeoutMs = HEALTH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function grokHealth() {
  const hasKey = hasXaiApiKey();
  if (!hasKey) {
    return { ok: false, hasKey: false, error: "No xAI API key" };
  }
  const settings = getLlmSettings();
  const modelList = [settings.grokModel];
  try {
    const key = getXaiApiKey();
    if (!key) {
      return { ok: false, hasKey: false, error: "No xAI API key" };
    }
    const res = await fetchWithTimeout2(`${baseUrl()}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.ok) {
      const data = await res.json();
      const ids = (data.data ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id.length > 0);
      if (ids.length > 0) {
        const models = ids.includes(settings.grokModel) ? ids : [settings.grokModel, ...ids];
        return { ok: true, hasKey: true, models };
      }
    }
    return { ok: true, hasKey: true, models: modelList };
  } catch {
    return { ok: true, hasKey: true, models: modelList };
  }
}
async function grokGenerate(model, prompt) {
  const key = getXaiApiKey();
  if (!key) {
    return { ok: false, error: "No xAI API key" };
  }
  try {
    const res = await fetchWithTimeout2(
      `${baseUrl()}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2
        })
      },
      GENERATE_TIMEOUT_MS
    );
    if (!res.ok) {
      let detail = `Grok HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody.error === "string") detail = errBody.error;
        else if (errBody.error?.message) detail = errBody.error.message;
      } catch {
      }
      return { ok: false, error: detail };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// electron/groq.ts
var DEFAULT_BASE2 = "https://api.groq.com/openai/v1";
var HEALTH_TIMEOUT_MS2 = 8e3;
var GENERATE_TIMEOUT_MS2 = 12e4;
function baseUrl2() {
  const env = process.env.LKV_GROQ_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  return DEFAULT_BASE2;
}
async function fetchWithTimeout3(url, init, timeoutMs = HEALTH_TIMEOUT_MS2) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
function orderGroqModels(ids, configured) {
  const preferredRe = /^(llama|openai|gpt-oss)/i;
  const uniq = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  const rest = uniq.filter((id) => id !== configured);
  const preferred = rest.filter((id) => preferredRe.test(id));
  const other = rest.filter((id) => !preferredRe.test(id));
  return [configured, ...preferred, ...other];
}
async function groqHealth() {
  const hasKey = hasGroqApiKey();
  if (!hasKey) {
    return { ok: false, hasKey: false, error: "No Groq API key" };
  }
  const settings = getLlmSettings();
  const modelList = [settings.groqModel];
  try {
    const key = getGroqApiKey();
    if (!key) {
      return { ok: false, hasKey: false, error: "No Groq API key" };
    }
    const res = await fetchWithTimeout3(`${baseUrl2()}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.ok) {
      const data = await res.json();
      const ids = (data.data ?? []).map((m) => m.id).filter((id) => typeof id === "string" && id.length > 0);
      if (ids.length > 0) {
        return { ok: true, hasKey: true, models: orderGroqModels(ids, settings.groqModel) };
      }
    }
    return { ok: true, hasKey: true, models: modelList };
  } catch {
    return { ok: true, hasKey: true, models: modelList };
  }
}
async function groqGenerate(model, prompt) {
  const key = getGroqApiKey();
  if (!key) {
    return { ok: false, error: "No Groq API key" };
  }
  try {
    const res = await fetchWithTimeout3(
      `${baseUrl2()}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2
        })
      },
      GENERATE_TIMEOUT_MS2
    );
    if (!res.ok) {
      let detail = `Groq HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (typeof errBody.error === "string") detail = errBody.error;
        else if (errBody.error?.message) detail = errBody.error.message;
      } catch {
      }
      return { ok: false, error: detail };
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// electron/llm.ts
function resolveProviderFromHealth(input) {
  const { settings, hasKey, hasGroqKey, ollama, grok, groq } = input;
  const choice = settings.provider;
  const ollamaModel = ollama.ok ? pickModel(ollama.models ?? []) : null;
  const grokModel = grok.ok && hasKey ? grok.models?.[0] ?? settings.grokModel : hasKey ? settings.grokModel : null;
  const groqModel = groq.ok && hasGroqKey ? groq.models?.[0] ?? settings.groqModel : hasGroqKey ? settings.groqModel : null;
  const build = (provider, model, message) => ({
    provider,
    model,
    status: { ollama, grok, groq, active: provider, message }
  });
  if (choice === "ollama") {
    if (ollama.ok && ollamaModel) {
      return build("ollama", ollamaModel, "Ollama ready");
    }
    if (ollama.ok && !ollamaModel) {
      return build(null, null, "Ollama reachable but no models installed");
    }
    return build(null, null, "AI offline \u2014 search still works");
  }
  if (choice === "groq") {
    if (!hasGroqKey) {
      return build(null, null, "Groq enabled but no API key");
    }
    if (groq.ok && groqModel) {
      return build("groq", groqModel, `Groq ready (${groqModel})`);
    }
    return build(
      null,
      null,
      groq.error ? `Groq error: ${groq.error}` : "AI offline \u2014 search still works"
    );
  }
  if (choice === "grok") {
    if (!hasKey) {
      return build(null, null, "Grok enabled but no API key");
    }
    if (grok.ok && grokModel) {
      return build("grok", grokModel, `Grok ready (${grokModel})`);
    }
    return build(
      null,
      null,
      grok.error ? `Grok error: ${grok.error}` : "AI offline \u2014 search still works"
    );
  }
  const tryGroq = () => {
    if (!(settings.groqEnabled && hasGroqKey)) return null;
    if (groq.ok && groqModel) {
      return build("groq", groqModel, `Groq ready (${groqModel})`);
    }
    return null;
  };
  const tryGrok = () => {
    if (!(settings.grokEnabled && hasKey)) return null;
    if (grok.ok && grokModel) {
      return build("grok", grokModel, `Grok ready (${grokModel})`);
    }
    return null;
  };
  const tryOllama = () => {
    if (ollama.ok && ollamaModel) {
      return build("ollama", ollamaModel, "Ollama ready");
    }
    return null;
  };
  const groqHit = tryGroq();
  if (groqHit) return groqHit;
  const grokHit = tryGrok();
  if (grokHit) return grokHit;
  const ollamaHit = tryOllama();
  if (ollamaHit) return ollamaHit;
  if (settings.groqEnabled && !hasGroqKey && !settings.grokEnabled) {
    return build(null, null, "Groq enabled but no API key");
  }
  if (settings.grokEnabled && !hasKey && !settings.groqEnabled) {
    return build(null, null, "Grok enabled but no API key");
  }
  if (settings.groqEnabled && hasGroqKey && !groq.ok && groq.error) {
    if (!(settings.grokEnabled && hasKey)) {
      return build(
        null,
        null,
        groq.error === "No Groq API key" ? "Groq enabled but no API key" : `Groq error: ${groq.error}`
      );
    }
  }
  if (settings.grokEnabled && hasKey && !grok.ok && grok.error) {
    return build(
      null,
      null,
      grok.error === "No xAI API key" ? "Grok enabled but no API key" : `Grok error: ${grok.error}`
    );
  }
  if (settings.groqEnabled && !hasGroqKey || settings.grokEnabled && !hasKey) {
    if (settings.groqEnabled && !hasGroqKey) {
      return build(null, null, "Groq enabled but no API key");
    }
    return build(null, null, "Grok enabled but no API key");
  }
  if (ollama.ok && !ollamaModel) {
    return build(null, null, "Ollama reachable but no models installed");
  }
  return build(null, null, "AI offline \u2014 search still works");
}
async function resolveProvider() {
  const settings = getLlmSettings();
  const hasKey = hasXaiApiKey();
  const hasGroqKey = hasGroqApiKey();
  const needGrok = settings.provider === "grok" || settings.provider === "auto" && settings.grokEnabled || settings.grokEnabled;
  const needGroq = settings.provider === "groq" || settings.provider === "auto" && settings.groqEnabled || settings.groqEnabled;
  const needOllama = settings.provider === "ollama" || settings.provider === "auto" || (settings.provider === "grok" || settings.provider === "groq" ? false : true);
  const [ollama, grok, groq] = await Promise.all([
    needOllama || settings.provider === "auto" ? ollamaHealth() : Promise.resolve({ ok: false, error: "skipped" }),
    needGrok || hasKey ? grokHealth() : Promise.resolve({
      ok: false,
      hasKey: false,
      error: "No xAI API key"
    }),
    needGroq || hasGroqKey ? groqHealth() : Promise.resolve({
      ok: false,
      hasKey: false,
      error: "No Groq API key"
    })
  ]);
  const ollamaForStatus = settings.provider === "grok" || settings.provider === "groq" ? await ollamaHealth().catch(() => ollama) : ollama;
  return resolveProviderFromHealth({
    settings,
    hasKey,
    hasGroqKey,
    ollama: ollamaForStatus,
    grok: { ...grok, hasKey },
    groq: { ...groq, hasKey: hasGroqKey }
  });
}
async function tryOllamaFallback(prompt) {
  const oh = await ollamaHealth();
  const om = oh.ok ? pickModel(oh.models ?? []) : null;
  if (!om) return null;
  const fallback = await ollamaGenerate(om, prompt);
  if (fallback.ok) {
    return { ok: true, text: fallback.text, provider: "ollama", model: om };
  }
  return { ok: false, error: fallback.error, provider: "ollama" };
}
async function tryGrokFallback(prompt, settings) {
  if (!(settings.grokEnabled && hasXaiApiKey())) return null;
  const gh = await grokHealth();
  const model = gh.ok ? gh.models?.[0] ?? settings.grokModel : settings.grokModel;
  if (!model) return null;
  const gen = await grokGenerate(model, prompt);
  if (gen.ok) {
    return { ok: true, text: gen.text, provider: "grok", model };
  }
  return { ok: false, error: gen.error, provider: "grok" };
}
async function llmGenerate(prompt) {
  const resolved = await resolveProvider();
  if (!resolved.provider || !resolved.model) {
    return {
      ok: false,
      error: resolved.status.message,
      provider: resolved.provider
    };
  }
  const { provider, model } = resolved;
  const settings = getLlmSettings();
  if (provider === "groq") {
    const gen2 = await groqGenerate(model, prompt);
    if (!gen2.ok) {
      if (settings.provider === "auto") {
        const grokFb = await tryGrokFallback(prompt, settings);
        if (grokFb?.ok) return grokFb;
        const ollamaFb = await tryOllamaFallback(prompt);
        if (ollamaFb) return ollamaFb;
      }
      return { ok: false, error: gen2.error, provider: "groq" };
    }
    return { ok: true, text: gen2.text, provider: "groq", model };
  }
  if (provider === "grok") {
    const gen2 = await grokGenerate(model, prompt);
    if (!gen2.ok) {
      if (settings.provider === "auto") {
        const ollamaFb = await tryOllamaFallback(prompt);
        if (ollamaFb) return ollamaFb;
      }
      return { ok: false, error: gen2.error, provider: "grok" };
    }
    return { ok: true, text: gen2.text, provider: "grok", model };
  }
  const gen = await ollamaGenerate(model, prompt);
  if (!gen.ok) {
    return { ok: false, error: gen.error, provider: "ollama" };
  }
  return { ok: true, text: gen.text, provider: "ollama", model };
}
function providerDisplayName(provider) {
  if (provider === "groq") return "Groq";
  if (provider === "grok") return "Grok";
  if (provider === "ollama") return "Ollama";
  return "AI";
}

// electron/generate.ts
var CITE_RE = /\[(itm_[a-zA-Z0-9]+)\]/g;
function extractCitedIds(answer) {
  const ids = [];
  const seen = /* @__PURE__ */ new Set();
  let m;
  const re = new RegExp(CITE_RE.source, "g");
  while ((m = re.exec(answer)) !== null) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
function validateCitations(citedIds, allowedIds) {
  const allowed = allowedIds instanceof Set ? allowedIds : new Set(allowedIds);
  return citedIds.filter((id) => allowed.has(id));
}
var GROUNDED_RULES = `You are a careful assistant for a local knowledge vault.
Answer the user's question ONLY using the numbered passages below.
Cite supporting passages using square brackets with the exact item id, e.g. [itm_abc123].
If the passages do not contain enough information, say so honestly.
Do not invent facts or cite ids that are not listed.`;
function buildGroundedPrompt(question, hits, options) {
  const passages = hits.map((h, i) => {
    const item = getItem(h.id);
    const body = item?.body?.slice(0, 1200) ?? h.snippet;
    return `[Passage ${i + 1}] id=${h.id}
title: ${h.title}
${body}`;
  }).join("\n\n");
  const extra = options?.systemExtra?.trim();
  const guidance = extra ? `${GROUNDED_RULES}

Additional guidance:
${extra}` : GROUNDED_RULES;
  let historyBlock = "";
  const history = options?.history ?? [];
  if (history.length > 0) {
    const turns = history.filter((m) => m.role === "user" || m.role === "assistant").map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
    historyBlock = `

Conversation so far:
${turns}
`;
  }
  return `${guidance}

Passages:
${passages}
${historyBlock}
Question: ${question}

Answer (with [id] citations):`;
}
function citationsFromIds(ids) {
  return ids.map((id) => {
    const item = getItem(id);
    return { id, title: item?.title ?? id };
  });
}
async function askGrounded(input) {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const { hits } = searchQuery({
    text: input.question,
    filters: input.filters,
    limit
  });
  if (hits.length === 0) {
    return {
      answer: "No matching notes found for that question with the current filters. Try different keywords or clear filters.",
      citations: [],
      hits: []
    };
  }
  const prompt = buildGroundedPrompt(input.question, hits, {
    systemExtra: input.systemExtra
  });
  const gen = await llmGenerate(prompt);
  if (!gen.ok) {
    const msg = gen.error;
    const name = providerDisplayName(gen.provider);
    let answer;
    if (/no api key/i.test(msg)) {
      answer = `${msg}. Showing search hits only \u2014 add a key in Advanced or use Ollama.`;
    } else if (/no models/i.test(msg)) {
      answer = `${msg}. Pull a model (e.g. llama3.2) and retry.`;
    } else if (/offline/i.test(msg)) {
      answer = `${name === "AI" ? "AI" : name} is offline. Showing search hits only \u2014 search still works.`;
    } else if (gen.provider) {
      answer = `${name} call failed (${msg}). Showing search hits only.`;
    } else {
      answer = `${msg}. Showing search hits only.`;
    }
    return {
      answer,
      citations: [],
      hits,
      offline: true,
      error: msg
    };
  }
  const allowed = new Set(hits.map((h) => h.id));
  const rawCited = extractCitedIds(gen.text);
  const validIds = validateCitations(rawCited, allowed);
  return {
    answer: gen.text.trim() || "(empty model response)",
    citations: citationsFromIds(validIds),
    hits
  };
}

// electron/chat.ts
var HISTORY_TURNS = 6;
function titleFromUserText(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 48 ? cleaned.slice(0, 45) + "\u2026" : cleaned;
}
async function sendChatTurn(input) {
  const session = getSession(input.sessionId);
  if (!session) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  const text = input.text.trim();
  if (!text) {
    throw new Error("Message text is empty");
  }
  appendMessage({
    session_id: session.id,
    role: "user",
    content: text
  });
  let currentSession = session;
  if (session.title === "New chat") {
    const titled = updateSessionTitle(session.id, titleFromUserText(text));
    if (titled) currentSession = titled;
  }
  let systemExtra = input.systemPrompt?.trim() || void 0;
  if (!systemExtra && input.promptId) {
    const prompt2 = getPrompt(input.promptId);
    if (prompt2?.body?.trim()) {
      systemExtra = prompt2.body.trim();
    }
  }
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const { hits } = searchQuery({
    text,
    filters: input.filters,
    limit
  });
  const finish = (content, citations2, hitList, extra) => {
    const assistant = appendMessage({
      session_id: session.id,
      role: "assistant",
      content,
      citations_json: citations2.length ? JSON.stringify(citations2) : null,
      hits_json: hitList.length ? JSON.stringify(hitList) : null
    });
    const messages = listMessages(session.id);
    const updated = getSession(session.id) ?? currentSession;
    return {
      assistant,
      messages,
      session: updated,
      offline: extra?.offline,
      error: extra?.error
    };
  };
  if (hits.length === 0) {
    return finish(
      "No matching notes found for that question with the current filters. Try different keywords or clear filters.",
      [],
      []
    );
  }
  const prior = listMessages(session.id).filter((m) => m.id !== void 0);
  const beforeCurrent = prior.slice(0, -1);
  const recent = beforeCurrent.filter((m) => m.role === "user" || m.role === "assistant").slice(-HISTORY_TURNS);
  const prompt = buildGroundedPrompt(text, hits, {
    systemExtra,
    history: recent.map((m) => ({ role: m.role, content: m.content }))
  });
  const gen = await llmGenerate(prompt);
  if (!gen.ok) {
    const msg = gen.error;
    const name = providerDisplayName(gen.provider);
    let content;
    if (/no api key/i.test(msg)) {
      content = `${msg}. Your message was saved \u2014 add a key in Advanced or use Ollama.`;
    } else if (/no models/i.test(msg)) {
      content = `${msg}. Your message was saved \u2014 pull a model (e.g. llama3.2) and retry.`;
    } else if (/offline/i.test(msg)) {
      content = "AI is offline. Your message was saved \u2014 start Ollama or enable Grok in Advanced to enable grounded replies.";
    } else if (gen.provider) {
      content = `${name} call failed (${msg}). Your message was saved \u2014 showing search context only.`;
    } else {
      content = `${msg}. Your message was saved \u2014 showing search context only.`;
    }
    return finish(content, [], hits, { offline: true, error: msg });
  }
  const allowed = new Set(hits.map((h) => h.id));
  const rawCited = extractCitedIds(gen.text);
  const validIds = validateCitations(rawCited, allowed);
  const citations = citationsFromIds(validIds);
  return finish(gen.text.trim() || "(empty model response)", citations, hits);
}

// scripts/gorgias-smoke.ts
var dbPath = "/home/box/.config/local-knowledge-vault/lkv.sqlite";
setLlmUserDataDir("/home/box/.config/local-knowledge-vault");
initDb(dbPath);
var PROMPT_ID = "prm_56ba1ab41bfe4042";
var filters = { project: "Gorgias" };
async function main() {
  const p = getPrompt(PROMPT_ID);
  console.log("prompt", p?.id, p?.name);
  const ask = await askGrounded({
    question: "What does Gorgias claim rhetoric is, and how does Socrates push back? Cite the notes.",
    filters,
    limit: 8,
    systemExtra: p?.body
  });
  console.log("---ASK---");
  console.log("offline", ask.offline, "error", ask.error || "");
  console.log("citations", JSON.stringify(ask.citations));
  console.log("hits", ask.hits.map((h) => h.title).join(" | "));
  console.log(ask.answer);
  console.log("---END ASK---");
  await new Promise((r) => setTimeout(r, 8e3));
  const session = createSession({ title: "Gorgias persona smoke", mode: "grounded" });
  const chat = await sendChatTurn({
    sessionId: session.id,
    text: "Speak briefly as Callicles: who should rule, and why? Stay faithful to the dialogue and cite notes.",
    promptId: PROMPT_ID,
    filters,
    limit: 8
  });
  console.log("---CHAT---");
  console.log("error", chat.error || "");
  console.log("citations", JSON.stringify(chat.citations));
  console.log(chat.assistantMessage?.content || chat.answer || JSON.stringify(chat).slice(0, 2e3));
  console.log("---END CHAT---");
  closeDb();
}
main().catch((e) => {
  console.error(e);
  closeDb();
  process.exit(1);
});
