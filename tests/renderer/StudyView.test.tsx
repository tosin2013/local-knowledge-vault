import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudyView } from '../../src/plugins/study/StudyView'
import { lkvMock, makeAskResult, makeStudyCalibration } from './lkv'

const ASK = makeAskResult({
  answer: 'PARA is Projects, Areas, Resources, Archives [itm_1].',
  citations: [{ id: 'itm_1', title: 'Note title' }],
})

function askQuestion() {
  fireEvent.change(screen.getByLabelText(/Question/i), {
    target: { value: 'What is PARA?' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Get answer/i }))
}

describe('StudyView', () => {
  it('stores the answer without rendering it before reveal', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(ASK)
    render(<StudyView />)
    askQuestion()

    await waitFor(() => expect(lkv.ask.grounded).toHaveBeenCalledWith({ question: 'What is PARA?' }))
    expect(await screen.findByTestId('study-recall')).toBeInTheDocument()
    // The grounded answer and its citations must not be in the DOM yet.
    expect(screen.queryByText(/PARA is Projects/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Note title/)).not.toBeInTheDocument()
  })

  it('allows reveal after "I don\'t know"', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(ASK)
    render(<StudyView />)
    askQuestion()

    const reveal = await screen.findByRole('button', { name: 'Reveal answer' })
    expect(reveal).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /I don.t know/i }))
    expect(reveal).toBeEnabled()
    fireEvent.click(reveal)

    expect(await screen.findByText(/PARA is Projects/)).toBeInTheDocument()
    expect(screen.getByText('[1] Note title')).toBeInTheDocument()
  })

  it('reveals the answer and citation chips after a typed recall', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(ASK)
    render(<StudyView />)
    askQuestion()

    fireEvent.change(await screen.findByLabelText('Your recall'), {
      target: { value: 'Projects, Areas, Resources, Archives' },
    })
    fireEvent.change(screen.getByRole('slider', { name: 'Confidence' }), {
      target: { value: '80' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))

    expect(await screen.findByText(/PARA is Projects/)).toBeInTheDocument()
    // Numbered inline citation matches the numbered chip (#238), and both open the note.
    expect(screen.queryByText(/\[itm_1\]/)).not.toBeInTheDocument()
    expect(screen.getByText('[1] Note title')).toBeInTheDocument()
  })

  it('opens the cited note from the inline number and the chip (#238)', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(ASK)
    const onOpenNote = vi.fn()
    render(<StudyView onOpenNote={onOpenNote} />)
    askQuestion()
    fireEvent.click(await screen.findByRole('button', { name: /I don.t know/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Citation 1: Note title' }))
    fireEvent.click(screen.getByText('[1] Note title'))
    expect(onOpenNote).toHaveBeenCalledTimes(2)
    expect(onOpenNote).toHaveBeenCalledWith('itm_1')
  })

  it('saves the attempt with the expected fields', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(ASK)
    render(<StudyView />)
    askQuestion()

    fireEvent.change(await screen.findByLabelText('Your recall'), {
      target: { value: 'Projects, Areas, Resources, Archives' },
    })
    fireEvent.change(screen.getByRole('slider', { name: 'Confidence' }), {
      target: { value: '80' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Got it' }))
    fireEvent.change(screen.getByLabelText('Explain it in your own words'), {
      target: { value: 'Four groups for notes' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save attempt' }))

    await waitFor(() =>
      expect(lkv.study.record).toHaveBeenCalledWith({
        question: 'What is PARA?',
        attempt: 'Projects, Areas, Resources, Archives',
        confidence: 80,
        selfGrade: 'got',
        selfExplanation: 'Four groups for notes',
        citedIds: ['itm_1'],
        answer: ASK.answer,
      }),
    )
    expect(await screen.findByText('Attempt saved')).toBeInTheDocument()
  })

  it('still allows saving an offline attempt', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(
      makeAskResult({
        answer: 'Vault runs on local models — start Ollama.',
        citations: [],
        offline: true,
        error: 'ECONNREFUSED',
      }),
    )
    render(<StudyView />)
    askQuestion()

    fireEvent.click(await screen.findByRole('button', { name: /I don.t know/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(await screen.findByText(/AI offline/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Missed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save attempt' }))

    await waitFor(() =>
      expect(lkv.study.record).toHaveBeenCalledWith(
        expect.objectContaining({ selfGrade: 'missed', citedIds: [] }),
      ),
    )
  })

  it('renders the calibration strip from study.calibration', async () => {
    const lkv = lkvMock()
    lkv.study.calibration.mockResolvedValue(
      makeStudyCalibration({ count: 3, meanConfidence: 0.8, meanScore: 0.5, bias: 0.3, brier: 0.2 }),
    )
    render(<StudyView />)

    const strip = await screen.findByTestId('study-calibration')
    expect(strip).toHaveTextContent('3 attempts')
    expect(strip).toHaveTextContent('mean confidence 80%')
    expect(strip).toHaveTextContent('mean self-graded accuracy 50%')
    expect(strip).toHaveTextContent('bias +30 pts')
    expect(strip).toHaveTextContent('Brier 20%')
    expect(strip).toHaveTextContent(/overconfidence/i)
  })

  it('records a near-zero confidence for "I don\'t know"', async () => {
    const lkv = lkvMock()
    lkv.ask.grounded.mockResolvedValue(ASK)
    render(<StudyView />)
    askQuestion()

    fireEvent.click(await screen.findByRole('button', { name: /I don.t know/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Missed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save attempt' }))

    await waitFor(() =>
      expect(lkv.study.record).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: "I don't know", confidence: 0 }),
      ),
    )
  })
})
