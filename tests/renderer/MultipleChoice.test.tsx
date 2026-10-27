import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StudySession, optionLabel } from '../../src/features/study/StudySession'
import { StudyHome } from '../../src/features/study/StudyHome'
import { MultipleChoiceSetting } from '../../src/features/study/MultipleChoiceSetting'
import { RepeatedPicks } from '../../src/features/study/RepeatedPicks'
import { lkvMock, makeCardQuestion, makeReviewItem, makeSessionReport } from './lkv'
import type { StudyCardQuestion } from '../../electron/types'

const CARD = makeReviewItem('itm_test', { title: 'Core 2 · 2026-10-08', origin: 'practice-test' })
const PICK = {
  cardId: 'crd_itm_test',
  itemId: 'itm_test',
  question: 'Which type of attack is this?',
  picked: 'Shoulder surfing',
  answer: 'Tailgating',
  times: 2,
}

function mcQuestion(overrides: Partial<StudyCardQuestion> = {}): StudyCardQuestion {
  return makeCardQuestion('crd_itm_test', {
    origin: 'practice-test',
    kind: 'test',
    question: 'An employee follows another person through a badge-controlled door. Which type of attack is this?',
    answer: 'Tailgating',
    quote: null,
    explanation: 'Tailgating is entering a secure area by following an authorized person.',
    citations: [],
    sourceTest: { itemId: 'itm_test', name: 'Core 2', date: '2026-10-08' },
    mode: 'mc',
    // Shown shuffled: the answer (key C) is now the first option.
    options: [
      { key: 'C', text: 'Tailgating' },
      { key: 'A', text: 'Shoulder surfing' },
      { key: 'B', text: 'Phishing' },
      { key: 'D', text: 'Whaling' },
    ],
    answerKey: 'C',
    whyWrong: { A: 'Shoulder surfing is watching someone’s screen or keyboard.' },
    lastPick: null,
    streak: 0,
    ...overrides,
  })
}

function setup(q: StudyCardQuestion, report = makeSessionReport()) {
  const lkv = lkvMock()
  lkv.review.count.mockResolvedValue(1)
  lkv.study.startSession.mockResolvedValue({ sessionId: 'ses_mc', cards: [CARD] })
  lkv.study.cardQuestion.mockResolvedValue(q)
  lkv.study.sessionSummary.mockResolvedValue(report)
  return lkv
}

async function begin() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
  return screen.findByTestId('session-question')
}

describe('Multiple-choice practice questions (#324)', () => {
  it('labels an option by its letter on this review', () => {
    const q = mcQuestion()
    expect(optionLabel(q, 'A')).toBe('B (Shoulder surfing)')
    expect(optionLabel(q, 'Z')).toBe('Z')
  })

  it('asks with options, grades a wrong pick Missed and says why', async () => {
    const lkv = setup(mcQuestion())
    render(<StudySession project="A+" />)
    await begin()
    const options = screen.getByTestId('mc-options')
    expect(within(options).getAllByRole('button')).toHaveLength(4)
    expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument()
    expect(screen.getByText('Multiple choice')).toBeInTheDocument()
    const check = screen.getByRole('button', { name: 'Check answer' })
    expect(check).toBeDisabled()
    expect(screen.getByText(/Pick an option/)).toBeInTheDocument()

    fireEvent.click(within(options).getByText('B. Shoulder surfing'))
    fireEvent.click(check)
    expect(await screen.findByTestId('mc-result')).toHaveTextContent(
      'You picked B (Shoulder surfing); the answer is A (Tailgating). Graded Missed.',
    )
    expect(screen.getByTestId('mc-why-wrong')).toHaveTextContent('watching someone’s screen')
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next (Missed)' }))
    await waitFor(() =>
      expect(lkv.study.answer).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'crd_itm_test', grade: 'again', mode: 'mc', chosenOption: 'A' }),
      ),
    )
    // The missed card comes back, asked fresh (a new fetch, new shuffle).
    await waitFor(() => expect(lkv.study.cardQuestion).toHaveBeenCalledTimes(2))
  })

  it('shows the last wrong pick on the next review, and offers Got it / guessed for a right pick', async () => {
    const lkv = setup(mcQuestion({ lastPick: { key: 'A', text: 'Shoulder surfing', latest: true } }))
    render(<StudySession project="A+" />)
    await begin()
    fireEvent.click(screen.getByText('A. Tailgating'))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByTestId('mc-last-pick')).toHaveTextContent(
      'Last time you picked B (Shoulder surfing); the answer is A (Tailgating).',
    )
    expect(screen.getByTestId('mc-last-pick')).toHaveTextContent('Why not Shoulder surfing')
    expect(screen.getByTestId('mc-result')).toHaveTextContent('Right: A (Tailgating).')
    expect(screen.getByRole('button', { name: 'Partly: I guessed' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() =>
      expect(lkv.study.answer).toHaveBeenCalledWith(expect.objectContaining({ grade: 'good', mode: 'mc', chosenOption: 'C' })),
    )
  })

  it('says "Earlier" for an older wrong pick, and "I don\'t know" is Missed', async () => {
    const lkv = setup(mcQuestion({ lastPick: { key: 'A', text: 'Shoulder surfing', latest: false } }))
    render(<StudySession project="A+" />)
    await begin()
    fireEvent.click(screen.getByText('A. Tailgating'))
    fireEvent.click(screen.getByRole('button', { name: 'I don\'t know' }))
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByTestId('mc-last-pick')).toHaveTextContent(/^Earlier you picked/)
    expect(screen.getByTestId('mc-result')).toHaveTextContent('You didn’t know; the answer is A (Tailgating).')
    fireEvent.click(screen.getByRole('button', { name: 'Next (Missed)' }))
    await waitFor(() => expect(lkv.study.answer).toHaveBeenCalledWith(expect.objectContaining({ grade: 'again', dontKnow: true })))
    expect(lkv.study.answer.mock.calls[0][0]).not.toHaveProperty('chosenOption')
  })

  it('asks a promoted card from memory and lists repeated picks in the summary', async () => {
    const onOpenNote = vi.fn()
    const lkv = setup(
      mcQuestion({ mode: 'recall', options: undefined, answerKey: undefined, whyWrong: undefined, streak: 2 }),
      makeSessionReport({ repeatedPicks: [PICK] }),
    )
    render(<StudySession project="A+" onOpenNote={onOpenNote} />)
    await begin()
    expect(screen.getByTestId('mc-promoted')).toBeInTheDocument()
    expect(screen.getByText(/answer from memory/)).toBeInTheDocument()
    expect(screen.queryByTestId('mc-options')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'tailgating' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(await screen.findByTestId('session-answer')).toHaveTextContent('Tailgating')
    fireEvent.click(screen.getByRole('button', { name: 'Missed' }))
    await waitFor(() => expect(lkv.study.answer).toHaveBeenCalledWith(expect.objectContaining({ grade: 'again', mode: 'recall' })))
    // Missed → requeued; grade the comeback to finish.
    fireEvent.change(await screen.findByLabelText('Your answer'), { target: { value: 'tailgating' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))
    const picks = await screen.findByTestId('repeated-picks')
    expect(picks).toHaveTextContent('Answers you keep picking (1)')
    expect(picks).toHaveTextContent('“Shoulder surfing” ×2, the answer is “Tailgating”')
    fireEvent.click(within(picks).getByRole('button', { name: /Open the test for/ }))
    expect(onOpenNote).toHaveBeenCalledWith('itm_test')
  })

  it('shows "Answers you keep picking" and the opt-out on Study home', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'A+', count: 3 }])
    lkv.review.stats.mockResolvedValue({
      project: 'A+', examDate: null, due: 1, totalCards: 3, newCards: 0, liveNotes: 3, enrolledNotes: 1,
      lastSession: null, newPerDay: 0, newLeftToday: 0, unreachable: 0, repeatedPicks: [PICK],
    })
    const onOpenNote = vi.fn()
    render(<StudyHome project="A+" onProjectChange={vi.fn()} onStartReview={vi.fn()} onOpenNote={onOpenNote} />)
    expect(await screen.findByTestId('repeated-picks')).toHaveTextContent('Shoulder surfing')
    const toggle = screen.getByRole('switch', { name: 'Ask multiple-choice questions as multiple choice' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(lkv.projects.setMultipleChoice).toHaveBeenCalledWith('A+', false))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('reads the saved setting, hides it for all projects, and rolls back on failure', async () => {
    const lkv = lkvMock()
    lkv.projects.getSettings.mockResolvedValue({ name: 'Bio', examDate: null, multipleChoice: false })
    const { rerender } = render(<MultipleChoiceSetting project="Bio" />)
    const toggle = screen.getByRole('switch', { name: 'Ask multiple-choice questions as multiple choice' })
    await waitFor(() => expect(toggle).not.toBeChecked())
    lkv.projects.setMultipleChoice.mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(toggle)
    await waitFor(() => expect(lkv.projects.setMultipleChoice).toHaveBeenCalledWith('Bio', true))
    await waitFor(() => expect(toggle).not.toBeChecked())
    rerender(<MultipleChoiceSetting project="" />)
    expect(screen.queryByTestId('mc-setting')).not.toBeInTheDocument()
  })

  it('renders nothing without repeated picks', () => {
    const { container } = render(<RepeatedPicks picks={[]} />)
    expect(container).toBeEmptyDOMElement()
    render(<RepeatedPicks picks={undefined} />)
  })
})
