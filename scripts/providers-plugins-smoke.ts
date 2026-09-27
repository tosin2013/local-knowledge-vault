/**
 * Offline smoke tests for the provider registry, adapters (against local mock servers),
 * legacy migration, and the declarative plugin loader. Never touches the real userData dir.
 *
 *   npm run test:providers
 */
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'

import { setLlmUserDataDir } from '../electron/llm-settings'
import {
  loadProvidersFile,
  listProviderConfigs,
  listPresets,
  getSelection,
  setSelection,
  upsertProvider,
  removeProvider,
  providerKeyPath,
  resetProviderStoreCache,
  buildInitialProvidersFile,
  setProviderEnabled,
} from '../electron/provider-store'
import { resolveProvider, llmGenerate, testProvider, fetchProviderModels } from '../electron/llm'
import {
  validatePluginManifest,
  installPluginFrom,
  reloadPlugins,
  listPluginsResult,
  getPluginContributions,
  setPluginEnabled,
  removePlugin,
  resetPluginCache,
  pluginsDir,
} from '../electron/plugin-loader'
import { writeZipFromFiles } from '../electron/citation-pack'
import { buildAnthropicBody, ANTHROPIC_VERSION } from '../electron/providers/anthropic'

let passed = 0
let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.log(`  ✗ ${msg}`)
  }
}

type Captured = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }

function mockServer(handler: (req: Captured, res: http.ServerResponse) => void) {
  const seen: Captured[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body: unknown = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = raw
      }
      const cap = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body }
      seen.push(cap)
      handler(cap, res)
    })
  })
  return new Promise<{ url: string; seen: Captured[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({ url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

function json(res: http.ServerResponse, code: number, obj: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function freshDir(tag: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `lkv-smoke-${tag}-`))
  setLlmUserDataDir(d)
  resetProviderStoreCache()
  resetPluginCache()
  return d
}

const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

async function main() {
  // Keep local detection deterministic: point at closed ports unless a test overrides.
  process.env.LKV_OLLAMA_URL = 'http://127.0.0.1:9'
  process.env.LKV_LMSTUDIO_URL = 'http://127.0.0.1:9/v1'
  for (const k of ['GROQ_API_KEY', 'LKV_GROQ_API_KEY', 'XAI_API_KEY', 'LKV_XAI_API_KEY', 'OPENROUTER_API_KEY', 'LKV_OPENROUTER_API_KEY', 'LKV_OLLAMA_MODEL'])
    delete process.env[k]

  console.log('\nFresh install → local-first, first-run card')
  freshDir('fresh')
  const f0 = loadProvidersFile()
  assert(f0.selected === 'auto', 'fresh install selects Auto (local-first)')
  const ids0 = listProviderConfigs().map((p) => p.id)
  assert(ids0[0] === 'ollama' && ids0[1] === 'lmstudio', 'Ollama, LM Studio listed first')
  const r0 = await resolveProvider()
  assert(r0.status.active === null && r0.status.needsSetup, 'nothing running + no cloud → needsSetup')
  assert(r0.status.recommendedLocalModel.command === 'ollama pull qwen3:8b', 'first-run recommends `ollama pull qwen3:8b`')

  console.log('\nMock Ollama → auto picks it, prefers ≥3B, flags tiny')
  const ollama = await mockServer((req, res) => {
    if (req.url === '/api/tags')
      return json(res, 200, {
        models: [
          { name: 'nomic-embed-text:latest', details: { parameter_size: '137M' } },
          { name: 'llama3.2:1b', details: { parameter_size: '1.2B' } },
          { name: 'qwen3:8b', details: { parameter_size: '8.2B' } },
        ],
      })
    if (req.url === '/api/generate') return json(res, 200, { response: '<think>hmm</think>Local answer [1]' })
    json(res, 404, { error: 'nope' })
  })
  process.env.LKV_OLLAMA_URL = ollama.url
  const r1 = await resolveProvider()
  assert(r1.status.active?.id === 'ollama' && r1.status.active.model === 'qwen3:8b', 'auto → Ollama qwen3:8b (skips embed + tiny)')
  assert(/^Local · Ollama · qwen3:8b/.test(r1.status.message), `status message "${r1.status.message}"`)
  assert(!r1.status.active?.smallModel, 'qwen3:8b not flagged small')
  const g1 = await llmGenerate({ system: 'RULES', prompt: 'Q?' })
  assert(g1.ok && g1.text === 'Local answer [1]' && g1.local, 'llmGenerate via Ollama strips <think>')
  const genReq = ollama.seen.find((s) => s.url === '/api/generate')
  assert(genReq?.body?.system === 'RULES' && genReq?.body?.model === 'qwen3:8b', 'Ollama request carries system + model')
  // tiny-only install
  upsertProvider({ id: 'ollama', kind: 'ollama', label: 'Ollama', baseUrl: ollama.url, model: 'llama3.2:1b' })
  const r1b = await resolveProvider()
  assert(r1b.status.active?.smallModel === true, 'explicit llama3.2:1b → smallModel hint')
  upsertProvider({ id: 'ollama', kind: 'ollama', label: 'Ollama', baseUrl: ollama.url, model: '' })

  console.log('\nOpenAI-compatible adapter (mock server)')
  const oa = await mockServer((req, res) => {
    if (req.url === '/v1/models') return json(res, 200, { data: [{ id: 'm-small' }, { id: 'text-embedding-3-small' }, { id: 'm-large' }] })
    if (req.url === '/v1/chat/completions') {
      if (req.headers.authorization !== 'Bearer sk-test-123') return json(res, 401, { error: { message: 'Invalid API key' } })
      return json(res, 200, { choices: [{ message: { content: 'OK' } }] })
    }
    json(res, 404, {})
  })
  const draft = { kind: 'openai-compatible' as const, label: 'Mock', baseUrl: `${oa.url}/v1`, model: 'm-small', apiKey: 'sk-test-123' }
  const models = await fetchProviderModels(draft)
  assert(models.ok && models.models.join(',') === 'm-large,m-small', 'Fetch models lists chat models (embeddings filtered)')
  const t1 = await testProvider(draft)
  assert(t1.ok && t1.sample === 'OK' && t1.latencyMs >= 0, `Test connection ok (${t1.latencyMs} ms)`)
  const chatReq = oa.seen.find((s) => s.url === '/v1/chat/completions')
  assert(chatReq?.body?.model === 'm-small' && Array.isArray(chatReq?.body?.messages), 'chat body has model + messages')
  const t2 = await testProvider({ ...draft, apiKey: 'wrong' })
  assert(!t2.ok && /401|Invalid API key/.test(t2.error ?? ''), `bad key → exact error ("${t2.error}")`)
  assert(!JSON.stringify(t2).includes('wrong'), 'test result never echoes the key')

  console.log('\nSaved user provider: key stored 0600, never returned; auto keeps local first')
  const saved = upsertProvider({ ...draft, label: 'My gateway', local: false })
  assert(saved.id.startsWith('usr_') && saved.hasKey && saved.keySource === 'file', 'saved with key (hasKey only)')
  assert(!JSON.stringify(listProviderConfigs()).includes('sk-test-123'), 'provider list never contains the key')
  const kp = providerKeyPath(saved.id)
  assert((fs.statSync(kp).mode & 0o777) === 0o600, 'key file is owner-only (0600)')
  const r2 = await resolveProvider()
  assert(r2.status.active?.id === 'ollama', 'with cloud enabled, Auto still uses local Ollama first')
  process.env.LKV_OLLAMA_URL = 'http://127.0.0.1:9'
  const r3 = await resolveProvider()
  assert(r3.status.active?.id === saved.id && !r3.status.active.local, 'Ollama down → falls to enabled cloud')
  setProviderEnabled(saved.id, false)
  const r4 = await resolveProvider()
  assert(r4.status.active === null && r4.status.needsSetup, 'disabled cloud is never used')
  setSelection(saved.id)
  assert(getSelection() === saved.id, 'explicit selection persisted')
  assert(removeProvider(saved.id) && !fs.existsSync(kp), 'remove deletes provider + its own key file')
  assert(getSelection() === 'auto', 'removing the selected provider falls back to Auto')

  console.log('\n#21: stored key reuse is gated on the draft baseUrl')
  const keyA = await mockServer((req, res) => {
    if (req.url === '/v1/models') return json(res, 200, { data: [{ id: 'm-a' }] })
    return json(res, 404, {})
  })
  const keyB = await mockServer((req, res) => {
    if (req.url === '/v1/models') return json(res, 200, { data: [{ id: 'm-b' }] })
    return json(res, 404, {})
  })
  const sp = upsertProvider({
    kind: 'openai-compatible',
    label: 'Keyed',
    baseUrl: `${keyA.url}/v1`,
    model: 'm-a',
    apiKey: 'sk-secret-1',
    local: false,
  })
  // Unchanged baseUrl + blank key → the stored key is reused.
  await fetchProviderModels({ id: sp.id, kind: 'openai-compatible', label: 'Keyed', baseUrl: `${keyA.url}/v1`, model: 'm-a', apiKey: '' })
  assert(keyA.seen.some((s) => s.headers.authorization === 'Bearer sk-secret-1'), 'unchanged baseUrl reuses the stored key')
  // Changed baseUrl + blank key → the stored key must NOT be sent to the new host.
  await fetchProviderModels({ id: sp.id, kind: 'openai-compatible', label: 'Keyed', baseUrl: `${keyB.url}/v1`, model: 'm-a', apiKey: '' })
  assert(!JSON.stringify(keyB.seen).includes('sk-secret-1'), 'changed baseUrl never receives the stored key')
  removeProvider(sp.id)
  await keyA.close()
  await keyB.close()

  console.log('\nAnthropic adapter shape (mock server)')
  const an = await mockServer((req, res) => {
    if (req.url === '/v1/messages') return json(res, 200, { content: [{ type: 'text', text: 'OK' }] })
    json(res, 404, {})
  })
  const ta = await testProvider({ kind: 'anthropic', label: 'Claude', baseUrl: `${an.url}/v1`, model: 'claude-haiku-4-5', apiKey: 'sk-ant-test' })
  const areq = an.seen.find((s) => s.url === '/v1/messages')
  assert(ta.ok && ta.sample === 'OK', 'Anthropic test ok')
  assert(areq?.headers['x-api-key'] === 'sk-ant-test' && areq?.headers['anthropic-version'] === ANTHROPIC_VERSION, 'x-api-key + anthropic-version headers')
  assert(!areq?.headers.authorization, 'no Bearer header for Anthropic')
  assert(typeof areq?.body?.max_tokens === 'number' && areq?.body?.temperature === undefined, 'max_tokens set, no temperature')
  const ab = buildAnthropicBody('m', { system: 'SYS', prompt: 'P' }) as { system?: string; messages: Array<{ role: string; content: string }> }
  assert(ab.system === 'SYS' && ab.messages[0].role === 'user' && ab.messages[0].content === 'P', 'system is top-level, prompt is the user message')

  console.log('\nLegacy settings migration (Groq user)')
  const legacyDir = freshDir('legacy')
  fs.writeFileSync(
    path.join(legacyDir, 'lkv-llm.json'),
    JSON.stringify({ provider: 'auto', grokEnabled: false, grokModel: 'grok-4.3', groqEnabled: true, groqModel: 'openai/gpt-oss-20b' }),
  )
  fs.writeFileSync(path.join(legacyDir, 'lkv-groq-key'), 'gsk_fake_for_test\n', { mode: 0o600 })
  fs.writeFileSync(path.join(legacyDir, 'lkv-xai-key'), 'xai-fake\n', { mode: 0o600 })
  const before = ['lkv-llm.json', 'lkv-groq-key', 'lkv-xai-key'].map((f) => sha(path.join(legacyDir, f)))
  const mf = loadProvidersFile()
  const groq = listProviderConfigs().find((p) => p.id === 'groq')
  const xai = listProviderConfigs().find((p) => p.id === 'xai')
  assert(mf.selected === 'groq', 'legacy auto+groqEnabled → selected groq (keeps working)')
  assert(groq?.enabled && groq.hasKey && groq.model === 'openai/gpt-oss-20b', 'Groq entry enabled with legacy key + model')
  assert(xai && !xai.enabled && xai.hasKey && xai.model === 'grok-4.3', 'xAI entry kept, disabled (was off)')
  const after = ['lkv-llm.json', 'lkv-groq-key', 'lkv-xai-key'].map((f) => sha(path.join(legacyDir, f)))
  assert(before.join() === after.join(), 'legacy settings + key files untouched')
  assert(fs.existsSync(path.join(legacyDir, 'lkv-providers.json')), 'lkv-providers.json written')
  const pure = buildInitialProvidersFile({ legacy: { provider: 'grok', grokEnabled: true }, legacyGroqKeyFile: false, legacyXaiKeyFile: true })
  assert(pure.selected === 'xai', 'legacy provider "grok" → xai')
  const pure2 = buildInitialProvidersFile({ legacy: { provider: 'auto', groqEnabled: false, grokEnabled: false }, legacyGroqKeyFile: true, legacyXaiKeyFile: false })
  assert(pure2.selected === 'auto', 'legacy auto with clouds off → Auto')

  console.log('\nPlugin manifest validation')
  const good = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/plugins/openrouter-free-models/plugin.json'), 'utf8'))
  assert(validatePluginManifest(good).errors.length === 0, 'example openrouter-free-models validates')
  const bad = validatePluginManifest({
    schemaVersion: 2,
    id: 'Bad ID',
    name: 'x',
    version: 'one',
    main: 'index.js',
    contributes: { providers: [{ id: 'p', label: 'P', kind: 'soap', baseUrl: 'http://evil.example.com', apiKey: 'x' }], themes: [] },
  })
  const msgs = bad.errors.join(' | ')
  assert(/schemaVersion/.test(msgs), 'rejects wrong schemaVersion')
  assert(/"id" must be/.test(msgs), 'rejects bad id')
  assert(/"main" is not allowed/.test(msgs), 'rejects code entry points')
  assert(/Unknown contribution type "themes"/.test(msgs), 'rejects unknown contribution type')
  assert(/kind must be one of/.test(msgs), 'rejects unknown provider kind')
  assert(/must use https/.test(msgs), 'rejects plain-http remote URL')
  assert(/apiKey is not allowed/.test(msgs), 'rejects shipped API keys')

  console.log('\nPlugin install (folder + zip), contributions, disable, remove')
  const pdir = freshDir('plugins')
  const ins1 = installPluginFrom(path.join(__dirname, '../examples/plugins/study-buddy'))
  assert(ins1.ok && ins1.plugin?.id === 'study-buddy', 'install study-buddy from folder')
  const c1 = getPluginContributions()
  assert(c1.personas.length === 2 && /patient study partner/.test(c1.personas[0].prompt), 'promptFile persona resolved from persona.md')
  assert(c1.promptPacks[0]?.prompts.length === 4 && c1.mcpServers.length === 1, 'prompt pack + MCP preset contributed')
  const zipPath = path.join(pdir, 'openrouter-free-models.zip')
  writeZipFromFiles(zipPath, [
    { relativePath: 'openrouter-free-models/plugin.json', content: JSON.stringify(good, null, 2) },
    { relativePath: 'openrouter-free-models/evil.js', content: 'require("child_process")' },
  ])
  const ins2 = installPluginFrom(zipPath)
  assert(ins2.ok && ins2.plugin?.id === 'openrouter-free-models', `install from .zip (${ins2.errors?.join('; ') ?? 'ok'})`)
  assert((ins2.warnings ?? []).some((w) => /evil\.js/.test(w)), 'non-asset files skipped with a warning')
  assert(!fs.existsSync(path.join(pluginsDir(), 'openrouter-free-models', 'evil.js')), 'evil.js not copied')
  const presets = listPresets().filter((p) => p.pluginId === 'openrouter-free-models')
  assert(presets.length === 3 && presets[0].id === 'plugin:openrouter-free-models:free-router', 'plugin provider presets listed')
  const pp = listProviderConfigs().find((p) => p.id === 'plugin:openrouter-free-models:free-router')
  assert(pp && !pp.enabled && pp.requiresKey, 'plugin providers are opt-in (disabled) and need a key')
  // broken plugin folder surfaces a readable error, others still load
  fs.mkdirSync(path.join(pluginsDir(), 'broken'), { recursive: true })
  fs.writeFileSync(path.join(pluginsDir(), 'broken', 'plugin.json'), '{\n  "schemaVersion": 1,\n  "id": "broken",\n  oops\n}')
  reloadPlugins()
  const lr = listPluginsResult()
  assert(lr.plugins.length === 2, 'good plugins still load next to a broken one')
  assert(lr.errors.some((e) => e.folder === 'broken' && /line 4/.test(e.errors.join(' '))), `broken plugin.json error names the line (${lr.errors[0]?.errors[0]})`)
  const badIns = installPluginFrom(path.join(pluginsDir(), 'broken'))
  assert(!badIns.ok && (badIns.errors?.length ?? 0) > 0, 'installing an invalid plugin fails with errors')
  setPluginEnabled('study-buddy', false)
  assert(getPluginContributions().personas.length === 0, 'disabled plugin contributes nothing')
  setPluginEnabled('study-buddy', true)
  setPluginEnabled('media-chat', false)
  assert(listPluginsResult().disabled.includes('media-chat'), 'built-in panel can be disabled (state persisted)')
  removePlugin('study-buddy')
  assert(!fs.existsSync(path.join(pluginsDir(), 'study-buddy')) && fs.existsSync(path.join(pdir, 'plugins-removed')), 'remove moves plugin to plugins-removed/ (recoverable)')

  await Promise.all([ollama.close(), oa.close(), an.close()])
  setLlmUserDataDir(null)
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
