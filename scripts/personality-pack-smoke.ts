/**
 * #164 — personality packs: export/import JSON validation and unique import
 * names. Offline and deterministic (no model, no network).
 *
 *   npm run test:personalities
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { closeDb, createPrompt, initDb, listPrompts, uniquePromptName } from '../electron/db'
import {
  buildPersonalityPack,
  parsePersonalityPack,
  personalityFileName,
  serializePersonalityPack,
  PERSONALITY_BODY_MAX,
  PERSONALITY_DESCRIPTION_MAX,
  PERSONALITY_NAME_MAX,
  PERSONALITY_PACK_KIND,
  PERSONALITY_PACK_VERSION,
} from '../electron/personality-pack'

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

function main(): void {
  console.log('\n=== Local Knowledge Vault — personality packs (#164) ===\n')

  const prompt = { name: ' Concise bullets ', description: 'Short', body: 'Be concise.' }
  const at = '2026-10-07T00:00:00.000Z'

  // --- build + serialize ---
  const pack = buildPersonalityPack(prompt, at)
  assert(pack.kind === PERSONALITY_PACK_KIND, 'pack kind is vault.personality')
  assert(pack.version === PERSONALITY_PACK_VERSION, 'pack version is current')
  assert(pack.name === 'Concise bullets', 'name is trimmed')
  assert(pack.exportedAt === at, 'exportedAt is recorded')
  const json = serializePersonalityPack(prompt, at)
  assert(json.endsWith('\n'), 'serialized pack ends with a newline')

  // --- round trip ---
  const parsed = parsePersonalityPack(json)
  assert(parsed.ok === true, 'round-trip parses')
  if (parsed.ok) {
    assert(parsed.pack.name === 'Concise bullets', 'round-trip name')
    assert(parsed.pack.body === 'Be concise.', 'round-trip body')
    assert(parsed.pack.description === 'Short', 'round-trip description')
  }

  // --- filename ---
  assert(
    personalityFileName('Executive summary') === 'executive-summary.personality.json',
    'filename is slug + .personality.json'
  )
  assert(personalityFileName('') === 'personality.personality.json', 'empty name falls back')
  assert(personalityFileName('!!!') === 'personality.personality.json', 'symbol-only name falls back')

  // --- import validation (deny by default) ---
  assert(parsePersonalityPack('not json').ok === false, 'invalid JSON rejected')
  assert(parsePersonalityPack('[]').ok === false, 'array rejected')
  assert(parsePersonalityPack('{"kind":"other"}').ok === false, 'wrong kind rejected')
  assert(
    parsePersonalityPack(
      JSON.stringify({ kind: PERSONALITY_PACK_KIND, version: 99, name: 'x', body: 'y' })
    ).ok === false,
    'future version rejected'
  )
  assert(
    parsePersonalityPack(
      JSON.stringify({ kind: PERSONALITY_PACK_KIND, version: 1, name: '', body: 'y' })
    ).ok === false,
    'missing name rejected'
  )
  assert(
    parsePersonalityPack(
      JSON.stringify({ kind: PERSONALITY_PACK_KIND, version: 1, name: 'x', body: '   ' })
    ).ok === false,
    'missing body rejected'
  )
  assert(
    parsePersonalityPack(
      JSON.stringify({
        kind: PERSONALITY_PACK_KIND,
        version: 1,
        name: 'x',
        body: 'y'.repeat(PERSONALITY_BODY_MAX + 1),
      })
    ).ok === false,
    'oversized body rejected'
  )
  assert(
    parsePersonalityPack(
      JSON.stringify({
        kind: PERSONALITY_PACK_KIND,
        version: 1,
        name: 'x',
        body: 'y',
        description: 3,
      })
    ).ok === false,
    'non-string description rejected'
  )
  assert(
    parsePersonalityPack(
      JSON.stringify({ kind: PERSONALITY_PACK_KIND, version: 1, name: 'x', body: 'y' })
    ).ok === true,
    'minimal valid pack accepted'
  )
  assert(
    typeof buildPersonalityPack({ name: 'X', description: null, body: 'Y' }).exportedAt === 'string',
    'buildPersonalityPack defaults exportedAt to now'
  )
  assert(parsePersonalityPack('null').ok === false, 'null rejected')
  assert(parsePersonalityPack('3').ok === false, 'a bare number rejected')
  assert(
    parsePersonalityPack(
      JSON.stringify({ kind: PERSONALITY_PACK_KIND, name: 'x', body: 'y' })
    ).ok === false,
    'missing version rejected'
  )
  assert(
    parsePersonalityPack(
      JSON.stringify({
        kind: PERSONALITY_PACK_KIND,
        version: 1,
        name: 'x'.repeat(PERSONALITY_NAME_MAX + 1),
        body: 'y',
      })
    ).ok === false,
    'oversized name rejected'
  )
  const longDesc = parsePersonalityPack(
    JSON.stringify({
      kind: PERSONALITY_PACK_KIND,
      version: 1,
      name: 'x',
      body: 'y',
      description: 'd'.repeat(PERSONALITY_DESCRIPTION_MAX + 50),
    })
  )
  assert(
    longDesc.ok === true && longDesc.pack.description?.length === PERSONALITY_DESCRIPTION_MAX,
    'long description is clamped'
  )
  const blankDesc = parsePersonalityPack(
    JSON.stringify({ kind: PERSONALITY_PACK_KIND, version: 1, name: 'x', body: 'y', description: '   ' })
  )
  assert(blankDesc.ok === true && blankDesc.pack.description === null, 'blank description becomes null')

  // --- unique import names (db, import never overwrites) ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-164-'))
  initDb(path.join(tmp, 'test.sqlite'))
  createPrompt({ name: 'Study guide', body: 'Q&A.' })
  assert(uniquePromptName('Study guide') === 'Study guide (2)', 'clashing import name gets (2)')
  assert(uniquePromptName('Nothing here yet') === 'Nothing here yet', 'fresh import name kept')
  const created = createPrompt({ name: uniquePromptName('Study guide'), body: 'Q&A.' })
  assert(created.name === 'Study guide (2)', 'created prompt carries the unique name')
  assert(uniquePromptName('Study guide') === 'Study guide (3)', 'the suffix keeps counting (3)')
  assert(
    listPrompts().filter((p) => p.name === 'Study guide' || p.name === 'Study guide (2)').length === 2,
    'import adds a second prompt rather than overwriting'
  )
  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
