/**
 * Offline smoke tests for provider adapter error paths (#82):
 * - anthropic: chat success/500/no-key/timeout/bad-json; listModels success/500/no-key/bad-json
 * - openai-compatible: chat success, 400-temperature retry, 400-plain, 500,
 *   array content, bad-json, timeout; listModels success/500/bad-json/empty
 * - http: fetchWithTimeout abort message, readErrorDetail shapes (message object,
 *   plain text, throwing text)
 * - llm: resolveFromProviders missing-selected / running-no-models / cloud-no-key,
 *   providerDisplayName, llmGenerate no-candidates + fallthrough error,
 *   fetchProviderModels ollama/anthropic/openai errors, testProvider no-model paths
 *
 * Local mock HTTP server only, no external network.
 *
 *   npm run test:provider-errors
 */
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

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

function json(res: never, code: number, obj: unknown): void {
  const r = res as unknown as import('http').ServerResponse
  r.writeHead(code, { 'Content-Type': 'application/json' })
  r.end(JSON.stringify(obj))
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Provider error paths smoke ===\n')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-perr-'))
  const { setLlmUserDataDir } = require('../electron/llm-settings')
  setLlmUserDataDir(path.join(dir, 'ud'))
  const ps = require('../electron/provider-store')
  ps.resetProviderStoreCache()

  // Keep provider resolution hermetic: closed ports + no keys in env.
  const { PRESET_ENV_KEYS } = require('../electron/providers/presets')
  const savedEnv: Record<string, string | undefined> = {}
  for (const names of Object.values(PRESET_ENV_KEYS) as string[][]) {
    for (const n of names) {
      savedEnv[n] = process.env[n]
      delete process.env[n]
    }
  }
  const savedOllamaUrl = process.env.LKV_OLLAMA_URL
  const savedLmUrl = process.env.LKV_LMSTUDIO_URL
  process.env.LKV_OLLAMA_URL = 'http://127.0.0.1:9'
  process.env.LKV_LMSTUDIO_URL = 'http://127.0.0.1:9/v1'

  let retryCalls = 0
  const server = http.createServer((req: never, res: never) => {
    const q = req as unknown as import('http').IncomingMessage
    const r = res as unknown as import('http').ServerResponse
    const url = new URL(q.url || '/', 'http://x')
    const bodyChunks: Buffer[] = []
    q.on('data', (c: Buffer) => bodyChunks.push(c))
    q.on('end', () => {
      const p = url.pathname
      // --- anthropic shapes ---
      if (p === '/anthropic/messages' && q.method === 'POST') {
        return json(res, 200, { content: [{ type: 'text', text: 'hello anthropic' }] })
      }
      if (p === '/anthropic-500/messages' && q.method === 'POST') {
        return json(res, 500, { error: { message: 'quota boom' } })
      }
      if (p === '/anthropic/models' && q.method === 'GET') {
        return json(res, 200, { data: [{ id: 'claude-x' }] })
      }
      if (p === '/anthropic-models-500/models' && q.method === 'GET') {
        r.writeHead(500, { 'Content-Type': 'text/plain' })
        return r.end('plain failure')
      }
      if (p === '/anthropic-models-badjson/models' && q.method === 'GET') {
        r.writeHead(200, { 'Content-Type': 'application/json' })
        return r.end('garbage{{{')
      }
      // --- openai shapes ---
      if (p === '/oai/chat/completions' && q.method === 'POST') {
        return json(res, 200, { choices: [{ message: { content: 'hi oai' } }] })
      }
      if (p === '/oai-retry/chat/completions' && q.method === 'POST') {
        retryCalls++
        if (retryCalls === 1) return json(res, 400, { error: { message: 'temperature unsupported parameter' } })
        return json(res, 200, { choices: [{ message: { content: 'retried ok' } }] })
      }
      if (p === '/oai-400/chat/completions' && q.method === 'POST') {
        return json(res, 400, { error: 'this model is gone' })
      }
      if (p === '/oai-500/chat/completions' && q.method === 'POST') {
        return json(res, 500, { error: { message: 'srv down' } })
      }
      if (p === '/oai-array/chat/completions' && q.method === 'POST') {
        return json(res, 200, { choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] })
      }
      if (p === '/oai-badjson/chat/completions' && q.method === 'POST') {
        r.writeHead(200, { 'Content-Type': 'application/json' })
        return r.end('not json{{{')
      }
      if (p === '/oai/models' && q.method === 'GET') {
        return json(res, 200, { data: [{ id: 'm1' }, { id: 'embed-x' }] })
      }
      if (p === '/oai-models-500/models' && q.method === 'GET') {
        return json(res, 500, { error: { message: 'nope' } })
      }
      if (p === '/oai-models-badjson/models' && q.method === 'GET') {
        r.writeHead(200, { 'Content-Type': 'application/json' })
        return r.end('garbage{{{')
      }
      if (p === '/oai-empty-models/models' && q.method === 'GET') {
        return json(res, 200, { data: [] })
      }
      // --- ollama tags ---
      if (p === '/ollama-tags/api/tags' && q.method === 'GET') {
        return json(res, 200, { models: [{ name: 'qwen3:7b', details: { parameter_size: '7B' } }] })
      }
      // --- ollama keyed (Ollama Cloud: 401 without bearer) ---
      if (p === '/ollama-keyed/api/generate' && q.method === 'POST') {
        if (q.headers.authorization === 'Bearer secret') return json(res, 200, { response: 'hello keyed' })
        return json(res, 401, { error: 'unauthorized' })
      }
      if (p === '/ollama-keyed/api/tags' && q.method === 'GET') {
        if (q.headers.authorization === 'Bearer secret') return json(res, 200, { models: [{ name: 'cloud-m1' }] })
        return json(res, 401, { error: 'unauthorized' })
      }
      if (p === '/hang' || p.startsWith('/hang/')) return // never respond -> client timeout
      r.writeHead(404)
      r.end('nope')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as unknown as { port: number }).port}`
  const closed = 'http://127.0.0.1:9'

  try {
    const { anthropicChat, anthropicListModels } = require('../electron/providers/anthropic')
    const { openAiChat, openAiListModels } = require('../electron/providers/openai-compatible')
    const { fetchWithTimeout, readErrorDetail } = require('../electron/providers/http')
    const llm = require('../electron/llm')

    console.log('anthropic adapter')
    const aOk = await anthropicChat({ baseUrl: `${base}/anthropic`, apiKey: 'k' }, 'm', { prompt: 'hi' })
    assert(aOk.ok === true && aOk.text === 'hello anthropic', 'anthropic chat success')
    assert((await anthropicChat({ baseUrl: `${base}/anthropic` }, 'm', { prompt: 'hi' })).error.includes('no API key'), 'anthropic chat no-key')
    const a500 = await anthropicChat({ baseUrl: `${base}/anthropic-500`, apiKey: 'k' }, 'm', { prompt: 'hi' })
    assert(a500.ok === false && a500.error.includes('quota boom'), `anthropic 500 detail (${a500.error.slice(0, 60)})`)
    const aHang2 = await anthropicChat({ baseUrl: `${base}/hang`, apiKey: 'k' }, 'm', { prompt: 'hi', timeoutMs: 300 })
    assert(aHang2.ok === false && /Timed out/.test(aHang2.error), `anthropic timeout wording (${aHang2.error.slice(0, 60)})`)
    const aRefused = await anthropicChat({ baseUrl: closed, apiKey: 'k' }, 'm', { prompt: 'hi', timeoutMs: 3000 })
    assert(aRefused.ok === false, 'anthropic connection-refused surfaces as error')
    const aModels = await anthropicListModels({ baseUrl: `${base}/anthropic`, apiKey: 'k' })
    assert(aModels.ok === true && aModels.models.includes('claude-x'), 'anthropic listModels success')
    assert((await anthropicListModels({ baseUrl: `${base}/anthropic` })).error.includes('no API key'), 'anthropic listModels no-key')
    const aM500 = await anthropicListModels({ baseUrl: `${base}/anthropic-models-500`, apiKey: 'k' })
    assert(aM500.ok === false && aM500.error.includes('plain failure'), 'anthropic listModels plain-text error')
    const aMBad = await anthropicListModels({ baseUrl: `${base}/anthropic-models-badjson`, apiKey: 'k' })
    assert(aMBad.ok === false, 'anthropic listModels bad-json surfaces as error')

    console.log('openai-compatible adapter')
    const oOk = await openAiChat({ baseUrl: `${base}/oai`, label: 'T' }, 'm', { prompt: 'hi' })
    assert(oOk.ok === true && oOk.text === 'hi oai', 'openai chat success')
    retryCalls = 0
    const oRetry = await openAiChat({ baseUrl: `${base}/oai-retry`, label: 'T' }, 'm', { prompt: 'hi' })
    assert(oRetry.ok === true && oRetry.text === 'retried ok' && retryCalls === 2, 'openai 400-temperature retries plain')
    const o400 = await openAiChat({ baseUrl: `${base}/oai-400`, label: 'T' }, 'm', { prompt: 'hi' })
    assert(o400.ok === false && o400.error.includes('this model is gone'), 'openai 400-plain returns detail')
    const o500 = await openAiChat({ baseUrl: `${base}/oai-500`, label: 'T' }, 'm', { prompt: 'hi' })
    assert(o500.ok === false && o500.error.includes('srv down'), 'openai 500 detail')
    const oArr = await openAiChat({ baseUrl: `${base}/oai-array`, label: 'T' }, 'm', { prompt: 'hi' })
    assert(oArr.ok === true && oArr.text === 'ab', 'openai array content joined')
    const oBad = await openAiChat({ baseUrl: `${base}/oai-badjson`, label: 'T' }, 'm', { prompt: 'hi' })
    assert(oBad.ok === false, 'openai bad-json surfaces as error')
    const oHang = await openAiChat({ baseUrl: `${base}/hang`, label: 'T' }, 'm', { prompt: 'hi', timeoutMs: 300 })
    assert(oHang.ok === false && /Timed out/.test(oHang.error), 'openai timeout wording')
    const oModels = await openAiListModels({ baseUrl: `${base}/oai`, label: 'T' })
    assert(oModels.ok === true && oModels.models.includes('m1') && oModels.models.includes('embed-x'), 'openai listModels success')
    const oM500 = await openAiListModels({ baseUrl: `${base}/oai-models-500`, label: 'T' })
    assert(oM500.ok === false && oM500.error.includes('nope'), 'openai listModels 500 detail')
    const oMBad = await openAiListModels({ baseUrl: `${base}/oai-models-badjson`, label: 'T' })
    assert(oMBad.ok === false, 'openai listModels bad-json surfaces as error')

    console.log('http helpers')
    try {
      await fetchWithTimeout(`${base}/hang`, undefined, 80)
      assert(false, 'hang should time out')
    } catch (e) {
      assert(/Timed out after/.test((e as Error).message), `abort wording (${(e as Error).message.slice(0, 50)})`)
    }
    const throwing: string = await readErrorDetail(
      { status: 500, text: async () => { throw new Error('x') } } as never,
      'P'
    )
    assert(throwing === 'P HTTP 500', 'readErrorDetail survives throwing text()')
    const msgShape: string = await readErrorDetail(
      { status: 400, text: async () => JSON.stringify({ message: 'bad args' }) } as never,
      'P'
    )
    assert(msgShape.includes('bad args'), 'readErrorDetail message shape')
    const detailShape: string = await readErrorDetail(
      { status: 400, text: async () => JSON.stringify({ detail: 'deep detail' }) } as never,
      'P'
    )
    assert(detailShape.includes('deep detail'), 'readErrorDetail detail shape')
    const strShape: string = await readErrorDetail(
      { status: 400, text: async () => JSON.stringify({ error: 'flat boom' }) } as never,
      'P'
    )
    assert(strShape.includes('flat boom'), 'readErrorDetail string-error shape')

    console.log('ollama adapter (key handling)')
    const { ollamaGenerate, ollamaHealth } = require('../electron/ollama')
    const okKeyed = await ollamaGenerate('m', { prompt: 'hi' }, `${base}/ollama-keyed`, 'secret')
    assert(okKeyed.ok === true && okKeyed.text === 'hello keyed', 'ollamaGenerate sends Authorization when a key is present')
    const noKey = await ollamaGenerate('m', { prompt: 'hi' }, `${base}/ollama-keyed`)
    assert(noKey.ok === false && /401/.test(noKey.error), `ollamaGenerate without a key surfaces 401 (${String(noKey.error).slice(0, 60)})`)
    const hKeyed = await ollamaHealth(`${base}/ollama-keyed`, 'secret')
    assert(hKeyed.ok === true && hKeyed.models?.includes('cloud-m1'), 'ollamaHealth sends Authorization when a key is present')
    const hNoKey = await ollamaHealth(`${base}/ollama-keyed`)
    assert(hNoKey.ok === false && /401/.test(hNoKey.error ?? ''), 'ollamaHealth without a key surfaces 401')
    const gwKeyed = await llm.generateWith({ id: 'x', kind: 'ollama', baseUrl: `${base}/ollama-keyed`, label: 'O' }, 'm', { prompt: 'hi' }, 'secret')
    assert(gwKeyed.ok === true && gwKeyed.text === 'hello keyed', 'generateWith passes the key for ollama kind')
    const fKeyed = await llm.fetchProviderModels({ kind: 'ollama', label: 'O', baseUrl: `${base}/ollama-keyed`, model: '', apiKey: 'secret' })
    assert(fKeyed.ok === true && fKeyed.models.includes('cloud-m1'), 'fetchProviderModels passes the key to ollama health')

    console.log('llm resolution + generation')
    const missing = llm.resolveFromProviders('zzz' as never, [])
    assert(missing.candidates.length === 0 && missing.status.message.includes('not found'), 'missing selected provider message')
    const localNoModel = {
      id: 'lmstudio', kind: 'openai-compatible', label: 'LM Studio', baseUrl: 'http://localhost:1234',
      model: '', hasKey: false, requiresKey: false, local: true, enabled: true, source: 'builtin',
      health: { ok: true, models: [] },
    }
    const rnm = llm.resolveFromProviders('auto', [localNoModel])
    assert(rnm.candidates.length === 0 && rnm.status.message.includes('no model is loaded'), 'running local without model message')
    const cloudNoKey = {
      id: 'groq', kind: 'openai-compatible', label: 'Groq', baseUrl: 'https://x', model: 'm',
      hasKey: false, requiresKey: true, local: false, enabled: true, source: 'builtin',
    }
    const rck = llm.resolveFromProviders('auto', [cloudNoKey])
    assert(rck.candidates.length === 0 && rck.status.message.includes('search still works'), 'cloud without key message')
    assert(llm.providerDisplayName('x', 'Label') === 'Label', 'displayName prefers label')
    assert(llm.providerDisplayName(null) === 'AI', 'displayName null -> AI')
    assert(llm.providerDisplayName('nope') === 'nope', 'displayName falls back to id')

    const none = await llm.llmGenerate({ prompt: 'hi' })
    assert(none.ok === false && none.provider === null, `llmGenerate no-candidates (${String(none.error).slice(0, 60)})`)

    const failer = ps.upsertProvider({
      kind: 'openai-compatible', label: 'Failer', baseUrl: `${base}/oai-500`, model: 'm', apiKey: 'k',
      local: false,
    })
    ps.setSelection(failer.id)
    const fell = await llm.llmGenerate({ prompt: 'hi' })
    assert(fell.ok === false && fell.provider === failer.id && fell.error.includes('srv down'), 'llmGenerate fallthrough error')
    ps.setSelection('auto')
    ps.removeProvider(failer.id)

    console.log('fetchProviderModels + testProvider')
    const fOllErr = await llm.fetchProviderModels({ kind: 'ollama', label: 'O', baseUrl: closed, model: '' })
    assert(fOllErr.ok === false, 'fetchModels ollama unreachable errors')
    const fOllOk = await llm.fetchProviderModels({ kind: 'ollama', label: 'O', baseUrl: `${base}/ollama-tags`, model: '' })
    assert(fOllOk.ok === true && fOllOk.models.includes('qwen3:7b'), 'fetchModels ollama lists tags')
    const fAntOk = await llm.fetchProviderModels({ kind: 'anthropic', label: 'A', baseUrl: `${base}/anthropic`, model: 'm', apiKey: 'k' })
    assert(fAntOk.ok === true && fAntOk.models.includes('claude-x'), 'fetchModels anthropic ok')
    const fAntErr = await llm.fetchProviderModels({ kind: 'anthropic', label: 'A', baseUrl: `${base}/anthropic-models-500`, model: 'm', apiKey: 'k' })
    assert(fAntErr.ok === false, 'fetchModels anthropic 500 errors')
    const fOaiErr = await llm.fetchProviderModels({ kind: 'openai-compatible', label: 'O', baseUrl: `${base}/oai-models-500`, model: 'm' })
    assert(fOaiErr.ok === false, 'fetchModels openai 500 errors')
    const fOaiOk = await llm.fetchProviderModels({ kind: 'openai-compatible', label: 'O', baseUrl: `${base}/oai`, model: '' })
    assert(fOaiOk.ok === true && fOaiOk.models.includes('m1') && !fOaiOk.models.includes('embed-x'), 'fetchModels filters embeddings')

    const tNoModel = await llm.testProvider({ kind: 'openai-compatible', label: 'T', baseUrl: `${base}/oai-empty-models`, model: '' })
    assert(tNoModel.ok === false && tNoModel.error.includes('no model is installed'), 'testProvider reachable-but-empty errors')
    const tUnreach = await llm.testProvider({ kind: 'openai-compatible', label: 'T', baseUrl: closed, model: '' })
    assert(tUnreach.ok === false, 'testProvider unreachable errors')
    const tOk = await llm.testProvider({ kind: 'openai-compatible', label: 'T', baseUrl: `${base}/oai`, model: 'm' })
    assert(tOk.ok === true && tOk.sample.includes('hi oai'), 'testProvider success samples text')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (savedOllamaUrl === undefined) delete process.env.LKV_OLLAMA_URL
    else process.env.LKV_OLLAMA_URL = savedOllamaUrl
    if (savedLmUrl === undefined) delete process.env.LKV_LMSTUDIO_URL
    else process.env.LKV_LMSTUDIO_URL = savedLmUrl
    setLlmUserDataDir(null)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
