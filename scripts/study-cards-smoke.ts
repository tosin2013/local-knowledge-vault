/**
 * Study cards after a note edit (#286), plus later card sources.
 *
 *   npm run test:study-cards
 *
 * Runs under Electron-as-Node against a temp DB. The section planner is pure;
 * the DB checks edit enrolled notes through `updateItem` and look at what
 * happened to their cards, schedules and review history.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDb, closeDb, createItem, updateItem, getDb } from '../electron/db'
import {
  cardUnitsForNote,
  createNoteCards,
  listCardsForItem,
  planSectionSync,
  sectionSimilarity,
  syncNoteCards,
  SECTION_SIMILARITY_MIN,
  type SectionCard,
} from '../electron/study-cards'
import { getStudyStats, listDueReviews, listReviewLog, rateReview, getCardState } from '../electron/review'
import { hashText } from '../electron/text-hash'

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

/** Distinct study sentences per topic, so different sections don't look alike. */
const TOPICS: Record<string, string[]> = {
  photosynthesis: ['Chloroplasts capture light', 'Chlorophyll absorbs red and blue wavelengths', 'Thylakoid membranes host photosystems', 'Water splitting releases oxygen gas', 'The Calvin cycle fixes carbon dioxide', 'RuBisCO catalyses carboxylation', 'Stroma enzymes build glucose', 'NADPH carries reducing power', 'Stomata regulate gas exchange'],
  respiration: ['Glycolysis splits glucose in cytoplasm', 'Pyruvate enters mitochondria', 'Krebs cycle releases carbon dioxide', 'Electron transport pumps protons', 'Oxygen accepts electrons finally', 'ATP synthase spins rotor', 'Fermentation regenerates NAD', 'Lactate accumulates during sprinting', 'Yeast produces ethanol anaerobically'],
  transcription: ['RNA polymerase binds promoters', 'Template strands guide pairing', 'Uracil replaces thymine', 'Introns get spliced out', 'Exons join into mature mRNA', 'Caps protect transcripts', 'PolyA tails aid export', 'Enhancers boost expression', 'Repressors block initiation'],
  translation: ['Ribosomes read codons', 'Transfer RNA delivers amino acids', 'Anticodons pair with codons', 'AUG starts every protein', 'Stop codons terminate synthesis', 'Peptide bonds link residues', 'Polysomes multiply output', 'Signal peptides target membranes', 'Chaperones assist folding'],
  meiosis: ['Homologous chromosomes pair up', 'Crossing over swaps segments', 'Chiasmata hold tetrads', 'Anaphase one separates homologs', 'Gametes become haploid', 'Independent assortment shuffles alleles', 'Nondisjunction causes aneuploidy', 'Spermatogenesis yields four sperm', 'Oogenesis yields one egg'],
  atp: ['Adenosine triphosphate stores energy', 'Phosphate bonds release energy', 'Cells recycle ADP constantly'],
  nadh: ['NADH donates electrons', 'Dehydrogenases reduce NAD', 'Complex one oxidises NADH', 'Each NADH yields roughly three ATP', 'Shuttles move reducing equivalents', 'Malate aspartate shuttle operates in liver', 'Glycerol phosphate shuttle operates in muscle', 'Ratios signal energy status', 'Sirtuins sense NAD levels'],
  fadh: ['FADH2 enters at complex two', 'Succinate dehydrogenase makes FADH2', 'Flavoproteins bind FAD tightly', 'Fewer protons get pumped', 'Beta oxidation produces FADH2', 'Riboflavin is the vitamin precursor', 'Ubiquinone collects electrons', 'Iron sulfur clusters relay charge', 'Yield is about two ATP'],
  plain: ['Plain notes are not enrolled', 'Editing them makes no cards', 'Nothing should happen here', 'Still plain text', 'Another plain sentence', 'More plain words', 'Plainness continues', 'Very plain', 'The end of plainness'],
}

/** A paragraph of `n` sentences about one topic. */
function para(topic: string, n = 9): string {
  return TOPICS[topic]
    .slice(0, n)
    .map((s, i) => `${s}, which matters for ${topic} detail ${i + 1} on the exam and in real lab work.`)
    .join(' ')
}

function active(itemId: string) {
  return listCardsForItem(itemId).filter((c) => c.status === 'active')
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — study cards after an edit (#286) ===\n')

  // --- Pure helpers ---
  console.log('sectionSimilarity')
  assert(sectionSimilarity('the cell wall is rigid', 'the cell wall is rigid') === 1, 'same text → 1')
  assert(sectionSimilarity('alpha beta gamma', 'delta epsilon zeta') === 0, 'no shared words → 0')
  assert(sectionSimilarity('', '') === 1, 'two empty texts → 1')
  const typo = sectionSimilarity(para('respiration'), para('respiration').replace('sprinting', 'running'))
  assert(typo > 0.9, `a one-word edit stays very similar (${typo.toFixed(2)})`)

  console.log('\nplanSectionSync')
  const units = [
    { chunkIndex: 0, text: 'A unchanged section about mitochondria and ATP.' },
    { chunkIndex: 1, text: 'B section about ribosomes making proteins, edited slightly here.' },
    { chunkIndex: 2, text: 'C brand new section on lysosomes and digestion enzymes.' },
  ]
  const cards: SectionCard[] = [
    { cardId: 'a', chunkIndex: 1, hash: hashText(units[0].text), status: 'active', textBefore: units[0].text },
    {
      cardId: 'b',
      chunkIndex: 2,
      hash: 'old-b',
      status: 'active',
      textBefore: 'B section about ribosomes making proteins.',
    },
    { cardId: 'gone', chunkIndex: 0, hash: 'old-g', status: 'active', textBefore: 'Golgi apparatus packages vesicles.' },
    { cardId: 'old', chunkIndex: 5, hash: 'x', status: 'retired', textBefore: null },
  ]
  const plan = planSectionSync(cards, units)
  assert(plan.keep.length === 1 && plan.keep[0].cardId === 'a' && plan.keep[0].chunkIndex === 0, 'same hash → kept, index moves to 0')
  assert(plan.edit.length === 1 && plan.edit[0].cardId === 'b' && plan.edit[0].chunkIndex === 1, 'similar text → same card, edited')
  assert(plan.add.length === 1 && plan.add[0].chunkIndex === 2, 'unmatched section → new card')
  assert(plan.retire.length === 1 && plan.retire[0] === 'gone', 'a removed live section is retired; already-retired cards are left')
  const revive = planSectionSync([{ cardId: 'r', chunkIndex: null, hash: hashText('x y z'), status: 'retired', textBefore: null }], [
    { chunkIndex: null, text: 'x y z' },
  ])
  assert(revive.keep.length === 1 && revive.keep[0].cardId === 'r', 'a retired card whose text comes back is revived')
  const unknownBefore = planSectionSync([{ cardId: 'u', chunkIndex: 3, hash: 'h', status: 'active', textBefore: null }], [
    { chunkIndex: 0, text: 'totally new' },
  ])
  assert(unknownBefore.add.length === 1 && unknownBefore.retire[0] === 'u', 'no old text → cannot be matched as edited')
  assert(SECTION_SIMILARITY_MIN === 0.5, 'edited-section threshold is 0.5')

  // --- DB ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-286-'))
  initDb(path.join(tmp, 'test.sqlite'))

  console.log('\nlong note: unchanged sections keep schedule and history')
  const sections = ['photosynthesis', 'respiration', 'transcription', 'translation']
  const body = sections.map((t) => para(t)).join('\n\n')
  const note = createItem({ title: 'Cell biology', body, kind: 'note', para: 'resources', project: 'Bio' })
  const { created } = createNoteCards(note.id)
  assert(created.length >= 4, `long note enrolls as chunk cards (${created.length})`)
  const first = created[0]
  const last = created[created.length - 1]
  rateReview(first.id, 'good')
  rateReview(last.id, 'again')
  const firstState = getCardState(first.id)
  const lastLog = listReviewLog(last.id)

  // Rewrite only the last topic completely.
  const edited = sections.slice(0, 3).map((t) => para(t)).join('\n\n') + '\n\n' + para('meiosis')
  updateItem(note.id, { body: edited })
  const after = listCardsForItem(note.id)
  const firstAfter = after.find((c) => c.id === first.id)!
  assert(firstAfter.status === 'active', 'the unchanged first section keeps its card')
  assert(JSON.stringify(getCardState(first.id)) === JSON.stringify(firstState), 'and its schedule')
  assert(listReviewLog(first.id).length === 1, 'and its grade history')
  const lastAfter = after.find((c) => c.id === last.id)!
  assert(lastAfter.status === 'retired', 'the rewritten section’s old card is retired')
  assert(listReviewLog(last.id).length === lastLog.length, 'the retired card keeps its history')
  assert(active(note.id).some((c) => !created.some((o) => o.id === c.id)), 'the new section has a new card')
  assert(!listDueReviews(undefined, 100, 'Bio').some((q) => q.card_id === last.id), 'retired cards are out of the queue')
  const stats = getStudyStats('Bio')
  assert(stats.totalCards === active(note.id).length, 'stats count active cards only')

  console.log('\nshifted chunk boundaries keep their schedules')
  const beforeShift = active(note.id)
  for (const c of beforeShift) rateReview(c.id, 'good')
  const shiftedBody = 'One new opening sentence about the topic.\n\n' + edited
  updateItem(note.id, { body: shiftedBody })
  const afterShift = active(note.id)
  const survivors = beforeShift.filter((c) => afterShift.some((a) => a.id === c.id))
  assert(survivors.length === beforeShift.length, `every section survives a shifting insert (${survivors.length}/${beforeShift.length})`)
  assert(
    survivors.every((c) => (getCardState(c.id)?.reps ?? 0) >= 1),
    'and keeps its reps (no schedule reset)',
  )
  const units2 = cardUnitsForNote(shiftedBody, (getDb().prepare('SELECT body FROM note_chunks WHERE item_id = ? ORDER BY chunk_index').all(note.id) as { body: string }[]).map((r) => r.body))
  assert(
    afterShift.every((c) => units2.some((u) => u.chunkIndex === c.chunkIndex && hashText(u.text) === c.chunkHash)),
    'every active card now points at its current section and hash',
  )
  const editedCard = getDb()
    .prepare(`SELECT question FROM study_cards WHERE item_id = ? AND status = 'active' AND question IS NOT NULL`)
    .all(note.id)
  assert(editedCard.length === 0, 'edited sections have no stale question')

  console.log('\nshort note growing into chunks, and an edit that empties it')
  const short = createItem({ title: 'ATP', body: para('atp', 3), kind: 'note', para: 'resources', project: 'Bio' })
  const [whole] = createNoteCards(short.id).created
  rateReview(whole.id, 'good')
  updateItem(short.id, { body: para('atp', 3) + '\n\n' + para('nadh') + '\n\n' + para('fadh') })
  const grown = active(short.id)
  assert(grown.length >= 2, `the note now has a card per section (${grown.length})`)
  assert(grown.some((c) => c.id === whole.id && c.chunkIndex === 0), 'the whole-note card carries on as the matching first section')
  assert((getCardState(whole.id)?.reps ?? 0) === 1, 'with its schedule')
  updateItem(short.id, { body: '' })
  assert(active(short.id).length === 0, 'emptying the note retires every card')
  assert(listCardsForItem(short.id).length === grown.length, 'nothing is deleted')
  const grownBody = para('atp', 3) + '\n\n' + para('nadh') + '\n\n' + para('fadh')
  updateItem(short.id, { body: grownBody })
  assert(
    grown.every((g) => active(short.id).some((c) => c.id === g.id)),
    'putting the same text back revives the matching cards',
  )

  console.log('\nnotes that are not in Study, and title-only edits')
  const plain = createItem({ title: 'Plain', body: para('plain'), kind: 'note', para: 'resources' })
  updateItem(plain.id, { body: para('plain') + ' More.' })
  assert(listCardsForItem(plain.id).length === 0, 'an un-enrolled note gets no cards from an edit')
  const res = syncNoteCards(plain.id, { body: '', chunks: [] })
  assert(res.kept + res.edited + res.added + res.retired === 0, 'syncNoteCards is a no-op for an un-enrolled note')
  const beforeTitle = JSON.stringify(listCardsForItem(note.id))
  updateItem(note.id, { title: 'Renamed' })
  updateItem(note.id, { body: shiftedBody })
  assert(JSON.stringify(listCardsForItem(note.id)) === beforeTitle, 'a title edit or same-body save changes no card')

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main()
