import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TeachConcept, TeachPlan } from '../../electron/types'
import { VOICE_SETTINGS, lkvMock, makeItem } from './lkv'

const spoken: Array<{ text: string; rate?: number }> = []
vi.mock('../../src/features/voice/audio', async (orig) => {
  const real = await orig<typeof import('../../src/features/voice/audio')>()
  return {
    ...real,
    speakSentences: vi.fn((s: string[], _v: unknown, _st: unknown, _f: unknown, rate?: number) => {
      spoken.push({ text: s.join(' '), rate })
      return { done: Promise.resolve(), stop: vi.fn() }
    }),
  }
})

import { TalkView } from '../../src/features/voice/TalkView'
import { NotePeek } from '../../src/features/NotePeek'
import {
  conceptSpeech,
  exampleSpeech,
  goTo,
  isDone,
  mark,
  parseTeachCommand,
  startTeach,
  summarize,
} from '../../src/features/voice/teachFlow'

const concept = (n: number, over: Partial<TeachConcept> = {}): TeachConcept => ({
  id: `c${n}`,
  title: `Idea ${n}`,
  explain: `Idea ${n} explained.`,
  example: n === 1 ? 'Leaves in sunlight.' : null,
  check: `What is idea ${n}?`,
  answer: `answer ${n}`,
  quote: n === 2 ? 'Quoted line two.' : null,
  sourceId: n === 3 ? 'itm_b' : 'itm_a',
  sourceTitle: n === 3 ? 'Note B' : 'Note A',
  ...over,
})
const plan = (n = 3): TeachPlan => ({
  concepts: Array.from({ length: n }, (_, i) => concept(i + 1)),
  citations: [{ id: 'itm_a', title: 'Note A' }],
})

const type = async (t: string) => {
  fireEvent.change(screen.getByLabelText('Type a message'), { target: { value: t } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
}
const said = () => spoken.map((s) => s.text).join(' | ')

beforeEach(() => {
  spoken.length = 0
})

describe('teachFlow (#418)', () => {
  it('parses whole-utterance commands only', () => {
    expect(parseTeachCommand('Slower, please')).toBe('slower')
    expect(parseTeachCommand('slow down')).toBe('slower')
    expect(parseTeachCommand('Give me an example')).toBe('example')
    expect(parseTeachCommand('skip')).toBe('skip')
    expect(parseTeachCommand('next one')).toBe('skip')
    expect(parseTeachCommand('Go back')).toBe('back')
    expect(parseTeachCommand('say that again')).toBe('repeat')
    expect(parseTeachCommand('I’m done')).toBe('stop')
    expect(parseTeachCommand('another hint')).toBe('hint')
    expect(parseTeachCommand('the example is photosynthesis')).toBeNull()
    expect(parseTeachCommand('')).toBeNull()
  })

  it('walks concepts, tracks status and summarizes', () => {
    let st = startTeach(plan())
    expect(conceptSpeech(st)).toBe('Concept 1 of 3: Idea 1. Idea 1 explained. For example: Leaves in sunlight. Quick check: What is idea 1?')
    st = mark(st, 'missed')
    expect(mark(st, 'covered').status.c1).toBe('missed')
    expect(mark(mark(goTo(st, 1), 'covered'), 'skipped').status.c2).toBe('covered')
    st = goTo(st, 1)
    expect(conceptSpeech(st)).not.toMatch(/For example/)
    st = mark(st, 'covered')
    st = goTo(mark(goTo(st, 2), 'skipped'), 3)
    expect(isDone(st)).toBe(true)
    expect(conceptSpeech(st)).toBe('')
    expect(mark(st, 'covered')).toBe(st)
    expect(goTo(st, -4).index).toBe(0)
    const sum = summarize(st)
    expect(sum.say).toBe('That’s the lesson: 1 of 3 concepts went smoothly. We went back over Idea 1. You skipped 1. You can add those to Study so they come back for review.')
    expect(sum.missedNoteIds).toEqual(['itm_a'])
    expect(summarize(startTeach(plan(1))).say).toBe('That’s the lesson: 0 of 1 concepts went smoothly.')
    expect(startTeach({ concepts: [], citations: [] }).question).toBe('')
  })

  it('says when the note has no example', () => {
    expect(exampleSpeech(concept(1))).toBe('Here’s the example from your note: Leaves in sunlight.')
    expect(exampleSpeech(concept(2))).toBe('Your note doesn’t give an example for this one. Here’s what it says: “Quoted line two.”')
    expect(exampleSpeech(concept(3))).toBe('Your note doesn’t give an example for this one.')
  })
})

describe('Teach mode in Talk it through (#418)', () => {
  it('teaches a project in text: hint, wrong → re-explain → follow-up, right → why, commands, missed → Study with confirmation', async () => {
    const lkv = lkvMock()
    lkv.teach.plan.mockResolvedValue(plan())
    lkv.teach.check
      // concept 1: off → hint and retry
      .mockResolvedValueOnce({ verdict: 'wrong', say: 'Not quite. Hint: it starts with “a”.', retry: true, missed: false, citations: [] })
      // still off → re-explain + follow-up
      .mockResolvedValueOnce({
        verdict: 'partial',
        say: 'You’re right about X. One thing to untangle: Y. Let’s look at it another way: Z. Now try this: Why Z?',
        retry: false,
        missed: true,
        followUp: 'Why Z?',
        citations: [{ id: 'itm_a', title: 'Note A' }],
      })
      // follow-up right → next concept
      .mockResolvedValueOnce({ verdict: 'right', say: 'Yes, that’s it.', retry: false, missed: false, citations: [] })
      // concept 2 right with a why question
      .mockResolvedValueOnce({ verdict: 'right', say: 'Yes. Why does that matter?', retry: false, missed: false, followUp: 'Why does that matter?', citations: [] })
    render(<TalkView project="Biology" onProjectChange={vi.fn()} />)
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Teach me Biology' })))
    expect(lkv.teach.plan).toHaveBeenCalledWith({ project: 'Biology' })
    expect(await screen.findByTestId('talk-teach')).toHaveTextContent('concept 1 of 3')
    expect(screen.getByText(/Let’s learn this in 3 steps: Idea 1, Idea 2, Idea 3/)).toBeInTheDocument()
    expect(spoken).toEqual([]) // voice is off: text only

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Example' })))
    expect(await screen.findByText('Here’s the example from your note: Leaves in sunlight.')).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Slower' })))
    expect(await screen.findByText(/Let’s take it slowly\. Idea 1 explained\./)).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Hint' })))
    expect(await screen.findByText(/^Hint: /)).toBeInTheDocument()
    await type('repeat')
    await type('a guess')
    expect(await screen.findByText('Not quite. Hint: it starts with “a”.')).toBeInTheDocument()
    expect(lkv.teach.check).toHaveBeenLastCalledWith(expect.objectContaining({ question: 'What is idea 1?', attempt: 'a guess', hintsGiven: 1, askWhy: false }))
    await type('another guess')
    expect(await screen.findByTestId('talk-teach')).toHaveTextContent('follow-up')
    expect(lkv.teach.check).toHaveBeenLastCalledWith(expect.objectContaining({ hintsGiven: 2 }))
    await type('because Z')
    expect(lkv.teach.check).toHaveBeenLastCalledWith(expect.objectContaining({ question: 'Why Z?', hintsGiven: 1 }))
    expect(await screen.findByText(/Yes, that’s it\. Concept 2 of 3: Idea 2/)).toBeInTheDocument()
    await type('answer 2')
    expect(lkv.teach.check).toHaveBeenLastCalledWith(expect.objectContaining({ askWhy: true }))
    expect(await screen.findByTestId('talk-teach')).toHaveTextContent('why?')
    await type('because it does')
    expect(await screen.findByText(/Putting it in your own words helps it stick\. Concept 3 of 3/)).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Go back' })))
    expect(await screen.findByTestId('talk-teach')).toHaveTextContent('concept 2 of 3')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Skip' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'End lesson' })))
    expect(await screen.findByText(/That’s the lesson: 1 of 3 concepts went smoothly\. We went back over Idea 1\./)).toBeInTheDocument()
    expect(screen.queryByTestId('talk-teach')).toBeNull()
    const ask = screen.getByTestId('teach-missed')
    expect(ask).toHaveTextContent('Add the concept you missed to Study? The cards for its note (Note A) will be due now.')
    expect(lkv.teach.missed).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to Study' })))
    expect(lkv.teach.missed).toHaveBeenCalledWith(['itm_a'])
    expect(await screen.findByText('Done: 2 Study cards are due now from that note.')).toBeInTheDocument()
  })

  it('speaks aloud, slower uses a slower rate, and a wrong follow-up moves on', async () => {
    const lkv = lkvMock()
    lkv.voice.getSettings.mockResolvedValue({ ...VOICE_SETTINGS, enabled: true, output: 'system' })
    lkv.teach.plan.mockResolvedValue(plan(1))
    lkv.teach.check
      .mockResolvedValueOnce({ verdict: 'wrong', say: 'Re-explained. Now try this: Follow?', retry: false, missed: true, followUp: 'Follow?', citations: [] })
      .mockResolvedValueOnce({ verdict: 'wrong', say: 'Still not it. Here it is again. Now try this: Again?', retry: false, missed: true, followUp: 'Again?', citations: [] })
    render(<TalkView project="" onProjectChange={vi.fn()} />)
    await waitFor(() => expect(lkv.voice.getSettings).toHaveBeenCalled())
    await type('teach me')
    expect(lkv.teach.plan).toHaveBeenCalledWith({})
    await waitFor(() => expect(said()).toMatch(/Concept 1 of 1/))
    await type('slower')
    await waitFor(() => expect(spoken.at(-1)).toEqual(expect.objectContaining({ rate: 0.8 })))
    await type('wrong one')
    await type('wrong two')
    await waitFor(() => expect(said()).toMatch(/Still not it\. Here it is again\. That’s the lesson/))
    expect(said()).not.toMatch(/Again\?/)
    // Not now dismisses the Study offer.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not now' })))
    expect(screen.queryByTestId('teach-missed')).toBeNull()
  })

  it('says when nothing in the notes can be taught, and reports errors', async () => {
    const lkv = lkvMock()
    render(<TalkView project="" onProjectChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Teach me this (pick a project)' })).toBeDisabled()
    await type('teach')
    expect(await screen.findByText('I couldn’t find that in your notes.')).toBeInTheDocument()
    lkv.teach.plan.mockRejectedValueOnce(new Error('db busy'))
    await type('teach me')
    expect(await screen.findByText('db busy')).toBeInTheDocument()
    lkv.teach.plan.mockResolvedValueOnce({ ...plan(1), notice: 'No AI model answered, so these steps come straight from your note’s sections.', offline: true })
    lkv.teach.check.mockRejectedValueOnce(new Error('check failed'))
    lkv.teach.missed.mockRejectedValueOnce(new Error('missed failed'))
    await type('teach me')
    expect(await screen.findByText(/straight from your note’s sections/)).toBeInTheDocument()
    await type('an answer')
    expect(await screen.findByText('check failed')).toBeInTheDocument()
    lkv.teach.check.mockResolvedValueOnce({ verdict: 'right', say: 'Yes.', retry: false, missed: false, citations: [] })
    await type('hint')
    await type('hint')
    await type('hint')
    expect(await screen.findByText(/That’s all the hints I have/)).toBeInTheDocument()
    await type('answer 1')
    expect(await screen.findByText(/Yes\. That’s the lesson: 1 of 1/)).toBeInTheDocument()
    expect(screen.queryByTestId('teach-missed')).toBeNull()
  })

  it('starts a lesson from a note (“Teach me this”) and from pasted notes saved as a note', async () => {
    const lkv = lkvMock()
    lkv.teach.plan.mockResolvedValue(plan(1))
    lkv.items.create.mockResolvedValue(makeItem('itm_new', { title: 'Lecture 3' }))
    const onTeachStarted = vi.fn()
    const { rerender } = render(<TalkView project="Bio" onProjectChange={vi.fn()} teachNoteId="itm_a" onTeachStarted={onTeachStarted} />)
    await waitFor(() => expect(lkv.teach.plan).toHaveBeenCalledWith({ itemIds: ['itm_a'] }))
    expect(onTeachStarted).toHaveBeenCalled()
    await screen.findByTestId('talk-teach')
    await type('stop')
    rerender(<TalkView project="Bio" onProjectChange={vi.fn()} teachNoteId={null} onTeachStarted={onTeachStarted} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paste notes to learn' }))
    const save = await screen.findByRole('button', { name: 'Save note and teach me' })
    expect(save).toBeDisabled()
    expect(screen.getByText(/saves this as a note in Bio/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Lecture 3' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '  Enzymes lower activation energy.  ' } })
    lkv.items.create.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => fireEvent.click(save))
    expect(await screen.findByText('disk full')).toBeInTheDocument()
    await act(async () => fireEvent.click(save))
    expect(lkv.items.create).toHaveBeenLastCalledWith({ title: 'Lecture 3', body: 'Enzymes lower activation energy.', kind: 'note', status: 'active', project: 'Bio' })
    await waitFor(() => expect(lkv.teach.plan).toHaveBeenLastCalledWith({ itemIds: ['itm_new'] }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Cancel closes without saving; an untitled paste is "Untitled", with no project.
    rerender(<TalkView project="" onProjectChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Paste notes to learn' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('NotePeek offers “Teach me this” for a saved, unchanged note', () => {
    const onTeach = vi.fn()
    const base = {
      open: true,
      isNewDraft: false,
      draft: makeItem('itm_a'),
      peekEditing: false,
      dirty: false,
      busy: false,
      advanced: false,
      projectOptions: [],
      noteMissing: false,
      onClose: vi.fn(),
      onEdit: vi.fn(),
      onPatch: vi.fn(),
      onSave: vi.fn(),
      onDelete: vi.fn(),
      onConfirmDraft: vi.fn(),
      onCopyId: vi.fn(),
    }
    const { rerender } = render(<NotePeek {...base} onTeach={onTeach} />)
    fireEvent.click(screen.getByRole('button', { name: 'Teach me this' }))
    expect(onTeach).toHaveBeenCalledWith('itm_a')
    rerender(<NotePeek {...base} dirty onTeach={onTeach} />)
    expect(screen.queryByRole('button', { name: 'Teach me this' })).toBeNull()
    rerender(<NotePeek {...base} />)
    expect(screen.queryByRole('button', { name: 'Teach me this' })).toBeNull()
  })
})
