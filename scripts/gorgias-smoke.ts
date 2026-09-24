/**
 * Multi-turn Gorgias chat smoke: Callicles → "why is that" → "both".
 * Expects retrieval fix so turn 3 still finds Callicles-related notes.
 */
import { initDb, closeDb, createSession, getPrompt } from '../electron/db'
import { setLlmUserDataDir } from '../electron/llm-settings'
import { sendChatTurn, buildChatSearchQuery } from '../electron/chat'
import { searchQuery } from '../electron/search'
import type { ChatSendResult, SearchHit } from '../electron/types'

const dbPath = '/home/box/.config/local-knowledge-vault/lkv.sqlite'
setLlmUserDataDir('/home/box/.config/local-knowledge-vault')
initDb(dbPath)

const PROMPT_ID = 'prm_56ba1ab41bfe4042'
const filters = { project: 'Gorgias' }
const PAUSE_MS = 12000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function parseHits(json: string | null): SearchHit[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as SearchHit[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseCitations(json: string | null): { id: string; title: string }[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as { id: string; title: string }[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function logTurn(label: string, res: ChatSendResult): void {
  const hits = parseHits(res.assistant.hits_json)
  const cites = parseCitations(res.assistant.citations_json)
  console.log(`\n=== ${label} ===`)
  console.log('offline', !!res.offline, 'error', res.error || '')
  console.log(
    'hit titles:',
    hits.map((h) => h.title).join(' | ') || '(none)'
  )
  console.log('citations:', JSON.stringify(cites))
  console.log('answer excerpt:', (res.assistant.content || '').slice(0, 1200))
}

async function main() {
  const p = getPrompt(PROMPT_ID)
  console.log('prompt', p?.id, p?.name)
  console.log('description', p?.description)

  // Dry-run retrieval query builder for the "both" case
  const preview = buildChatSearchQuery('both', [
    'Speak briefly as Callicles: who should rule, and why? Stay faithful to the dialogue and cite notes.',
    'why is that',
  ])
  console.log('preview search query for "both":', preview)
  const previewHits = searchQuery({ text: preview, filters, limit: 8 })
  console.log(
    'preview hit titles:',
    previewHits.hits.map((h) => h.title).join(' | ')
  )

  const session = createSession({ title: 'Gorgias multi-turn smoke', mode: 'grounded' })

  const t1 = await sendChatTurn({
    sessionId: session.id,
    text: 'Speak briefly as Callicles: who should rule, and why? Stay faithful to the dialogue and cite notes.',
    promptId: PROMPT_ID,
    filters,
    limit: 8,
  })
  logTurn('TURN 1 — Callicles who should rule', t1)

  await sleep(PAUSE_MS)

  const t2 = await sendChatTurn({
    sessionId: session.id,
    text: 'why is that',
    promptId: PROMPT_ID,
    filters,
    limit: 8,
  })
  logTurn('TURN 2 — why is that', t2)

  await sleep(PAUSE_MS)

  const t3 = await sendChatTurn({
    sessionId: session.id,
    text: 'both',
    promptId: PROMPT_ID,
    filters,
    limit: 8,
  })
  logTurn('TURN 3 — both (definition + why)', t3)

  const t3Hits = parseHits(t3.assistant.hits_json)
  const calliclesRelated = t3Hits.some((h) => /Callicles|rule|strong|nature|superior/i.test(h.title + ' ' + h.snippet))
  console.log('\n=== SMOKE SUMMARY ===')
  console.log('turn3 hit count:', t3Hits.length)
  console.log('turn3 Callicles-related hits:', calliclesRelated)
  console.log(
    'turn3 refused / empty-notes?',
    /don'?t know|do not know|not in (the )?(passages|notes|book)|No matching notes/i.test(
      t3.assistant.content
    )
  )
  closeDb()
}

main().catch((e) => {
  console.error(e)
  closeDb()
  process.exit(1)
})
