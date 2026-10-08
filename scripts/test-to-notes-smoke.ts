/**
 * #166 — Test to notes: parse pasted practice-test results (plain text and CSV)
 * and draft a grounded corrective note per wrong answer.
 *
 *   npm run test:test-to-notes
 *
 * Runs under Electron-as-Node with a mocked llmGenerate so the offline /
 * no-hits / citation paths are deterministic without a model.
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
      provider?: string
      providerLabel?: string
      model?: string
      local?: boolean
      fallback?: boolean
    }
  | { ok: false; error: string; provider?: string }
let mockLlmGenerateResult: MockGen = { ok: false, error: 'mocked offline' }
function setMockLlmGenerate(result: MockGen) {
  mockLlmGenerateResult = result
}

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (
    request === './llm' ||
    request === '../electron/llm' ||
    request.endsWith('/electron/llm') ||
    request.endsWith('electron/llm')
  ) {
    return {
      llmGenerate: async () => mockLlmGenerateResult,
      providerDisplayName: (providerId: string | null | undefined, label?: string) =>
        label || providerId || 'AI',
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

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
  console.log('\n=== Local Knowledge Vault — Test to notes (#166) ===\n')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-166-'))
  const { initDb, closeDb, createItem } = require('../electron/db')
  const { searchQuery } = require('../electron/search')
  initDb(path.join(tmp, 'test.sqlite'))

  const {
    parseTestResults,
    isCorrectMarker,
    summarizeAttempts,
    analyzeTestResults,
    parseAiJson,
    parseTestResultsWithAi,
  } = require('../electron/test-to-notes')
  const { redactError, isRateLimited, retryAfterMs, formatWait } = require('../electron/providers/http')
  const { offlineCopy } = require('../electron/generate')

  // --- isCorrectMarker ---
  console.log('isCorrectMarker')
  assert(isCorrectMarker('✓') === true, 'tick is a correct marker')
  assert(isCorrectMarker('Question [x]') === true, '[x] is a correct marker')
  assert(isCorrectMarker('✗') === false, 'cross is an incorrect marker')
  assert(isCorrectMarker('Question [ ]') === false, '[ ] is an incorrect marker')
  assert(isCorrectMarker('correct') === true, 'the word correct is a marker')
  assert(isCorrectMarker('incorrect') === false, 'the word incorrect is a marker')
  assert(isCorrectMarker('what is 2 + 2') === null, 'no marker returns null')
  assert(
    isCorrectMarker('Which of these statements is correct?') === null,
    'a question ending in “correct?” is not a marker',
  )
  assert(isCorrectMarker('Which answer is right?') === null, 'a question ending in “right?” is not a marker')
  assert(isCorrectMarker('Paris (wrong)') === false, 'a trailing (wrong) word marker is recognised')
  assert(isCorrectMarker('Capital (correct)') === true, 'a trailing (correct) word marker is recognised')

  // --- parseTestResults: plain text with markers + answer prefixes ---
  console.log('\nparseTestResults — plain text')
  const plain = [
    '1. What is the capital of France? ✓',
    'Your answer: Paris',
    '',
    '2. What is 2 + 2? ✗',
    'Answer: 5',
    '',
    '3. What is the boiling point of water?',
    'A: 50°C',
  ].join('\n')
  const plainItems = parseTestResults(plain)
  assert(plainItems.length === 3, 'plain text parses three blocks')
  assert(
    plainItems[0].question === 'What is the capital of France?',
    'leading number and trailing marker are stripped from the question',
  )
  assert(plainItems[0].answer === 'Paris' && plainItems[0].correct === true, '✓ item is correct with its answer')
  assert(plainItems[1].answer === '5' && plainItems[1].correct === false, '✗ item is incorrect with its answer')
  assert(
    plainItems[2].correct === false && plainItems[2].answer === '50°C',
    'unmarked item defaults to incorrect and keeps “A:” answer',
  )

  // Regression: the word “correct”/“right” inside the question must not be read
  // as a correctness marker (it would exclude the item from “Suggest fixes”).
  const tricky = parseTestResults('1. Which of these statements is correct?\nYour answer: B')
  assert(
    tricky.length === 1 && tricky[0].correct === false,
    'a question containing “correct” is not treated as a correct answer',
  )
  const paren = parseTestResults('1. Capital of France? (correct)\nYour answer: Paris')
  assert(paren[0].correct === true, 'a trailing (correct) marker on the question line still counts')

  // --- parseTestResults: number prefixes split blocks without blank lines ---
  const compact = '1. First question? ✓\nYour answer: A\n2. Second question? ✗\nYour answer: B'
  const compactItems = parseTestResults(compact)
  assert(compactItems.length === 2, 'number prefixes split blocks without blank lines')
  assert(compactItems[1].question === 'Second question?' && compactItems[1].correct === false, 'second block parsed')

  // --- parseTestResults: empty question blocks are skipped ---
  const blanks = '\n\n   \n1.  \nYour answer: nothing\n\n2. Real question? ✓\n'
  const blankItems = parseTestResults(blanks)
  assert(blankItems.length === 1 && blankItems[0].question === 'Real question?', 'blocks with an empty question are skipped')

  // --- parseTestResults: CSV header + rows ---
  console.log('\nparseTestResults — CSV')
  const csv = [
    'question,answer,correct',
    'What is 2 + 2?,5,yes',
    'Capital of France?,Paris,no',
    'Water boiling point?,50°C,',
    '"Which is quoted?","a, b",right',
  ].join('\n')
  const csvItems = parseTestResults(csv)
  assert(csvItems.length === 4, 'CSV parses four rows')
  assert(csvItems[0].correct === true && csvItems[0].answer === '5', 'CSV yes → correct')
  assert(csvItems[1].correct === false, 'CSV no → incorrect')
  assert(csvItems[2].correct === false, 'CSV empty correct cell → incorrect')
  assert(
    csvItems[3].question === 'Which is quoted?' && csvItems[3].answer === 'a, b' && csvItems[3].correct === true,
    'CSV quoted cells (including a comma) parse correctly',
  )

  // --- parseTestResults: whitespace / blank handling ---
  const spaced = '\n\n  1. Spaced question?  ✓  \n  Your answer:   yes  \n\n'
  const spacedItems = parseTestResults(spaced)
  assert(spacedItems.length === 1, 'blank lines and surrounding whitespace do not create items')
  assert(spacedItems[0].question === 'Spaced question?' && spacedItems[0].answer === 'yes', 'fields are trimmed')

  // --- summarizeAttempts ---
  const summary = summarizeAttempts(plainItems)
  assert(summary.total === 3 && summary.correct === 1 && summary.wrong === 2, 'summarizeAttempts counts correctly')

  // --- analyzeTestResults: grounding contract ---
  console.log('\nanalyzeTestResults — grounding contract')
  const note = createItem({
    title: 'Mitochondria',
    body: 'The mitochondria is the powerhouse of the cell. It produces ATP, the energy currency of the cell.',
    kind: 'note',
    para: 'resources',
  })
  const wrongItem = { question: 'What is the powerhouse of the cell?', answer: 'The nucleus', correct: false }
  const correctItem = { question: 'What is the powerhouse of the cell?', answer: 'The mitochondria', correct: true }

  // Offline: one suggestion per wrong item, correct items skipped.
  setMockLlmGenerate({ ok: false, error: 'Connection refused', provider: 'ollama' })
  const offline = await analyzeTestResults([wrongItem, correctItem])
  assert(offline.length === 1, 'only incorrect items produce a suggestion')
  assert(offline[0].offline === true, 'model failure marks the suggestion offline')
  assert(offline[0].error === 'Connection refused', 'offline suggestion preserves the error')
  assert(offline[0].citations.length === 0, 'offline suggestion has no citations')
  assert(offline[0].yourAnswer === 'The nucleus', 'offline suggestion carries the learner answer')
  assert(offline[0].title.startsWith('Fix: '), 'suggestion has a derived title')

  // The allowed id set is exactly what analyze retrieves.
  const allowedHits = searchQuery({ text: wrongItem.question, limit: 6 }).hits
  const validId = allowedHits[0]?.id
  assert(!!validId && allowedHits.some((h: { id: string }) => h.id === note.id), 'the note about cells is retrieved')

  // Successful generation keeps retrieved ids and drops hallucinations.
  setMockLlmGenerate({
    ok: true,
    text: `The mitochondria is the powerhouse of the cell [${validId}] and [itm_999].`,
    provider: 'ollama',
    model: 'test',
    local: true,
    fallback: false,
  })
  const grounded = await analyzeTestResults([wrongItem])
  assert(grounded.length === 1 && !grounded[0].offline, 'successful generation produces one grounded suggestion')
  assert(grounded[0].citations.some((c: { id: string }) => c.id === validId), 'retrieved citation is kept')
  assert(!grounded[0].body.includes('itm_999'), 'hallucinated citation marker is stripped from the body')
  assert(
    grounded[0].citations.every((c: { id: string }) => allowedHits.some((h: { id: string }) => h.id === c.id)),
    'every citation in the suggestion was actually retrieved',
  )

  // No-hits path: clear copy, no model call, no citations.
  const noHits = await analyzeTestResults([
    { question: 'zzzqqqxyw nonexistent topic plugh', answer: 'x', correct: false },
  ])
  assert(noHits.length === 1, 'a no-hits wrong item still produces one suggestion')
  assert(noHits[0].citations.length === 0, 'no-hits suggestion has no citations')
  assert(/No notes cover this/.test(noHits[0].body), 'no-hits suggestion says the notes do not cover it')
  assert(noHits[0].offline !== true, 'no-hits suggestion is not marked offline')

  // --- parseAiJson (pure) ---
  console.log('\nparseAiJson')
  const aiItems = parseAiJson(
    '```json\n[{"question":"What is 2+2?","answer":"5","correct":false},{"question":"Capital of France?","answer":"Paris","correct":true}]\n```',
  )
  assert(aiItems !== null && aiItems.length === 2, 'parseAiJson parses a fenced JSON array')
  assert(
    aiItems && aiItems[0].question === 'What is 2+2?' && aiItems[0].correct === false,
    'parseAiJson maps a wrong answer to correct=false',
  )
  assert(
    aiItems && aiItems[1].answer === 'Paris' && aiItems[1].correct === true,
    'parseAiJson maps a right answer to correct=true',
  )
  assert(parseAiJson('not json at all') === null, 'parseAiJson returns null for non-JSON')

  // --- parseTestResultsWithAi ---
  console.log('\nparseTestResultsWithAi')
  setMockLlmGenerate({
    ok: true,
    text: '[{"question":"What is 2+2?","answer":"4","correct":true}]',
    provider: 'ollama',
    model: 'test',
    local: true,
    fallback: false,
  })
  const aiParsed = await parseTestResultsWithAi({ text: 'some messy export format' })
  assert(aiParsed.items.length === 1 && aiParsed.items[0].correct === true, 'AI parse returns structured items')
  assert(aiParsed.offline !== true, 'a successful AI parse is not marked offline')

  setMockLlmGenerate({ ok: false, error: 'Connection refused', provider: 'ollama' })
  const fallback = await parseTestResultsWithAi({ text: '1. What is 2+2? ✗\nYour answer: 5' })
  assert(fallback.offline === true, 'an offline AI parse is marked offline')
  assert(fallback.items.length === 1 && fallback.items[0].correct === false, 'offline AI parse falls back to the heuristic parser')

  const emptyParse = await parseTestResultsWithAi({ text: '   ' })
  assert(emptyParse.items.length === 0 && emptyParse.offline !== true, 'empty input returns no items without a model call')

  // --- #274: error redaction + rate-limit classification ---
  console.log('\n#274 rate-limit errors')
  assert(
    redactError('Rate limit for org_abc123 and req_xyz789') === 'Rate limit for org_<redacted> and req_<redacted>',
    'org_ and req_ ids are redacted',
  )
  assert(isRateLimited('Groq HTTP 429: rate limit reached') === true, 'HTTP 429 is rate limited')
  assert(isRateLimited('Connection refused') === false, 'a network error is not rate limited')
  assert(retryAfterMs('try again in 7.5s') === 7500, 'retry-after parses seconds')
  assert(retryAfterMs('try again in 2m3.1s') === 123100, 'retry-after parses minutes+seconds')
  assert(retryAfterMs('try again in 450ms') === 450, 'retry-after parses milliseconds')
  assert(retryAfterMs('try again in 2h') === 7_200_000, 'retry-after parses hours')
  assert(retryAfterMs('try again in 2 minutes') === 120_000, 'retry-after parses the minutes word')
  assert(retryAfterMs('no wait info here') === undefined, 'retry-after is undefined without a wait')
  assert(redactError('request id: abc123 failed') === 'request id <redacted> failed', 'request ids are redacted')
  assert(formatWait(450) === '450 ms', 'formatWait formats milliseconds')
  assert(formatWait(12_000) === '12 s', 'formatWait formats seconds')
  assert(formatWait(120_000) === '2 m', 'formatWait formats minutes')
  assert(formatWait(7_200_000) === '2 h', 'formatWait formats hours')

  const daily = offlineCopy(
    { error: 'Groq HTTP 429: daily limit reached for org_x', provider: 'groq', providerLabel: 'Groq' },
    'suffix',
  )
  assert(/Daily rate limit/.test(daily), 'a daily limit is told apart from a per-minute limit')
  const noWait = offlineCopy(
    { error: 'Groq HTTP 429: rate limit reached', provider: 'groq', providerLabel: 'Groq' },
    'suffix',
  )
  assert(/try again shortly/.test(noWait), 'a rate limit without retry-after says try again shortly')

  setMockLlmGenerate({ ok: false, error: 'Groq HTTP 429: rate limit reached, try again in 12 s', provider: 'groq' })
  const rateParsed = await parseTestResultsWithAi({ text: '1. What is 2+2? ✗\nYour answer: 5' })
  assert(rateParsed.rateLimited === true, 'a 429 parse fallback is flagged rate limited')
  assert(rateParsed.offline !== true, 'a 429 parse fallback is not flagged offline')
  assert(rateParsed.retryAfterMs === 12000, 'the parse result carries the retry-after')

  const rateSuggestion = await analyzeTestResults([{ question: 'What is the powerhouse of the cell?', answer: 'The nucleus', correct: false }])
  assert(rateSuggestion.length === 1 && rateSuggestion[0].rateLimited === true, 'a 429 suggestion is flagged rate limited')
  assert(rateSuggestion[0].offline !== true, 'a 429 suggestion is not flagged offline')
  assert(/Rate limited/i.test(rateSuggestion[0].body ?? ''), 'the suggestion body says rate limited, not offline')

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
