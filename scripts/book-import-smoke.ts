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
  cleanEpubSection,
  cleanPdfPages,
  epubSectionTitle,
  epubTextFromHtml,
  extractPageLines,
  groupPages,
  normalizeLetterSpacing,
  parseEpub,
  stripGutenbergBoilerplate,
  importBookFromPath,
  pageNoteTitle,
  pageNoteTitleWithSection,
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

const xhtml = (title: string, body: string): string =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`

const CLEAN_SECTIONS: Array<[string, string]> = [
  ['ch1.xhtml', xhtml('Chapter One', '<h1>Chapter One</h1><p>Alpha &amp; beta content for the first chapter.</p>')],
  ['ch2.xhtml', xhtml('Chapter Two', '<h1>Chapter Two</h1><p>Gamma content for the second chapter.</p>')],
]

/** Build a tiny, valid EPUB from XHTML sections (stored mimetype first). */
async function buildTestEpub(filePath: string, sections = CLEAN_SECTIONS, bookTitle = 'The Test Book'): Promise<void> {
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
  const items = sections.map(([href], i) => `    <item id="c${i}" href="${href}" media-type="application/xhtml+xml"/>`).join('\n')
  const refs = sections.map((_, i) => `    <itemref idref="c${i}"/>`).join('\n')
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${bookTitle}</dc:title>
    <dc:identifier id="bookid">urn:uuid:test</dc:identifier>
  </metadata>
  <manifest>
${items}
  </manifest>
  <spine>
${refs}
  </spine>
</package>`,
  )
  for (const [href, html] of sections) zip.file(`OEBPS/${href}`, html)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  fs.writeFileSync(filePath, buf)
}

const PROSE = 'He walked to the harbour every morning and wrote down what the sailors told him about the weather.'

/** Shaped like a Project Gutenberg EPUB: cover, header + START marker, END marker + licence (#239). */
const GUTENBERG_SECTIONS: Array<[string, string]> = [
  ['wrap0000.html', xhtml('"Cover"', '<div><img src="cover.jpg" alt="Cover"/></div>')],
  [
    'h-0.html',
    xhtml(
      'B E N J A M I N',
      '<h2>The Project Gutenberg eBook of Test Life</h2><div>This eBook is for the use of anyone anywhere in the United States and most other parts of the world at no cost. www.gutenberg.org</div>' +
        '<span>*** START OF THE PROJECT GUTENBERG EBOOK TEST LIFE ***</span>' +
        `<h1>B E N J A M I N</h1><p>Opening chapter. ${PROSE}</p>`,
    ),
  ],
  ['h-1.html', xhtml('II', `<h1>II</h1><p>Second chapter. ${PROSE}</p>`)],
  ['h-2.html', xhtml('Plate', '<h2>Plate</h2><p><img src="plate.jpg"/> Plate I</p>')],
  [
    'h-3.html',
    xhtml(
      'THE FULL PROJECT GUTENBERG™ LICENSE',
      `<p>Closing chapter. ${PROSE}</p><h3>APPENDIX</h3><p>Appendix text. ${PROSE}</p>` +
        '<span>*** END OF THE PROJECT GUTENBERG EBOOK TEST LIFE ***</span>' +
        '<h2>THE FULL PROJECT GUTENBERG™ LICENSE</h2><p>To protect the Project Gutenberg™ mission of promoting the free distribution of electronic works, by using or distributing this work you agree to comply with all the terms of the Full Project Gutenberg™ License.</p>',
    ),
  ],
  [
    'license.html',
    xhtml(
      'License',
      '<h2>THE FULL PROJECT GUTENBERG LICENSE</h2><p>PLEASE READ THIS BEFORE YOU DISTRIBUTE OR USE THIS WORK. Section 1. General Terms of Use and Redistributing Project Gutenberg electronic works.</p>',
    ),
  ],
]

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

  // A sentence split across a page boundary is joined, not cut mid-idea (#272).
  const joined = groupPages(
    [
      'Sentence one. Sentence two. The mitochondria is the powerhouse',
      'of the cell and makes ATP.',
    ],
    { maxChars: 60 },
  )
  assert(
    joined.some((g) => g.text.includes('The mitochondria is the powerhouse of the cell and makes ATP.')),
    'a sentence spanning pages is joined across the note boundary',
  )

  // The final note keeps its trailing fragment (there is no next note to carry it to).
  const tail = groupPages(['Complete sentence. A trailing fragment with no period'], { maxChars: 200 })
  assert(tail.length === 1 && tail[0].text.includes('A trailing fragment with no period'), 'the final note keeps its trailing fragment')

  // A trailing fragment longer than maxChars is flushed whole, not carried.
  const overlong = groupPages(
    ['Complete sentence. ' + 'word '.repeat(30).trim(), 'Next page text.'],
    { maxChars: 40 },
  )
  assert(
    overlong.length === 2 && overlong[0].text.endsWith('word'),
    'a trailing fragment longer than maxChars is flushed whole, not carried',
  )

  // --- titles ---
  console.log('\ntitles')
  assert(pageNoteTitle('My Book', 3) === 'My Book · p.3', 'single-page title is p.N')
  assert(pageNoteTitle('My Book', 3, 4) === 'My Book · p.3\u20134', 'page range title is p.N–M')
  assert(pageNoteTitle('', 1) === 'Book · p.1', 'falls back to "Book"')
  assert(
    chapterNoteTitle('My Book', 'Intro', 2) === 'My Book · Intro (part 2)',
    'chapter title adds a part suffix',
  )

  // --- #272: PDF page cleaning (repeated headers, banners, section headings) ---
  console.log('\nPDF page cleaning (#272)')
  assert(
    extractPageLines({
      items: [
        { str: 'Header', transform: [1, 0, 0, 1, 72, 700], height: 10 },
        { str: 'Body', transform: [1, 0, 0, 1, 72, 680], height: 10 },
      ],
    }).map((l) => l.text).join('|') === 'Header|Body',
    'extractPageLines groups text items into top-first lines',
  )

  const L = (text: string, height = 10) => ({ text, height })
  const header = 'OpenStax Biology 2e'
  const banner = 'We use cookies to improve your experience.'
  const cleaned = cleanPdfPages([
    [L(header), L('8.1 Overview of Photosynthesis', 14), L('Plants capture light energy.')],
    [L(header), L(banner), L('Photosynthesis occurs in chloroplasts.')],
    [L(header), L(banner), L('Carbon dioxide is fixed by RuBisCO.')],
  ])
  assert(cleaned.removedLines === 5, `drops the repeated header and banner (removed ${cleaned.removedLines})`)
  assert(cleaned.pages.every((p) => !p.includes(header)), 'repeated header is gone from every page')
  assert(cleaned.pages.every((p) => !/cookies/i.test(p)), 'cookie banner is gone from every page')
  assert(cleaned.pages[0].includes('Plants capture light energy'), 'keeps the real page text')
  assert(cleaned.sectionTitles[0] === '8.1 Overview of Photosynthesis', 'detects a numbered section heading')
  assert(
    pageNoteTitleWithSection('Bio', 1, 1, '8.1 Overview') === 'Bio · p.1 · 8.1 Overview',
    'section heading is appended to the page title',
  )
  assert(cleanPdfPages([[L('Only one page')]]).pages[0] === 'Only one page', 'a single page is untouched')

  // A larger-font heading is detected even without a numbered section.
  const sized = cleanPdfPages([
    [L('Body text line one.'), L('Body text line two.')],
    [L('Section Heading', 18), L('More body text.')],
  ])
  assert(sized.sectionTitles[1] === 'Section Heading', 'detects a larger-font heading')

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

  // --- EPUB clean-up: covers, Gutenberg boilerplate, letter-spaced titles (#239) ---
  console.log('\nEPUB clean-up (#239)')
  assert(normalizeLetterSpacing('B E N J A M I N') === 'BENJAMIN', 'letter-spaced title is joined')
  assert(normalizeLetterSpacing('B E N J A M I N  F R A N K L I N') === 'BENJAMIN FRANKLIN', 'double spaces still separate words')
  assert(normalizeLetterSpacing('Chapter I. A B C') === 'Chapter I. A B C', 'short runs and normal titles are left alone')
  assert(normalizeLetterSpacing('  Part\u00a0 Two ') === 'Part Two', 'whitespace and nbsp collapse')
  assert(
    stripGutenbergBoilerplate(`Header junk *** START OF THE PROJECT GUTENBERG EBOOK X *** Real text here. *** END OF THE PROJECT GUTENBERG EBOOK X *** licence`) === 'Real text here.',
    'START/END markers trim header and footer',
  )
  assert(stripGutenbergBoilerplate('Real text. THE FULL PROJECT GUTENBERG™ LICENSE terms') === 'Real text.', 'licence heading with ™ cuts the rest')
  assert(stripGutenbergBoilerplate('The Project Gutenberg eBook of X. This eBook is for the use of anyone anywhere.') === '', 'header-only section is dropped')
  assert(stripGutenbergBoilerplate(PROSE) === PROSE, 'ordinary prose is untouched')
  assert(cleanEpubSection('Cover', 'Cover') === '', 'cover page (title only) is skipped')
  assert(cleanEpubSection('Plate Plate I', 'Plate') === '', 'image page with a caption is skipped')
  assert(cleanEpubSection(`Chapter One ${PROSE}`, 'Chapter One') !== '', 'a real chapter is kept')
  assert(epubTextFromHtml('<html><head><title>Meta</title></head><body><p>Body</p></body></html>') === 'Body', '<head> title is not body text')
  assert(epubSectionTitle(xhtml('THE FULL PROJECT GUTENBERG™ LICENSE', '<h3>APPENDIX</h3>')) === 'APPENDIX', 'licence <title> falls back to the first real heading')
  assert(epubSectionTitle(xhtml('B E N J A M I N', '')) === 'BENJAMIN', 'section title is normalised')

  const pgPath = path.join(tmp, 'gutenberg-style.epub')
  await buildTestEpub(pgPath, GUTENBERG_SECTIONS, 'Test Life')
  const parsedPg = await parseEpub(fs.readFileSync(pgPath), 'gutenberg-style.epub')
  const keptPg = parsedPg.chapters.filter((c) => c.text)
  assert(keptPg.length === 3, `keeps the 3 real sections (got ${keptPg.length}: ${keptPg.map((c) => c.title).join(' | ')})`)
  assert(keptPg.map((c) => c.title).join('|') === 'BENJAMIN|II|APPENDIX', `titles are clean (got ${keptPg.map((c) => c.title).join('|')})`)
  assert(keptPg.every((c) => !/gutenberg/i.test(c.text)), 'no Gutenberg header, footer or licence text is kept')
  assert(/^B E N J A M I N Opening chapter\./.test(keptPg[0].text), 'header before START is trimmed from a section with real text')
  assert(keptPg[2].text.includes('Closing chapter.') && keptPg[2].text.endsWith(PROSE), 'footer after END is trimmed from a section with real text')

  const pgResult = await importBookFromPath(pgPath)
  assert(pgResult.imported === 3 && pgResult.skipped === 3, `imports 3 notes and skips cover, plate and licence (got ${pgResult.imported}/${pgResult.skipped})`)
  const pgTitles = listItems().filter((it) => pgResult.itemIds.includes(it.id)).map((it) => it.title)
  assert(pgTitles.includes('Test Life · BENJAMIN') && !pgTitles.some((t) => /Cover|LICENSE|B E N/.test(t)), `no junk note titles (got ${pgTitles.join(' | ')})`)

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
