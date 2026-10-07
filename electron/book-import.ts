/**
 * Import local books as checkable notes (#162).
 *
 * EPUB: unzip in memory (jszip) → read the OPF spine order → one note per
 * chapter (`kind: 'book'`, `para: 'resources'`, `project: '<book title>'`).
 * Very long chapters are split into "<Book> · <Chapter> (part N)" notes.
 *
 * PDF: text layer only (pdfjs-dist, loaded lazily) → per-page text grouped into
 * notes with page provenance. Pages with no text layer are counted in
 * `emptyPages` and create no notes — OCR for scanned PDFs is out of scope.
 *
 * Pure helpers are exported for the offline smoke test.
 */
import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { createItem, runInTransaction } from './db'
import type { BookImportResult } from './types'

/** Summary length, matching media notes. */
const SUMMARY_CHARS = 180
/** Soft cap for a single note body, matching the citation pack. */
const MAX_BODY_CHARS = 50_000
/** Target characters per EPUB chapter part (very long chapters get split). */
const CHAPTER_PART_CHARS = 20_000
/** Target characters for a merged group of consecutive PDF pages. */
const DEFAULT_GROUP_CHARS = 1500

interface PageGroup {
  text: string
  /** 1-based page number of the first page in the group. */
  startPage: number
  /** 1-based page number of the last page in the group. */
  endPage: number
}

export interface BookChapter {
  title: string
  text: string
}

export interface ParsedBook {
  title: string
  chapters: BookChapter[]
}

/** `'epub'` / `'pdf'` from the file extension, else `null`. */
export function detectBookFormat(fileName: string): 'epub' | 'pdf' | null {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.epub') return 'epub'
  if (ext === '.pdf') return 'pdf'
  return null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function codePointToString(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

/** Decode the basic XML/HTML entities plus numeric references. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (all, hex: string) =>
      codePointToString(parseInt(hex, 16), all)
    )
    .replace(/&#(\d+);/g, (all, dec: string) => codePointToString(parseInt(dec, 10), all))
    .replace(/&([a-zA-Z]+);/g, (all, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? all)
}

/**
 * Turn one XHTML/HTML chapter into plain text: drop script/style blocks and
 * tags, decode entities, collapse whitespace.
 */
export function epubTextFromHtml(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
}

/** Strip inner tags from a title fragment and collapse whitespace. */
function titleFromMarkup(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Chapter title from an XHTML `<title>`, then the first `<h1>`, then `<h2>`. */
export function epubChapterTitle(html: string): string | null {
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i, /<h2[^>]*>([\s\S]*?)<\/h2>/i]) {
    const m = html.match(re)
    if (m) {
      const title = titleFromMarkup(m[1])
      if (title) return title
    }
  }
  return null
}

/**
 * Group consecutive PDF pages into notes. Short, adjacent pages merge up to
 * `maxChars`; empty pages are dropped; page numbers are 1-based. A page range
 * only ever covers adjacent pages, so `p.N–M` never implies a skipped page.
 */
export function groupPages(pages: string[], opts?: { maxChars?: number }): PageGroup[] {
  const maxChars = opts?.maxChars ?? DEFAULT_GROUP_CHARS
  const groups: PageGroup[] = []
  let buf: string[] = []
  let bufChars = 0
  let startPage = 0
  let endPage = 0

  const flush = (): void => {
    if (buf.length === 0) return
    const text = buf.join('\n\n').replace(/\s+/g, ' ').trim()
    if (text) groups.push({ text, startPage, endPage })
    buf = []
    bufChars = 0
  }

  for (let i = 0; i < pages.length; i++) {
    const clean = (pages[i] ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const pageNo = i + 1
    const adjacent = buf.length > 0 && endPage === pageNo - 1
    const nextChars = bufChars + (buf.length > 0 ? 2 : 0) + clean.length
    if (buf.length > 0 && (!adjacent || nextChars > maxChars)) flush()
    if (buf.length === 0) {
      startPage = pageNo
      bufChars = 0
    }
    buf.push(clean)
    bufChars += (buf.length > 1 ? 2 : 0) + clean.length
    endPage = pageNo
  }
  flush()
  return groups
}

/** Note title for a PDF page group: `"<Book> · p.3"` or `"<Book> · p.3–4"`. */
export function pageNoteTitle(book: string, startPage: number, endPage = startPage): string {
  const source = (book ?? '').trim() || 'Book'
  const locator = startPage === endPage ? `p.${startPage}` : `p.${startPage}\u2013${endPage}`
  return `${source} · ${locator}`
}

/** Note title for an EPUB chapter: `"<Book> · <Chapter>"` (+ `" (part N)"`). */
export function chapterNoteTitle(book: string, chapter: string, part?: number): string {
  const source = (book ?? '').trim() || 'Book'
  const name = (chapter ?? '').trim()
  const base = !name || name === source ? source : `${source} · ${name}`
  return part && part > 1 ? `${base} (part ${part})` : base
}

/** First ~180 chars of the source text, whitespace-collapsed. */
function summarize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS)
}

/** Split text on word boundaries into parts no longer than `maxChars`. */
function chunkText(text: string, maxChars: number): string[] {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return [trimmed]
  const parts: string[] = []
  let rest = trimmed
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars)
    if (cut < Math.floor(maxChars / 2)) cut = maxChars
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

/** Provenance header mirroring media notes, then a blank line and the text. */
function buildBookBody(opts: {
  fileName: string
  chapter?: string
  startPage?: number
  endPage?: number
  text: string
}): string {
  const lines = [`Source: ${opts.fileName}`]
  if (opts.chapter !== undefined) lines.push(`Chapter: ${opts.chapter}`)
  if (opts.startPage !== undefined) {
    const end = opts.endPage ?? opts.startPage
    lines.push(opts.startPage === end ? `Page: ${opts.startPage}` : `Pages: ${opts.startPage}\u2013${end}`)
  }
  lines.push('', opts.text.trim())
  return lines.join('\n').slice(0, MAX_BODY_CHARS)
}

function sanitizeTitle(raw: string, fallback: string): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 200) : fallback
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Resolve an OPF `href` relative to the OPF's own directory inside the zip. */
function resolveEpubHref(opfPath: string, href: string): string {
  let clean = href.split('#')[0]
  try {
    clean = decodeURIComponent(clean)
  } catch {
    /* keep the raw href */
  }
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '')
  return path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), clean))
}

function getAttr(tag: string, name: string): string | null {
  const dq = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
  if (dq) return dq[1]
  const sq = tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'))
  return sq ? sq[1] : null
}

/** Parse an EPUB (already-read bytes) into its title and chapter texts. */
export async function parseEpub(buf: Buffer, fileName: string): Promise<ParsedBook> {
  const stem = path.basename(fileName, path.extname(fileName)).trim() || 'Book'
  const zip = await JSZip.loadAsync(buf)

  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('EPUB is missing META-INF/container.xml')
  const containerXml = await containerFile.async('string')
  const rootfile = containerXml.match(/<rootfile\b[^>]*>/i)
  const opfPath = rootfile ? getAttr(rootfile[0], 'full-path') : null
  if (!opfPath) throw new Error('EPUB container.xml has no rootfile full-path')

  const opfFile = zip.file(opfPath) ?? zip.file(opfPath.replace(/^\/+/, ''))
  if (!opfFile) throw new Error(`EPUB OPF not found: ${opfPath}`)
  const opfXml = await opfFile.async('string')

  const titleMatch = opfXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)
  const title = sanitizeTitle(titleMatch ? titleFromMarkup(titleMatch[1]) : '', stem)

  const manifest = new Map<string, string>()
  for (const m of opfXml.matchAll(/<(?:[\w.-]+:)?item\b[^>]*>/gi)) {
    const tag = m[0]
    const id = getAttr(tag, 'id')
    const href = getAttr(tag, 'href')
    if (!id || !href) continue
    const media = getAttr(tag, 'media-type') ?? ''
    if (/\bhtml\b/i.test(media) || /\.x?html?$/i.test(href.split('#')[0])) {
      manifest.set(id, href)
    }
  }

  const spineIds: string[] = []
  for (const m of opfXml.matchAll(/<(?:[\w.-]+:)?itemref\b[^>]*>/gi)) {
    const idref = getAttr(m[0], 'idref')
    if (idref) spineIds.push(idref)
  }

  const chapters: BookChapter[] = []
  for (const idref of spineIds) {
    const href = manifest.get(idref)
    if (!href) continue
    const zipPath = resolveEpubHref(opfPath, href)
    const entry = zip.file(zipPath)
    if (!entry) continue
    const html = await entry.async('string')
    const text = epubTextFromHtml(html)
    const chapterTitle = epubChapterTitle(html) ?? title
    chapters.push({ title: chapterTitle, text })
  }

  return { title, chapters }
}

function importEpub(fileName: string, buf: Buffer): Promise<BookImportResult> {
  return parseEpub(buf, fileName)
    .then(({ title, chapters }) => {
      const itemIds: string[] = []
      let imported = 0
      let skipped = 0
      runInTransaction(() => {
        for (const chapter of chapters) {
          if (!chapter.text) {
            skipped++
            continue
          }
          const parts = chunkText(chapter.text, CHAPTER_PART_CHARS)
          parts.forEach((part, index) => {
            const item = createItem({
              title: chapterNoteTitle(title, chapter.title, index + 1),
              summary: summarize(part),
              body: buildBookBody({ fileName, chapter: chapter.title, text: part }),
              para: 'resources',
              kind: 'book',
              status: 'active',
              project: title,
            })
            itemIds.push(item.id)
            imported++
          })
        }
      })
      return { format: 'epub' as const, project: title, imported, skipped, itemIds, errors: [] }
    })
    .catch((e) => ({
      format: 'epub' as const,
      imported: 0,
      skipped: 0,
      itemIds: [],
      errors: [errorMessage(e)],
    }))
}

async function importPdf(fileName: string, buf: Buffer): Promise<BookImportResult> {
  let destroy: (() => Promise<void>) | null = null
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buf),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    } as Parameters<typeof pdfjs.getDocument>[0])
    destroy = () => loadingTask.destroy()
    const doc = await loadingTask.promise

    const stem = path.basename(fileName, path.extname(fileName)).trim() || 'Book'
    let title = stem
    try {
      const meta = await doc.getMetadata()
      const raw = (meta.info as { Title?: string } | undefined)?.Title
      if (raw) title = sanitizeTitle(raw, stem)
    } catch {
      /* metadata is optional */
    }

    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      pages.push(text)
    }
    const emptyPages = pages.filter((p) => !p).length

    const itemIds: string[] = []
    let imported = 0
    runInTransaction(() => {
      for (const group of groupPages(pages)) {
        const item = createItem({
          title: pageNoteTitle(title, group.startPage, group.endPage),
          summary: summarize(group.text),
          body: buildBookBody({
            fileName,
            startPage: group.startPage,
            endPage: group.endPage,
            text: group.text,
          }),
          para: 'resources',
          kind: 'book',
          status: 'active',
          project: title,
        })
        itemIds.push(item.id)
        imported++
      }
    })
    return { format: 'pdf', project: title, imported, skipped: 0, emptyPages, itemIds, errors: [] }
  } catch (e) {
    return {
      format: 'pdf',
      imported: 0,
      skipped: 0,
      emptyPages: 0,
      itemIds: [],
      errors: [errorMessage(e)],
    }
  } finally {
    if (destroy) {
      try {
        await destroy()
      } catch {
        /* ignore cleanup */
      }
    }
  }
}

/** Detect the format from `filePath`, read it and import its notes. */
export async function importBookFromPath(filePath: string): Promise<BookImportResult> {
  const fileName = path.basename(filePath)
  const format = detectBookFormat(fileName)
  if (!format) {
    return { imported: 0, skipped: 0, itemIds: [], errors: [`Unsupported book format: ${fileName}`] }
  }

  let buf: Buffer
  try {
    buf = fs.readFileSync(filePath)
  } catch (e) {
    return { format, imported: 0, skipped: 0, itemIds: [], errors: [errorMessage(e)] }
  }

  return format === 'epub' ? importEpub(fileName, buf) : importPdf(fileName, buf)
}
