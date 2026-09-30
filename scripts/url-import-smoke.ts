/**
 * Offline smoke tests for URL import — uses a local HTTP fixture server, no external network.
 * Tests isAllowedUrl, extractFromHtml, heuristicTags, parseAutoTagJson, importFromUrl.
 *
 *   npm run test:url-import
 */

// --- Module._load hook to mock llmGenerate MUST BE FIRST ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request === '../llm' || request.endsWith('/electron/llm') || request.includes('electron/llm')) {
    return {
      llmGenerate: async () => ({ ok: false, error: 'mocked offline' }),
      providerDisplayName: () => 'mock',
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

// Import test utilities (not electron modules yet)
import http from 'http'
import { URL } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'

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

interface FixtureServer {
  server: http.Server
  baseUrl: string
  stop: () => Promise<void>
}

async function startFixtureServer(): Promise<FixtureServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const addr = server.address() as any
      const port = addr?.port || 0
      const url = new URL(req.url || '/', `http://localhost:${port}`)
      const pathname = url.pathname

      if (pathname === '/simple') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
<!DOCTYPE html>
<html>
<head><title>Simple Page</title></head>
<body>
  <h1>Welcome</h1>
  <main>
    <p>This is a simple test page with some content.</p>
    <p>It has multiple paragraphs for extraction.</p>
  </main>
</body>
</html>
        `)
      } else if (pathname === '/with-meta') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>HTML Title</title>
  <meta property="og:title" content="OG Title" />
  <meta name="description" content="Page description" />
</head>
<body>
  <h1>H1 Title</h1>
  <article>
    <p>Article content here.</p>
  </article>
</body>
</html>
        `)
      } else if (pathname === '/redirect') {
        res.writeHead(302, { 'Location': '/simple' })
        res.end()
      } else if (pathname === '/redirect-chain') {
        res.writeHead(302, { 'Location': '/redirect' })
        res.end()
      } else if (pathname === '/too-large') {
        const largeContent = 'x'.repeat(600 * 1024)
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': largeContent.length.toString() })
        res.end(largeContent)
      } else if (pathname === '/no-content-length') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><p>No content length</p></body></html>')
      } else if (pathname === '/binary') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
        res.end(Buffer.from([0x89, 0x50, 0x4E, 0x47]))
      } else if (pathname === '/error-404') {
        res.writeHead(404, { 'Content-Type': 'text/html' })
        res.end('<html><body>Not found</body></html>')
      } else if (pathname === '/error-500') {
        res.writeHead(500, { 'Content-Type': 'text/html' })
        res.end('<html><body>Server error</body></html>')
      } else if (pathname === '/timeout') {
        // Don't respond - will timeout
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      })
    })

    server.on('error', reject)
  })
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — URL Import smoke ===\n')

  // 1) Initialize DB
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-url-')), 'test.sqlite')
  const { initDb, closeDb } = require('../electron/db')
  initDb(dbFile)

  // 2) Start fixture server
  console.log('Starting fixture server...')
  const fixture = await startFixtureServer()
  console.log(`Fixture server at ${fixture.baseUrl}`)

  // 3) NOW import electron modules (mock is installed)
  const {
    isAllowedUrl,
    extractFromHtml,
    heuristicTags,
    parseAutoTagJson,
    importFromUrl,
  } = require('../electron/import-url')

  try {
    // --- isAllowedUrl ---
    console.log('\nisAllowedUrl')
    assert(isAllowedUrl('https://example.com').ok === true, 'https allowed')
    assert(isAllowedUrl('http://example.com').ok === true, 'http allowed')
    assert(isAllowedUrl('').ok === false, 'empty URL rejected')
    assert(isAllowedUrl('   ').ok === false, 'whitespace rejected')
    assert(isAllowedUrl('file:///etc/passwd').ok === false, 'file:// rejected')
    assert(isAllowedUrl('ftp://example.com').ok === false, 'ftp:// rejected')
    assert(isAllowedUrl('javascript:alert(1)').ok === false, 'javascript: rejected')
    assert(isAllowedUrl('not-a-url').ok === false, 'invalid URL rejected')

    // --- extractFromHtml ---
    console.log('\nextractFromHtml')
    const simpleHtml = `<html><head><title>Test Title</title></head><body><h1>Heading</h1><main><p>Body content here.</p></main></body></html>`
    const extracted = extractFromHtml(simpleHtml)
    assert(extracted.title === 'Test Title', 'extracts title from <title>')
    assert(extracted.text.includes('Body content here'), 'extracts body text')

    const metaHtml = `<html><head><title>HTML Title</title><meta property="og:title" content="OG Title" /></head><body><h1>H1 Title</h1><article><p>Article content</p></article></body></html>`
    const metaExtracted = extractFromHtml(metaHtml)
    assert(metaExtracted.title === 'OG Title', 'prefers og:title over <title>')

    const h1Html = `<html><head></head><body><h1>H1 Title</h1></body></html>`
    const h1Extracted = extractFromHtml(h1Html)
    assert(h1Extracted.title === 'H1 Title', 'falls back to h1 when no title tag')

    const scriptStyleHtml = `<html><head><title>Test</title></head><body><script>bad()</script><style>bad{}</style><main>Good content</main></body></html>`
    const cleaned = extractFromHtml(scriptStyleHtml)
    assert(!cleaned.text.includes('bad'), 'removes script/style')

    // --- heuristicTags ---
    console.log('\nheuristicTags')
    const heur = heuristicTags('https://example.com/page', 'Test Title', 'Summary content here')
    assert(heur.title === 'Test Title', 'uses provided title')
    assert(heur.para === 'resources', 'defaults para to resources')
    assert(heur.kind === 'article', 'defaults kind to article')
    assert(heur.project === 'example.com', 'project from hostname')
    assert(heur.status === 'active', 'status active')

    const heurNoTitle = heuristicTags('https://example.com/page', '', 'Content')
    assert(heurNoTitle.title === 'example.com', 'falls back to hostname')

    // --- parseAutoTagJson ---
    console.log('\nparseAutoTagJson')
    assert(parseAutoTagJson('{"title":"T","summary":"S","para":"resources","kind":"article","project":"test","status":"active"}')?.title === 'T', 'parses valid JSON')
    assert(parseAutoTagJson('```json\n{"title":"T","summary":"S","para":"resources","kind":"article","project":null,"status":"active"}\n```')?.title === 'T', 'strips markdown fences')
    assert(parseAutoTagJson('{"title":"","summary":"S"}') === null, 'rejects empty title')
    assert(parseAutoTagJson('not json') === null, 'rejects invalid JSON')
    assert(parseAutoTagJson(null) === null, 'handles null')
    assert(parseAutoTagJson('{"title":"T"}')?.title === 'T', 'accepts minimal valid JSON with title only')

    // --- importFromUrl against fixture server ---
    console.log('\nimportFromUrl (fixture server)')

    // Success case
    const success = await importFromUrl(`${fixture.baseUrl}/simple`)
    assert(success.item && success.item.id, 'importFromUrl creates item on success')
    assert(success.tagsSource === 'heuristic', 'falls back to heuristic when LLM fails')
    assert(success.warning && success.warning.length > 0, 'warning present when LLM fails')
    assert(success.item.title === 'Simple Page', 'item title from page')
    assert(success.item.body.includes('Source URL:'), 'body includes source URL')
    assert(success.item.body.includes('Fetched:'), 'body includes fetched timestamp')
    assert(success.item.para === 'resources', 'para is resources')
    assert(success.item.kind === 'article', 'kind is article')

    // Redirect
    const redirect = await importFromUrl(`${fixture.baseUrl}/redirect`)
    assert(redirect.item && redirect.item.id, 'follows redirect')
    assert(redirect.item.title === 'Simple Page', 'redirect resolves to final page')

    // Redirect chain
    const redirectChain = await importFromUrl(`${fixture.baseUrl}/redirect-chain`)
    assert(redirectChain.item && redirectChain.item.id, 'follows redirect chain')

    // Too large
    try {
      await importFromUrl(`${fixture.baseUrl}/too-large`)
      assert(false, 'too-large should throw')
    } catch (e) {
      assert((e as Error).message.includes('too large') || (e as Error).message.includes('Page too large'), 'rejects too large page')
    }

    // Binary content-type
    try {
      await importFromUrl(`${fixture.baseUrl}/binary`)
      assert(false, 'binary should throw')
    } catch (e) {
      assert((e as Error).message.includes('Unsupported content-type'), 'rejects binary content-type')
    }

    // 404
    try {
      await importFromUrl(`${fixture.baseUrl}/error-404`)
      assert(false, '404 should throw')
    } catch (e) {
      assert((e as Error).message.includes('HTTP 404'), 'throws on 404')
    }

    // 500
    try {
      await importFromUrl(`${fixture.baseUrl}/error-500`)
      assert(false, '500 should throw')
    } catch (e) {
      assert((e as Error).message.includes('HTTP 500'), 'throws on 500')
    }

    // Invalid URLs
    try {
      await importFromUrl('file:///etc/passwd')
      assert(false, 'file:// should throw')
    } catch (e) {
      assert((e as Error).message.includes('Only http and https'), 'rejects file://')
    }

    try {
      await importFromUrl('not a url')
      assert(false, 'invalid url should throw')
    } catch (e) {
      assert((e as Error).message.includes('Invalid URL'), 'rejects invalid URL')
    }

  } finally {
    await fixture.stop()
    closeDb()
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})