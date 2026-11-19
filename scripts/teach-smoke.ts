/**
 * Offline smoke for Teach mode (#418): planning (model and no-model), grounded
 * checks with hint-first feedback, and missed concepts into Study. The model is
 * a stub; nothing leaves the machine.
 *
 *   npm run test:teach
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-teach-'))
process.env.LKV_USER_DATA_DIR = tmp
process.env.LKV_OLLAMA_URL = 'http://127.0.0.1:9'
process.env.LKV_LMSTUDIO_URL = 'http://127.0.0.1:9/v1'

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

const BODY =
  '# Light reactions\nThe light reactions happen in the thylakoid membranes. They split water, release oxygen, and make ATP and NADPH.\n\n' +
  '# Calvin cycle\nThe Calvin cycle runs in the stroma. It uses ATP and NADPH to fix carbon dioxide into sugar. For example, RuBisCO fixes carbon dioxide.\n\n# Tiny\nToo short.'

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Teach mode (#418) ===\n')
  const db = require('../electron/db') as typeof import('../electron/db')
  const t = require('../electron/teach') as typeof import('../electron/teach')
  db.initDb(path.join(tmp, 'test.sqlite'))
  const note = db.createItem({ title: 'Photosynthesis', body: BODY, kind: 'note', para: 'resources', project: 'Bio' })
  const other = db.createItem({ title: 'Cells', body: 'Mitochondria make most of the ATP a cell uses, through cellular respiration.', kind: 'note', para: 'resources', project: 'Bio' })
  db.createItem({ title: 'Empty', body: '   ', kind: 'note', para: 'resources', project: 'Empty' })

  console.log('Pure helpers')
  assert(Array.isArray(t.parseJsonReply('```json\n[{"a":1}]\n```')) && (t.parseJsonReply('ok {"verdict":"right"} done') as { verdict: string }).verdict === 'right', 'reads JSON arrays and objects')
  assert(t.parseJsonReply('[not json') === null && t.parseJsonReply('no json') === null && t.parseJsonReply('{bad}') === null, 'bad JSON → null')
  assert(t.keepAllowedCitations('A [itm_ok] B [itm_bad].', new Set(['itm_ok'])) === 'A [itm_ok] B.', 'drops citations that were not given')
  assert(t.verifiedQuote('the Calvin cycle runs in the stroma', BODY) !== null && t.verifiedQuote('made up words', BODY) === null && t.verifiedQuote(' ', BODY) === null, 'keeps only real quotes')
  const secs = t.noteSections(BODY)
  assert(secs.length === 3 && secs[0].heading === 'Light reactions' && secs[1].heading === 'Calvin cycle', 'splits a note at headings')
  assert(t.noteSections('One para here.\n\nTwo para here.').length === 2 && t.noteSections('').length === 0, 'splits plain paragraphs')
  assert(t.overlapVerdict('in the stroma', 'the stroma') === 'right' && t.overlapVerdict('stroma and membranes and more', 'thylakoid stroma membranes oxygen sugar') === 'partial' && t.overlapVerdict('no clue', 'stroma') === 'wrong', 'overlap verdicts')
  assert(t.overlapVerdict('x', 'the of') === 'partial', 'an answer of stopwords is partial')
  assert(/3 words and starts with “A”/.test(t.answerShapeHint({ answer: 'ATP and NADPH [itm_x]', sourceTitle: 'P' })) && /starts with “S”/.test(t.answerShapeHint({ answer: 'stroma', sourceTitle: 'P' })) && /Think about your note “P”\.$/.test(t.answerShapeHint({ answer: ' ', sourceTitle: 'P' })), 'shape hints never give the answer')

  console.log('\nPlanning')
  const modelPlan = JSON.stringify([
    { title: 'Light reactions', explain: `They make ATP and NADPH in the thylakoids [${note.id}] [itm_fake].`, example: '', check: 'What do the light reactions make?', answer: 'ATP and NADPH', quote: 'make ATP and NADPH', id: note.id },
    { title: 'Calvin cycle', explain: `It builds sugar [${note.id}].`, example: `RuBisCO fixes carbon dioxide [${note.id}].`, check: 'Where does it run?', answer: 'the stroma', quote: 'invented quote', id: 'itm_unknown' },
    { title: 'No source', explain: 'x', check: 'y', answer: 'z', id: 'itm_nope' },
    { title: '', explain: 'missing title', check: 'c', answer: 'a', id: note.id },
    'junk',
  ])
  let calls = 0
  const plan = await t.teachPlan({ itemIds: [note.id, 'itm_missing'] }, { generate: async (input) => { calls++; assert(input.prompt.includes(`id=${note.id}`) && /ONLY the numbered passages/.test(input.system ?? ''), 'plan prompt has the passages and the grounding rules'); return { ok: true, text: modelPlan } } })
  assert(calls === 1 && plan.concepts.length === 2 && !plan.notice, 'keeps only concepts grounded in the given notes')
  assert(!plan.concepts[0].explain.includes('itm_fake') && plan.concepts[0].example === null && plan.concepts[0].quote === 'make ATP and NADPH', 'drops fake citations, empty examples are null, real quotes kept')
  assert(plan.concepts[1].sourceId === note.id && plan.concepts[1].quote === null && plan.concepts[1].example?.startsWith('RuBisCO') === true, 'source falls back to a cited id; an invented quote is dropped')
  assert(plan.citations.length === 1 && plan.citations[0].title === 'Photosynthesis', 'plan cites its notes')

  const many = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, explain: 'e', check: 'c', answer: 'a', id: note.id })))
  assert((await t.teachPlan({ itemIds: [note.id] }, { generate: async () => ({ ok: true, text: many }) })).concepts.length === t.MAX_CONCEPTS, 'caps the concept list')

  const proj = await t.teachPlan({ project: 'Bio' }, { generate: async () => ({ ok: true, text: 'Sorry, I cannot.' }) })
  assert(proj.concepts.length >= 3 && /straight from your note/.test(proj.notice ?? '') && !proj.offline, 'an unusable reply falls back to the note’s sections')
  assert(proj.concepts.some((c) => c.sourceId === other.id) && proj.concepts[0].title === 'Light reactions' || proj.concepts.some((c) => c.title === 'Light reactions'), 'fallback uses headings as concept titles')
  const off = await t.teachPlan({ project: 'Bio' })
  assert(off.offline === true && /No AI model answered/.test(off.notice ?? '') && off.concepts.length > 0, 'no model → offline plan from the note')
  assert((await t.teachPlan({ project: 'Empty' })).notFound === true && (await t.teachPlan({})).notFound === true && (await t.teachPlan(undefined)).notFound === true, 'no notes → I couldn’t find that in your notes')
  const shortNote = db.createItem({ title: 'Short', body: 'Too short.', kind: 'note', para: 'resources', project: 'S' })
  const short = await t.teachPlan({ itemIds: [shortNote.id] }, { generate: async () => ({ ok: false, error: 'x' }) })
  assert(short.notFound === true && /too short/.test(short.notice ?? ''), 'too-short notes say so')
  const fb = t.fallbackConcepts([note, { ...other, body: 'Plain words without any strong key term here at all okay.' }])
  assert(fb.every((c) => c.check && c.answer && c.example === null), 'fallback concepts always have a check and an answer')
  assert(t.fallbackConcepts(Array.from({ length: 10 }, () => note)).length === t.MAX_CONCEPTS, 'fallback is capped too')

  console.log('\nChecking answers')
  const concept = plan.concepts[0]
  const ask = (attempt: string, hintsGiven: number, reply: unknown, askWhy = false) =>
    t.teachCheck({ concept, question: concept.check, attempt, hintsGiven, askWhy }, { generate: async () => (reply === null ? { ok: false, error: 'down' } : { ok: true, text: typeof reply === 'string' ? reply : JSON.stringify(reply) }) })
  const right = await ask('ATP and NADPH', 0, { verdict: 'right', right: 'They make ATP and NADPH.', why: 'Why does the Calvin cycle need them?' }, true)
  assert(right.verdict === 'right' && right.say.startsWith('Yes, they make ATP and NADPH.') && right.followUp === 'Why does the Calvin cycle need them?' && !right.retry && !right.missed, 'right → brief yes plus a why question')
  const right2 = await ask('ATP and NADPH', 0, { verdict: 'RIGHT' })
  assert(right2.say === 'Yes, that’s right.' && !right2.followUp, 'right without why → just a confirmation')
  const hint = await ask('sugar', 0, { verdict: 'wrong', hint: 'Think about energy carriers.', reexplain: 'The answer is ATP and NADPH.' })
  assert(hint.retry && !hint.missed && /Here’s a hint: Think about energy carriers\. Try again\./.test(hint.say) && !hint.say.includes('ATP and NADPH'), 'wrong → hint first, no answer')
  const partHint = await ask('ATP', 0, { verdict: 'partial', right: 'ATP is one of them' })
  assert(partHint.retry && /^You’re partly there: ATP is one of them\./.test(partHint.say) && /starts with “A”/.test(partHint.say), 'partial → what was right, then a shape hint')
  const after = await ask('sugar', 1, { verdict: 'wrong', right: '', misconception: 'sugar is what the Calvin cycle makes, not the light reactions', reexplain: `Think of the light reactions as charging batteries [${note.id}] [itm_fake].`, followup: 'Which two molecules carry the energy?' })
  assert(after.missed && !after.retry && /One thing to untangle: sugar is what/.test(after.say) && /charging batteries/.test(after.say) && after.followUp === 'Which two molecules carry the energy?' && !after.say.includes('itm_fake'), 'still wrong after a hint → misconception, re-explanation, follow-up')
  assert(after.citations.length === 1 && after.citations[0].id === note.id, 'feedback citations are validated')
  const partAfter = await ask('ATP', 2, { verdict: 'partial', right: 'ATP, yes' })
  assert(/^You got this part right: ATP, yes\./.test(partAfter.say) && partAfter.followUp === concept.check && partAfter.citations[0].id === note.id, 'partial after a hint keeps what was right and re-asks')
  const offCheck = await ask('ATP and NADPH', 0, null)
  assert(offCheck.offline === true && offCheck.verdict === 'right', 'no model → overlap check')
  const offWrong = await ask('no idea', 1, null)
  assert(offWrong.missed && /Your note says: “make ATP and NADPH”/.test(offWrong.say), 'no model, still wrong → the note’s own words')
  const junk = await ask('ATP and NADPH', 0, 'I think it is fine')
  assert(junk.verdict === 'right' && !junk.offline, 'an unusable grade falls back to overlap')
  const empty = await t.teachCheck({ concept: { ...concept, quote: null }, question: '', attempt: '  ', hintsGiven: 1 })
  assert(empty.verdict === 'wrong' && empty.missed && /They make ATP/.test(empty.say), 'an empty answer is wrong and gets the explanation')
  const gone = await t.teachCheck({ concept: { ...concept, sourceId: 'itm_gone' }, question: '', attempt: 'x', hintsGiven: 0 })
  assert(gone.say === t.NOT_IN_NOTES, 'a concept whose note is gone → I couldn’t find that in your notes')
  assert((await t.teachCheck({ concept: undefined as never, question: '', attempt: '', hintsGiven: 0 })).say === t.NOT_IN_NOTES, 'missing concept is handled')

  console.log('\nMissed concepts → Study')
  const first = t.teachMissed([note.id, note.id, 'itm_missing', 7 as never])
  assert(first.enrolled === 1 && first.cards > 0 && first.madeDue === 0, 'a note without cards is enrolled (cards due now)')
  db.getDb().prepare("UPDATE card_schedule SET due_at = '2999-01-01T00:00:00.000Z' WHERE card_id IN (SELECT id FROM study_cards WHERE item_id = ?)").run(note.id)
  const again = t.teachMissed([note.id])
  const dueNow = db.getDb().prepare("SELECT COUNT(*) AS c FROM card_schedule WHERE due_at <= ? AND card_id IN (SELECT id FROM study_cards WHERE item_id = ?)").get(new Date().toISOString(), note.id) as { c: number }
  assert(again.madeDue === 1 && again.enrolled === 0 && Number(dueNow.c) === again.cards, 'an enrolled note’s cards are made due now')
  assert(t.teachMissed(undefined as never).cards === 0, 'no ids → nothing')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
