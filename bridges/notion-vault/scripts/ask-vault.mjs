#!/usr/bin/env node
/**
 * Minimal CLI: POST a grounded ask to the local Vault Bridge.
 * Usage:
 *   node ask-vault.mjs "Your question"
 *   node ask-vault.mjs --project my-video "Your question"
 *   node ask-vault.mjs --prompt-id prm_xxx "Your question"
 */
const BRIDGE = process.env.VAULT_BRIDGE || 'http://127.0.0.1:8765'
const TOKEN = process.env.VAULT_BRIDGE_TOKEN || ''

function usage() {
  console.error(`Usage: node ask-vault.mjs [--project NAME] [--prompt-id ID] "question text"
Env: VAULT_BRIDGE (default ${BRIDGE})
     VAULT_BRIDGE_TOKEN (bearer token from Vault → Settings → Vault Bridge)`)
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  let project
  let promptId
  const textParts = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--project') {
      project = args[++i]
    } else if (a === '--prompt-id') {
      promptId = args[++i]
    } else if (a === '-h' || a === '--help') {
      usage()
    } else {
      textParts.push(a)
    }
  }
  const text = textParts.join(' ').trim()
  if (!text) usage()

  const health = await fetch(`${BRIDGE}/health`).catch((e) => {
    console.error(`Vault Bridge unreachable at ${BRIDGE}. Start the Vault app first.`)
    console.error(e.message || e)
    process.exit(2)
  })
  if (!health.ok) {
    console.error(`Health check failed: HTTP ${health.status}`)
    process.exit(2)
  }

  const res = await fetch(`${BRIDGE}/v1/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ text, project, promptId }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    if (res.status === 401) {
      console.error(
        'Unauthorized. Set VAULT_BRIDGE_TOKEN to the bearer token shown in Vault → Settings → Vault Bridge.'
      )
      process.exit(3)
    }
    console.error(data.error || `Ask failed: HTTP ${res.status}`)
    process.exit(3)
  }
  console.log(data.answer || '')
  if (Array.isArray(data.citations) && data.citations.length) {
    console.log('\nCitations:')
    for (const c of data.citations) {
      console.log(`  [${c.id}] ${c.title}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
