/**
 * Offline smoke tests for grounding & routing gaps (#43, #78):
 * - askGrounded (generate.ts): offline path, empty response, citation extraction/validation
 * - sendChatTurn (chat.ts): greeting path, search query building, offline path, empty response
 * - buildChatSearchQuery (chat.ts): FTS input with prior user turns
 * - isGreetingOrSocial (chat.ts): greeting detection
 * - pickModel (ollama.ts): model selection logic
 * - stripThinking (providers/http.ts): thinking tag removal (incl. multiline,
 *   case-insensitive, unclosed, multiple blocks)
 * - buildFtsQuery/searchQuery (search.ts): tricky FTS input never throws
 * - getDb/initDb/closeDb (db.ts): init-failure behaviour
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

type MockGen =
  | { ok: true; text: string; provider?: string; providerLabel?: string; model?: string; local?: boolean; fallback?: boolean }
  | { ok: false; error: string; provider?: string }
let mockLlmGenerateResult: MockGen = { ok: true, text: 'Test answer [itm_123]' }
function setMockLlmGenerate(result: MockGen) {
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
  const { initDb, closeDb, getDb, createItem, createSession, createPrompt, appendMessage, listMessages } = require('../electron/db')
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
  const { searchQuery, buildFtsQuery, tokenizeFts } = require('../electron/search')
  const {
    askGrounded,
    buildGroundedMessages,
    extractCitedIds,
    validateCitations,
    citationsFromIds,
    offlineCopy,
    stripInvalidCitations,
    finalizeAnswer,
    UNCITED_LABEL,
  } = require('../electron/generate')
  const {
    sendChatTurn,
    buildChatSearchQuery,
    isGreetingOrSocial,
    parseCitations,
  } = require('../electron/chat')
  const { pickModel, estimateNumCtx, readOllamaStream } = require('../electron/ollama')
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

  // --- buildGroundedMessages: history char cap (#36) ---
  const longHistory = Array.from({ length: 6 }, (_, i) => [
    { role: 'user' as const, content: `question number ${i} ` + 'x'.repeat(900) },
    { role: 'assistant' as const, content: `answer number ${i} ` + 'y'.repeat(900) },
  ]).flat()
  const capped = buildGroundedMessages('q', hits.hits, { history: longHistory })
  assert(!capped.prompt.includes('question number 0'), 'history cap drops the oldest turns first')
  assert(capped.prompt.includes('question number 5'), 'history cap keeps the most recent turns')

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
  assert(!withCitations.answer.includes('itm_999'), 'askGrounded strips hallucinated marker from answer text')

  // --- citation marker cleanup (#38) ---
  console.log('\ngenerate.ts — citation marker cleanup (#38)')
  assert(
    stripInvalidCitations('Answer [itm_1] and [itm_fake].', ['itm_1']) === 'Answer [itm_1] and.',
    'stripInvalidCitations removes the invalid marker, keeps the valid one'
  )
  assert(
    stripInvalidCitations('Only [itm_fake] here.', ['itm_1']) === 'Only here.',
    'stripInvalidCitations eats the leading space of a stripped marker'
  )
  assert(
    stripInvalidCitations('No markers at all.', ['itm_1']) === 'No markers at all.',
    'stripInvalidCitations leaves clean text untouched'
  )
  const cited = finalizeAnswer('Answer [itm_1].', ['itm_1'])
  assert(
    cited.answer === 'Answer [itm_1].' && cited.uncited === false,
    'finalizeAnswer keeps a cited answer unchanged'
  )
  const uncitedFin = finalizeAnswer('Answer [itm_fake].', ['itm_1'])
  assert(
    uncitedFin.answer === 'Answer.' && uncitedFin.uncited === true,
    'finalizeAnswer flags an answer that cites nothing (label not in text)'
  )
  const refusalFin = finalizeAnswer(
    "I'm sorry, but none of the passages contain information about that.",
    ['itm_1']
  )
  assert(
    refusalFin.uncited === false,
    'finalizeAnswer does not flag an honest "not in your notes" refusal (#235)'
  )
  const refusalFin2 = finalizeAnswer(
    'The notes do not cover this topic.',
    ['itm_1']
  )
  assert(refusalFin2.uncited === false, 'a plain "notes do not cover this" is not flagged (#235)')
  assert(
    finalizeAnswer('None of the passages you provided contain information about vitamin D.', ['itm_1'])
      .uncited === false,
    '"none of the passages contain…" is not flagged (#235)'
  )
  assert(
    finalizeAnswer('I could not find this in the provided excerpts.', ['itm_1']).uncited === false,
    '"could not find this in the excerpts" is not flagged (#235)'
  )
  assert(
    finalizeAnswer('There is no information about vitamin D in the notes.', ['itm_1']).uncited
      === false,
    '"no information in the notes" is not flagged (#235)'
  )
  assert(
    finalizeAnswer('Vitamin D is a fat-soluble vitamin.', ['itm_1']).uncited === true,
    'a substantive uncited answer is still flagged (#235)'
  )
  assert(
    finalizeAnswer('Answer: take 2000 IU daily.', ['itm_1']).uncited === true,
    'a short factual answer with no citation is still flagged (#235)'
  )
  const emptyFin = finalizeAnswer('   ', ['itm_1'])
  assert(
    emptyFin.answer === '(empty model response)' && emptyFin.uncited === false,
    'finalizeAnswer empty text is the sentinel, not labelled'
  )

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

  // --- sendChatTurn: uncited answer is flagged as metadata, never stored text (#38, #235) ---
  setMockLlmGenerate({ ok: true, text: 'An answer that cites nothing' })
  const uncited = await sendChatTurn({ sessionId: session.id, text: 'alpha', filters: { project: 'test' } })
  assert(
    uncited.assistant.uncited === true && !uncited.assistant.content.includes(UNCITED_LABEL),
    'sendChatTurn flags an uncited answer as metadata, label not in content (#235)'
  )
  // Round-trip: the flag survives persistence, the text stays clean.
  const reread = listMessages(session.id).find((m) => m.id === uncited.assistant.id)
  assert(
    !!reread && reread.uncited === true && !reread.content.includes(UNCITED_LABEL),
    'uncited flag persists and the stored content never carries the label (#235)'
  )
  // Legacy rows: text written before #235 still embeds the label; reads strip it.
  const legacyRowId = 'msg_legacy_235'
  getDb()
    .prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, citations_json, hits_json, provider_json, uncited, created_at)
       VALUES (?, ?, 'assistant', ?, NULL, NULL, NULL, 1, ?)`
    )
    .run(
      legacyRowId,
      session.id,
      `${UNCITED_LABEL}\n\nI'm sorry, but none of the passages contain information about that.`,
      new Date().toISOString()
    )
  const legacy = listMessages(session.id).find((m) => m.id === legacyRowId)
  assert(
    !!legacy && !legacy.content.includes(UNCITED_LABEL) && legacy.content.startsWith("I'm sorry"),
    'legacy rows with the embedded label are cleaned on read (#235)'
  )

  // --- sendChatTurn: hallucinated marker stripped from persisted content (#38) ---
  setMockLlmGenerate({ ok: true, text: 'Answer [itm_zzz999] only' })
  const hallucinated = await sendChatTurn({ sessionId: session.id, text: 'alpha', filters: { project: 'test' } })
  assert(!hallucinated.assistant.content.includes('[itm_zzz999]'), 'sendChatTurn strips a hallucinated marker from content')

  // --- The answering provider is recorded so cloud answers can be flagged (#45) ---
  setMockLlmGenerate({ ok: true, text: 'Cloud answer', provider: 'groq', providerLabel: 'Groq', model: 'gpt-oss-20b', local: false, fallback: true })
  const cloudChat = await sendChatTurn({ sessionId: session.id, text: 'alpha', filters: { project: 'test' } })
  const cloudProv = JSON.parse(cloudChat.assistant.provider_json ?? 'null')
  assert(cloudProv?.id === 'groq' && cloudProv.local === false && cloudProv.fallback === true, 'sendChatTurn records a cloud fallback on the message')
  assert(
    cloudChat.messages.find((m: { id: string }) => m.id === cloudChat.assistant.id)?.provider_json === cloudChat.assistant.provider_json,
    'the recorded provider survives a reload of the thread'
  )
  const cloudAsk = await askGrounded({ question: 'alpha', limit: 5 })
  assert(cloudAsk.provider?.label === 'Groq' && cloudAsk.provider.fallback === true, 'askGrounded returns the answering provider')
  setMockLlmGenerate({ ok: true, text: 'Should not be called' })
  const cannedChat = await sendChatTurn({ sessionId: session.id, text: 'completely nonexistent topic xyz', filters: { project: 'nope' } })
  assert(cannedChat.assistant.provider_json === null, 'a canned not-found reply records no provider')

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

  // --- estimateNumCtx (#36) ---
  assert(
    estimateNumCtx(undefined, 'hi', undefined) === 2048,
    'estimateNumCtx floors at Ollama default (2048) for short prompts'
  )
  assert(
    estimateNumCtx(undefined, 'x'.repeat(12000), undefined) > 2048,
    'estimateNumCtx grows past the floor for a large prompt'
  )
  assert(
    estimateNumCtx(undefined, 'x'.repeat(100_000), 1024) === 8192,
    'estimateNumCtx caps at the max context (8192)'
  )
  assert(
    estimateNumCtx(undefined, 'x'.repeat(4000), 1024) === 2048,
    'estimateNumCtx adds output headroom before crossing the floor'
  )

  // --- readOllamaStream (#36): NDJSON loop skips thinking, flushes tail ---
  const ndjson = [
    JSON.stringify({ response: 'Hel', done: false }),
    JSON.stringify({ thinking: 'internal reasoning to skip', done: false }),
    JSON.stringify({ response: 'lo', done: false }),
    JSON.stringify({ response: '!', done: true }),
  ].join('\n')
  const streamed = await readOllamaStream(new Response(ndjson))
  assert(streamed === 'Hello!', 'readOllamaStream concatenates response and skips thinking')
  const streamTail = await readOllamaStream(new Response('{"response":"tail"}'))
  assert(streamTail === 'tail', 'readOllamaStream flushes a final line without a newline')
  const streamMalformed = await readOllamaStream(new Response('{"response":"ok"}\nnot-json\n'))
  assert(streamMalformed === 'ok', 'readOllamaStream skips a malformed line')
  const streamBadTail = await readOllamaStream(new Response('not-json'))
  assert(streamBadTail === '', 'readOllamaStream ignores a malformed tail')

  console.log('\nproviders/http.ts — stripThinking')

  // --- stripThinking (#43: reasoning models inline <think>…</think>) ---
  assert(stripThinking('Normal answer') === 'Normal answer', 'stripThinking leaves normal text')
  assert(
    stripThinking('<think>reasoning</think>Final answer') === 'Final answer',
    'stripThinking removes a think block'
  )
  assert(
    stripThinking('<think>\nline1\nline2\n</think>\nAnswer') === 'Answer',
    'stripThinking removes multiline think block'
  )
  const upper = stripThinking('Prefix <THINK>upper</THINK> suffix')
  assert(
    !/upper/i.test(upper) && upper.includes('Prefix') && upper.includes('suffix'),
    'stripThinking is case-insensitive'
  )
  assert(
    stripThinking('<think>unclosed reasoning') === '',
    'stripThinking drops leading unclosed think'
  )
  const multi = stripThinking('A <think>one</think> B <think>two</think> C')
  assert(
    multi.includes('A') && multi.includes('B') && multi.includes('C') &&
      !multi.includes('one') && !multi.includes('two'),
    'stripThinking removes multiple think blocks'
  )
  assert(stripThinking('<think>only</think>') === '', 'stripThinking empty after strip is empty')
  assert(
    stripThinking('  <think>spaced</think>  Trimmed  ') === 'Trimmed',
    'stripThinking trims surrounding whitespace'
  )
  assert(
    stripThinking('Real answer <think>unclosed reasoning trailing') === 'Real answer',
    'stripThinking removes a mid-answer unclosed think block (#36)'
  )

  console.log('\nsearch.ts — query building (#37) + tricky FTS input (#43)')

  // --- buildFtsQuery: stopwords dropped, terms quoted, no prefix `*` ---
  assert(buildFtsQuery('') === '', 'buildFtsQuery empty returns empty')
  assert(buildFtsQuery('   ') === '', 'buildFtsQuery whitespace returns empty')
  assert(buildFtsQuery('"\'*(){}[]^:~') === '', 'buildFtsQuery only-special-chars returns empty')
  assert(
    buildFtsQuery('hello"world') === '"hello" OR "world"',
    'buildFtsQuery splits on stripped quotes and quotes terms'
  )
  const orInjection = buildFtsQuery('foo OR bar')
  assert(
    orInjection === '"foo" OR "bar"',
    'buildFtsQuery drops the "or" stopword (and cannot inject an operator)'
  )
  assert(
    buildFtsQuery('"unterminated') === '"unterminated"',
    'buildFtsQuery quotes an unbalanced quote'
  )
  assert(
    buildFtsQuery('café naïve') === '"café" OR "naïve"',
    'buildFtsQuery keeps unicode tokens'
  )
  assert(
    buildFtsQuery('what are my habits') === '"habits"',
    'buildFtsQuery drops stopwords, keeps the meaningful term (#37)'
  )
  assert(
    JSON.stringify(tokenizeFts("it's")) === '["s"]',
    'tokenizeFts drops "it" stopword, keeps "s" so the query is not empty (#37)'
  )
  assert(
    JSON.stringify(tokenizeFts('The Quick BROWN fox')) === '["quick","brown","fox"]',
    'tokenizeFts lowercases and drops stopwords'
  )
  assert(
    buildFtsQuery('alpha beta alpha Alpha beta') === '"alpha" OR "beta"',
    'buildFtsQuery deduplicates repeated terms (#196)'
  )

  // --- A strong match is never dropped for scoring too well (#196) ---
  // bm25() is more negative for better matches; the old `bm25 > -15` floor
  // removed exactly these once the corpus and query grew.
  for (let i = 0; i < 40; i++) {
    createItem({ title: `Filler ${i}`, body: `Unrelated filler passage number ${i} about gardening`, kind: 'note', project: 'filler' })
  }
  const strong = createItem({
    title: 'Quarterly kayak budget',
    body: 'Kayak paddle budget quarterly forecast zephyr marigold lantern',
    kind: 'note',
    project: 'strong',
  })
  const strongHits = searchQuery({ text: 'kayak paddle budget quarterly forecast zephyr marigold lantern', limit: 5 })
  assert(strongHits.hits[0]?.id === strong.id, 'a strong multi-term match is returned first, not filtered out (#196)')
  assert(strongHits.hits[0]?.score < -15, 'the strong match scores below the old -15 floor (regression guard for #196)')

  // --- CJK substring search via trigram (#37) ---
  const cjk = createItem({ title: 'CJK note', body: '今日の東京の天気は晴れです', kind: 'note' })
  const cjkHits = searchQuery({ text: 'の天気', limit: 5 })
  assert(cjkHits.hits.some((h: { id: string }) => h.id === cjk.id), 'trigram finds a CJK substring (の天気)')
  const cjkMiss = searchQuery({ text: '不存在の言葉', limit: 5 })
  assert(!cjkMiss.hits.some((h: { id: string }) => h.id === cjk.id), 'unrelated CJK does not match the note')

  // --- searchQuery: tricky input never throws, always returns hits array ---
  const trickyInputs = [
    '',
    '   ',
    '"\'*(){}[]^:~',
    '*',
    '((()))',
    'foo:bar',
    'foo OR bar',
    'OR AND NOT',
    '"unterminated',
    '<script>alert(1)</script>',
    'café naïve 日本語',
    'foo-bar_baz.qux/quux',
    'a '.repeat(2000).trim(),
  ]
  for (const t of trickyInputs) {
    let threw = false
    let hits: unknown[] | undefined
    try {
      const r = searchQuery({ text: t, limit: 5 })
      hits = r.hits
    } catch {
      threw = true
    }
    assert(!threw && Array.isArray(hits), `searchQuery no-throw for ${JSON.stringify(t.slice(0, 24))}`)
  }
  // Tricky queries still retrieve when the content matches
  const quoted = searchQuery({ text: 'hello"world', limit: 5 })
  assert(Array.isArray(quoted.hits), 'searchQuery quoted input returns hits array')

  console.log('\ndb.ts — init failure (#43)')

  // --- DB init failure: callers must see a clear error, never a silent null ---
  closeDb()
  let getThrew = false
  try {
    getDb()
  } catch (e) {
    getThrew = /not initialized/i.test((e as Error).message)
  }
  assert(getThrew, 'getDb after closeDb throws not-initialized')
  let doubleCloseThrew = false
  try {
    closeDb()
  } catch {
    doubleCloseThrew = true
  }
  assert(!doubleCloseThrew, 'closeDb is idempotent')
  let badInitThrew = false
  try {
    initDb(path.dirname(dbFile))
  } catch {
    badInitThrew = true
  }
  assert(badInitThrew, 'initDb on a directory path throws')
  // Re-open so cleanup below sees a live handle
  initDb(dbFile)
  assert(getDb() !== null, 'initDb re-opens after failure')

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