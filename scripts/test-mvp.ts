/**
 * Headless MVP verification — DB, FTS search, citation validation, ollama health,
 * prompts CRUD, chat sessions/messages (incl. offline send path).
 * Run: npm run test:mvp
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  initDb,
  closeDb,
  listItems,
  createItem,
  countItems,
  getItem,
  listPrompts,
  createPrompt,
  getPrompt,
  updatePrompt,
  deletePrompt,
  createSession,
  listSessions,
  getSession,
  deleteSession,
  appendMessage,
  listMessages,
  updateSessionTitle,
  listProjects,
  renameProject,
  mergeProject,
  deleteProject,
} from '../electron/db'
import { searchQuery, buildFtsQuery } from '../electron/search'
import { extractCitedIds, validateCitations, buildGroundedPrompt } from '../electron/generate'
import { sendChatTurn, buildChatSearchQuery, isGreetingOrSocial } from '../electron/chat'
import { ollamaHealth, pickModel } from '../electron/ollama'
import {
  mergeLlmSettings,
  getLlmSettings,
  setLlmSettings,
  setLlmUserDataDir,
  setXaiApiKey,
  hasXaiApiKey,
  getXaiApiKey,
  setGroqApiKey,
  hasGroqApiKey,
  getGroqApiKey,
  getDefaultLlmSettings,
} from '../electron/llm-settings'
import { resolveFromProviders } from '../electron/llm'
import type { ProviderConfig } from '../electron/types'
import {
  isAllowedUrl,
  extractFromHtml,
  parseAutoTagJson,
  heuristicTags,
} from '../electron/import-url'

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
  console.log('\n=== Local Knowledge Vault — MVP tests ===\n')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-mvp-'))
  const dbFile = path.join(tmpDir, 'test.sqlite')

  // --- DB + seed ---
  console.log('DB / seed')
  initDb(dbFile)
  const n = countItems()
  assert(n >= 3, `seeded at least 3 notes (got ${n})`)
  const all = listItems()
  assert(all.every((i) => i.id.startsWith('itm_')), 'item ids use itm_ prefix')
  assert(
    all.some((i) => i.para === 'projects'),
    'seed includes a project note'
  )
  assert(
    all.some((i) => i.para === 'resources'),
    'seed includes a resources note'
  )

  // --- Filters ---
  console.log('\nFilters')
  const projects = listItems({ para: 'projects' })
  assert(projects.length >= 1 && projects.every((i) => i.para === 'projects'), 'para filter works')
  const byProject = listItems({ project: 'Knowledge' })
  assert(byProject.length >= 1, 'project text filter works')

  // --- FTS ---
  console.log('\nFTS5 search')
  assert(buildFtsQuery('atomic habits').includes('atomic'), 'FTS query builder tokenizes')
  const habitHits = searchQuery({ text: 'habits', limit: 10 })
  assert(habitHits.hits.length >= 1, `search "habits" returns hits (got ${habitHits.hits.length})`)
  assert(
    habitHits.hits.some((h) => /habit/i.test(h.title) || /habit/i.test(h.snippet)),
    'habit hit relates to Atomic Habits / habits content'
  )
  const gtd = searchQuery({ text: 'productivity capture', limit: 10 })
  assert(gtd.hits.length >= 1, 'search productivity returns hits')
  const filtered = searchQuery({
    text: 'notes',
    filters: { para: 'archives' },
    limit: 10,
  })
  assert(
    filtered.hits.every((h) => h.para === 'archives'),
    'metadata filter applied before/with FTS'
  )
  const emptyQ = searchQuery({ text: '', filters: { status: 'active' }, limit: 50 })
  assert(emptyQ.hits.length >= 1, 'empty text + filters lists matching items')

  // CRUD
  console.log('\nCRUD')
  const created = createItem({
    title: 'Test note XYZ',
    body: 'unique-token-qwerty-lkv',
    para: 'resources',
  })
  assert(!!getItem(created.id), 'create + get works')
  const uniq = searchQuery({ text: 'qwerty-lkv', limit: 5 })
  assert(uniq.hits.some((h) => h.id === created.id), 'new note is FTS-indexed via triggers')

  // --- Projects (first-class list / rename / merge / delete) ---
  console.log('\nProjects')
  createItem({ title: 'P1 note', body: 'alpha project content', kind: 'note', project: 'Alpha' })
  createItem({ title: 'P1 note 2', body: 'alpha project content two', kind: 'note', project: 'Alpha' })
  createItem({ title: 'P2 note', body: 'beta project content', kind: 'note', project: 'Beta' })
  let projs = listProjects()
  assert(
    projs.some((p) => p.name === 'Alpha' && p.count === 2),
    'listProjects counts notes per project'
  )
  assert(projs.some((p) => p.name === 'Beta' && p.count === 1), 'listProjects includes Beta')

  const renamedProj = renameProject('Alpha', 'Alpha-renamed')
  assert(renamedProj.count === 2, 'renameProject renames 2 notes')
  projs = listProjects()
  assert(!projs.some((p) => p.name === 'Alpha'), 'renameProject removes old name')
  assert(projs.some((p) => p.name === 'Alpha-renamed' && p.count === 2), 'renameProject adds new name')

  const mergedProj = mergeProject('Alpha-renamed', 'Beta')
  assert(mergedProj.count === 2, 'mergeProject moves 2 notes')
  projs = listProjects()
  assert(!projs.some((p) => p.name === 'Alpha-renamed'), 'mergeProject removes source')
  assert(projs.some((p) => p.name === 'Beta' && p.count === 3), 'mergeProject combines counts')

  const deletedProj = deleteProject('Beta')
  assert(deletedProj.count === 3, 'deleteProject deletes 3 notes')
  assert(!listProjects().some((p) => p.name === 'Beta'), 'deleteProject removes the project')

  // --- Citation validation ---
  console.log('\nCitation validation')
  const allowed = ['itm_aaa111', 'itm_bbb222']
  const extracted = extractCitedIds(
    'Answer cites [itm_aaa111] and hallucinated [itm_fake999] plus [itm_bbb222].'
  )
  assert(
    extracted.includes('itm_aaa111') && extracted.includes('itm_fake999'),
    'extractCitedIds finds bracketed ids'
  )
  const valid = validateCitations(extracted, allowed)
  assert(valid.includes('itm_aaa111') && valid.includes('itm_bbb222'), 'keeps retrieved ids')
  assert(!valid.includes('itm_fake999'), 'DROPS hallucinated id itm_fake999')
  assert(validateCitations(['itm_zzz'], new Set(allowed)).length === 0, 'rejects unknown id set')

  // --- Prompt includes systemExtra ---
  console.log('\nGrounded prompt extras')
  const promptWithExtra = buildGroundedPrompt('What are habits?', habitHits.hits.slice(0, 2), {
    systemExtra: 'Answer in bullet points.',
    history: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello from vault.' },
    ],
  })
  assert(promptWithExtra.includes('Additional guidance'), 'systemExtra merged into prompt')
  assert(promptWithExtra.includes('Answer in bullet points'), 'systemExtra body present')
  assert(promptWithExtra.includes('Conversation so far'), 'history block included')
  assert(promptWithExtra.includes('Hello from vault'), 'prior assistant turn in history')

  // --- Prompts CRUD ---
  console.log('\nPrompts CRUD')
  const seededPrompts = listPrompts()
  assert(seededPrompts.length >= 2, `seeded at least 2 prompts (got ${seededPrompts.length})`)
  assert(seededPrompts.every((p) => p.id.startsWith('prm_')), 'prompt ids use prm_ prefix')
  const custom = createPrompt({
    name: 'Test prompt',
    body: 'Be terse.',
    description: 'unit test',
  })
  assert(!!getPrompt(custom.id), 'createPrompt + getPrompt works')
  const updatedP = updatePrompt(custom.id, { name: 'Test prompt renamed', body: 'Be ultra terse.' })
  assert(updatedP?.name === 'Test prompt renamed', 'updatePrompt renames')
  assert(updatedP?.body === 'Be ultra terse.', 'updatePrompt updates body')
  assert(deletePrompt(custom.id), 'deletePrompt returns true')
  assert(getPrompt(custom.id) === null, 'deleted prompt is gone')

  // --- Chat sessions / messages ---
  console.log('\nChat sessions / messages')
  const session = createSession({ title: 'New chat' })
  assert(session.id.startsWith('ses_'), 'session id uses ses_ prefix')
  assert(session.mode === 'grounded', 'default mode is grounded')
  assert(listSessions().some((s) => s.id === session.id), 'listSessions includes new session')
  assert(getSession(session.id)?.title === 'New chat', 'getSession works')

  const uMsg = appendMessage({
    session_id: session.id,
    role: 'user',
    content: 'What is PARA?',
  })
  assert(uMsg.id.startsWith('msg_'), 'message id uses msg_ prefix')
  const aMsg = appendMessage({
    session_id: session.id,
    role: 'assistant',
    content: 'PARA is Projects, Areas, Resources, Archives. [itm_x]',
    citations_json: JSON.stringify([{ id: 'itm_x', title: 'demo' }]),
  })
  const msgs = listMessages(session.id)
  assert(msgs.length === 2, `listMessages returns 2 (got ${msgs.length})`)
  assert(msgs[0].role === 'user' && msgs[1].role === 'assistant', 'message order user then assistant')
  assert(!!msgs[1].citations_json && msgs[1].citations_json.includes('itm_x'), 'citations_json persisted')

  const titled = updateSessionTitle(session.id, 'PARA chat')
  assert(titled?.title === 'PARA chat', 'updateSessionTitle works')

  assert(deleteSession(session.id), 'deleteSession returns true')
  assert(getSession(session.id) === null, 'deleted session is gone')
  assert(listMessages(session.id).length === 0, 'cascade deletes messages')

  // --- Chat send (offline-safe: stores user msg + offline assistant) ---
  console.log('\nChat send (offline path)')
  const chatSes = createSession()
  const sendResult = await sendChatTurn({
    sessionId: chatSes.id,
    text: 'Tell me about habits and compounding',
    filters: {},
    limit: 5,
  })
  assert(!!sendResult.assistant, 'sendChatTurn returns assistant message')
  assert(sendResult.assistant.role === 'assistant', 'assistant role set')
  assert(sendResult.messages.length >= 2, 'messages include user + assistant')
  assert(
    sendResult.messages.some((m) => m.role === 'user' && m.content.includes('habits')),
    'user message persisted even if Ollama offline'
  )
  assert(sendResult.session.title !== 'New chat', 'auto-title from first user message')
  // Either online answer or offline notice — both valid
  if (sendResult.offline) {
    assert(
      /offline|no models|failed|api key|Ollama|Grok|Groq|AI/i.test(sendResult.assistant.content),
      'offline assistant explains status'
    )
  } else {
    assert(sendResult.assistant.content.length > 0, 'online assistant returned content')
  }

  // promptId wiring
  const prm = createPrompt({ name: 'Bullets', body: 'Use short bullets only.' })
  const chatSes2 = createSession()
  const withPrompt = await sendChatTurn({
    sessionId: chatSes2.id,
    text: 'Summarize productivity capture',
    promptId: prm.id,
    limit: 5,
  })
  assert(withPrompt.messages.length >= 2, 'send with promptId still persists turns')

  // --- LLM settings merge + key file ---
  console.log('\nLLM settings')
  const llmTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-llm-'))
  setLlmUserDataDir(llmTmp)
  const defaults = getDefaultLlmSettings()
  assert(defaults.provider === 'auto', 'default provider is auto')
  assert(defaults.grokEnabled === false, 'default grokEnabled is false')
  assert(defaults.grokModel === 'grok-4.3', 'default grok model is grok-4.3')
  assert(defaults.groqEnabled === false, 'default groqEnabled is false')
  assert(defaults.groqModel === 'openai/gpt-oss-20b', 'default groq model is openai/gpt-oss-20b')
  const merged = mergeLlmSettings({ provider: 'grok', grokEnabled: true })
  assert(merged.provider === 'grok' && merged.grokEnabled === true, 'mergeLlmSettings applies partial')
  assert(merged.grokModel === 'grok-4.3', 'merge keeps default model')
  assert(merged.groqEnabled === false && merged.groqModel === 'openai/gpt-oss-20b', 'merge keeps groq defaults')
  assert(mergeLlmSettings({ provider: 'nope' as unknown as 'auto' }).provider === 'auto', 'invalid provider falls back')
  assert(mergeLlmSettings({ provider: 'groq', groqEnabled: true }).provider === 'groq', 'merge accepts groq provider')
  setLlmSettings({ provider: 'ollama', grokEnabled: true, grokModel: 'grok-4.3', groqEnabled: true })
  const loaded = getLlmSettings()
  assert(loaded.provider === 'ollama' && loaded.grokEnabled === true, 'settings persist to disk')
  assert(loaded.groqEnabled === true, 'groqEnabled persists')
  const prevEnv = process.env.LKV_XAI_API_KEY
  const prevEnv2 = process.env.XAI_API_KEY
  delete process.env.LKV_XAI_API_KEY
  delete process.env.XAI_API_KEY
  assert(!hasXaiApiKey(), 'no key when env cleared and file empty')
  setXaiApiKey('test-key-not-logged')
  assert(hasXaiApiKey(), 'hasXaiApiKey true after save')
  assert(getXaiApiKey() === 'test-key-not-logged', 'getXaiApiKey returns saved key')
  setXaiApiKey(null)
  assert(!hasXaiApiKey(), 'clear removes key file')
  // Env key counts without writing file
  process.env.LKV_XAI_API_KEY = 'env-only-key'
  assert(hasXaiApiKey(), 'env LKV_XAI_API_KEY counts as having key')
  if (prevEnv === undefined) delete process.env.LKV_XAI_API_KEY
  else process.env.LKV_XAI_API_KEY = prevEnv
  if (prevEnv2 === undefined) delete process.env.XAI_API_KEY
  else process.env.XAI_API_KEY = prevEnv2
  setXaiApiKey(null)

  // Groq key file / env
  const prevGroqEnv = process.env.LKV_GROQ_API_KEY
  const prevGroqEnv2 = process.env.GROQ_API_KEY
  delete process.env.LKV_GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  assert(!hasGroqApiKey(), 'no groq key when env cleared and file empty')
  setGroqApiKey('groq-test-key-not-logged')
  assert(hasGroqApiKey(), 'hasGroqApiKey true after save')
  assert(getGroqApiKey() === 'groq-test-key-not-logged', 'getGroqApiKey returns saved key')
  setGroqApiKey(null)
  assert(!hasGroqApiKey(), 'clear removes groq key file')
  process.env.LKV_GROQ_API_KEY = 'env-only-groq'
  assert(hasGroqApiKey(), 'env LKV_GROQ_API_KEY counts as having key')
  if (prevGroqEnv === undefined) delete process.env.LKV_GROQ_API_KEY
  else process.env.LKV_GROQ_API_KEY = prevGroqEnv
  if (prevGroqEnv2 === undefined) delete process.env.GROQ_API_KEY
  else process.env.GROQ_API_KEY = prevGroqEnv2
  setGroqApiKey(null)

  setLlmUserDataDir(null)

  // --- Provider registry resolution (pure; local-first) ---
  console.log('\nProvider registry resolveFromProviders')
  const mk = (p: Partial<ProviderConfig> & Pick<ProviderConfig, 'id'>): ProviderConfig => ({
    kind: 'openai-compatible',
    label: p.id,
    baseUrl: 'http://x',
    model: '',
    hasKey: false,
    requiresKey: false,
    local: false,
    enabled: true,
    source: 'builtin',
    ...p,
  })
  const ollamaUp = mk({ id: 'ollama', kind: 'ollama', label: 'Ollama', local: true, health: { ok: true, models: ['llama3.2:latest'] } })
  const ollamaDown = mk({ id: 'ollama', kind: 'ollama', label: 'Ollama', local: true, health: { ok: false, error: 'ECONNREFUSED' } })
  const lmDown = mk({ id: 'lmstudio', label: 'LM Studio', local: true, health: { ok: false, error: 'ECONNREFUSED' } })
  const lmUp = mk({ id: 'lmstudio', label: 'LM Studio', local: true, health: { ok: true, models: ['qwen3-8b'] } })
  const groqOn = mk({ id: 'groq', label: 'Groq', requiresKey: true, hasKey: true, model: 'openai/gpt-oss-20b' })
  const groqNoKey = mk({ id: 'groq', label: 'Groq', requiresKey: true, hasKey: false, model: 'openai/gpt-oss-20b' })
  const groqOff = { ...groqOn, enabled: false }

  const a1 = resolveFromProviders('auto', [ollamaUp, lmDown, groqOn])
  assert(a1.status.active?.id === 'ollama' && a1.status.active.local, 'auto → Ollama first even when cloud enabled')
  const a2 = resolveFromProviders('auto', [ollamaDown, lmUp, groqOn])
  assert(a2.status.active?.id === 'lmstudio', 'auto → LM Studio when Ollama down')
  const a3 = resolveFromProviders('auto', [ollamaDown, lmDown, groqOn])
  assert(a3.status.active?.id === 'groq' && !a3.status.active.local, 'auto → enabled cloud only after locals')
  const a4 = resolveFromProviders('auto', [ollamaDown, lmDown, groqOff])
  assert(a4.status.active === null && a4.status.needsSetup, 'auto never picks a disabled cloud; needsSetup card')
  assert(a1.candidates.map((c) => c.provider.id).join(',') === 'ollama,groq', 'auto fallback order local → cloud')
  const e1 = resolveFromProviders('groq', [ollamaUp, lmUp, groqOn])
  assert(e1.status.active?.id === 'groq' && e1.candidates.length === 1, 'explicit groq uses Groq only')
  const e2 = resolveFromProviders('groq', [ollamaUp, lmUp, groqNoKey])
  assert(e2.status.active === null && /API key/i.test(e2.status.message), 'explicit groq without key fails (no local steal)')
  const e3 = resolveFromProviders('ollama', [ollamaDown, lmUp, groqOn])
  assert(e3.status.active === null, 'explicit ollama ignores other healthy providers')
  const e4 = resolveFromProviders('auto', [mk({ ...ollamaUp, health: { ok: true, models: [] } }), lmDown])
  assert(/ollama pull/.test(e4.status.message), 'Ollama running with no models suggests ollama pull')
  const e5 = resolveFromProviders('auto', [mk({ ...ollamaUp, health: { ok: true, models: ['llama3.2:1b'] } })])
  assert(e5.status.active?.smallModel === true, 'tiny local model flagged smallModel')

  // --- pickModel cloud exclusion + fallbacks (pure) ---
  console.log('\npickModel cloud exclusion')
  const cloudSkip = pickModel(['llama3.2:1b', 'glm-5.2:cloud'])
  assert(cloudSkip === 'llama3.2:1b', 'pickModel skips a :cloud model in favor of a local one')
  const onlyCloud = pickModel(['glm-5.2:cloud', 'qwen3:cloud'])
  assert(onlyCloud === null, 'pickModel returns null when only :cloud models exist')
  const dashCloud = pickModel(['llama3.2:1b', 'glm-5.2-cloud'])
  assert(dashCloud === 'llama3.2:1b', 'pickModel skips a -cloud model too')
  const sizeFallback = pickModel(['model-a', 'model-b'], { 'model-a': '1B', 'model-b': '8B' })
  assert(sizeFallback === 'model-b', 'pickModel size fallback prefers non-small (8B over 1B)')
  const noMatchFallback = pickModel(['phi3:mini', 'gemma2:2b'])
  assert(noMatchFallback === 'phi3:mini', 'pickModel no-family-match falls back to pool[0]')
  const cloudAuto = resolveFromProviders('auto', [
    mk({ id: 'ollama', kind: 'ollama', label: 'Ollama', local: true, model: 'glm-5.2:cloud', health: { ok: true, models: ['glm-5.2:cloud'] } }),
  ])
  assert(cloudAuto.status.active?.local === false, 'auto with explicitly-set :cloud model reported non-local')
  assert(/^Cloud/.test(cloudAuto.status.message), 'auto status message says Cloud for a :cloud model')

  // --- Import from URL (pure helpers) ---
  console.log('\nImport from URL helpers')
  const okHttps = isAllowedUrl('https://example.com/path')
  assert(okHttps.ok === true, 'allows https URL')
  const okHttp = isAllowedUrl('http://example.com')
  assert(okHttp.ok === true, 'allows http URL')
  const badFile = isAllowedUrl('file:///etc/passwd')
  assert(badFile.ok === false, 'blocks file://')
  const badFtp = isAllowedUrl('ftp://files.example.com/a')
  assert(badFtp.ok === false, 'blocks ftp://')
  const badEmpty = isAllowedUrl('  ')
  assert(badEmpty.ok === false, 'blocks empty URL')
  const okLocal = isAllowedUrl('http://localhost:3000/page')
  assert(okLocal.ok === true, 'allows localhost http for testing')

  const html = `<!DOCTYPE html><html><head>
    <title>SpaceX Study Notes</title>
    <meta property="og:title" content="OG SpaceX" />
    <script>evil()</script>
    <style>.x{color:red}</style>
  </head><body>
    <nav>Skip</nav>
    <main><h1>Ignored H1 when title present</h1><p>Rocket engines and orbital mechanics for the vault.</p></main>
  </body></html>`
  const pageEx = extractFromHtml(html)
  assert(pageEx.title === 'OG SpaceX', `prefers og:title (got ${pageEx.title})`)
  assert(/Rocket engines/.test(pageEx.text), 'extracts main body text')
  assert(!/evil/.test(pageEx.text), 'strips script content')
  assert(!/color:red/.test(pageEx.text), 'strips style content')

  const htmlTitleOnly = `<html><head><title>Plain Title</title></head><body><article><p>Article body here.</p></article></body></html>`
  const ex2 = extractFromHtml(htmlTitleOnly)
  assert(ex2.title === 'Plain Title', 'falls back to <title>')
  assert(/Article body/.test(ex2.text), 'uses article when no main')

  const htmlH1 = `<html><body><h1>Only H1</h1><p>More text about widgets.</p></body></html>`
  const ex3 = extractFromHtml(htmlH1)
  assert(ex3.title === 'Only H1', 'falls back to h1')

  const parsed = parseAutoTagJson(
    '{"title":"T","summary":"S","para":"resources","kind":"article","project":"SpaceX study","status":"active"}'
  )
  assert(!!parsed && parsed.title === 'T' && parsed.para === 'resources', 'parseAutoTagJson happy path')
  assert(parsed!.project === 'SpaceX study', 'parseAutoTagJson project')
  const fenceOpen = String.fromCharCode(96, 96, 96)
  const fenced = parseAutoTagJson(
    'Here:\n' + fenceOpen + 'json\n{"title":"A","summary":"B","para":"projects","kind":"docs","project":null,"status":"active"}\n' + fenceOpen
  )
  assert(!!fenced && fenced.para === 'projects' && fenced.project === null, 'parseAutoTagJson strips fence')
  const badPara = parseAutoTagJson('{"title":"X","summary":"Y","para":"nope","kind":"z","project":null,"status":"active"}')
  assert(!!badPara && badPara.para === 'resources', 'invalid para defaults to resources')
  assert(parseAutoTagJson('not json') === null, 'parseAutoTagJson rejects garbage')
  assert(parseAutoTagJson('{"summary":"no title"}') === null, 'parseAutoTagJson requires title')

  const heur = heuristicTags('https://www.example.com/a', 'Example Domain', 'Hello world '.repeat(30))
  assert(heur.para === 'resources' && heur.kind === 'article', 'heuristic defaults para/kind')
  assert(heur.project === 'example.com', 'heuristic project from hostname without www')
  assert(heur.status === 'active', 'heuristic status active')
  assert(heur.summary.length <= 240, 'heuristic summary capped ~240')
  assert(heur.title === 'Example Domain', 'heuristic keeps page title')

  // --- Multi-turn chat search query ---
  console.log('\nisGreetingOrSocial')
  assert(isGreetingOrSocial('hello'), 'hello is greeting')
  assert(isGreetingOrSocial('Hi!'), 'Hi! is greeting')
  assert(isGreetingOrSocial('thanks'), 'thanks is greeting')
  assert(!isGreetingOrSocial('hello what does Callicles say'), 'hello+question is not pure greeting')
  assert(!isGreetingOrSocial('Who should rule?'), 'content question is not greeting')

  console.log('\nbuildChatSearchQuery')
  const bothQ = buildChatSearchQuery('both', [
    'As Callicles: who should rule the city, and by what right?',
    'why is that',
  ])
  assert(/Callicles/i.test(bothQ), 'short "both" keeps Callicles from prior')
  assert(/rule/i.test(bothQ), 'short "both" keeps rule terms from prior')
  assert(bothQ.includes('both'), 'short follow-up still includes "both"')
  assert(
    bothQ.toLowerCase().indexOf('callicles') < bothQ.toLowerCase().indexOf('both'),
    'short follow-up weights prior before latest'
  )

  const longAlone =
    'What does Socrates argue about rhetoric being a knack rather than a true art, and how does that relate to justice?'
  const longQ = buildChatSearchQuery(longAlone, [])
  assert(longQ.includes('rhetoric'), 'long standalone keeps its own terms')
  assert(longQ.startsWith('What does Socrates'), 'long standalone is mostly the latest itself')

  const longWithPrior = buildChatSearchQuery(longAlone, [
    'As Callicles: who should rule the city, and by what right?',
  ])
  assert(longWithPrior.startsWith('What does Socrates'), 'long latest stays dominant at front')
  assert(longWithPrior.length <= 700, 'search query capped at ~700 chars')

  const emptySearchQ = buildChatSearchQuery('   ', [])
  assert(emptySearchQ === '', 'empty latest+priors yields empty query')

  // --- Ollama health (must not throw when down) ---

  console.log('\nOllama health (no crash if down)')
  let healthThrew = false
  let health
  try {
    health = await ollamaHealth()
  } catch (e) {
    healthThrew = true
    console.error(e)
  }
  assert(!healthThrew, 'ollamaHealth() does not throw')
  assert(typeof health!.ok === 'boolean', `returns { ok: boolean } (ok=${health!.ok})`)
  if (health!.ok) {
    const model = pickModel(health!.models ?? [])
    assert(!!model, `pickModel chose ${model}`)
  } else {
    assert(true, `Ollama offline as expected in CI/headless (${health!.error ?? 'no error'})`)
  }

  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  try {
    closeDb()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
