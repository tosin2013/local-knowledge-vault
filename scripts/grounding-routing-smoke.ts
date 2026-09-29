/**
 * Offline smoke tests for grounding & routing gaps:
 * - askGrounded (generate.ts): offline path, empty response, citation extraction/validation
 * - sendChatTurn (chat.ts): greeting path, search query building, offline path, empty response
 * - buildChatSearchQuery (chat.ts): FTS input with prior user turns
 * - isGreetingOrSocial (chat.ts): greeting detection
 * - pickModel (ollama.ts): model selection logic
 * - stripThinking (providers/http.ts): thinking tag removal
 *
 * Runs under Electron-as-Node with mocked llmGenerate.
 *
 *   npm run test:grounding-routing
 */

// --- Module._load hook to mock llmGenerate MUST BE FIRST ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load

let mockLlmGenerateResult: { ok: true; text: string } | { ok: false; error: string } = { ok: true, text: 'Test answer [itm_123]' }
function setMockLlmGenerate(result: { ok: true; text: string } | { ok: false; error: string }) {
  mockLlmGenerateResult = result
}

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request === '../electron/llm' || request.endsWith('/electron/llm') || request.endsWith('electron/llm') || request === 'electron/llm' || request.includes('electron/llm')) {
    return {
      llmGenerate: async () => mockLlmGenerateResult,
      providerDisplayName: (providerId: string | null | undefined, label?: string) => label || providerId || 'AI',
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

// Import test utilities
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

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Grounding & Routing smoke ===\n')

  // 1) Initialize DB
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-gr-')), 'test.sqlite')
  const { initDb, closeDb, createItem, createSession, createPrompt } = require('../electron/db')
  initDb(dbFile)

  // Create some test items for citation testing
  createItem({ title: 'Note 1', body: 'Content about alpha and beta', kind: 'note', project: 'test' })
  createItem({ title: 'Note 2', body: 'Content about gamma and delta', kind: 'note', project: 'test' })
  const item1 = createItem({ title: 'Note 3', body: 'Content about epsilon', kind: 'note', project: 'test' })
  const item2 = createItem({ title: 'Note 4', body: 'Content about zeta', kind: 'note', project: 'test' })

  // Create a test session
  const session = createSession({ title: 'Test Session', project: 'test' })

  // Create a test prompt
  const prompt = createPrompt({ name: 'Test Prompt', body: 'You are a test assistant', description: 'Test' })

  // 2) NOW require electron modules that depend on llm (AFTER mock is installed)
  const { searchQuery } = require('../electron/search')
  const {
    askGrounded,
    buildGroundedMessages,
    extractCitedIds,
    validateCitations,
    citationsFromIds,
    offlineCopy,
  } = require('../electron/generate')
  const {
    sendChatTurn,
    buildChatSearchQuery,
    isGreetingOrSocial,
    parseCitations,
  } = require('../electron/chat')
  const { pickModel } = require('../electron/ollama')
  const { stripThinking } = require('../electron/providers/http')

  console.log('generate.ts — askGrounded & helpers')

  // --- extractCitedIds ---
  assert(
    extractCitedIds('Answer [itm_abc] and [itm_def]').length === 2,
    'extractCitedIds finds multiple citations'
  )
  assert(
    extractCitedIds('Answer [itm_abc] and [itm_abc]').length === 1,
    'extractCitedIds deduplicates'
  )
  assert(
    extractCitedIds('No citations here').length === 0,
    'extractCitedIds returns empty for no citations'
  )

  // --- validateCitations ---
  const allowed = new Set(['itm_1', 'itm_2', 'itm_3'])
  assert(
    validateCitations(['itm_1', 'itm_4'], allowed).length === 1,
    'validateCitations drops hallucinated IDs'
  )
  assert(
    validateCitations(['itm_1', 'itm_2'], allowed).length === 2,
    'validateCitations keeps allowed IDs'
  )
  assert(
    validateCitations([], allowed).length === 0,
    'validateCitations handles empty input'
  )

  // --- citationsFromIds ---
  const cits = citationsFromIds([item1.id, item2.id])
  assert(cits.length === 2 && cits[0].id === item1.id, 'citationsFromIds builds citation objects')

  // --- buildGroundedMessages ---
  const hits = await searchQuery({ text: 'alpha', limit: 5 })
  const msgs = buildGroundedMessages('test question', hits.hits, { systemExtra: 'Be concise' })
  assert(msgs.system.includes('careful assistant'), 'system includes grounding rules')
  assert(msgs.system.includes('Be concise'), 'system includes extra guidance')
  assert(msgs.prompt.includes('Passages:'), 'prompt includes passages')
  assert(msgs.prompt.includes('Question: test question'), 'prompt includes question')
  assert(msgs.prompt.includes('Answer (with [id] citations):'), 'prompt includes citation instruction')

  // --- offlineCopy ---
  assert(
    offlineCopy({ error: 'API key missing', provider: 'openai' }, 'suffix').includes('add the key'),
    'offlineCopy handles API key error'
  )
  assert(
    offlineCopy({ error: 'no models found', provider: 'ollama' }, 'suffix').includes('no models'),
    'offlineCopy handles no models error'
  )
  assert(
    offlineCopy({ error: 'not running', provider: 'ollama' }, 'suffix').includes('local models'),
    'offlineCopy handles Ollama not running'
  )
  assert(
    offlineCopy({ error: 'timeout', provider: 'openai', providerLabel: 'My OpenAI' }, 'suffix').includes('My OpenAI'),
    'offlineCopy uses providerLabel'
  )
  assert(
    offlineCopy({ error: 'unknown error' }, 'suffix').includes('unknown error'),
    'offlineCopy handles generic error'
  )

  // --- askGrounded: no hits path ---
  setMockLlmGenerate({ ok: true, text: 'Should not be called' })
  const noHits = await askGrounded({ question: 'quantum flux capacitor xyzzy plugh', limit: 5 })
  assert(noHits.hits.length === 0, 'askGrounded no hits returns empty hits')
  assert(noHits.answer.includes("couldn't find"), 'askGrounded no hits returns not-found message')
  assert(noHits.citations.length === 0, 'askGrounded no hits has no citations')

  // --- askGrounded: offline path (llmGenerate fails) ---
  setMockLlmGenerate({ ok: false, error: 'Connection refused', provider: 'ollama' })
  const offline = await askGrounded({ question: 'alpha', limit: 5 })
  assert(offline.offline === true, 'askGrounded offline path sets offline=true')
  assert(offline.answer.includes('Showing search hits only'), 'askGrounded offline shows fallback')
  assert(offline.error === 'Connection refused', 'askGrounded offline preserves error')
  assert(offline.hits.length > 0, 'askGrounded offline includes hits')
  assert(offline.citations.length === 0, 'askGrounded offline has no citations')

  // --- askGrounded: empty model response ---
  setMockLlmGenerate({ ok: true, text: '   ' })
  const emptyResp = await askGrounded({ question: 'alpha', limit: 5 })
  assert(emptyResp.answer === '(empty model response)', 'askGrounded handles empty response')

  // --- askGrounded: citation validation ---
  // First get the hits for 'alpha' to know the valid IDs
  const alphaHits = await searchQuery({ text: 'alpha', limit: 5 })
  const validHitId = alphaHits.hits[0]?.id
  setMockLlmGenerate({ ok: true, text: `Answer [${validHitId}] and [itm_999]` }) // itm_999 is hallucinated
  const withCitations = await askGrounded({ question: 'alpha', limit: 5 })
  assert(withCitations.citations.every((c: { id: string }) => c.id !== 'itm_999'), 'askGrounded drops hallucinated citations')
  assert(withCitations.citations.some((c: { id: string }) => c.id === validHitId), 'askGrounded keeps valid citations')

  console.log('\nchat.ts — sendChatTurn & helpers')

  // --- isGreetingOrSocial ---
  assert(isGreetingOrSocial('hi') === true, 'isGreetingOrSocial detects hi')
  assert(isGreetingOrSocial('hello there') === true, 'isGreetingOrSocial detects hello there')
  assert(isGreetingOrSocial('good morning') === true, 'isGreetingOrSocial detects good morning')
  assert(isGreetingOrSocial('thanks') === true, 'isGreetingOrSocial detects thanks')
  assert(isGreetingOrSocial('what can you do') === true, 'isGreetingOrSocial detects what can you do')
  assert(isGreetingOrSocial('how does this work') === true, 'isGreetingOrSocial detects how does this work')
  assert(isGreetingOrSocial('help') === true, 'isGreetingOrSocial detects help')
  assert(isGreetingOrSocial('what is the capital of france') === false, 'isGreetingOrSocial rejects real question')
  assert(isGreetingOrSocial('') === false, 'isGreetingOrSocial rejects empty')
  assert(isGreetingOrSocial('a'.repeat(81)) === false, 'isGreetingOrSocial rejects long text')

  // --- parseCitations ---
  assert(parseCitations(null).length === 0, 'parseCitations handles null')
  assert(parseCitations('invalid').length === 0, 'parseCitations handles invalid JSON')
  assert(parseCitations('[{"id":"itm_1","title":"Note"}]').length === 1, 'parseCitations parses valid JSON')

  // --- buildChatSearchQuery ---
  assert(buildChatSearchQuery('latest', []).includes('latest'), 'buildChatSearchQuery with no priors')
  assert(buildChatSearchQuery('', ['prior1', 'prior2']).includes('prior1'), 'buildChatSearchQuery with priors only')
  assert(buildChatSearchQuery('short', ['prior1']).includes('prior1'), 'buildChatSearchQuery short latest puts priors first')
  assert(buildChatSearchQuery('longer question here', ['prior1']).startsWith('longer question'), 'buildChatSearchQuery long latest puts latest first')
  assert(buildChatSearchQuery('', []).length === 0, 'buildChatSearchQuery empty returns empty')

  // --- sendChatTurn: greeting path ---
  setMockLlmGenerate({ ok: true, text: 'Should not be called' })
  const greetResult = await sendChatTurn({ sessionId: session.id, text: 'hi there', filters: { project: 'test' } })
  assert(greetResult.assistant.content.includes('test'), 'sendChatTurn greeting includes project')
  assert(greetResult.assistant.content.includes('welcome') || greetResult.assistant.content.includes('Ask'), 'sendChatTurn greeting is orienting')

  // --- sendChatTurn: no hits path ---
  const noHitsChat = await sendChatTurn({ sessionId: session.id, text: 'completely nonexistent topic xyz', filters: { project: 'test' } })
  assert(noHitsChat.assistant.content.includes("couldn't find"), 'sendChatTurn no hits returns not-found message')
  assert(noHitsChat.offline === undefined || noHitsChat.offline === false, 'sendChatTurn no hits not offline')

  // --- sendChatTurn: no hits, no project scope (covers the no-project message) ---
  const noProjectSession = createSession({ title: 'No project' })
  const noHitsNoProject = await sendChatTurn({ sessionId: noProjectSession.id, text: 'qqqzzzvvvwwwxxx', filters: {} })
  assert(noHitsNoProject.assistant.content.includes('Project / Profile scope'), 'sendChatTurn no hits without project suggests Project / Profile')

  // --- sendChatTurn: offline path ---
  setMockLlmGenerate({ ok: false, error: 'Ollama not running', provider: 'ollama' })
  const offlineChat = await sendChatTurn({ sessionId: session.id, text: 'alpha beta', filters: { project: 'test' } })
  assert(offlineChat.offline === true, 'sendChatTurn offline path sets offline=true')
  assert(offlineChat.error?.includes('Ollama not running'), 'sendChatTurn offline preserves error')

  // --- sendChatTurn: empty model response ---
  setMockLlmGenerate({ ok: true, text: '   ' })
  const emptyChat = await sendChatTurn({ sessionId: session.id, text: 'alpha beta', filters: { project: 'test' } })
  assert(emptyChat.assistant.content === '(empty model response)', 'sendChatTurn handles empty response')

  // --- sendChatTurn: with promptId ---
  setMockLlmGenerate({ ok: true, text: 'Prompt answer [itm_123]' })
  const withPrompt = await sendChatTurn({ sessionId: session.id, text: 'test', promptId: prompt.id, filters: { project: 'test' } })
  assert(withPrompt.assistant.content.includes('Prompt answer'), 'sendChatTurn uses prompt body as systemExtra')

  console.log('\nollama.ts — pickModel')

  // --- pickModel ---
  const models = ['qwen3:7b', 'llama3.2:3b', 'gemma3:4b', 'nomic-embed-text', 'llama3.2:cloud']
  const picked = pickModel(models, { 'qwen3:7b': '7B', 'llama3.2:3b': '3B' })
  assert(picked === 'qwen3:7b', 'pickModel prefers qwen3')
  const picked2 = pickModel(['llama3.2:3b', 'gemma3:4b'], {})
  assert(picked2 === 'llama3.2:3b', 'pickModel prefers llama3.2')
  const picked3 = pickModel(['small-model'], { 'small-model': '1B' })
  assert(picked3 === 'small-model', 'pickModel falls back to available')
  const picked4 = pickModel([], {})
  assert(picked4 === null, 'pickModel returns null for empty list')
  process.env.LKV_OLLAMA_MODEL = 'model2'
  const pickedEnv = pickModel(['model1', 'model2'], {})
  assert(pickedEnv === 'model2', 'pickModel respects LKV_OLLAMA_MODEL env')
  delete process.env.LKV_OLLAMA_MODEL

  console.log('\nproviders/http.ts — stripThinking')

  // --- stripThinking ---
  assert(stripThinking('Normal answer') === 'Normal answer', 'stripThinking leaves normal text')
  assert(stripThinking('Okay answer') === 'Okay answer', 'stripThinking removes think tags')

  // Cleanup
  closeDb()
  Module._load = origLoad
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})