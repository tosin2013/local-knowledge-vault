/**
 * Import Markdown / Obsidian notes from a folder — walk `.md` files, parse
 * YAML frontmatter, infer note fields, and batch-insert in one transaction.
 *
 * Mapping (#190):
 * - title: frontmatter `title` → first `# heading` → filename stem.
 * - body: file content minus frontmatter and the leading H1, with Obsidian
 *   `[[wiki links]]` normalized to plain text for cleaner search.
 * - para/kind/status: frontmatter `para`/`kind`/`status`, else note defaults.
 * - project: frontmatter `project` → first frontmatter `tag` → first inline
 *   `#tag` → containing subfolder → the folder's own name.
 *
 * Pure helpers are exported for the offline smoke test.
 */
import fs from 'fs'
import path from 'path'
import { createItem, runInTransaction } from './db'
import type { MarkdownImportResult, Para } from './types'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const SUMMARY_CHARS = 240

const PARA_SET = new Set<Para>(['projects', 'areas', 'resources', 'archives'])

/** Directories that are part of Obsidian/Git tooling, never notes. */
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules'])

export interface FrontmatterData {
  title?: string
  summary?: string
  para?: string
  kind?: string
  status?: string
  project?: string
  tags?: string[]
}

/** Strip optional quotes from a scalar YAML value. */
function parseScalar(value: string): string {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim()
  }
  return v
}

/** Split a `tags` value (inline array / comma / space) plus an indented list into clean tags. */
function parseTags(inline: string, listLines: string[]): string[] {
  const out: string[] = []
  const push = (raw: string): void => {
    const t = raw
      .trim()
      .replace(/^#/, '')
      .replace(/^["']|["']$/g, '')
      .replace(/,$/, '')
      .trim()
    if (t) out.push(t)
  }
  if (inline) {
    const cleaned = inline.replace(/^\[/, '').replace(/\]$/, '')
    for (const part of cleaned.split(',')) {
      for (const sub of part.trim().split(/\s+/)) push(sub)
    }
  }
  for (const line of listLines) {
    const m = line.match(/^\s*-\s*(.*)$/)
    if (m) push(m[1])
  }
  return out
}

/**
 * Parse the common Obsidian YAML frontmatter shape: flat `key: value` scalars
 * and a `tags` list (inline array, comma/space separated, or an indented list).
 * Unknown keys are ignored. Not a full YAML parser — enough for note metadata.
 */
export function parseYamlFrontmatter(raw: string): FrontmatterData {
  const data: FrontmatterData = {}
  const lines = raw.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s+-\s+/.test(line)) continue // indented list item handled by its parent key
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const rawValue = m[2].trim()

    if (key === 'tags') {
      const listLines: string[] = []
      if (!rawValue) {
        let j = i + 1
        while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
          listLines.push(lines[j])
          j++
        }
      }
      data.tags = parseTags(rawValue, listLines)
      continue
    }

    if (!rawValue) continue
    const value = parseScalar(rawValue)
    switch (key) {
      case 'title':
        data.title = value
        break
      case 'summary':
        data.summary = value
        break
      case 'para':
        data.para = value
        break
      case 'kind':
        data.kind = value
        break
      case 'status':
        data.status = value
        break
      case 'project':
        data.project = value
        break
    }
  }
  return data
}

/** Split a leading `--- … ---` frontmatter block from the body. */
export function splitFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const text = content.replace(/^\uFEFF/, '')
  const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return { data: {}, body: text }
  return { data: parseYamlFrontmatter(m[1]), body: text.slice(m[0].length) }
}

/**
 * The first non-empty line, when it is an H1 (`# …`). Returns null when the
 * note starts with anything else (H2+ is a section, not a title).
 */
export function firstHeading(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^#\s+(.+?)\s*#*\s*$/)
    return m ? m[1].trim() : null
  }
  return null
}

/** Replace Obsidian `[[target|alias]]` / `![[embed]]` with plain text. */
export function normalizeWikiLinks(body: string): string {
  return body.replace(/!?\[\[([^\]\r\n]+?)\]\]/g, (_all, inner: string) => {
    const parts = inner.split('|')
    const label = (parts.length > 1 ? parts[1] : parts[0]).trim()
    return label.replace(/#[^\s]*$/, '') // drop a `#heading` anchor
  })
}

/** Collect inline `#tags` from the body (word/`/`/`-` after `#`, not a heading). */
export function inlineTags(body: string): string[] {
  const out: string[] = []
  const re = /(?:^|\s)#([A-Za-z][\w/-]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) out.push(m[1])
  return out
}

export interface ParsedMarkdown {
  title: string
  body: string
  summary: string
  para: Para
  kind: string
  status: string
  project: string | null
}

/** Strip the single leading H1 (it becomes the title) from a body. */
function stripLeadingHeading(body: string): string {
  return body.replace(/^[ \t]*#[ \t]+[^\r\n]*(?:\r?\n|$)/, '')
}

function resolveProject(
  data: FrontmatterData,
  body: string,
  ctx: { rootName: string; relDir: string },
): string | null {
  const explicit = (data.project ?? '').trim()
  if (explicit) return explicit.slice(0, 80)
  const tag = data.tags?.[0] ?? inlineTags(body)[0]
  if (tag) return tag.slice(0, 80)
  const rel = ctx.relDir.replace(/^[/\\]+|[/\\]+$/g, '')
  if (rel) return rel.split(/[/\\]/)[0].slice(0, 80)
  return ctx.rootName || null
}

/** Parse one Markdown file into note fields, or null to skip it (empty file). */
export function parseMarkdownNote(
  fileName: string,
  content: string,
  ctx: { rootName: string; relDir: string },
): ParsedMarkdown | null {
  const { data, body: afterFm } = splitFrontmatter(content)
  const heading = firstHeading(afterFm)
  const stem = fileName.replace(/\.md$/i, '').trim()
  const title = (data.title?.trim() || heading || stem) || 'Untitled'

  let body = stripLeadingHeading(afterFm)
  body = normalizeWikiLinks(body).trim()

  if (!body && !data.title && !heading) return null

  const summary =
    (data.summary && data.summary.trim()) ||
    body.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS) ||
    title

  const para: Para = PARA_SET.has(data.para as Para) ? (data.para as Para) : 'resources'
  const kind = (data.kind && data.kind.trim()) || 'note'
  const status = (data.status && data.status.trim()) || 'active'

  return { title, body, summary, para, kind, status, project: resolveProject(data, body, ctx) }
}

/** Recursively list `.md` files, skipping hidden files/dirs and tooling dirs. */
export function listMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        walk(full)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * Import every Markdown file under `dir` as a note, in a single transaction.
 * Returns counts and per-file errors; never throws on an unreadable file.
 */
export function importMarkdownFolder(dir: string): MarkdownImportResult {
  const root = path.resolve(dir)
  const rootName = path.basename(root)
  const files = listMarkdownFiles(root)
  const errors: string[] = []
  const itemIds: string[] = []
  let imported = 0
  let skipped = 0

  runInTransaction(() => {
    for (const file of files) {
      let content: string
      try {
        const stat = fs.statSync(file)
        if (stat.size > MAX_FILE_BYTES) {
          skipped++
          errors.push(`${path.basename(file)}: too large (${stat.size} bytes)`)
          continue
        }
        content = fs.readFileSync(file, 'utf8')
      } catch (e) {
        skipped++
        errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }

      const relDir = path.relative(root, path.dirname(file))
      const parsed = parseMarkdownNote(path.basename(file), content, { rootName, relDir })
      if (!parsed) {
        skipped++
        continue
      }

      const item = createItem({
        title: parsed.title,
        summary: parsed.summary,
        body: parsed.body,
        para: parsed.para,
        kind: parsed.kind,
        status: parsed.status,
        project: parsed.project,
      })
      itemIds.push(item.id)
      imported++
    }
  })

  return { imported, skipped, itemIds, errors }
}
