/**
 * Headless smoke: build a session with citations/hits, export citation pack,
 * assert pack files exist and a note file contains [itm_.
 * Run: ELECTRON_RUN_AS_NODE=1 electron -r tsx/cjs scripts/citation-pack-smoke.ts
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  initDb,
  closeDb,
  createItem,
  createSession,
  appendMessage,
  listItems,
} from '../electron/db'
import {
  buildCitationPackForSession,
  writeCitationPack,
  collectNoteIdsFromMessages,
} from '../electron/citation-pack'
import { listMessages } from '../electron/db'

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
  console.log('\n=== Citation pack smoke ===\n')

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-citepack-'))
  const dbFile = path.join(tmpDir, 'test.sqlite')
  const outDir = path.join(tmpDir, 'out')
  fs.mkdirSync(outDir, { recursive: true })

  initDb(dbFile)

  // Prefer a seeded item; also create one with a known source URL line
  const seeded = listItems()[0]
  assert(!!seeded, 'have at least one seeded item')
  const custom = createItem({
    title: 'Citation Pack Demo Note',
    body: 'Source URL: https://example.com/demo\n\nPARA means Projects, Areas, Resources, Archives. This note exists for pack export smoke.',
    para: 'resources',
    kind: 'article',
    project: 'Smoke',
  })

  const session = createSession({
    title: 'What is PARA?',
    mode: 'grounded',
    filters: { project: 'Smoke' },
  })
  appendMessage({
    session_id: session.id,
    role: 'user',
    content: 'What is PARA?',
  })
  const citeId = custom.id
  const hitId = seeded?.id ?? custom.id
  appendMessage({
    session_id: session.id,
    role: 'assistant',
    content: `PARA is a notes system: Projects, Areas, Resources, Archives. [${citeId}]`,
    citations_json: JSON.stringify([{ id: citeId, title: custom.title }]),
    hits_json: JSON.stringify([
      {
        id: hitId,
        title: seeded?.title ?? custom.title,
        snippet: '…',
        score: 1,
        para: seeded?.para ?? 'resources',
        kind: seeded?.kind ?? 'note',
        project: seeded?.project ?? null,
      },
    ]),
  })
  // Fake missing citation to exercise missingIds
  appendMessage({
    session_id: session.id,
    role: 'assistant',
    content: 'Also see [itm_missingdeadbeef01] which does not exist.',
    citations_json: JSON.stringify([{ id: 'itm_missingdeadbeef01', title: 'ghost' }]),
  })

  const messages = listMessages(session.id)
  const ids = collectNoteIdsFromMessages(messages)
  assert(ids.includes(citeId), 'collects citation id')
  assert(ids.includes(hitId), 'collects hit id')
  assert(ids.includes('itm_missingdeadbeef01'), 'collects missing cited id')

  const pack = buildCitationPackForSession(session.id, { profileHint: 'Smoke profile' })
  assert(pack.files.some((f) => f.relativePath === 'INSTRUCTIONS.md'), 'has INSTRUCTIONS.md')
  assert(pack.files.some((f) => f.relativePath === 'thread.md'), 'has thread.md')
  assert(pack.files.some((f) => f.relativePath === 'context.md'), 'has context.md')
  assert(pack.files.some((f) => f.relativePath === 'manifest.json'), 'has manifest.json')
  assert(pack.files.some((f) => f.relativePath.startsWith('notes/')), 'has notes/')
  assert(pack.manifest.missingIds.includes('itm_missingdeadbeef01'), 'manifest lists missingIds')
  assert(pack.manifest.profileHint === 'Smoke profile', 'profileHint set')
  assert(pack.manifest.app === 'Vault', 'app is Vault')
  assert(pack.manifest.noteIds.includes(citeId), 'manifest includes cited note')

  const noteFile = pack.files.find((f) => f.relativePath.startsWith('notes/') && f.content.includes(citeId))
  assert(!!noteFile, 'note file for cited item')
  assert(!!noteFile && noteFile.content.includes(`[${citeId}]`), 'note file contains [itm_…] heading')
  assert(!!noteFile && noteFile.content.includes('Source URL: https://example.com/demo'), 'note body preserved')

  const instructions = pack.files.find((f) => f.relativePath === 'INSTRUCTIONS.md')!
  assert(instructions.content.includes('Answer only from NOTES'), 'instructions mention NOTES')
  assert(instructions.content.includes('[itm_'), 'instructions mention cite format')

  const context = pack.files.find((f) => f.relativePath === 'context.md')!
  assert(context.content.includes('[itm_'), 'context.md binds ids')
  assert(context.content.includes('What is PARA?'), 'context includes thread question')

  const { folderPath, zipPath } = writeCitationPack(outDir, pack)
  assert(fs.existsSync(folderPath), `folder exists: ${folderPath}`)
  assert(fs.existsSync(zipPath), `zip exists: ${zipPath}`)
  assert(fs.existsSync(path.join(folderPath, 'INSTRUCTIONS.md')), 'folder INSTRUCTIONS.md')
  assert(fs.existsSync(path.join(folderPath, 'thread.md')), 'folder thread.md')
  assert(fs.existsSync(path.join(folderPath, 'context.md')), 'folder context.md')
  assert(fs.existsSync(path.join(folderPath, 'manifest.json')), 'folder manifest.json')
  const noteDir = path.join(folderPath, 'notes')
  const noteNames = fs.readdirSync(noteDir)
  assert(noteNames.length >= 1, `notes/ has files (${noteNames.length})`)
  const someNote = fs.readFileSync(path.join(noteDir, noteNames[0]), 'utf8')
  assert(someNote.includes('[itm_'), 'written note contains [itm_')

  const zipStat = fs.statSync(zipPath)
  assert(zipStat.size > 100, `zip non-trivial size (${zipStat.size} bytes)`)

  console.log('\n--- Smoke output paths ---')
  console.log(`folder: ${folderPath}`)
  console.log(`zip:    ${zipPath}`)
  console.log(`notes:  ${noteNames.join(', ')}`)

  closeDb()

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main()
