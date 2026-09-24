import { initDb, closeDb, createSession } from '../electron/db'
import { setLlmUserDataDir } from '../electron/llm-settings'
import { sendChatTurn } from '../electron/chat'

setLlmUserDataDir('/home/box/.config/local-knowledge-vault')
initDb('/home/box/.config/local-knowledge-vault/lkv.sqlite')

async function main() {
  const session = createSession({ title: 'oob', mode: 'grounded' })
  const res = await sendChatTurn({
    sessionId: session.id,
    text: 'What does Nietzsche say about the will to power?',
    promptId: 'prm_56ba1ab41bfe4042',
    filters: { project: 'Gorgias' },
    limit: 8,
  })
  console.log('offline', !!res.offline)
  console.log('error', res.error || '')
  console.log('--- answer ---')
  console.log(res.assistant.content)
  closeDb()
}
main().catch((e) => {
  console.error(e)
  closeDb()
  process.exit(1)
})
