/**
 * #215 — Study mode: recall-before-reveal attempts and calibration.
 *
 *   npm run test:study
 *
 * Runs under Electron-as-Node with a temp DB. Pure helpers are checked without
 * a model; DB tests cover confidence clamping, field caps and newest-first
 * ordering.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  gradeScore,
  calibrationSummary,
  recordStudyAttempt,
  listRecentAttempts,
  studyCalibration,
} from '../electron/study'
import { parseQuestions, listEligibleChunks, sampleStudyPassages, MAX_SOURCE_NOTES } from '../electron/study-questions'
import { initDb, closeDb, createItem } from '../electron/db'
import type { StudyAttempt, StudySelfGrade } from '../electron/types'

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

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}

function attempt(overrides: Partial<StudyAttempt>): StudyAttempt {
  return {
    id: 'att_x',
    question: 'q',
    attempt: '',
    confidence: 0,
    self_grade: 'missed' as StudySelfGrade,
    self_explanation: null,
    cited_ids: '',
    answer: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

async function main(): Promise<void> {
  console.log('\n=== Local Knowledge Vault — Study mode (#215) ===\n')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lkv-215-'))
  initDb(path.join(tmp, 'test.sqlite'))

  // --- gradeScore ---
  console.log('gradeScore')
  assert(gradeScore('missed') === 0, 'missed scores 0')
  assert(gradeScore('partial') === 0.5, 'partial scores 0.5')
  assert(gradeScore('got') === 1, 'got scores 1')

  // --- parseQuestions (pure, no model) ---
  console.log('\nparseQuestions')
  const questions = parseQuestions(
    [
      '1. What is PARA?',
      '2) Why does spacing beat cramming?',
      '- What is an Area?',
      '* What is a Resource?',
      'Q3: What is a Project?',
      '',
    ].join('\n'),
  )
  assert(questions.length === 5, `parseQuestions returns five questions (got ${questions.length})`)
  assert(questions[0] === 'What is PARA?', 'numbered list markers are stripped')
  assert(questions[1] === 'Why does spacing beat cramming?', 'parenthesised number markers are stripped')
  assert(questions[2] === 'What is an Area?', 'dash bullets are stripped')
  assert(questions[3] === 'What is a Resource?', 'star bullets are stripped')
  assert(questions[4] === 'What is a Project?', 'Q3: prefixes are stripped')

  // --- #271: sample questions draw from every kind, spread across the scope ---
  console.log('\n#271 sample-question sources')
  const book = createItem({ title: 'Book page', body: 'Photosynthesis turns light into chemical energy.', kind: 'book', para: 'resources', project: 'Biology' })
  const article = createItem({ title: 'Web article', body: 'The mitochondria is the powerhouse of the cell.', kind: 'article', para: 'resources', project: 'Biology' })
  const plain = createItem({ title: 'Plain note', body: 'PARA is Projects, Areas, Resources, Archives.', kind: 'note', para: 'resources', project: 'Biology' })

  const bioChunks = listEligibleChunks('Biology')
  assert(
    bioChunks.some((c) => c.itemId === book.id) &&
      bioChunks.some((c) => c.itemId === article.id) &&
      bioChunks.some((c) => c.itemId === plain.id),
    'eligible chunks include book, article and note kinds',
  )
  assert(listEligibleChunks('Biology').length >= 3, 'a book/article-only project yields eligible chunks')

  // sampleStudyPassages returns one passage per distinct note.
  const crafted = [
    ...Array.from({ length: 7 }, (_, i) => ({ itemId: `a-${i}`, title: 'Alpha', body: `Alpha ${i}` })),
    ...Array.from({ length: 7 }, (_, i) => ({ itemId: `b-${i}`, title: 'Beta', body: `Beta ${i}` })),
  ]
  const spread = sampleStudyPassages(crafted, MAX_SOURCE_NOTES)
  assert(spread.length === MAX_SOURCE_NOTES, 'sampleStudyPassages honors maxNotes')
  assert(new Set(spread.map((p) => p.itemId)).size === spread.length, 'sampleStudyPassages draws distinct notes')
  assert(
    spread.some((p) => p.itemId.startsWith('a-')) && spread.some((p) => p.itemId.startsWith('b-')),
    'a 12-of-14 sample necessarily spans both groups',
  )

  // --- calibrationSummary: empty ---
  console.log('\ncalibrationSummary — empty')
  const empty = calibrationSummary([])
  assert(empty.count === 0, 'empty count is 0')
  assert(
    empty.meanConfidence === 0 && empty.meanScore === 0 && empty.bias === 0 && empty.brier === 0,
    'empty summary is all zeros',
  )

  // --- calibrationSummary: known set ---
  console.log('\ncalibrationSummary — known set')
  const known = calibrationSummary([
    attempt({ confidence: 80, self_grade: 'got' }),
    attempt({ confidence: 40, self_grade: 'missed' }),
  ])
  assert(known.count === 2, 'count is 2')
  assert(approx(known.meanConfidence, 0.6), `mean confidence is 0.6 (got ${known.meanConfidence})`)
  assert(approx(known.meanScore, 0.5), `mean score is 0.5 (got ${known.meanScore})`)
  assert(approx(known.bias, 0.1), `bias is 0.1 (got ${known.bias})`)
  assert(approx(known.brier, 0.1), `brier is 0.1 (got ${known.brier})`)

  const overconfident = calibrationSummary([
    attempt({ confidence: 100, self_grade: 'missed' }),
    attempt({ confidence: 100, self_grade: 'partial' }),
  ])
  assert(approx(overconfident.bias, 0.75), 'bias positive when confidence exceeds accuracy')

  // --- recordStudyAttempt: clamp + cap + join ---
  console.log('\nrecordStudyAttempt')
  const high = recordStudyAttempt({
    question: 'What is PARA?',
    attempt: 'Projects, Areas, Resources, Archives',
    confidence: 150,
    selfGrade: 'got',
    selfExplanation: 'Four groups for notes',
    citedIds: ['itm_a', 'itm_b'],
    answer: 'PARA answer [itm_a]',
  })
  assert(high.id.startsWith('att_'), 'attempt id uses att_ prefix')
  assert(high.confidence === 100, 'confidence above 100 clamps to 100')
  assert(high.cited_ids === 'itm_a,itm_b', 'citedIds are joined with commas')
  assert(high.self_grade === 'got', 'self_grade is stored')

  const low = recordStudyAttempt({ question: 'q', confidence: -20, selfGrade: 'missed' })
  assert(low.confidence === 0, 'confidence below 0 clamps to 0')
  assert(low.attempt === '', 'missing attempt defaults to empty string')
  assert(low.self_explanation === null, 'missing self-explanation is null')
  assert(low.answer === null, 'missing answer is null')

  const long = 'x'.repeat(5000)
  const capped = recordStudyAttempt({
    question: long,
    attempt: long,
    confidence: 12.6,
    selfGrade: 'partial',
    selfExplanation: long,
    answer: long,
  })
  assert(capped.question.length === 4000, 'question is capped at 4000 chars')
  assert(capped.attempt.length === 4000, 'attempt is capped at 4000 chars')
  assert(capped.self_explanation?.length === 4000, 'self-explanation is capped at 4000 chars')
  assert(capped.answer?.length === 4000, 'answer is capped at 4000 chars')
  assert(capped.confidence === 13, 'fractional confidence rounds to an integer')

  // --- listRecentAttempts: newest first ---
  console.log('\nlistRecentAttempts')
  const before = listRecentAttempts().length
  const first = recordStudyAttempt({ question: 'first', selfGrade: 'missed' })
  const second = recordStudyAttempt({ question: 'second', selfGrade: 'got' })
  const third = recordStudyAttempt({ question: 'third', selfGrade: 'partial' })
  const recent = listRecentAttempts(2)
  assert(recent.length === 2, 'limit is honored')
  assert(recent[0].id === third.id, 'newest attempt is first')
  assert(recent[1].id === second.id, 'second-newest is next')
  const all = listRecentAttempts(500)
  assert(all.length === before + 3, 'all inserted attempts are returned')
  assert(all[0].id === third.id && all[1].id === second.id && all[2].id === first.id, 'full list is newest first')

  // --- studyCalibration matches the pure summary ---
  console.log('\nstudyCalibration')
  const cal = studyCalibration()
  const expected = calibrationSummary(listRecentAttempts(500))
  assert(cal.count === expected.count, 'studyCalibration count matches listRecentAttempts')
  assert(approx(cal.meanConfidence, expected.meanConfidence), 'mean confidence matches')
  assert(approx(cal.meanScore, expected.meanScore), 'mean score matches')
  assert(approx(cal.bias, expected.bias), 'bias matches')
  assert(approx(cal.brier, expected.brier), 'brier matches')

  closeDb()
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
