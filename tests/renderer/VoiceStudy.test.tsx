import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { VoicePullProgress } from '../../electron/types'
import { VOICE_SETTINGS, lkvMock, makeSession, makeCardQuestion, makeMessage, makeReviewItem, makeVoiceStatus } from './lkv'

// The microphone and speakers are faked: each startMic() hands the test a
// capture it can drive (levels for turn detection) and finish.
const mics: Array<{ onLevel?: (l: number, now: number) => void; stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> = []
let micError: unknown = null
const spoken: string[] = []
vi.mock('../../src/features/voice/audio', async (orig) => {
  const real = await orig<typeof import('../../src/features/voice/audio')>()
  const utter = (text: string) => {
    spoken.push(text)
    return { done: Promise.resolve(), stop: vi.fn() }
  }
  return {
    ...real,
    startMic: vi.fn(async (onLevel?: (l: number, now: number) => void) => {
      if (micError) throw micError
      const m = { onLevel, stop: vi.fn().mockResolvedValue(new Uint8Array([82, 73, 70, 70])), cancel: vi.fn() }
      mics.push(m)
      return m
    }),
    speakText: vi.fn((text: string) => utter(text)),
    speakSentences: vi.fn((s: string[]) => utter(s.join(' '))),
  }
})

import { MicButton } from '../../src/features/voice/MicButton'
import { VoiceSettings } from '../../src/features/voice/VoiceSettings'
import { TalkView } from '../../src/features/voice/TalkView'
import { StudySession } from '../../src/features/study/StudySession'
import { loadVoice, refreshVoiceStatus, resetVoiceStore, updateVoiceSettings } from '../../src/features/voice/useVoice'

function voiceOn(status = makeVoiceStatus()) {
  const lkv = lkvMock()
  lkv.voice.getSettings.mockResolvedValue({ ...VOICE_SETTINGS, enabled: true })
  lkv.voice.setSettings.mockImplementation(async (p: Record<string, unknown>) => ({ ...VOICE_SETTINGS, enabled: true, ...p }))
  lkv.voice.status.mockResolvedValue(status)
  return lkv
}

/** Drive the latest capture: speech, then a pause long enough to end the turn. */
async function speakTurn() {
  const m = mics[mics.length - 1]
  await act(async () => {
    m.onLevel?.(0.3, 0)
    m.onLevel?.(0.3, 400)
    m.onLevel?.(0, 2000)
  })
}

beforeEach(() => {
  mics.length = 0
  spoken.length = 0
  micError = null
})

describe('voice store (#413)', () => {
  it('loads once, saves patches and re-checks status when the provider changes', async () => {
    const lkv = voiceOn()
    await loadVoice()
    await loadVoice()
    expect(lkv.voice.getSettings).toHaveBeenCalledTimes(1)
    expect(lkv.voice.status).toHaveBeenCalledTimes(1)
    await updateVoiceSettings({ providerId: 'lmstudio' })
    expect(lkv.voice.setSettings).toHaveBeenCalledWith({ providerId: 'lmstudio' })
    expect(lkv.voice.status).toHaveBeenCalledTimes(2)
    lkv.voice.setSettings.mockRejectedValueOnce(new Error('disk'))
    expect((await updateVoiceSettings({ voice: 'x' })).providerId).toBe('lmstudio')
    lkv.voice.status.mockRejectedValueOnce(new Error('down'))
    expect(await refreshVoiceStatus()).toBeNull()
  })

  it('copes without the voice API or with a failing load', async () => {
    const lkv = lkvMock()
    lkv.voice.getSettings.mockRejectedValue(new Error('x'))
    await loadVoice()
    ;(window.lkv as unknown as Record<string, unknown>).voice = undefined
    expect(await refreshVoiceStatus()).toBeNull()
    expect((await updateVoiceSettings({ enabled: true })).enabled).toBe(true)
  })
})

describe('VoiceSettings (#413)', () => {
  it('turns voice on and shows readiness, downloads and snap note', async () => {
    const lkv = lkvMock()
    lkv.voice.status.mockResolvedValue(
      makeVoiceStatus({ canTranscribe: false, sttHint: 'Download lfm3-audio.', ttsHint: 'Built-in voices for now.', snap: true })
    )
    let progress: ((p: { model: string; status: string; completed?: number; total?: number }) => void) | null = null
    lkv.voice.onPullProgress.mockImplementation((cb: typeof progress) => {
      progress = cb
      return () => undefined
    })
    let finishPull: (v: VoicePullProgress) => void = () => undefined
    lkv.voice.pull.mockImplementation(() => new Promise<VoicePullProgress>((r) => (finishPull = r)))
    render(<VoiceSettings />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Voice study' }))
    await waitFor(() => expect(lkv.voice.setSettings).toHaveBeenCalledWith({ enabled: true }))
    expect(await screen.findByText(/Speech to text \(lfm3-audio\): not ready/)).toBeInTheDocument()
    expect(screen.getByText('Download lfm3-audio.')).toBeInTheDocument()
    expect(screen.getByText(/snap connect local-knowledge-vault:audio-record/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Download lfm3-audio' }))
    expect(lkv.voice.pull).toHaveBeenCalledWith('lfm3-audio')
    act(() => progress!({ model: 'lfm3-audio', status: 'downloading', completed: 5, total: 10 }))
    expect(screen.getByText('downloading · 50%')).toBeInTheDocument()
    await act(async () => finishPull({ model: 'lfm3-audio', status: 'success', done: true }))
    await waitFor(() => expect(lkv.voice.status.mock.calls.length).toBeGreaterThanOrEqual(2))
    fireEvent.click(screen.getByRole('switch', { name: 'Spoken replies' }))
    expect(lkv.voice.setSettings).toHaveBeenCalledWith({ spokenReplies: false })
    fireEvent.click(screen.getByRole('button', { name: 'Re-check speech' }))
  })

  it('reports a failed download', async () => {
    const lkv = voiceOn(makeVoiceStatus({ canSpeak: false }))
    lkv.voice.pull.mockResolvedValue({ model: 'phonon', status: 'error', done: true, error: 'no space' })
    render(<VoiceSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download phonon' }))
    expect(await screen.findByText('no space')).toBeInTheDocument()
  })

  it('picks provider voices, warns about cloud providers and tests the voice', async () => {
    const lkv = voiceOn(
      makeVoiceStatus({
        canSpeak: true,
        voices: ['Zoey', 'Easton'],
        providers: [
          { id: 'ollama', label: 'Ollama', local: true },
          { id: 'openai', label: 'OpenAI', local: false },
        ],
      })
    )
    render(<VoiceSettings />)
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Voice' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Ollama · Zoey' }))
    await waitFor(() => expect(lkv.voice.setSettings).toHaveBeenCalledWith({ output: 'provider', voice: 'Zoey' }))
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Speech provider' }))
    expect(await screen.findByRole('option', { name: /OpenAI \(cloud: your audio leaves this computer\)/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /OpenAI/ }))
    await waitFor(() => expect(lkv.voice.setSettings).toHaveBeenCalledWith({ providerId: 'openai' }))
    fireEvent.click(screen.getByRole('button', { name: 'Test voice' }))
    await waitFor(() => expect(spoken[0]).toMatch(/This is the voice Vault will use/))
  })

  it('keeps a saved voice the list does not offer, and shows a cloud warning', async () => {
    const lkv = lkvMock()
    lkv.voice.getSettings.mockResolvedValue({ ...VOICE_SETTINGS, enabled: true, output: 'system', voice: 'Gone voice' })
    lkv.voice.status.mockResolvedValue(makeVoiceStatus({ local: false, providerLabel: 'Gateway' }))
    render(<VoiceSettings />)
    expect(await screen.findByText(/Gateway is a cloud provider/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Voice' })).toHaveTextContent('This computer · Gone voice')
  })

  it('renders nothing without the voice API', () => {
    ;(window.lkv as unknown as Record<string, unknown>).voice = undefined
    const { container } = render(<VoiceSettings />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('MicButton (#413)', () => {
  it('is hidden while voice is off', async () => {
    lkvMock()
    render(<MicButton onTranscript={vi.fn()} />)
    await act(async () => undefined)
    expect(screen.queryByTestId('mic-button')).toBeNull()
  })

  it('records while held and passes the transcript on', async () => {
    const lkv = voiceOn()
    const onTranscript = vi.fn()
    render(<MicButton onTranscript={onTranscript} label="Hold to answer out loud" />)
    const btn = await screen.findByRole('button', { name: 'Hold to answer out loud' })
    await waitFor(() => expect(btn).toBeEnabled())
    await act(async () => {
      fireEvent.pointerDown(btn)
    })
    expect(await screen.findByText(/Listening… let go/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.pointerUp(btn)
    })
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('spoken answer'))
    expect(lkv.voice.transcribe).toHaveBeenCalled()
    // Keyboard push-to-talk
    await act(async () => {
      fireEvent.keyDown(btn, { key: ' ' })
    })
    await act(async () => {
      fireEvent.keyUp(btn, { key: ' ' })
    })
    await waitFor(() => expect(onTranscript).toHaveBeenCalledTimes(2))
  })

  it('explains a missing speech model and a blocked microphone', async () => {
    voiceOn(makeVoiceStatus({ canTranscribe: false, sttHint: 'Pull lfm3-audio first.' }))
    const { unmount } = render(<MicButton onTranscript={vi.fn()} />)
    expect(await screen.findByTestId('mic-hint')).toHaveTextContent('Pull lfm3-audio first.')
    unmount()
    resetAndVoice()
    micError = { name: 'NotAllowedError' }
    render(<MicButton onTranscript={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: 'Hold to talk' })
    await waitFor(() => expect(btn).toBeEnabled())
    await act(async () => {
      fireEvent.pointerDown(btn)
    })
    expect(await screen.findByText(/Allow microphone access/)).toBeInTheDocument()
  })

  it('reports transcription errors and macOS mic denial', async () => {
    const lkv = voiceOn()
    lkv.voice.transcribe.mockResolvedValue({ ok: false, error: 'model not found' })
    render(<MicButton onTranscript={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: 'Hold to talk' })
    await waitFor(() => expect(btn).toBeEnabled())
    await act(async () => fireEvent.pointerDown(btn))
    await act(async () => fireEvent.pointerUp(btn))
    expect(await screen.findByText('model not found')).toBeInTheDocument()
    lkv.voice.micAccess.mockResolvedValue({ granted: false, snap: true })
    await act(async () => fireEvent.pointerDown(btn))
    expect(await screen.findByText(/snap connect/)).toBeInTheDocument()
  })
})

function resetAndVoice() {
  resetVoiceStore()
  return voiceOn()
}

describe('Talk it through (#413)', () => {
  it('works in text when voice is off, through the grounded chat with citations', async () => {
    const lkv = lkvMock()
    lkv.chat.send.mockResolvedValue({
      assistant: makeMessage({ content: 'Mitochondria make ATP [itm_1].', citations_json: JSON.stringify([{ id: 'itm_1', title: 'Cells' }]) }),
      messages: [],
      session: makeSession('s_1'),
    })
    const onOpenNote = vi.fn()
    render(<TalkView project="Biology" onProjectChange={vi.fn()} onOpenNote={onOpenNote} />)
    expect(await screen.findByTestId('talk-voice-off')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Type a message'), { target: { value: 'What do mitochondria do?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Mitochondria make ATP/)).toBeInTheDocument()
    expect(screen.queryByText(/itm_1/)).toBeNull()
    expect(lkv.chat.createSession).toHaveBeenCalledWith({ title: 'Talk: Biology', filters: { project: 'Biology' } })
    expect(lkv.chat.send).toHaveBeenCalledWith({ sessionId: 's_1', text: 'What do mitochondria do?', filters: { project: 'Biology' }, spoken: true })
    fireEvent.click(screen.getByText('Source: Cells'))
    expect(onOpenNote).toHaveBeenCalledWith('itm_1')
    // Same session for the next turn (conversation memory).
    fireEvent.change(screen.getByLabelText('Type a message'), { target: { value: 'And why?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(lkv.chat.send).toHaveBeenCalledTimes(2))
    expect(lkv.chat.createSession).toHaveBeenCalledTimes(1)
    expect(spoken).toEqual([])
  })

  it('runs the hands-free loop: listen, pause, answer aloud, listen again; stop ends it', async () => {
    const lkv = voiceOn()
    lkv.chat.send.mockResolvedValue({
      assistant: makeMessage({ content: 'They make ATP. Want a quick check?', citations_json: 'not json' }),
      messages: [],
      session: makeSession('s_1'),
      offline: true,
    })
    render(<TalkView project="" onProjectChange={vi.fn()} />)
    const startBtn = await screen.findByRole('button', { name: 'Start talking' })
    await waitFor(() => expect(startBtn).toBeEnabled())
    await act(async () => fireEvent.click(startBtn))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    await waitFor(() => expect(spoken).toContain('They make ATP. Want a quick check?'))
    expect(lkv.chat.createSession).toHaveBeenCalledWith({ title: 'Talk it through' })
    expect(screen.getByText(/search results only/)).toBeInTheDocument()
    await waitFor(() => expect(mics).toHaveLength(2))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })))
    expect(await screen.findByRole('button', { name: 'Start talking' })).toBeInTheDocument()
  })

  it('stops on a spoken “stop” and pauses after silence', async () => {
    const lkv = voiceOn()
    lkv.voice.transcribe.mockResolvedValue({ ok: true, text: 'stop' })
    render(<TalkView project="" onProjectChange={vi.fn()} />)
    const startBtn = await screen.findByRole('button', { name: 'Start talking' })
    await waitFor(() => expect(startBtn).toBeEnabled())
    await act(async () => fireEvent.click(startBtn))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    await waitFor(() => expect(spoken.join(' ')).toMatch(/Press Start talking whenever/))
    expect(lkv.chat.send).not.toHaveBeenCalled()
    // Silence → timeout → paused
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Start talking' })))
    await waitFor(() => expect(mics.length).toBeGreaterThanOrEqual(2))
    const m = mics[mics.length - 1]
    await act(async () => {
      m.onLevel?.(0, 0)
      m.onLevel?.(0, 31000)
    })
    expect(await screen.findByText(/Paused: I didn’t hear anything/)).toBeInTheDocument()
  })

  it('push-to-talk sends the transcript as a turn', async () => {
    const lkv = voiceOn()
    render(<TalkView project="" onProjectChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Hands-free' }))
    const btn = await screen.findByRole('button', { name: 'Hold to talk' })
    await waitFor(() => expect(btn).toBeEnabled())
    await act(async () => fireEvent.pointerDown(btn))
    await act(async () => fireEvent.pointerUp(btn))
    await waitFor(() => expect(lkv.chat.send).toHaveBeenCalledWith(expect.objectContaining({ text: 'spoken answer', spoken: true })))
    await act(async () => fireEvent.keyDown(btn, { key: 'Enter' }))
    await act(async () => fireEvent.keyUp(btn, { key: 'Enter' }))
    await waitFor(() => expect(lkv.chat.send).toHaveBeenCalledTimes(2))
  })

  it('quizzes inside the conversation: ask first, hint, confidence, cited reveal, grade into spaced review', async () => {
    const lkv = voiceOn()
    lkv.study.startSession.mockResolvedValue({ sessionId: 'ses_1', cards: [makeReviewItem('itm_0'), makeReviewItem('itm_1')] })
    lkv.study.cardQuestion
      .mockResolvedValueOnce(makeCardQuestion('crd_itm_0', { skipped: true }))
      .mockResolvedValueOnce(makeCardQuestion('crd_itm_1'))
    render(<TalkView project="Biology" onProjectChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quiz me' }))
    expect(await screen.findByTestId('talk-quiz')).toHaveTextContent('What does the Calvin cycle use')
    expect(lkv.study.startSession).toHaveBeenCalledWith({ project: 'Biology', limit: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(await screen.findByText('Hint: Think about your note “Photosynthesis”.')).toBeInTheDocument()
    const type = async (t: string) => {
      fireEvent.change(screen.getByLabelText('Type a message'), { target: { value: t } })
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    }
    await type('sunlight')
    expect(await screen.findByText('How sure are you, from 0 to 100?')).toBeInTheDocument()
    await type('80')
    expect(await screen.findByText(/Your note says: ATP and NADPH\./)).toBeInTheDocument()
    expect(screen.getAllByText('Source: Photosynthesis').length).toBeGreaterThan(0)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Missed' })))
    await waitFor(() =>
      expect(lkv.study.answer).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'ses_1', cardId: 'crd_itm_1', attempt: 'sunlight', confidence: 80, grade: 'again', dontKnow: false })
      )
    )
    expect(await screen.findByText(/That’s the end of this round: 0 got it, 0 partly, 1 missed/)).toBeInTheDocument()
    expect(screen.queryByTestId('talk-quiz')).toBeNull()
  })

  it('handles I don’t know, ending the quiz, an empty queue and errors', async () => {
    const lkv = voiceOn()
    lkv.study.startSession
      .mockResolvedValueOnce({ sessionId: 'ses_1', cards: [makeReviewItem('itm_1'), makeReviewItem('itm_2')] })
      .mockResolvedValueOnce({ sessionId: 'ses_2', cards: [] })
    lkv.study.answer.mockRejectedValueOnce(new Error('db locked'))
    render(<TalkView project="" onProjectChange={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quiz me' }))
    await screen.findByTestId('talk-quiz')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I don’t know' })))
    expect(await screen.findByText('db locked')).toBeInTheDocument()
    await waitFor(() => expect(lkv.study.answer).toHaveBeenCalledWith(expect.objectContaining({ dontKnow: true, confidence: 0, grade: 'again' })))
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'End quiz' })))
    expect(await screen.findByText('Okay, stopping the quiz.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quiz me' }))
    expect(await screen.findByText(/Nothing is due for review right now/)).toBeInTheDocument()
    lkv.chat.send.mockRejectedValueOnce(new Error('Session not found'))
    fireEvent.change(screen.getByLabelText('Type a message'), { target: { value: 'hello there' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    expect(await screen.findByText('Session not found')).toBeInTheDocument()
  })
})

describe('StudySession with voice (#413)', () => {
  it('reads the question, gives stepped hints, takes a spoken answer and reads the cited answer', async () => {
    const lkv = voiceOn()
    lkv.review.count.mockResolvedValue(1)
    lkv.study.startSession.mockResolvedValue({ sessionId: 'ses_1', cards: [makeReviewItem('itm_1')] })
    render(<StudySession project="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    await screen.findByTestId('session-question')
    await waitFor(() => expect(spoken[0]).toBe('What does the Calvin cycle use to fix carbon dioxide?'))
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Another hint' }))
    expect(screen.getByTestId('session-hints')).toHaveTextContent('Hint 2: The answer is 3 words and starts with “A”.')
    const mic = screen.getByRole('button', { name: 'Hold to answer out loud' })
    await waitFor(() => expect(mic).toBeEnabled())
    await act(async () => fireEvent.pointerDown(mic))
    await act(async () => fireEvent.pointerUp(mic))
    await waitFor(() => expect(screen.getByLabelText('Your answer')).toHaveValue('spoken answer'))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    await waitFor(() => expect(spoken.at(-1)).toMatch(/Your note says: ATP and NADPH/))
  })
})
