/**
 * Offline smoke tests for book import (#162): EPUB (jszip) chapter notes and
 * text-layer PDF (pdfjs-dist) page notes. No network, no OCR.
 *
 * The PDF path is exercised end to end with a hand-built, single-page PDF whose
 * xref offsets are computed at build time — no PDF-writing dependency.
 *
 *   npm run test:books
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { closeDb, initDb, listItems } from '../electron/db'
import {
  chapterNoteTitle,
  detectBookFormat,
  epubTextFromHtml,
  groupPages,
  importBookFromPath,
  pageNoteTitle,
} from '../electron/book-import'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

/** Build a tiny, valid EPUB with two XHTML chapters (stored mimetype first). */
async function buildTestEpub(filePath: string): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Test Book</dc:title>
    <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
  </metadata>
  <manifest>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`,
  )
  zip.file(
    'OEBPS/ch1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>Alpha &amp; beta content for the first chapter.</p></body></html>`,
  )
  zip.file(
    'OEBPS/ch2.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><h1>Chapter Two</h1><p>Gamma content for the second chapter.</p></body></html>`,
  )
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(filePath, buf)
}

/** Hand-build a one-page, text-layer PDF with computed xref offsets. */
function buildMinimalPdf(text: string, title: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  bodies.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf +=
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R /Info << /Title (${title}) >> >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — book import (#162) ===\n')

  // --- detectBookFormat ---
  console.log('detectBookFormat')
  assert(detectBookFormat('book.epub') === 'epub', 'detects .epub')
  assert(detectBookFormat('PAPER.PDF') === 'pdf', 'detects .pdf case-insensitively')
  assert(detectBookFormat('notes.txt') === null, 'rejects unsupported extensions')

  // --- epubTextFromHtml ---
  console.log('\nepubTextFromHtml')
  const stripped = epubTextFromHtml(
    '<p>Hello&nbsp;<b>World</b> &amp; &lt;x&gt; &quot;q&quot; &#39;s&#39;</p>',
  )
  assert(stripped === `Hello World & <x> "q" 's'`, `strips tags and decodes entities (got "${stripped}")`)
  assert(epubTextFromHtml('<p>a\n\n   b\t c</p>') === 'a b c', 'collapses whitespace')
  assert(epubTextFromHtml('<style>p{color:red}</style><p>Kept</p>') === 'Kept', 'drops style blocks')

  // --- groupPages ---
  console.log('\ngroupPages')
  const merged = groupPages(['short one', 'short two', '', 'page four'])
  assert(merged.length === 2, `drops empty pages and splits at the gap (got ${merged.length})`)
  assert(
    merged[0].startPage === 1 && merged[0].endPage === 2 && merged[0].text === 'short one short two',
    'merges short adjacent pages with a 1-based range',
  )
  assert(merged[1].startPage === 4 && merged[1].endPage === 4, 'keeps 1-based page numbers after a drop')
  assert(groupPages(['', '   ', '']).length === 0, 'all-empty pages produce no groups')
  const split = groupPages(['x'.repeat(10), 'y'.repeat(10)], { maxChars: 15 })
  assert(split.length === 2, 'maxChars splits a run of short pages')

  // --- titles ---
  console.log('\ntitles')
  assert(pageNoteTitle('My Book', 3) === 'My Book · p.3', 'single-page title is p.N')
  assert(pageNoteTitle('My Book', 3, 4) === 'My Book · p.3\u20134', 'page range title is p.N–M')
  assert(pageNoteTitle('', 1) === 'Book · p.1', 'falls back to "Book"')
  assert(
    chapterNoteTitle('My Book', 'Intro', 2) === 'My Book · Intro (part 2)',
    'chapter title adds a part suffix',
  )

  // --- EPUB import (temp dir + real DB) ---
  console.log('\nEPUB import (temp tree)')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-books-'))
  initDb(path.join(tmp, 'test.sqlite'))

  const epubPath = path.join(tmp, 'test-book.epub')
  await buildTestEpub(epubPath)

  const epubResult = await importBookFromPath(epubPath)
  assert(epubResult.format === 'epub', 'reports the epub format')
  assert(epubResult.canceled !== true, 'not canceled')
  assert(epubResult.imported === 2, `creates 2 chapter notes (got ${epubResult.imported})`)
  assert(epubResult.skipped === 0, 'skips nothing for a clean book')
  assert(epubResult.project === 'The Test Book', 'project is the OPF dc:title')
  assert(epubResult.errors.length === 0, 'no errors')

  const epubItems = listItems().filter((it) => epubResult.itemIds.includes(it.id))
  assert(epubItems.length === 2, 'database holds the 2 book notes')
  assert(epubItems.every((it) => it.kind === 'book'), 'every note has kind "book"')
  assert(epubItems.every((it) => it.para === 'resources'), 'every note has para "resources"')
  assert(epubItems.every((it) => it.project === 'The Test Book'), 'every note carries the book project')

  const titles = epubItems.map((it) => it.title).sort()
  assert(
    titles.includes('The Test Book · Chapter One') && titles.includes('The Test Book · Chapter Two'),
    `chapter titles use "<Book> · <Chapter>" (got ${titles.join(' | ')})`,
  )
  const chOne = epubItems.find((it) => it.title.endsWith('Chapter One'))
  assert(!!chOne && chOne.body.includes('Source: test-book.epub'), 'body has a Source: line')
  assert(!!chOne && chOne.body.includes('Chapter: Chapter One'), 'body has a Chapter: line')
  assert(
    !!chOne && chOne.body.includes('Alpha & beta content for the first chapter.'),
    'body contains the chapter text with entities decoded',
  )

  // --- PDF import (hand-built text-layer PDF) ---
  console.log('\nPDF import (hand-built text-layer PDF)')
  const pdfPath = path.join(tmp, 'paper.pdf')
  fs.writeFileSync(pdfPath, buildMinimalPdf('Hello book page one', 'Minimal PDF Book'))

  const pdfResult = await importBookFromPath(pdfPath)
  assert(pdfResult.format === 'pdf', 'reports the pdf format')
  assert(pdfResult.imported === 1, `creates 1 page note (got ${pdfResult.imported})`)
  assert(pdfResult.emptyPages === 0, 'counts no empty pages')
  assert(pdfResult.project === 'Minimal PDF Book', 'project comes from PDF info.Title')
  assert(pdfResult.errors.length === 0, `no errors (${pdfResult.errors.join('; ')})`)

  const pdfItems = listItems().filter((it) => pdfResult.itemIds.includes(it.id))
  assert(pdfItems.length === 1 && pdfItems[0].kind === 'book', 'PDF note has kind "book"')
  assert(pdfItems[0]?.title === 'Minimal PDF Book · p.1', `page title is "<Book> · p.1" (got ${pdfItems[0]?.title})`)
  assert(!!pdfItems[0]?.body.includes('Source: paper.pdf'), 'PDF body has a Source: line')
  assert(!!pdfItems[0]?.body.includes('Page: 1'), 'PDF body has a Page: 1 line')
  assert(!!pdfItems[0]?.body.includes('Hello book page one'), 'PDF body contains the page text')

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
