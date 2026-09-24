/**
 * Citation pack — export an Ask session as a portable evidence bundle
 * (instructions + thread + note bodies + context.md + manifest) so another
 * LLM can answer from the same notes with [itm_…] citations bound to text.
 */
import fs from 'fs'
import path from 'path'
import { deflateRawSync, crc32 } from 'zlib'
import type { ChatMessage, ChatSession, Citation, Item, SearchHit } from './types'
import { getItem, getSession, listMessages } from './db'
import { extractCitedIds } from './generate'

export const CITATION_PACK_VERSION = 1

/** Soft cap for a single note body inside context.md (full note files stay complete). */
export const CONTEXT_NOTE_BODY_MAX = 50_000
/** Soft cap for entire context.md; after this, remaining notes get a stub. */
export const CONTEXT_TOTAL_MAX = 400_000

export interface CitationPackNoteMeta {
  id: string
  title: string
  project: string | null
  sourceUrl?: string
}

export interface CitationPackManifest {
  version: number
  exportedAt: string
  app: 'Vault'
  sessionId: string
  sessionTitle: string
  profileHint?: string
  noteIds: string[]
  notes: CitationPackNoteMeta[]
  missingIds: string[]
}

export interface CitationPackFile {
  /** Path relative to pack root, posix-style (e.g. notes/foo.md) */
  relativePath: string
  content: string
}

export interface CitationPackBuilt {
  folderName: string
  files: CitationPackFile[]
  manifest: CitationPackManifest
}

export interface CitationPackExportResult {
  canceled?: boolean
  /** Absolute path to the written zip (preferred) or folder */
  path?: string
  zipPath?: string
  folderPath?: string
  noteCount?: number
  missingCount?: number
}

const CITE_RE = /\[(itm_[a-zA-Z0-9]+)\]/g
const SOURCE_URL_RE = /(?:^|\n)\s*Source(?:\s+URL)?\s*:\s*(\S+)/i

function slugify(title: string): string {
  const s = (title || 'chat')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'chat'
}

function dateStamp(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export function packFolderName(sessionTitle: string, when = new Date()): string {
  return `vault-citation-pack-${slugify(sessionTitle)}-${dateStamp(when)}`
}

function safeNoteFilename(title: string, id: string): string {
  const base = (title || 'note')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const safeBase = base || 'note'
  const shortId = id.replace(/^itm_/, '').slice(0, 12)
  return `${safeBase}-${shortId || id}.md`
}

function parseCitationsJson(json: string | null): Citation[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as Citation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseHitsJson(json: string | null): SearchHit[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as SearchHit[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Union of citation ids + hit ids from assistant messages (+ inline [itm_] in content). */
export function collectNoteIdsFromMessages(messages: ChatMessage[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const add = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ordered.push(id)
  }

  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const c of parseCitationsJson(m.citations_json)) add(c.id)
    for (const h of parseHitsJson(m.hits_json)) add(h.id)
    for (const id of extractCitedIds(m.content || '')) add(id)
    // Also catch any itm_ in content that extractCitedIds might miss (same regex)
    const re = new RegExp(CITE_RE.source, 'g')
    let match: RegExpExecArray | null
    while ((match = re.exec(m.content || '')) !== null) add(match[1])
  }
  return ordered
}

export function extractSourceUrl(body: string): string | undefined {
  const m = body.match(SOURCE_URL_RE)
  return m?.[1]?.trim() || undefined
}

function profileHintFromSession(session: ChatSession): string | undefined {
  if (!session.filters_json) return undefined
  try {
    const f = JSON.parse(session.filters_json) as { project?: string; para?: string; kind?: string }
    const parts: string[] = []
    if (f.project?.trim()) parts.push(`project:${f.project.trim()}`)
    if (f.para) parts.push(`para:${f.para}`)
    if (f.kind) parts.push(`kind:${f.kind}`)
    return parts.length ? parts.join(' · ') : undefined
  } catch {
    return undefined
  }
}

export function buildInstructionsMd(): string {
  return `# Citation pack — instructions for another model

You are answering from a **Local Knowledge Vault** citation pack. Treat this folder as your only evidence.

1. **Answer only from NOTES** in this pack (see \`notes/\` and the NOTES section of \`context.md\`).
2. **Cite claims** as \`[itm_…]\` using ids that appear in NOTES (e.g. \`[itm_abc123]\`).
3. If the notes do not support an answer, say you don’t know.
4. **Do not invent** item ids, titles, or facts that are not in the notes.
5. Prefer the THREAD for what was already asked; ground new answers in NOTES.

The human may paste \`context.md\` alone into ChatGPT / Claude / Grok — it concatenates these instructions, the Ask thread, and all note bodies.
`
}

function formatThreadMd(messages: ChatMessage[], missingIds: string[]): string {
  const lines: string[] = ['# Ask thread', '']
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  if (turns.length === 0) {
    lines.push('_No user/assistant messages in this session._', '')
  } else {
    for (const m of turns) {
      const label = m.role === 'user' ? 'User' : 'Assistant'
      lines.push(`## ${label}`, '', m.content || '', '')
      if (m.role === 'assistant') {
        const cites = parseCitationsJson(m.citations_json)
        if (cites.length > 0) {
          const ids = cites.map((c) => `[${c.id}]`).join(' ')
          lines.push(`Citations: ${ids}`, '')
        }
      }
    }
  }
  if (missingIds.length > 0) {
    lines.push(
      '## Notes',
      '',
      'The following cited or retrieved ids were **not found** in the vault database and have no note file:',
      '',
      ...missingIds.map((id) => `- \`${id}\``),
      ''
    )
  }
  return lines.join('\n')
}

function formatNoteFile(item: Item): string {
  const sourceUrl = extractSourceUrl(item.body)
  const metaParts = [
    item.project ? `project: ${item.project}` : null,
    `kind: ${item.kind}`,
    `para: ${item.para}`,
    sourceUrl ? `source: ${sourceUrl}` : null,
  ].filter(Boolean)
  return [
    `# [${item.id}] ${item.title}`,
    `meta: ${metaParts.join(' / ')}`,
    '',
    item.body || '',
    '',
  ].join('\n')
}

function formatContextMd(
  instructions: string,
  thread: string,
  notes: Array<{ item: Item; content: string }>,
  missingIds: string[]
): string {
  const parts: string[] = [
    instructions.trim(),
    '',
    '---',
    '',
    thread.trim(),
    '',
    '---',
    '',
    '# NOTES',
    '',
  ]

  let total = parts.join('\n').length
  let truncated = false

  for (const { item, content } of notes) {
    let body = content
    if (item.body.length > CONTEXT_NOTE_BODY_MAX) {
      body = [
        `# [${item.id}] ${item.title}`,
        `meta: truncated for context.md (full body in notes/${safeNoteFilename(item.title, item.id)})`,
        '',
        item.body.slice(0, CONTEXT_NOTE_BODY_MAX),
        '',
        `\n\n<!-- TRUNCATED: original body ${item.body.length} chars; see notes/ file for full text -->\n`,
      ].join('\n')
    }
    if (total + body.length + 8 > CONTEXT_TOTAL_MAX) {
      parts.push(
        '',
        `<!-- OMITTED remaining notes from context.md to stay under ~${CONTEXT_TOTAL_MAX} chars; see notes/ and manifest.json -->`,
        ''
      )
      truncated = true
      break
    }
    parts.push(body, '', '---', '')
    total += body.length + 8
  }

  if (missingIds.length > 0) {
    parts.push(
      '## Missing ids',
      '',
      ...missingIds.map((id) => `- \`${id}\``),
      ''
    )
  }

  if (truncated) {
    parts.push('_Some note bodies were truncated or omitted in this paste file; individual files under `notes/` are complete._', '')
  }

  return parts.join('\n')
}

/**
 * Pure build: given session + messages (+ optional profile hint), produce pack files.
 */
export function buildCitationPack(
  session: ChatSession,
  messages: ChatMessage[],
  options?: { profileHint?: string; exportedAt?: string; getItemFn?: (id: string) => Item | null }
): CitationPackBuilt {
  const get = options?.getItemFn ?? getItem
  const exportedAt = options?.exportedAt ?? new Date().toISOString()
  const noteIds = collectNoteIdsFromMessages(messages)

  const found: Item[] = []
  const missingIds: string[] = []
  for (const id of noteIds) {
    const item = get(id)
    if (item) found.push(item)
    else missingIds.push(id)
  }

  const instructions = buildInstructionsMd()
  const thread = formatThreadMd(messages, missingIds)
  const noteFiles = found.map((item) => ({
    item,
    filename: safeNoteFilename(item.title, item.id),
    content: formatNoteFile(item),
  }))
  const context = formatContextMd(
    instructions,
    thread,
    noteFiles.map((n) => ({ item: n.item, content: n.content })),
    missingIds
  )

  const hint = options?.profileHint ?? profileHintFromSession(session)
  const manifest: CitationPackManifest = {
    version: CITATION_PACK_VERSION,
    exportedAt,
    app: 'Vault',
    sessionId: session.id,
    sessionTitle: session.title,
    ...(hint ? { profileHint: hint } : {}),
    noteIds: found.map((i) => i.id),
    notes: found.map((i) => {
      const sourceUrl = extractSourceUrl(i.body)
      const meta: CitationPackNoteMeta = {
        id: i.id,
        title: i.title,
        project: i.project,
      }
      if (sourceUrl) meta.sourceUrl = sourceUrl
      return meta
    }),
    missingIds,
  }

  const files: CitationPackFile[] = [
    { relativePath: 'INSTRUCTIONS.md', content: instructions },
    { relativePath: 'thread.md', content: thread },
    { relativePath: 'context.md', content: context },
    { relativePath: 'manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' },
    ...noteFiles.map((n) => ({
      relativePath: `notes/${n.filename}`,
      content: n.content,
    })),
  ]

  return {
    folderName: packFolderName(session.title),
    files,
    manifest,
  }
}

/** Load session + messages from DB and build pack. */
export function buildCitationPackForSession(
  sessionId: string,
  options?: { profileHint?: string }
): CitationPackBuilt {
  const session = getSession(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  const messages = listMessages(sessionId)
  return buildCitationPack(session, messages, options)
}

export function writeCitationPackFolder(dir: string, pack: CitationPackBuilt): string {
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(path.join(dir, 'notes'), { recursive: true })
  for (const f of pack.files) {
    const dest = path.join(dir, f.relativePath)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, f.content, 'utf8')
  }
  return dir
}

/** Minimal ZIP (store + deflate) writer — no extra dependency. */
export function writeZipFromFiles(zipPath: string, files: CitationPackFile[]): void {
  type Entry = {
    name: string
    data: Buffer
    crc: number
    compressed: Buffer
    method: number
    localOffset: number
  }

  const entries: Entry[] = []
  for (const f of files) {
    const name = f.relativePath.replace(/\\/g, '/')
    const data = Buffer.from(f.content, 'utf8')
    const crc = crc32(data) >>> 0
    const compressed = deflateRawSync(data)
    const method = compressed.length < data.length ? 8 : 0
    const payload = method === 8 ? compressed : data
    entries.push({
      name,
      data,
      crc,
      compressed: payload,
      method,
      localOffset: 0,
    })
  }

  const localParts: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    e.localOffset = offset
    const nameBuf = Buffer.from(e.name, 'utf8')
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(e.method, 8)
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0, 12) // date
    local.writeUInt32LE(e.crc, 14)
    local.writeUInt32LE(e.compressed.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    nameBuf.copy(local, 30)
    localParts.push(local, e.compressed)
    offset += local.length + e.compressed.length
  }

  const centralParts: Buffer[] = []
  let centralSize = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const cen = Buffer.alloc(46 + nameBuf.length)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0, 8)
    cen.writeUInt16LE(e.method, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0, 14)
    cen.writeUInt32LE(e.crc, 16)
    cen.writeUInt32LE(e.compressed.length, 20)
    cen.writeUInt32LE(e.data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0, 38)
    cen.writeUInt32LE(e.localOffset, 42)
    nameBuf.copy(cen, 46)
    centralParts.push(cen)
    centralSize += cen.length
  }

  const centralOffset = offset
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  fs.mkdirSync(path.dirname(zipPath), { recursive: true })
  fs.writeFileSync(zipPath, Buffer.concat([...localParts, ...centralParts, end]))
}

export function writeCitationPackZip(zipPath: string, pack: CitationPackBuilt): string {
  writeZipFromFiles(zipPath, pack.files)
  return zipPath
}

/**
 * Write pack as folder under parentDir (named pack.folderName) and a sibling .zip.
 * Returns paths.
 */
export function writeCitationPack(
  parentDir: string,
  pack: CitationPackBuilt
): { folderPath: string; zipPath: string } {
  const folderPath = path.join(parentDir, pack.folderName)
  writeCitationPackFolder(folderPath, pack)
  const zipPath = path.join(parentDir, `${pack.folderName}.zip`)
  writeCitationPackZip(zipPath, pack)
  return { folderPath, zipPath }
}
