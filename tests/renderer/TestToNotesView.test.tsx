import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TestToNotesView } from '../../src/features/study/TestToNotesView'
import { lkvMock, makeItem } from './lkv'

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
    // Not imported yet, so there is no card to link.
    expect(lkv.practiceTest.link).not.toHaveBeenCalled()
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

  it('shows a rate-limited banner and Retry for a 429 parse, never the raw error', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({
      items: ITEMS,
      rateLimited: true,
      retryAfterMs: 12000,
      error: 'Groq HTTP 429: rate limit reached for org_abc123',
    })
    render(<TestToNotesView />)
    paste(PASTE)

    expect(await screen.findByText(/Rate limited/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry with AI' })).toBeInTheDocument()
    expect(screen.queryByText(/org_abc123/)).not.toBeInTheDocument()
  })

  it('does not offer to save a rate-limited draft', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    lkv.testToNotes.analyze.mockResolvedValue([
      {
        question: 'What is 2 + 2?',
        yourAnswer: '5',
        title: 'Fix: What is 2 + 2?',
        body: 'Rate limited by Groq — try again in 12 s.',
        citations: [],
        rateLimited: true,
        retryAfterMs: 12000,
      },
    ])
    render(<TestToNotesView />)
    paste(PASTE)

    fireEvent.click(await screen.findByRole('button', { name: 'Suggest fixes' }))
    expect(await screen.findByText(/Rate limited by Groq/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as draft note' })).not.toBeInTheDocument()
  })

  it('adds the missed questions to Study with the test name, date and project (#265)', async () => {
    const lkv = lkvMock()
    lkv.projects.list.mockResolvedValue([{ name: 'A+', count: 3 }])
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    render(<TestToNotesView project="A+" onProjectChange={() => {}} />)
    paste('Core 2 practice exam — Results\n\n' + PASTE)
    await screen.findByText('2 items · 1 correct · 1 wrong')
    // The test name is suggested from the paste's first line.
    expect(screen.getByLabelText('Test name')).toHaveValue('Core 2 practice exam')
    fireEvent.change(screen.getByLabelText('Date taken'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Study' }))
    await waitFor(() =>
      expect(lkv.practiceTest.import).toHaveBeenCalledWith({
        project: 'A+',
        name: 'Core 2 practice exam',
        date: '2026-10-01',
        items: ITEMS,
        includeCorrect: false,
        questionTexts: {},
      }),
    )
    const result = await screen.findByTestId('import-result')
    expect(result).toHaveTextContent('1 card added.')
    expect(result).toHaveTextContent('1 corrective draft to confirm in your own words.')
    expect(result).toHaveTextContent('Saved as “Core 2 practice exam · 2026-10-01” in A+.')
  })

  it('"Also add the ones I got right" sends includeCorrect and reports needs and skips', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    lkv.practiceTest.import.mockResolvedValue({
      testItemId: 'itm_t', name: 'Quiz', date: '2026-10-08', added: 4, alreadyAdded: 2,
      needText: [3, 4], skipped: [{ index: 0, question: 'q', reason: 'answered correctly' }],
      linked: 2, drafts: 0, cardIds: {},
    })
    render(<TestToNotesView />)
    paste(PASTE)
    await screen.findByText('2 items · 1 correct · 1 wrong')
    fireEvent.click(screen.getByLabelText('Also add the ones I got right'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Study' }))
    await waitFor(() => expect(lkv.practiceTest.import).toHaveBeenCalledWith(expect.objectContaining({ includeCorrect: true, project: null })))
    const result = await screen.findByTestId('import-result')
    expect(result).toHaveTextContent('4 cards added, 2 need question text, 1 skipped, 2 already in Study.')
    expect(result).toHaveTextContent('2 linked to your notes.')
    expect(result).toHaveTextContent('Type the question text')
  })

  it('asks for question text for answer-sheet items and sends it', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({
      items: [
        { question: 'Question 3', answer: 'B', correctAnswer: 'D', correct: false, needsText: true },
        { question: 'Question 4', answer: 'D', correctAnswer: 'D', correct: true, needsText: true },
      ],
    })
    render(<TestToNotesView />)
    paste('Q3: B (correct: D)\nQ4: D (correct: D)')
    expect(await screen.findByText('2 items · 1 correct · 1 wrong · 2 need question text')).toBeInTheDocument()
    expect(screen.getByText('Your answer: B · Correct: D')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Question text for Question 3'), { target: { value: 'Which tool repairs the Windows image?' } })
    expect(await screen.findByText('2 items · 1 correct · 1 wrong · 1 need question text')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to Study' }))
    await waitFor(() =>
      expect(lkv.practiceTest.import).toHaveBeenCalledWith(
        expect.objectContaining({ questionTexts: { 0: 'Which tool repairs the Windows image?' } }),
      ),
    )
  })

  it('shows the key, options as text and the explanation for each item', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({
      items: [
        {
          question: 'Which type of attack is this?',
          answer: 'A',
          correct: false,
          options: ['A. Shoulder surfing', 'B. Phishing', 'C. Tailgating'],
          correctAnswer: 'Tailgating',
          explanation: 'Tailgating is following an authorized person in.',
        },
      ],
    })
    render(<TestToNotesView />)
    paste('Question 1 of 1 Incorrect')
    expect(await screen.findByText('Your answer: A. Shoulder surfing · Correct: Tailgating')).toBeInTheDocument()
    expect(screen.getByText('Tailgating is following an authorized person in.')).toBeInTheDocument()
  })

  it('opens a file into the paste box', async () => {
    const lkv = lkvMock()
    lkv.practiceTest.openFile.mockResolvedValue({ name: 'exam.pdf', text: '1. Q? ✗\nYour answer: x', truncated: true })
    lkv.testToNotes.parse.mockResolvedValue({ items: [{ question: 'Q?', answer: 'x', correct: false }] })
    render(<TestToNotesView />)
    fireEvent.click(screen.getByRole('button', { name: 'Open file…' }))
    expect(await screen.findByText(/Opened exam.pdf. It was long/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Paste practice-test results/i)).toHaveValue('1. Q? ✗\nYour answer: x')
    lkv.practiceTest.openFile.mockResolvedValue({ name: 'scan.pdf', error: 'This PDF has no text layer (scanned pages need OCR first).' })
    fireEvent.click(screen.getByRole('button', { name: 'Open file…' }))
    expect(await screen.findByText(/no text layer/)).toBeInTheDocument()
  })

  it('links a saved draft to its Study card after the import', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    lkv.testToNotes.analyze.mockResolvedValue([SUGGESTION])
    lkv.items.create.mockResolvedValue(makeItem('itm_draft'))
    render(<TestToNotesView />)
    paste(PASTE)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Study' }))
    await screen.findByTestId('import-result')
    fireEvent.click(screen.getByRole('button', { name: 'Suggest fixes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save as draft note' }))
    await waitFor(() => expect(lkv.practiceTest.link).toHaveBeenCalledWith('crd_test_2', 'itm_draft'))
    expect(await screen.findByText(/linked to its Study card/)).toBeInTheDocument()
  })

  it('reports an import error', async () => {
    const lkv = lkvMock()
    lkv.testToNotes.parse.mockResolvedValue({ items: ITEMS })
    lkv.practiceTest.import.mockRejectedValue(new Error('Paste some practice-test results first'))
    render(<TestToNotesView />)
    paste(PASTE)
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Study' }))
    expect(await screen.findByText('Paste some practice-test results first')).toBeInTheDocument()
  })
})

