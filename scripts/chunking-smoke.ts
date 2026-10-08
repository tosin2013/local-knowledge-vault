/**
 * #219 — note chunking: pure splitter + DB sync + chunk-aware search.
 *
 *   npm run test:chunking
 *
 * Runs under Electron-as-Node against a temp DB.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { splitIntoChunks, DEFAULT_CHUNK_CHARS } from '../electron/chunking'
import { initDb, closeDb, createItem, updateItem, deleteItem } from '../electron/db'
import { searchQuery } from '../electron/search'

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

function filler(sentences: number): string {
  return Array.from({ length: sentences }, (_, i) => `This is filler sentence number ${i} about ordinary topics.`).join(' ')
}

function main(): void {
  console.log('\n=== Local Knowledge Vault — note chunking (#219) ===\n')

  // --- splitIntoChunks (pure) ---
  console.log('splitIntoChunks')
  assert(splitIntoChunks('') .length === 0, 'empty text yields no chunks')
  assert(splitIntoChunks('short note').length === 1, 'short text yields one chunk')
  const long = filler(200)
  const chunks = splitIntoChunks(long)
  assert(chunks.length > 1, `long text yields multiple chunks (got ${chunks.length})`)
  assert(chunks.every((c) => c.length <= DEFAULT_CHUNK_CHARS), 'every chunk is within maxChars')
  assert(chunks.join(' ').includes('filler sentence number 199'), 'chunks preserve the text')

  // --- DB sync ---
  console.log('\nnote_chunks sync')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-219-'))
  initDb(path.join(tmp, 'test.sqlite'))

  const body = filler(20) + ' The mitochondria is the powerhouse of the cell. ' + filler(20)
  const note = createItem({ title: 'Cell biology (long)', body, kind: 'note', para: 'resources' })
  const chunkCount = (): number => {
    const row = require('../electron/db').getDb()
      .prepare('SELECT COUNT(*) AS c FROM note_chunks WHERE item_id = ?')
      .get(note.id) as { c: number }
    return Number(row.c)
  }
  assert(chunkCount() > 1, 'a long note is split into multiple chunks')

  updateItem(note.id, { body: 'A short replacement body.' })
  assert(chunkCount() === 1, 'updating the body re-derives the chunks')

  // --- chunk-aware search ---
  console.log('\nchunk-aware search')
  const buried = filler(30) + ' The quasiturbine is a rotary engine design. ' + filler(30)
  const buriedNote = createItem({ title: 'Engines', body: buried, kind: 'note', para: 'resources' })
  const hits = searchQuery({ text: 'quasiturbine', limit: 5 }).hits
  assert(hits.some((h) => h.id === buriedNote.id), 'a distinctive phrase buried mid-note still retrieves the note')
  const hit = hits.find((h) => h.id === buriedNote.id)
  assert(!!hit && hit.passage?.includes('quasiturbine'), 'the chunk-level hit carries the matching passage')

  // The grounded passage now prefers the matching chunk over the head of the body.
  assert(!!hit && !hit.passage!.startsWith('This is filler sentence number 0'), 'the passage is the relevant section, not the note head')

  // deleteItem cascades chunks away
  const chunkRows = (): number => {
    const row = require('../electron/db').getDb()
      .prepare('SELECT COUNT(*) AS c FROM note_chunks WHERE item_id = ?')
      .get(note.id) as { c: number }
    return Number(row.c)
  }
  deleteItem(note.id)
  assert(chunkRows() === 0, 'deleting a note cascades its chunks')

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
