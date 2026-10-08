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
    // <head> holds the <title>, which is metadata, not text of the section (#239).
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim()
}

/** Strip inner tags from a title fragment and collapse whitespace. */
function titleFromMarkup(fragment: string): string {
  return normalizeLetterSpacing(decodeEntities(fragment.replace(/<[^>]*>/g, '')))
}

/**
 * Undo letter-spaced display titles (#239): `B E N J A M I N` → `BENJAMIN`. Runs of four or
 * more single letters/digits are joined; two or more spaces still separate words, so
 * `B E N  F R A N K` → `BEN FRANK`. Also collapses whitespace.
 */
export function normalizeLetterSpacing(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .split(/\s{2,}/)
    .map((part) =>
      part.replace(/(?<!\S)((?:[\p{L}\p{N}] ){3,}[\p{L}\p{N}])(?![\p{L}\p{N}])/gu, (run) => run.replace(/ /g, '')),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PG_START_RE = /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG E-?BOOK[^*]*\*{3}/i
const PG_END_RE = /\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG E-?BOOK[^*]*\*{3}|\bEnd of (?:the )?Project Gutenberg'?s?\b/i
const PG_LICENSE_RE = /\bTHE FULL PROJECT GUTENBERG(?:\u2122|\(TM\))?\s+LICEN[CS]E\b|\bSTART: FULL LICEN[CS]E\b/i
const PG_HEADER_RE = /\bfor the use of anyone anywhere\b/i

/**
 * Remove Project Gutenberg wrapping from one section's text (#239): everything up to the
 * `*** START OF … ***` line, everything from the `*** END OF … ***` line or the licence on,
 * and a section that is only the standard eBook header. Returns '' when nothing real is left.
 */
export function stripGutenbergBoilerplate(text: string): string {
  let t = text
  const start = PG_START_RE.exec(t)
  if (start) t = t.slice(start.index + start[0].length)
  const end = PG_END_RE.exec(t)
  if (end) t = t.slice(0, end.index)
  const license = PG_LICENSE_RE.exec(t)
  if (license) t = t.slice(0, license.index)
  t = t.trim()
  // A header-only section ("The Project Gutenberg eBook of …, This eBook is for the use of
  // anyone anywhere …") with no START marker of its own.
  if (/project gutenberg/i.test(t) && PG_HEADER_RE.test(t) && t.length < 3000) return ''
  return t
}

/** Sections with fewer words than this (besides their own title) are covers or image pages. */
export const MIN_SECTION_WORDS = 3

/** Clean one EPUB section for import; '' means skip it (#239). */
export function cleanEpubSection(text: string, sectionTitle: string | null): string {
  const t = stripGutenbergBoilerplate(text)
  if (!t) return ''
  let rest = t
  if (sectionTitle) {
    const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const titleNorm = norm(sectionTitle)
    if (titleNorm && norm(rest).startsWith(titleNorm)) rest = norm(rest).slice(titleNorm.length)
  }
  const words = rest.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  return words.length < MIN_SECTION_WORDS ? '' : t
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
 * Section title for an EPUB document. Gutenberg's split files sometimes take their
 * `<title>` from the licence heading at the end of the file; then the first heading
 * that is not Gutenberg boilerplate is used instead (#239).
 */
export function epubSectionTitle(html: string): string | null {
  const title = epubChapterTitle(html)
  if (!title || !/project gutenberg/i.test(title)) return title
  for (const m of html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const heading = titleFromMarkup(m[2])
    if (heading && !/project gutenberg/i.test(heading)) return heading
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

  const flush = (carry: boolean): void => {
    if (buf.length === 0) return
    const text = buf.join('\n\n').replace(/\s+/g, ' ').trim()
    // Carry a trailing sentence fragment (no terminal punctuation) into the
    // next note, so a sentence split across a page boundary is joined instead
    // of being cut mid-idea (#272). The final flush does not carry — there is
    // no next note, so the fragment would be dropped.
    const m = carry ? text.match(/([.!?])\s+([^.!?]+)$/) : null
    if (m && m[2].length <= maxChars) {
      const complete = text.slice(0, m.index! + 1).trim()
      if (complete) groups.push({ text: complete, startPage, endPage })
      buf = [m[2]]
      bufChars = m[2].length
      startPage = endPage
    } else {
      groups.push({ text, startPage, endPage })
      buf = []
      bufChars = 0
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const clean = (pages[i] ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    const pageNo = i + 1
    const adjacent = buf.length > 0 && endPage === pageNo - 1
    const nextChars = bufChars + (buf.length > 0 ? 2 : 0) + clean.length
    if (buf.length > 0 && (!adjacent || nextChars > maxChars)) flush(true)
    if (buf.length === 0) {
      startPage = pageNo
      bufChars = 0
    }
    buf.push(clean)
    bufChars += (buf.length > 1 ? 2 : 0) + clean.length
    endPage = pageNo
  }
  flush(false)
  return groups
}

/** Note title for a PDF page group: `"<Book> · p.3"` or `"<Book> · p.3–4"`. */
export function pageNoteTitle(book: string, startPage: number, endPage = startPage): string {
  const source = (book ?? '').trim() || 'Book'
  const locator = startPage === endPage ? `p.${startPage}` : `p.${startPage}\u2013${endPage}`
  return `${source} · ${locator}`
}

/** Known cookie-consent / privacy-banner phrases that pollute printed pages. */
const BANNER_PATTERNS: RegExp[] = [
  /we use cookies/i,
  /accept (all )?cookies/i,
  /manage cookie/i,
  /cookie (settings|preferences|consent|policy)/i,
  /by (continuing|using this site|clicking)/i,
  /privacy (policy|preferences|center|notice)/i,
  /terms of (use|service)/i,
]

/** A numbered section heading like "8.1 Overview of Photosynthesis". */
const SECTION_HEADING_RE = /^\d{1,3}(?:\.\d+)*\s+\S.{2,}/

export interface PdfLine {
  text: string
  /** Representative font height in PDF units (0 when unknown). */
  height: number
}

/** Extract text lines from pdfjs `getTextContent()` items, grouped by y-position. */
export function extractPageLines(content: unknown): PdfLine[] {
  const items = (content as { items?: unknown[] } | undefined)?.items ?? []
  const lines = new Map<number, Array<{ x: number; str: string; height: number }>>()
  for (const raw of items) {
    const it = raw as { str?: unknown; transform?: unknown; height?: unknown }
    if (typeof it?.str !== 'string' || !it.str.trim()) continue
    const t = it.transform as number[] | undefined
    const y = t && t.length >= 6 ? Math.round(t[5]) : 0
    const x = t && t.length >= 6 ? t[4] : 0
    const height = typeof it.height === 'number' && it.height > 0 ? it.height : 0
    const arr = lines.get(y) ?? []
    arr.push({ x, str: it.str, height })
    lines.set(y, arr)
  }
  return [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, arr]) => {
      const sorted = arr.sort((p, q) => p.x - q.x)
      return {
        text: sorted.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim(),
        height: sorted.reduce((m, p) => Math.max(m, p.height), 0),
      }
    })
    .filter((l) => l.text)
}

export interface CleanedPdfPages {
  pages: string[]
  /** A detected section heading per page (1-based index), or null. */
  sectionTitles: Array<string | null>
  removedLines: number
}

/** Smallest positive line height for a page (a proxy for body text size). */
function minLineHeight(lines: PdfLine[]): number {
  const heights = (lines ?? []).map((l) => l.height).filter((h) => h > 0)
  if (heights.length === 0) return 0
  return Math.min(...heights)
}

/** A line is a section heading when it is a numbered section or clearly larger than body text. */
function isSectionHeading(line: PdfLine, bodyHeight: number): boolean {
  const text = line.text.trim()
  if (!text || text.length > 80) return false
  if (SECTION_HEADING_RE.test(text)) return true
  return bodyHeight > 0 && line.height > bodyHeight * 1.25
}

/**
 * Remove junk that repeats on printed pages (#272): a line that appears on at
 * least half the pages is a running header/footer (or a cookie banner) and is
 * dropped. Known banner phrases are dropped even when they do not repeat. Also
 * detects a section heading — a numbered section, or a line in a clearly larger
 * font than the body text.
 */
export function cleanPdfPages(pageLines: PdfLine[][]): CleanedPdfPages {
  const list = pageLines ?? []
  const lineSets = list.map((lines) => new Set((lines ?? []).map((l) => l.text.trim()).filter(Boolean)))

  const counts = new Map<string, number>()
  for (const set of lineSets) for (const l of set) counts.set(l, (counts.get(l) ?? 0) + 1)

  const threshold = Math.max(2, Math.ceil(list.length / 2))
  const repeated = new Set<string>()
  for (const [l, c] of counts) if (c >= threshold) repeated.add(l)

  let removedLines = 0
  const cleaned: string[] = []
  const sectionTitles: Array<string | null> = []
  for (const lines of list) {
    const kept: string[] = []
    let section: string | null = null
    const bodyHeight = minLineHeight(lines ?? [])
    for (const line of lines ?? []) {
      const text = line.text.trim()
      if (!text) continue
      const drop = repeated.has(text) || BANNER_PATTERNS.some((re) => re.test(text))
      if (drop) {
        removedLines++
        continue
      }
      if (!section && isSectionHeading(line, bodyHeight)) section = text.slice(0, 80)
      kept.push(text)
    }
    cleaned.push(kept.join(' '))
    sectionTitles.push(section)
  }
  return { pages: cleaned, sectionTitles, removedLines }
}

/** Note title for a PDF page group, with a section heading when one is found. */
export function pageNoteTitleWithSection(
  book: string,
  startPage: number,
  endPage: number,
  section?: string | null,
): string {
  const base = pageNoteTitle(book, startPage, endPage)
  return section ? `${base} · ${section}` : base
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
    const sectionTitle = epubSectionTitle(html)
    // Covers, image-only pages and Gutenberg licence/header sections become '' and are skipped.
    const text = cleanEpubSection(epubTextFromHtml(html), sectionTitle)
    chapters.push({ title: sectionTitle ?? title, text })
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

/**
 * The text layer of a PDF, page by page (repeated headers and banners removed),
 * for pasting a practice test or exam into Study (#265). No OCR.
 */
export async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  } as Parameters<typeof pdfjs.getDocument>[0])
  try {
    const doc = await loadingTask.promise
    const pageLines: PdfLine[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      pageLines.push(extractPageLines(await page.getTextContent()))
    }
    return cleanPdfPages(pageLines).pages.filter((p) => p.trim()).join('\n\n')
  } finally {
    await loadingTask.destroy()
  }
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

    const pageLines: PdfLine[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pageLines.push(extractPageLines(content))
    }

    // Drop repeated headers/footers/cookie banners and detect section headings (#272).
    const { pages: cleanedPages, sectionTitles, removedLines } = cleanPdfPages(pageLines)
    const emptyPages = cleanedPages.filter((p) => !p).length

    const itemIds: string[] = []
    let imported = 0
    let skipped = 0
    runInTransaction(() => {
      for (const group of groupPages(cleanedPages)) {
        // A page that is only boilerplate (cover, instructions, copyright) has
        // almost no real words after cleaning — skip it (#272).
        const words = group.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
        if (words.length < MIN_SECTION_WORDS) {
          skipped++
          continue
        }
        const section = sectionTitles[group.startPage - 1] ?? null
        const item = createItem({
          title: pageNoteTitleWithSection(title, group.startPage, group.endPage, section),
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
    return {
      format: 'pdf',
      project: title,
      imported,
      skipped,
      emptyPages,
      removedLines,
      itemIds,
      errors: [],
    }
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
