/**
 * Compare default vs Gorgias reader personality on the same question.
 */
import { initDb, closeDb, createSession, getPrompt, listPrompts } from '../electron/db'
import { setLlmUserDataDir } from '../electron/llm-settings'
import { sendChatTurn } from '../electron/chat'
import type { ChatSendResult } from '../electron/types'

const dbPath = '/home/box/.config/local-knowledge-vault/lkv.sqlite'
setLlmUserDataDir('/home/box/.config/local-knowledge-vault')
initDb(dbPath)

const GORGIAS_PROMPT_ID = 'prm_56ba1ab41bfe4042'
const filters = { project: 'Gorgias' }
const QUESTION =
  'In one short paragraph: what does Callicles say about who should rule, and why? Cite the notes.'

function cites(res: ChatSendResult): string {
  try {
    const parsed = JSON.parse(res.assistant.citations_json || '[]') as { id: string; title: string }[]
    return Array.isArray(parsed) ? parsed.map((c) => c.title || c.id).join(' | ') : ''
  } catch {
    return ''
  }
}

async function run(label: string, promptId: string | undefined) {
  const session = createSession({ title: `Personality smoke — ${label}`, mode: 'grounded' })
  const res = await sendChatTurn({
    sessionId: session.id,
    text: QUESTION,
    promptId,
    filters,
    limit: 8,
  })
  console.log(`\n========== ${label} ==========`)
  console.log('promptId:', promptId || '(default)')
  console.log('offline:', !!res.offline, 'error:', res.error || '')
  console.log('citations:', cites(res) || '(none)')
  console.log('--- answer ---')
  console.log(res.assistant.content || '(empty)')
  return res
}

async function main() {
  const g = getPrompt(GORGIAS_PROMPT_ID)
  console.log('Gorgias reader found:', !!g, g?.name)
  console.log('Gorgias description:', g?.description || '')
  console.log('Gorgias body (first 500 chars):\n', (g?.body || '').slice(0, 500))
  const prompts = listPrompts()
  console.log(
    'All prompts:',
    prompts.map((p) => `${p.id}:${p.name}`).join(', ')
  )

  await run('DEFAULT (no personality)', undefined)
  await new Promise((r) => setTimeout(r, 8000))
  await run('GORGIAS READER', GORGIAS_PROMPT_ID)
  closeDb()
}

main().catch((e) => {
  console.error(e)
  closeDb()
  process.exit(1)
})
