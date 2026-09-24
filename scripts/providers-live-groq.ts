/**
 * Live check: "Test connection" against Groq with the key already saved in your Vault
 * userData dir (legacy lkv-groq-key) or GROQ_API_KEY. Read-only: writes nothing, never prints the key.
 *
 *   npm run test:providers:live
 */
import os from 'os'
import path from 'path'
import fs from 'fs'
import { readKeyFileAt } from '../electron/llm-settings'
import { testProvider } from '../electron/llm'

function defaultUserData(): string {
  if (process.env.LKV_USER_DATA_DIR) return process.env.LKV_USER_DATA_DIR
  const name = 'local-knowledge-vault'
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name)
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? os.homedir(), name)
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), name)
}

async function main() {
  const dir = defaultUserData()
  const key = process.env.GROQ_API_KEY?.trim() || readKeyFileAt(path.join(dir, 'lkv-groq-key'))
  if (!key) {
    console.log(`SKIP: no Groq key (GROQ_API_KEY or ${path.join(dir, 'lkv-groq-key')})`)
    return
  }
  let model = 'openai/gpt-oss-20b'
  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(dir, 'lkv-llm.json'), 'utf8')) as { groqModel?: string }
    if (legacy.groqModel) model = legacy.groqModel
  } catch {
    /* default */
  }
  const r = await testProvider({
    kind: 'openai-compatible',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model,
    apiKey: key,
  })
  const out = JSON.stringify(r)
  if (out.includes(key)) throw new Error('key leaked into result') // paranoia
  console.log(r.ok ? `✓ Groq live: ${r.latencyMs} ms · ${r.model} · replied "${(r.sample ?? '').trim()}"` : `✗ Groq live failed after ${r.latencyMs} ms: ${r.error}`)
  process.exit(r.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
