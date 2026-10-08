import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TestToNotesView } from '../../src/plugins/test-to-notes/TestToNotesView'
import { lkvMock } from './lkv'

/** One correct item and one incorrect item, split by a blank line. */
const PASTE = [
  '1. What is the capital of France? ✓',
  'Your answer: Paris',
  '',
  '2. What is 2 + 2? ✗',
  'Your answer: 5',
].join('\n')

/** What the AI parser returns for PASTE. */
const ITEMS = [
  { question: 'What is the capital of France?', answer: 'Paris', correct: true },
  { question: 'What is 2 + 2?', answer: '5', correct: false },
]

const SUGGESTION = {
  question: 'What is 2 + 2?',
  yourAnswer: '5',
  title: 'Fix: What is 2 + 2?',
  body: 'Two plus two is four [itm_1]. You answered 5, which misses the sum.',
  citations: [{ id: 'itm_1', title: 'Arithmetic' }],
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText(/Paste practice-test results/i), {
    target: { value: text },
  })
}

describe('TestToNotesView', () => {
  it('parses pasted results with the model into a correct/wrong summary', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    render(<TestToNotesView />)
    paste(PASTE)
    expect(await screen.findByText('2 items · 1 correct · 1 wrong')).toBeInTheDocument()
    expect(lkv.testToNotes.parse).toHaveBeenCalledWith({ text: PASTE })
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument()
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument()
  })

  it('keeps the empty summary when nothing is pasted', () => {
    render(<TestToNotesView />)
    expect(screen.getByText('0 items · 0 correct · 0 wrong')).toBeInTheDocument()
  })

  it('falls back to the built-in parser and warns when the AI parse fails', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({
      items: ITEMS,
      offline: true,
      error: 'Connection refused',
    })
    render(<TestToNotesView />)
    paste(PASTE)
    expect(await screen.findByText(/showing the built-in parser/)).toBeInTheDocument()
    expect(await screen.findByText('2 items · 1 correct · 1 wrong')).toBeInTheDocument()
  })

  it('saves a reinforcement flash-card for a correct item', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    render(<TestToNotesView />)
    paste(PASTE)
    fireEvent.click(await screen.findByRole('button', { name: 'Save flash-card' }))
    await waitFor(() =>
      expect(lkv.items.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'What is the capital of France?',
          body: 'Q: What is the capital of France?\n\nA: Paris',
          kind: 'note',
          status: 'ai-draft',
          para: 'resources',
        }),
      ),
    )
  })

  it('analyzes the wrong items and saves a suggestion as a draft note', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    lkv.testToNotes.analyze.mockResolvedValue([SUGGESTION])
    render(<TestToNotesView />)
    paste(PASTE)

    fireEvent.click(await screen.findByRole('button', { name: 'Suggest fixes' }))
    await waitFor(() =>
      expect(lkv.testToNotes.analyze).toHaveBeenCalledWith({
        items: [{ question: 'What is 2 + 2?', answer: '5', correct: false }],
      }),
    )

    expect(await screen.findByText('Fix: What is 2 + 2?')).toBeInTheDocument()
    expect(screen.getByText(/Two plus two is four/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save as draft note' }))
    await waitFor(() =>
      expect(lkv.items.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fix: What is 2 + 2?',
          body: SUGGESTION.body,
          kind: 'note',
          status: 'ai-draft',
          para: 'resources',
          project: null,
        }),
      ),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('does not call analyze when there are no wrong items', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({
      items: [{ question: 'Only correct?', answer: 'yes', correct: true }],
    })
    render(<TestToNotesView />)
    paste('1. Only correct? ✓\nYour answer: yes')
    expect(await screen.findByText('1 items · 1 correct · 0 wrong')).toBeInTheDocument()
    // The Suggest fixes button only renders with wrong items.
    expect(screen.queryByRole('button', { name: 'Suggest fixes' })).not.toBeInTheDocument()
    expect(lkv.testToNotes.analyze).not.toHaveBeenCalled()
  })
})
