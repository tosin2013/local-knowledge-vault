/**
 * #138 — notes-first retrieval: verify the user's own notes rank before raw
 * transcript chunks in Ask, while Media chat (sourcesLast=false) keeps
 * transcripts ranked normally.
 *
 *   npm run test:notes-vs-transcripts
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDb, closeDb, createItem } from '../electron/db'
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

function main(): void {
  console.log('\n=== Local Knowledge Vault — notes vs transcripts (#138) ===\n')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-138-'))
  initDb(path.join(tmp, 'test.sqlite'))

  const transcript = [
    'The Falcon 9 first stage is a partially reusable rocket booster. After launch it separates from the second stage.',
    'The booster performs a boostback burn and lands on an autonomous drone ship in the Atlantic Ocean.',
    'Grid fins steer the booster during reentry, and landing legs deploy just before touchdown.',
  ]
  const notes = [
    "Falcon 9's rocket comes back and lands itself on a barge at sea so SpaceX can reuse it.",
    'Reusing the first stage cuts the cost of a launch, which is why it matters.',
    'The booster steers with grid fins and touches down on legs that deploy at the last moment.',
  ]

  for (const [i, body] of transcript.entries()) {
    createItem({ title: `Falcon 9 talk — ${i + 1}`, body, kind: 'transcript', para: 'resources', project: 'Falcon 9 talk' })
  }
  for (const [i, body] of notes.entries()) {
    createItem({ title: `My note ${i + 1}`, body, kind: 'note', para: 'resources', project: null })
  }

  // Queries where BOTH a note and a transcript match — notes should rank first in Ask.
  const queries = ['reusable rocket booster', 'grid fins steering', 'where does the booster land']

  console.log('Ask (sourcesLast = true): notes first')
  for (const q of queries) {
    const { hits } = searchQuery({ text: q, limit: 10, sourcesLast: true })
    const firstTranscript = hits.findIndex((h) => h.kind === 'transcript')
    const firstNote = hits.findIndex((h) => h.kind === 'note')
    assert(firstNote !== -1, `"${q}" matches at least one note`)
    assert(firstNote < firstTranscript, `"${q}" ranks a note before any transcript`)
  }

  console.log('\nMedia chat (sourcesLast = false): transcripts not demoted')
  const { hits: mediaHits } = searchQuery({ text: 'grid fins steering', limit: 10, sourcesLast: false })
  const transcriptRanksByScore = mediaHits.filter((h) => h.kind === 'transcript').length > 0
  assert(transcriptRanksByScore, 'media retrieval still returns transcript chunks')

  console.log('\nNo sourcesLast flag: behavior unchanged (score only)')
  const { hits: plainHits } = searchQuery({ text: 'reusable rocket booster', limit: 10 })
  assert(plainHits.length > 0, 'default search still returns hits')

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
