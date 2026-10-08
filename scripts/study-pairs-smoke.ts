/**
 * Two-way list cards (#273): acronym lists, port tables, command lists and
 * term definitions become forward and reverse cards, with no model.
 *
 *   npm run test:study-pairs
 *
 * Runs under Electron-as-Node against a temp DB. llmGenerate is mocked to
 * count calls: list cards must never need one.
 */
// --- Module._load hook to mock llm MUST BE FIRST ---
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const origLoad = Module._load
let modelCalls = 0
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === './llm' || request.endsWith('/electron/llm')) {
    return {
      llmGenerate: async () => {
        modelCalls++
        return { ok: false, error: 'No local model detected' }
      },
      providerDisplayName: (id: string | null | undefined, label?: string) => label || id || 'AI',
    }
  }
  return origLoad.call(this, request, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs')
const os = require('os') as typeof import('os')
const path = require('path') as typeof import('path')

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

const FIXTURES = path.join(__dirname, 'fixtures', 'study-pairs')
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8')

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — two-way list cards (#273) ===\n')
  const p = require('../electron/study-pairs') as typeof import('../electron/study-pairs')

  // --- Extraction (pure) ---
  console.log('extractPairs on the evaluation notes')
  const expected: Array<[string, number, boolean]> = [
    ['acronyms.md', 40, true],
    ['ports.md', 15, true],
    ['windows-commands.md', 10, true],
    ['cell-structure.md', 11, true],
    ['evolution.md', 0, false],
    ['homeostasis-enzymes.md', 3, false],
    ['messy-pasted-printers.md', 3, false],
  ]
  for (const [file, pairs, listLike] of expected) {
    const ex = p.extractPairs(fixture(file))
    assert(ex.pairs.length === pairs, `${file}: ${ex.pairs.length} pairs (expected ${pairs})`)
    assert(ex.listLike === listLike, `${file}: ${listLike ? 'list-like' : 'under the threshold'} (${Math.round(ex.ratio * 100)}% of ${ex.lines} lines)`)
  }
  const ports = p.extractPairs(fixture('ports.md'))
  assert(ports.pairs.every((x) => x.source === 'table'), 'ports: every pair is a table row ("tricks:" is a label, not a term)')
  assert(
    ports.pairs[12].term === '443' && ports.pairs[12].definition === 'Protocol: HTTPS; TCP/UDP: TCP; What for: secure web',
    'a table row is first cell → the other cells, labelled with the header',
  )
  const cell = p.extractPairs(fixture('cell-structure.md'))
  assert(!cell.pairs.some((x) => /^(project|tags)$/i.test(x.term)), 'frontmatter lines are not pairs')
  assert(cell.proseWords >= p.PROSE_SECTION_MIN_WORDS, `cell structure has prose outside the list (${cell.proseWords} words)`)

  const shapes = p.extractPairs(
    [
      '# Heading: not a pair',
      'TCP - Transmission Control Protocol',
      'Mitosis: cell division that makes two identical cells',
      'Speed of light = about 300,000 km per second',
      'DNS — Domain Name System',
      'See https://example.com/page: a link, not a pair',
      'Example: this is an example, not a term',
      'Tip: remember the order',
      'This term has far too many words in it - so it is not a pair',
      '- **ARP** - Address Resolution Protocol',
    ].join('\n'),
  )
  assert(
    JSON.stringify(shapes.pairs.map((x) => x.term)) === JSON.stringify(['TCP', 'Mitosis', 'Speed of light', 'DNS', 'ARP']),
    `-, :, =, — separators, bullets and bold; headings, URLs, labels and long terms ignored (${shapes.pairs.map((x) => x.term).join(', ')})`,
  )
  assert(shapes.lines === 8, `headings and URL lines are not counted (${shapes.lines})`)
  assert(!p.extractPairs('AES - Advanced Encryption Standard\nDNS - Domain Name System').listLike, 'two pairs are too few to count as a list')
  assert(p.extractPairs('').pairs.length === 0 && p.extractPairs('').ratio === 0, 'an empty note has no pairs')

  console.log('\npairCardSpecs')
  const acronyms = p.extractPairs(fixture('acronyms.md'))
  const aSpecs = p.pairCardSpecs('itm_a', acronyms.pairs)
  assert(aSpecs.length === 80, `40 acronyms → 80 cards, both directions (${aSpecs.length})`)
  assert(aSpecs.slice(0, 40).every((s) => s.direction === 'f') && aSpecs.slice(40).every((s) => s.direction === 'r'), 'forward cards come first, then reverse')
  const aes = aSpecs.filter((s) => s.answer === 'AES' || s.question.includes('AES'))
  assert(aes.some((s) => s.question === 'What does AES stand for?' && s.answer === 'Advanced Encryption Standard'), 'AES → Advanced Encryption Standard')
  assert(aes.some((s) => s.question === 'What is the acronym for Advanced Encryption Standard?' && s.answer === 'AES'), 'Advanced Encryption Standard → AES')
  assert(aSpecs[0].quote === 'AES - Advanced Encryption Standard', 'the quote is the source line')
  assert(new Set(aSpecs.map((s) => s.key)).size === 80, 'every card has its own key')
  const pSpecs = p.pairCardSpecs('itm_p', ports.pairs)
  assert(pSpecs.length === 30, `15 ports → 30 cards (${pSpecs.length})`)
  assert(pSpecs.some((s) => s.question === 'Port 443 → ?' && s.answer.includes('HTTPS')), 'Port 443 → ?')
  assert(pSpecs.some((s) => s.question === 'HTTPS uses which port?' && s.answer === '443'), 'HTTPS uses which port? → 443')
  const cSpecs = p.pairCardSpecs('itm_c', cell.pairs)
  assert(cSpecs.some((s) => s.question === 'Nucleus → ?'), 'a term card asks "Nucleus → ?"')
  assert(!cSpecs.some((s) => s.direction === 'r' && s.answer === 'Vacuole'), 'no reverse card when the definition gives the term away (vacuole)')
  const dupBack = p.pairCardSpecs(
    'itm_d',
    p.extractPairs('| Port | Transport |\n|---|---|\n| 22 | TCP |\n| 53 | TCP/UDP |\n| 80 | TCP |').pairs,
  )
  assert(dupBack.filter((s) => s.direction === 'r').map((s) => s.answer).join() === '53', 'no reverse card when two rows share the back (TCP)')
  assert(dupBack.some((s) => s.question === 'Which port goes with Transport “TCP/UDP”?') === false, 'port tables use "uses which port?"')
  const generic = p.pairCardSpecs('itm_g', p.extractPairs('| Term | Meaning |\n|---|---|\n| Osmosis | water across a membrane |\n| Diffusion | high to low |\n| Active transport | uses ATP |').pairs)
  assert(generic.some((s) => s.question === 'Which term goes with Meaning “uses ATP”?' && s.answer === 'Active transport'), 'other tables name the column in the reverse question')
  const dupTerm = p.pairCardSpecs('itm_t', p.extractPairs('RAM - memory\nROM - read-only memory\nRAM - random access memory').pairs)
  assert(new Set(dupTerm.map((s) => s.key)).size === dupTerm.length, 'a repeated term gets its own key')
  assert(p.isAcronymPair('NVMe', 'Non-Volatile Memory Express') && p.isAcronymPair('PoE', 'Power over Ethernet') && p.isAcronymPair('BIOS', 'Basic Input/Output System') && !p.isAcronymPair('Nucleus', 'holds DNA') && !p.isAcronymPair('DISM', 'repair Windows image'), 'acronym detection')

  // --- Database ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-273-'))
  const db = require('../electron/db') as typeof import('../electron/db')
  const cards = require('../electron/study-cards') as typeof import('../electron/study-cards')
  const review = require('../electron/review') as typeof import('../electron/review')
  const session = require('../electron/study-session') as typeof import('../electron/study-session')
  db.initDb(path.join(tmp, 'test.sqlite'))
  const note = (title: string, body: string, extra: Record<string, unknown> = {}) =>
    db.createItem({ title, body, kind: 'note', para: 'resources', project: 'A+', ...extra })

  console.log('\nenrolling a list note')
  const acr = note('A+ acronym list', fixture('acronyms.md'))
  const enrolled = review.enqueueReview(acr.id)
  assert(enrolled.created === 80 && enrolled.pairCards === 80, `the acronym list enrolls as 80 list cards (${enrolled.created}, ${enrolled.pairCards})`)
  const list = cards.listCardsForItem(acr.id)
  assert(list.every((c) => c.origin === 'reverse' && c.chunkIndex == null), 'all are list cards (origin reverse); no section card for a pure list')
  const row = db.getDb().prepare(`SELECT q_kind, question, answer, quote FROM study_cards WHERE item_id = ? AND question = ?`).get(acr.id, 'What does DNS stand for?') as
    | { q_kind: string; answer: string; quote: string }
    | undefined
  assert(row?.q_kind === 'pair' && row.answer === 'Domain Name System' && row.quote === 'DNS - Domain Name System', 'a card stores its question, answer, quote and q_kind pair')
  assert(review.enqueueReview(acr.id).alreadyEnrolled, 'enrolling again adds nothing')
  assert(cards.listCardsForItem(acr.id).length === 80, 'still 80 cards')

  const q = await session.getCardQuestion(list[0].id)
  assert(q.kind === 'pair' && q.question === 'What does AES stand for?' && q.answer === 'Advanced Encryption Standard', 'the session asks the stored question')
  assert(q.quote === 'AES - Advanced Encryption Standard' && q.citations.some((c) => c.id === acr.id), 'with the source line as the quote and the note cited')
  const qr = await session.getCardQuestion(list[40].id)
  assert(qr.question === 'What is the acronym for Advanced Encryption Standard?' && qr.answer === 'AES', 'the reverse card asks the other way')
  assert(modelCalls === 0, 'no model call for list cards (works offline)')

  const due = review.listDueReviews(undefined, 200, 'A+').filter((d) => d.id === acr.id)
  assert(due.length === review.NEW_CARDS_PER_DAY_MAX, `today's new-card budget applies (${due.length})`)
  const forwardQs = new Set(list.slice(0, 40).map((c) => c.question))
  assert(list.slice(0, 40).every((c) => c.sourceKey.endsWith(':f')) && due.every((d) => forwardQs.has(d.question ?? '')), 'forward cards are studied before reverse ones')

  console.log('\ngrading and editing')
  const aesCard = list[0]
  const dnsCard = list.find((c) => c.question === 'What does DNS stand for?')!
  const ftpCard = list.find((c) => c.question === 'What does FTP stand for?')!
  const ftpReverse = list.find((c) => c.answer === 'FTP')!
  review.rateReview(aesCard.id, 'good')
  review.rateReview(dnsCard.id, 'again')
  review.rateReview(ftpCard.id, 'hard')
  const aesBefore = review.getCardState(aesCard.id)!
  const dnsBefore = review.getCardState(dnsCard.id)!
  const edited = fixture('acronyms.md')
    .replace('DNS - Domain Name System', 'DNS - Domain Name System (names to IP addresses)')
    .replace('FTP - File Transfer Protocol\n', '')
    .concat('\nZIF - Zero Insertion Force\n')
  db.updateItem(acr.id, { body: edited })
  const after = cards.listCardsForItem(acr.id)
  const stateAes = review.getCardState(aesCard.id)!
  assert(stateAes.reps === aesBefore.reps && stateAes.dueAt === aesBefore.dueAt, 'an unchanged pair keeps its schedule')
  const dnsAfter = after.find((c) => c.id === dnsCard.id)!
  assert(dnsAfter.answer === 'Domain Name System (names to IP addresses)' && dnsAfter.status === 'active', 'an edited definition updates the card in place')
  const dnsState = review.getCardState(dnsCard.id)!
  assert(dnsState.lapses === dnsBefore.lapses && dnsState.dueAt === dnsBefore.dueAt, '… and keeps its schedule')
  assert(after.find((c) => c.id === ftpCard.id)?.status === 'retired' && after.find((c) => c.id === ftpReverse.id)?.status === 'retired', 'a removed line retires both its cards')
  assert(review.listReviewLog(ftpCard.id).length === 1, '… and keeps their grade history')
  assert(after.filter((c) => c.status === 'active' && /ZIF|Zero Insertion/.test(`${c.question} ${c.answer}`)).length === 2, 'a new line adds two cards')
  assert(after.filter((c) => c.status === 'active').length === 80, `40 pairs → 80 live cards again (${after.filter((c) => c.status === 'active').length})`)
  db.updateItem(acr.id, { body: edited + '\nFTP - File Transfer Protocol\n' })
  assert(cards.listCardsForItem(acr.id).find((c) => c.id === ftpCard.id)?.status === 'active', 'putting a line back revives its card and history')
  const ftpState = review.getCardState(ftpCard.id)
  assert(ftpState?.reps === 1 && ftpState.ease < 2.5, '… with its schedule')

  console.log('\nnotes that are not lists, and the opt-out')
  const evo = note('Evolution', fixture('evolution.md'), { project: 'Bio' })
  const evoRes = review.enqueueReview(evo.id)
  assert(evoRes.pairCards === 0 && evoRes.created >= 1, 'a prose note gets section cards, no list cards')
  assert(cards.listCardsForItem(evo.id).every((c) => c.origin === 'note'), '… all origin note')
  const cellNote = note('Cell structure', fixture('cell-structure.md'), { project: 'Bio' })
  const cellRes = cards.createNoteCards(cellNote.id)
  const cellCards = cards.listCardsForItem(cellNote.id)
  assert(cellRes.pairCards === 21 && cellCards.some((c) => c.origin === 'note'), `a list with real prose gets list cards (${cellRes.pairCards}) and a section card`)
  const cmds = note('windows cmds', fixture('windows-commands.md'))
  const off = review.enqueueReview(cmds.id, { pairs: false })
  assert(off.pairCards === 0 && cards.listCardsForItem(cmds.id).every((c) => c.origin === 'note'), 'pairs: false → section cards only')

  console.log('\nStudy this project')
  const portsNote = note('Ports to memorize', fixture('ports.md'))
  const messy = note('messy printers', fixture('messy-pasted-printers.md'))
  db.createItem({ title: 'Video part 1', body: fixture('acronyms.md'), kind: 'transcript', para: 'resources', project: 'A+' })
  const offProject = cards.enrollProject('A+', { pairs: false })
  assert(offProject.pairCards === 0 && offProject.pairNotes === 0, 'Study this project with list cards off makes none')
  assert(cards.listCardsForItem(portsNote.id).every((c) => c.origin === 'note'), '… the ports table got a section card')
  const upgrade = cards.enrollProject('A+')
  assert(upgrade.pairNotes === 2 && upgrade.pairCards === 50, `running it again with list cards on adds them to enrolled lists (${upgrade.pairNotes} lists, ${upgrade.pairCards} cards: ports 30 + commands 20)`)
  assert(cards.listCardsForItem(portsNote.id).some((c) => c.question === 'HTTPS uses which port?'), '… including "HTTPS uses which port?"')
  assert(cards.listCardsForItem(messy.id).every((c) => c.origin === 'note'), 'a messy pasted page stays on section cards')
  assert(upgrade.skipped.some((s) => s.title === 'Video part 1'), 'transcripts are still skipped')
  const again = cards.enrollProject('A+')
  assert(again.pairCards === 0 && again.cards === 0, 'a third run adds nothing')

  console.log('\na list that becomes prose')
  const small = note('Shortlist', 'RAM - Random Access Memory\nROM - Read Only Memory\nCPU - Central Processing Unit\n')
  assert(review.enqueueReview(small.id).pairCards === 6, 'three acronyms → six cards')
  db.updateItem(small.id, { body: 'Memory keeps data while the computer runs, and storage keeps it after power is off. The processor runs instructions one after another very quickly.' })
  const smallCards = cards.listCardsForItem(small.id)
  assert(smallCards.filter((c) => c.origin === 'reverse').every((c) => c.status === 'retired'), 'its list cards are retired')
  assert(smallCards.some((c) => c.origin === 'note' && c.status === 'active'), 'and it gets a section card so it stays in Study')
  const res = p.syncPairCards(evo.id)
  assert(res.kept + res.updated + res.added + res.retired === 0, 'syncPairCards leaves notes without list cards alone')

  db.closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
