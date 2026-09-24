/**
 * Stronger personality demo: speak-as-Callicles + out-of-book refusal.
 */
import { initDb, closeDb, createSession, getPrompt } from '../electron/db'
import { setLlmUserDataDir } from '../electron/llm-settings'
import { sendChatTurn } from '../electron/chat'
import type { ChatSendResult } from '../electron/types'

const dbPath = '/home/box/.config/local-knowledge-vault/lkv.sqlite'
setLlmUserDataDir('/home/box/.config/local-knowledge-vault')
initDb(dbPath)

const GORGIAS = 'prm_56ba1ab41bfe4042'
const filters = { project: 'Gorgias' }

function cites(res: ChatSendResult): string {
  try {
    const parsed = JSON.parse(res.assistant.citations_json || '[]') as { id: string; title: string }[]
    return Array.isArray(parsed) ? parsed.map((c) => c.title || c.id).join(' | ') : ''
  } catch {
    return ''
  }
}

async function ask(label: string, promptId: string | undefined, text: string) {
  const session = createSession({ title: label, mode: 'grounded' })
  const res = await sendChatTurn({
    sessionId: session.id,
    text,
    promptId,
    filters,
    limit: 8,
  })
  console.log(`\n========== ${label} ==========`)
  console.log('Q:', text)
  console.log('offline:', !!res.offline, 'error:', res.error || '')
  console.log('citations:', cites(res) || '(none)')
  console.log('--- answer ---')
  console.log(res.assistant.content || '(empty)')
}

async function main() {
  const g = getPrompt(GORGIAS)
  console.log('Using', g?.name)

  await ask(
    'DEFAULT — speak as Callicles',
    undefined,
    'Speak briefly in the first person as Callicles. Who should rule the city, and why? Stay faithful to the dialogue.'
  )
  await new Promise((r) => setTimeout(r, 6000))
  await ask(
    'GORGIAS READER — speak as Callicles',
    GORGIAS,
    'Speak briefly in the first person as Callicles. Who should rule the city, and why? Stay faithful to the dialogue.'
  )
  await new Promise((r) => setTimeout(r, 6000))
  await ask(
    'GORGIAS READER — out of book',
    GORGIAS,
    'What does Nietzsche say about the will to power?'
  )
  closeDb()
}

main().catch((e) => {
  console.error(e)
  closeDb()
  process.exit(1)
})
