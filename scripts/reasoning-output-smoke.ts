/**
 * #275 — reasoning models lose structured output: the classification (empty /
 * truncated / untagged reasoning), the retry with a larger budget, the qwen3
 * /no_think fallback, `reasoning_effort` on OpenAI-compatible bodies, and
 * finish_reason / done_reason surfacing.
 *
 *   npm run test:reasoning-output
 *
 * Runs under Electron-as-Node with a mocked llmGenerate and stubbed fetch, so
 * no model is called.
 */

// --- Module._load hook to mock llm MUST BE FIRST ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load

type MockGen =
  | {
      ok: true
      text: string
      provider: string
      providerLabel: string
      model: string
      local: boolean
      fallback: boolean
      truncated?: boolean
    }
  | { ok: false; error: string; provider?: string; providerLabel?: string }

let mockCalls = 0
const mockPrompts: string[] = []
const mockMaxTokens: Array<number | undefined> = []
let mockQueue: MockGen[] = []
function reply(text: string, model = 'llama3.1:8b', truncated?: boolean): MockGen {
  return {
    ok: true,
    text,
    provider: 'p',
    providerLabel: 'Mock',
    model,
    local: true,
    fallback: false,
    truncated,
  }
}

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async (input: { prompt: string; maxTokens?: number }) => {
        mockCalls++
        mockPrompts.push(input.prompt)
        mockMaxTokens.push(input.maxTokens)
        return (
          mockQueue.shift() ?? {
            ok: false,
            error: 'mock queue empty',
            provider: null,
            providerLabel: 'Mock',
          }
        )
      },
      providerDisplayName: (id: string | null | undefined, label?: string) => label || id || 'AI',
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('../electron/providers/http') as typeof import('../electron/providers/http')
const openai = require('../electron/providers/openai-compatible') as typeof import('../electron/providers/openai-compatible')
const ollama = require('../electron/ollama') as typeof import('../electron/ollama')
const structured = require('../electron/structured') as typeof import('../electron/structured')

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

const GOOD_JSON = '[{"question":"Q?","answer":"A [itm_1]","quote":"quote"}]'

async function withFetch<T>(
  stub: (url: string, init?: RequestInit) => Response,
  fn: () => Promise<T>
): Promise<T> {
  const realFetch = globalThis.fetch
  globalThis.fetch = stub as unknown as typeof globalThis.fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = realFetch
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — reasoning models vs structured output (#275) ===\n')

  // --- Pure helpers (http.ts) ---
  console.log('isReasoningModel')
  for (const m of ['qwen3:4b', 'openai/gpt-oss-20b', 'deepseek-r1:8b', 'QwQ-32B', 'phi-4-reasoning']) {
    assert(http.isReasoningModel(m), `reasoning family: ${m}`)
  }
  for (const m of ['llama3.1:8b', 'gemma3:12b', 'mistral-small', '']) {
    assert(!http.isReasoningModel(m), `not a reasoning family: ${m || '(empty)'}`)
  }

  console.log('looksLikeUntaggedReasoning')
  assert(http.looksLikeUntaggedReasoning('Wait, the answer must be short. Let me reconsider.'), 'a "Wait," opener is reasoning')
  assert(http.looksLikeUntaggedReasoning("Let's think about this step by step."), 'a "Let\'s think" opener is reasoning')
  assert(http.looksLikeUntaggedReasoning('First, identify the chloroplast.'), 'a "First," opener is reasoning')
  assert(!http.looksLikeUntaggedReasoning(GOOD_JSON), 'JSON is not reasoning')
  assert(!http.looksLikeUntaggedReasoning('1. What is photosynthesis?'), 'a question list is not reasoning')
  assert(!http.looksLikeUntaggedReasoning(''), 'empty text is not reasoning')

  console.log('hasBalancedJson')
  assert(http.hasBalancedJson(GOOD_JSON), 'a complete JSON array is balanced')
  assert(http.hasBalancedJson('prose\n```json\n[{"a":1}]\n```'), 'fenced JSON is balanced')
  assert(http.hasBalancedJson('{"a":"a brace } inside a string"}'), 'braces inside strings are ignored')
  assert(!http.hasBalancedJson('[{"question":"Q",'), 'JSON cut off mid-object is unbalanced')
  assert(!http.hasBalancedJson('{"a":"unclosed'), 'JSON cut off mid-string is unbalanced')
  assert(!http.hasBalancedJson('no brackets at all'), 'prose has no JSON')

  console.log('noThinkDirective')
  assert(http.noThinkDirective('Question?').endsWith('/no_think'), 'appends the /no_think soft switch')
  assert(http.noThinkDirective('Question?').startsWith('Question?'), 'keeps the prompt')

  // --- Classifier (structured.ts) ---
  console.log('classifyStructuredReply')
  assert(structured.classifyStructuredReply('', { expect: 'json' }) === 'ran-out', 'empty reply ran out')
  assert(structured.classifyStructuredReply('  \n', { expect: 'json' }) === 'ran-out', 'whitespace reply ran out')
  assert(
    structured.classifyStructuredReply('[{"a":1', { truncated: true, expect: 'json' }) === 'ran-out',
    'a length cutoff is ran-out even mid-JSON'
  )
  assert(structured.classifyStructuredReply(GOOD_JSON, { expect: 'json' }) === 'usable', 'complete JSON is usable')
  assert(
    structured.classifyStructuredReply('[{"question":"Q",', { expect: 'json' }) === 'ran-out',
    'JSON cut off mid-array ran out'
  )
  assert(
    structured.classifyStructuredReply('Wait, the answer must be short. Let me work through it.', { expect: 'json' }) ===
      'reasoning',
    'reasoning prose instead of JSON is "reasoning"'
  )
  assert(
    structured.classifyStructuredReply('I cannot answer that.', { expect: 'json' }) === 'usable',
    'a plain refusal is left to the caller'
  )
  assert(structured.classifyStructuredReply('1. What is X?\n2. Why Y?', { expect: 'list' }) === 'usable', 'a numbered list is usable')
  assert(structured.classifyStructuredReply('- bullet answer', { expect: 'list' }) === 'usable', 'a bulleted list is usable')
  assert(
    structured.classifyStructuredReply('Hmm, let me think about it.', { expect: 'list' }) === 'reasoning',
    'reasoning prose instead of a list is "reasoning"'
  )

  // --- OpenAI-compatible body + finish_reason ---
  console.log('buildOpenAiChatBody')
  const reasoningBody = openai.buildOpenAiChatBody('openai/gpt-oss-20b', {
    prompt: 'p',
    maxTokens: 1500,
    reasoningEffort: 'low',
  })
  assert(reasoningBody.reasoning_effort === 'low', 'a reasoning model gets reasoning_effort: low')
  assert(reasoningBody.max_tokens === 1500, 'max_tokens is sent')
  const plainBody = openai.buildOpenAiChatBody('llama3.1:8b', { prompt: 'p', reasoningEffort: 'low' })
  assert(!('reasoning_effort' in plainBody), 'a non-reasoning model does not get reasoning_effort')

  console.log('openAiChat finish_reason')
  await withFetch(
    () => jsonResponse({ choices: [{ message: { content: GOOD_JSON }, finish_reason: 'length' }] }),
    async () => {
      const r = await openai.openAiChat({ baseUrl: 'http://x', apiKey: null }, 'm', { prompt: 'p' })
      assert(r.ok && r.truncated === true, 'finish_reason "length" surfaces as truncated')
      return r
    },
  )
  await withFetch(
    () => jsonResponse({ choices: [{ message: { content: GOOD_JSON }, finish_reason: 'stop' }] }),
    async () => {
      const r = await openai.openAiChat({ baseUrl: 'http://x', apiKey: null }, 'm', { prompt: 'p' })
      assert(r.ok && !r.truncated, 'finish_reason "stop" is not truncated')
      return r
    },
  )

  console.log('openAiChat reasoning_effort rejection retry')
  const requestBodies: Array<Record<string, unknown>> = []
  await withFetch(
    (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (requestBodies.length === 1) {
        return jsonResponse({ error: { message: "Parameter 'reasoning_effort' is not supported" } }, 400)
      }
      return jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    },
    async () => {
      const r = await openai.openAiChat(
        { baseUrl: 'http://x', apiKey: null },
        'openai/gpt-oss-20b',
        { prompt: 'p', maxTokens: 1500, reasoningEffort: 'low' },
      )
      assert(r.ok, 'the retry after a reasoning_effort rejection succeeds')
      return r
    },
  )
  assert(requestBodies.length === 2, 'a rejected reasoning_effort is retried once')
  assert(requestBodies[0].reasoning_effort === 'low' && requestBodies[0].max_tokens === 1500, 'the first attempt asked for low effort')
  assert(
    !('reasoning_effort' in requestBodies[1]) && !('max_tokens' in requestBodies[1]),
    'the retry drops reasoning_effort and max_tokens'
  )

  // --- Ollama done_reason ---
  console.log('ollama done_reason')
  const lengthStream = await ollama.readOllamaStreamDetailed(
    new Response('{"response":"partial"}\n{"done":true,"done_reason":"length"}')
  )
  assert(lengthStream.text === 'partial' && lengthStream.doneReason === 'length', 'done_reason "length" is surfaced')
  const stopStream = await ollama.readOllamaStreamDetailed(
    new Response('{"response":"done"}\n{"done":true,"done_reason":"stop"}')
  )
  assert(stopStream.doneReason === 'stop', 'done_reason "stop" is surfaced')
  await withFetch(
    () =>
      new Response('{"response":"[{\\"q\\":1}"}\n{"done":true,"done_reason":"length"}', {
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    async () => {
      const r = await ollama.ollamaGenerate('qwen3:1.7b', { prompt: 'p' }, 'http://127.0.0.1:11434')
      assert(r.ok && r.truncated === true, 'a num_predict cutoff surfaces as truncated (#275)')
      return r
    },
  )

  // --- structuredGenerate end-to-end (mocked llm) ---
  console.log('structuredGenerate')

  mockQueue = [reply(GOOD_JSON)]
  mockCalls = 0
  const usable = await structured.structuredGenerate({ prompt: 'p', maxTokens: 1500, expect: 'json' })
  assert(usable.ok && mockCalls === 1, 'a usable first reply needs one call')

  mockQueue = [reply(''), reply(GOOD_JSON)]
  mockCalls = 0
  mockMaxTokens.length = 0
  const budgetRetry = await structured.structuredGenerate({
    prompt: 'p',
    maxTokens: 1500,
    retryMaxTokens: 3000,
    expect: 'json',
  })
  assert(budgetRetry.ok && mockCalls === 2, 'an empty reply is retried once')
  assert(mockMaxTokens[0] === 1500 && mockMaxTokens[1] === 3000, 'the retry uses the larger budget')

  mockQueue = [reply('[{"a":1', 'openai/gpt-oss-20b', true), reply(GOOD_JSON)]
  mockCalls = 0
  const truncatedRetry = await structured.structuredGenerate({
    prompt: 'p',
    maxTokens: 1500,
    retryMaxTokens: 3000,
    expect: 'json',
  })
  assert(truncatedRetry.ok && mockCalls === 2, 'a length-cutoff reply is retried like an empty one')

  mockQueue = [reply(''), reply('')]
  mockCalls = 0
  const bothRanOut = await structured.structuredGenerate({
    prompt: 'p',
    maxTokens: 1500,
    retryMaxTokens: 3000,
    expect: 'json',
  })
  assert(!bothRanOut.ok, 'two ran-out replies fail')
  assert(bothRanOut.ok === false && bothRanOut.ranOutOfTokens === true, 'the failure is marked ranOutOfTokens')
  assert(bothRanOut.ok === false && /ran out of output tokens/.test(bothRanOut.error), 'the ran-out error says so plainly')

  mockQueue = [reply('Wait, the answer must be short.', 'qwen3:4b'), reply(GOOD_JSON)]
  mockCalls = 0
  mockPrompts.length = 0
  const noThink = await structured.structuredGenerate({ prompt: 'Question?', maxTokens: 1500, expect: 'json' })
  assert(noThink.ok && noThink.reasoningFallbackUsed === true, 'untagged reasoning falls back to /no_think')
  assert(mockPrompts[1]?.trimEnd().endsWith('/no_think'), 'the fallback appends /no_think to the prompt')
  assert(mockCalls === 2, 'the /no_think fallback is one extra call')

  mockQueue = [reply('Hmm, let me think about it.', 'llama3.1:8b')]
  mockCalls = 0
  const plainReasoning = await structured.structuredGenerate({ prompt: 'p', maxTokens: 1500, expect: 'json' })
  assert(
    plainReasoning.ok === false && /reasoning out loud/.test(plainReasoning.error),
    'reasoning from a non-reasoning model is reported'
  )
  assert(mockCalls === 1, 'no /no_think retry for a model that cannot honour it')

  mockQueue = [reply('Wait, no.', 'qwen3:4b'), reply('Wait, still thinking.', 'qwen3:4b')]
  const bothReason = await structured.structuredGenerate({ prompt: 'p', maxTokens: 1500, expect: 'json' })
  assert(
    bothReason.ok === false && /\/no_think fallback did not help/.test(bothReason.error),
    'a stubborn qwen3 is reported after the fallback'
  )
  assert(bothReason.ok === false && !('text' in bothReason), 'reasoning is never returned as the answer')

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
