import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StudySession, formatDue } from '../../src/features/study/StudySession'
import { lkvMock, makeCardQuestion, makeReviewItem, makeSessionReport } from './lkv'

const CARD_A = makeReviewItem('itm_1', { title: 'Photosynthesis' })
const CARD_B = makeReviewItem('itm_2', {
  title: 'Cell transport',
  card_id: 'crd_part2',
  chunk_index: 1,
  chunk_count: 3,
})

function startWith(cards = [CARD_A]) {
  const lkv = lkvMock()
  lkv.review.count.mockResolvedValue(cards.length)
  lkv.study.startSession.mockResolvedValue({ sessionId: 'ses_1', cards })
  return lkv
}

async function begin() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
  return screen.findByTestId('session-question')
}

function answer(text: string) {
  fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: text } })
}

describe('StudySession (#263)', () => {
  it('shows how many cards are ready and says when nothing is due', async () => {
    const lkv = lkvMock()
    lkv.review.count.mockResolvedValue(0)
    render(<StudySession project="Biology" />)
    await waitFor(() => expect(lkv.review.count).toHaveBeenCalledWith({ project: 'Biology' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(await screen.findByText(/Nothing is due right now/)).toBeInTheDocument()
    expect(lkv.study.startSession).toHaveBeenCalledWith({ project: 'Biology', limit: 20 })
  })

  it('asks a question, requires an attempt before reveal, then shows feedback and grades', async () => {
    const lkv = startWith()
    const onGraded = vi.fn()
    const onOpenNote = vi.fn()
    render(<StudySession project="" onGraded={onGraded} onOpenNote={onOpenNote} />)
    expect(await screen.findByText('1 card ready')).toBeInTheDocument()

    expect(await begin()).toHaveTextContent('What does the Calvin cycle use to fix carbon dioxide?')
    expect(lkv.study.startSession).toHaveBeenCalledWith({ limit: 20 })
    expect(lkv.study.cardQuestion).toHaveBeenCalledWith('crd_itm_1')
    expect(screen.getByText('Card 1 of 1')).toBeInTheDocument()
    expect(screen.getByText('From your note')).toBeInTheDocument()

    // Nothing is revealed before an attempt.
    expect(screen.queryByText('ATP and NADPH')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()

    answer('ATP and something')
    fireEvent.change(screen.getByRole('slider', { name: 'Confidence' }), { target: { value: 80 } })
    expect(screen.getByText('How sure are you? 80%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))

    const reveal = await screen.findByTestId('session-reveal')
    expect(within(reveal).getByText('ATP and something')).toBeInTheDocument()
    expect(within(reveal).getByText(/confidence 80%/)).toBeInTheDocument()
    expect(screen.getByTestId('session-answer')).toHaveTextContent('ATP and NADPH')
    expect(within(reveal).getByText(/The Calvin cycle uses ATP and NADPH/)).toBeInTheDocument()

    // The cited note opens from the reveal.
    fireEvent.click(screen.getByRole('button', { name: 'Open note Photosynthesis' }))
    expect(onOpenNote).toHaveBeenCalledWith('itm_1')
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }))
    expect(onOpenNote).toHaveBeenCalledTimes(2)

    // The whole section is one click away.
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole section' }))
    expect(await screen.findByText(/It runs in the stroma/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Partly' }))
    await waitFor(() =>
      expect(lkv.study.answer).toHaveBeenCalledWith({
        sessionId: 'ses_1',
        cardId: 'crd_itm_1',
        question: 'What does the Calvin cycle use to fix carbon dioxide?',
        attempt: 'ATP and something',
        dontKnow: false,
        confidence: 80,
        grade: 'hard',
        answer: 'ATP and NADPH',
      }),
    )
    expect(onGraded).toHaveBeenCalled()
    expect(await screen.findByTestId('session-summary')).toBeInTheDocument()
    expect(lkv.study.sessionSummary).toHaveBeenCalledWith('ses_1', undefined)
  })

  it('"I don\'t know" unlocks reveal with confidence 0', async () => {
    const lkv = startWith()
    render(<StudySession project="Biology" />)
    await begin()
    fireEvent.click(screen.getByRole('button', { name: "I don't know" }))
    expect(screen.getByText(/Confidence: 0%/)).toBeInTheDocument()
    expect(screen.getByLabelText('Your answer')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(await screen.findByText('I don’t know')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Missed' }))
    await waitFor(() =>
      expect(lkv.study.answer).toHaveBeenCalledWith(
        expect.objectContaining({ dontKnow: true, confidence: 0, attempt: '', grade: 'again' }),
      ),
    )
    expect(lkv.study.sessionSummary).not.toHaveBeenCalled()
  })

  it('brings a missed card back at the end and prefetches the next question', async () => {
    const lkv = startWith([CARD_A, CARD_B])
    lkv.study.cardQuestion.mockImplementation((cardId: string) =>
      Promise.resolve(
        cardId === 'crd_part2'
          ? makeCardQuestion(cardId, { itemId: 'itm_2', title: 'Cell transport', question: 'What is osmosis?' })
          : makeCardQuestion(cardId),
      ),
    )
    render(<StudySession project="" />)
    await begin()
    // The next card's question is prepared in the background.
    await waitFor(() => expect(lkv.study.cardQuestion).toHaveBeenCalledWith('crd_part2'))

    answer('no idea really')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Missed' }))

    expect(await screen.findByText('What is osmosis?')).toBeInTheDocument()
    expect(screen.getByText('Card 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Part 2 of 3')).toBeInTheDocument()
    answer('water moves')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))

    // The missed card again, flagged, with its cached question (no new call).
    expect(await screen.findByText('Card 3 of 3')).toBeInTheDocument()
    expect(screen.getByText('Missed last time')).toBeInTheDocument()
    expect(lkv.study.cardQuestion.mock.calls.filter(([id]) => id === 'crd_itm_1')).toHaveLength(1)
    answer('ATP and NADPH')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))
    expect(await screen.findByTestId('session-summary')).toBeInTheDocument()
    expect(lkv.study.answer).toHaveBeenCalledTimes(3)
  })

  it('shows a fallback notice and the section to compare for an explain card', async () => {
    const lkv = startWith()
    lkv.study.cardQuestion.mockResolvedValue(
      makeCardQuestion('crd_itm_1', {
        kind: 'explain',
        question: 'Explain the main idea of “Photosynthesis” in your own words.',
        answer: null,
        quote: null,
        notice: 'AI is offline, so this is a prompt from your note.',
        offline: true,
        citations: [],
      }),
    )
    render(<StudySession project="" />)
    await begin()
    expect(screen.getByText('AI is offline, so this is a prompt from your note.')).toBeInTheDocument()
    answer('Plants make sugar from light')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(await screen.findByText('Compare with your note')).toBeInTheDocument()
    expect(screen.getByText(/It runs in the stroma/)).toBeInTheDocument()
    expect(screen.queryByTestId('session-answer')).not.toBeInTheDocument()
    expect(lkv.study.answer).not.toHaveBeenCalled()
  })

  it('summarises grades, calibration, confident misses, notes to revisit and what is next', async () => {
    const lkv = startWith()
    const onOpenNote = vi.fn()
    lkv.study.sessionSummary.mockResolvedValue(
      makeSessionReport({
        cards: 4,
        got: 2,
        partial: 1,
        missed: 1,
        retried: 1,
        accuracy: 0.625,
        calibration: { count: 4, meanConfidence: 0.8, meanScore: 0.625, bias: 0.175, brier: 0.2 },
        confidentMisses: [
          { cardId: 'crd_x', itemId: 'itm_7', title: 'Mitosis', question: 'What happens in anaphase?', confidence: 90, grade: 'missed' },
        ],
        revisit: [{ itemId: 'itm_7', title: 'Mitosis' }],
        nextDueAt: '2026-10-09T13:00:00.000Z',
        dueByTomorrow: 3,
      }),
    )
    render(<StudySession project="Biology" onOpenNote={onOpenNote} />)
    await begin()
    answer('ATP')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))

    expect(await screen.findByText('Got it: 2')).toBeInTheDocument()
    expect(lkv.study.sessionSummary).toHaveBeenCalledWith('ses_1', 'Biology')
    expect(screen.getByText('Partly: 1')).toBeInTheDocument()
    expect(screen.getByText('Missed: 1')).toBeInTheDocument()
    expect(screen.getByText('1 card retried')).toBeInTheDocument()
    expect(screen.getByText(/first-try accuracy 63%/)).toBeInTheDocument()
    expect(screen.getByText(/80% sure on average and recalled 63%: a little overconfident/)).toBeInTheDocument()
    const misses = screen.getByTestId('confident-misses')
    expect(within(misses).getByText('What happens in anaphase?')).toBeInTheDocument()
    expect(within(misses).getByText('90% sure · Missed · Mitosis')).toBeInTheDocument()
    fireEvent.click(within(misses).getByText('What happens in anaphase?'))
    expect(onOpenNote).toHaveBeenCalledWith('itm_7')
    expect(screen.getByTestId('whats-next')).toHaveTextContent('3 cards due by tomorrow; the next one is due')

    // Study more starts a new session; Done goes back.
    fireEvent.click(screen.getByRole('button', { name: 'Study more' }))
    await waitFor(() => expect(lkv.study.startSession).toHaveBeenCalledTimes(2))
  })

  it('reports errors from starting and answering', async () => {
    const lkv = startWith()
    lkv.study.startSession.mockRejectedValueOnce(new Error('database locked'))
    render(<StudySession project="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    expect(await screen.findByText('database locked')).toBeInTheDocument()

    await begin()
    lkv.study.answer.mockRejectedValueOnce(new Error('card not found'))
    answer('x')
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))
    expect(await screen.findByText('card not found')).toBeInTheDocument()
    // Still on the card, so it can be graded again.
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('reports a question that fails to load', async () => {
    const lkv = startWith()
    lkv.study.cardQuestion.mockRejectedValue(new Error('no such card'))
    render(<StudySession project="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    expect(await screen.findByText('no such card')).toBeInTheDocument()
    expect(screen.getByText('Writing a question from your note…')).toBeInTheDocument()
  })

  it('formats due dates and tolerates bad ones', () => {
    expect(formatDue(null)).toBe('')
    expect(formatDue('not a date')).toBe('')
    expect(formatDue('2026-10-09T13:00:00.000Z')).toMatch(/Oct/)
  })
})
