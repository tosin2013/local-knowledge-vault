/**
 * Offline smoke tests for Media personas — the grounded voice-pack definitions and
 * the seed / Easy Add / profile-bound logic. Runs under Electron-as-Node against a
 * temp DB + registry, no network.
 *
 *   npm run test:media-personas
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDb, closeDb } from '../electron/db'
import {
  MEDIA_PERSONAS,
  MEDIA_HARD_RULES,
  buildMediaVoicePromptBody,
  buildCustomMediaVoicePackDescription,
  getMediaPersonaByName,
  getMediaPersonaById,
  isCustomMediaVoicePackDescription,
} from '../electron/media-persona-defs'
import {
  setMediaVoicePackRegistryPath,
  ensureMediaPersonaPrompts,
  applyMediaPersona,
  createCustomMediaPersona,
  listMediaVoicePacks,
  listCustomMediaPersonas,
} from '../electron/media-personas'

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
  console.log('\n=== Local Knowledge Vault — Media personas smoke ===\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-personas-'))
  const dbFile = path.join(dir, 'test.sqlite')
  initDb(dbFile)
  setMediaVoicePackRegistryPath(dir)

  // --- persona definitions (pure data) ---
  console.log('Persona definitions')
  assert(MEDIA_PERSONAS.length === 3, 'three built-in Media personas')
  assert(
    MEDIA_PERSONAS.every((p) => p.name && p.description && p.body),
    'every persona has name / description / body',
  )
  assert(MEDIA_HARD_RULES.includes('never override'), 'hard rules forbid overriding grounding')
  const body = buildMediaVoicePromptBody('Warm and wry')
  assert(body.includes('Warm and wry'), 'prompt body includes the speaking style')
  assert(body.includes(MEDIA_HARD_RULES), 'prompt body includes the hard grounding rules')
  assert(getMediaPersonaByName('Desk cohost')?.id === 'desk-cohost', 'lookup by name')
  assert(getMediaPersonaById('desk-cohost')?.name === 'Desk cohost', 'lookup by id')
  assert(getMediaPersonaByName('nope') === undefined, 'unknown persona is undefined')
  const customDesc = buildCustomMediaVoicePackDescription('Nightly recap')
  assert(isCustomMediaVoicePackDescription(customDesc), 'custom description carries the prefix')
  assert(!isCustomMediaVoicePackDescription('plain description'), 'plain description is not custom')

  // --- seed / refresh built-ins ---
  console.log('Seed / refresh personas')
  const first = ensureMediaPersonaPrompts()
  assert(first.created.length === 3, `creates all three (created ${first.created.length})`)
  const second = ensureMediaPersonaPrompts()
  assert(second.created.length === 0 && second.updated.length === 0, 'idempotent re-run changes nothing')

  // --- Easy Add custom persona ---
  console.log('Custom persona')
  const custom = createCustomMediaPersona({
    name: 'Late-night host',
    speakingStyle: 'Warm and wry',
    description: 'Nightly recap',
  })
  assert(custom.name === 'Late-night host', 'custom persona created')
  try {
    createCustomMediaPersona({ name: 'Desk cohost', speakingStyle: 'x' })
    assert(false, 'built-in name is rejected')
  } catch {
    assert(true, 'built-in name is rejected')
  }
  try {
    createCustomMediaPersona({ name: '', speakingStyle: 'x' })
    assert(false, 'empty name is rejected')
  } catch {
    assert(true, 'empty name is rejected')
  }
  try {
    createCustomMediaPersona({ name: 'X', speakingStyle: '' })
    assert(false, 'empty speaking style is rejected')
  } catch {
    assert(true, 'empty speaking style is rejected')
  }

  // --- project-bound profile ---
  console.log('Apply persona profile')
  try {
    applyMediaPersona({ persona: 'Desk cohost', project: '' })
    assert(false, 'missing project is rejected')
  } catch {
    assert(true, 'missing project is rejected')
  }
  const applied = applyMediaPersona({ persona: 'Desk cohost', project: 'My podcast' })
  assert(applied.profile.name === 'Desk cohost · My podcast', 'built-in profile upserted with project name')
  const appliedCustom = applyMediaPersona({ persona: 'Late-night host', project: 'My podcast' })
  assert(appliedCustom.profile.prompt_id === custom.promptId, 'custom profile bound to custom prompt')
  try {
    applyMediaPersona({ persona: 'Does not exist', project: 'X' })
    assert(false, 'unknown persona is rejected')
  } catch {
    assert(true, 'unknown persona is rejected')
  }

  // --- voice pack listing ---
  console.log('List voice packs')
  const packs = listMediaVoicePacks()
  assert(packs.some((p) => p.name === 'Desk cohost' && p.builtin), 'built-in pack listed')
  assert(packs.some((p) => p.name === 'Late-night host' && !p.builtin), 'custom pack listed')
  const customOnly = listCustomMediaPersonas()
  assert(customOnly.every((p) => !p.builtin), 'custom-only list has no built-ins')
  assert(customOnly.some((p) => p.name === 'Late-night host'), 'custom-only list has the custom pack')

  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
