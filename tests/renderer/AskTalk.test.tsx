import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VOICE_SETTINGS, lkvMock, makeSession, makeVoiceStatus } from './lkv'
import { ChatView, type ChatViewProps } from '../../src/features/ChatView'
import { talkStatusText } from '../../src/features/voice/useTalkLoop'
import { VoiceSettings } from '../../src/features/voice/VoiceSettings'
import { resetVoiceStore } from '../../src/features/voice/useVoice'
import { AiSettingsDialog } from '../../src/features/AiSettingsDialog'
import { makeLlmStatus } from './lkv'

// The microphone and speakers are faked: each startMic() hands the test a
// capture it can drive (levels for turn detection) and finish.
const mics: Array<{ onLevel?: (l: number, now: number) => void; stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> = []
let micError: unknown = null
const spoken: string[] = []
let fallbackWhy: string | null = null
let speakUtterance: { done: Promise<void>; stop: ReturnType<typeof vi.fn>; resolve: () => void } | null = null

vi.mock('../../src/features/voice/audio', async (orig) => {
  const real = await orig<typeof import('../../src/features/voice/audio')>()
  const utter = (text: string, onFallback?: (why: string) => void) => {
    spoken.push(text)
    if (fallbackWhy && onFallback) onFallback(fallbackWhy)
    if (speakUtterance) return speakUtterance
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
    speakSentences: vi.fn((s: string[], _a?: unknown, _b?: unknown, onFallback?: (why: string) => void) =>
      utter(s.join(' '), onFallback),
    ),
  }
})

function voiceOn(status = makeVoiceStatus()) {
  const lkv = lkvMock()
  lkv.voice.getSettings.mockResolvedValue({ ...VOICE_SETTINGS, enabled: true })
  lkv.voice.setSettings.mockImplementation(async (p: Record<string, unknown>) => ({ ...VOICE_SETTINGS, enabled: true, ...p }))
  lkv.voice.status.mockResolvedValue(status)
  return lkv
}

async function speakTurn() {
  const m = mics[mics.length - 1]
  await act(async () => {
    m.onLevel?.(0.3, 0)
    m.onLevel?.(0.3, 400)
    m.onLevel?.(0, 2000)
  })
}

function makeProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  const threadEndRef = { current: null } as React.RefObject<HTMLDivElement | null>
  return {
    advanced: false,
    busy: false,
    sending: false,
    llmStatus: makeLlmStatus(),
    llmChecking: false,
    showFirstRun: false,
    showSmallHint: false,
    askEmpty: { title: 'Ask anything', body: 'Example question' },
    quickAsks: [],
    messages: [],
    chatOffline: false,
    threadEndRef,
    selectedProfileId: 'grounded-helper',
    userProfiles: [],
    selectedUserProfile: undefined,
    prompts: [],
    selectedPromptId: '',
    projectOptions: ['Biology'],
    notesFrom: 'Biology',
    profileRenameOpen: false,
    profileRenameName: '',
    profileSaveOpen: false,
    profileSaveName: '',
    profileBusy: false,
    askCustomizeOpen: false,
    filterSummary: 'Biology',
    stayingInGorgias: false,
    scopeCoupleHint: null,
    chatInput: '',
    chatPlaceholder: 'Ask about your notes…',
    sessions: [makeSession('s_1', 'Biology')],
    activeSessionId: 's_1',
    onRecheck: vi.fn(),
    onAddProvider: vi.fn(),
    onEditProvider: vi.fn(),
    onError: vi.fn(),
    onDismissSmallHint: vi.fn(),
    onChatInput: vi.fn(),
    onSelectNote: vi.fn(),
    onProfileChange: vi.fn(),
    onOpenRename: vi.fn(),
    onRenameName: vi.fn(),
    onRename: vi.fn(),
    onRenameCancel: vi.fn(),
    onDeleteProfile: vi.fn(),
    onAskCustomize: vi.fn(),
    onChatPrompt: vi.fn(),
    onNotesFrom: vi.fn(),
    onOpenProfileSave: vi.fn(),
    onProfileSaveName: vi.fn(),
    onSaveAsProfile: vi.fn(),
    onProfileSaveCancel: vi.fn(),
    onSend: vi.fn(),
    onSpokenTurn: vi.fn().mockResolvedValue({
      ok: true,
      content: 'They make ATP.',
      citationsJson: JSON.stringify([{ id: 'itm_1', title: 'Cells' }]),
      offline: false,
    }),
    onOpenVoiceSettings: vi.fn(),
    onNewChat: vi.fn(),
    onExportCitationPack: vi.fn(),
    onSaveAsNote: vi.fn(),
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  mics.length = 0
  spoken.length = 0
  micError = null
  speakUtterance = null
  fallbackWhy = null
  resetVoiceStore()
})

describe('talkStatusText (#426)', () => {
  it('names listening, thinking, speaking and ready states', () => {
    expect(talkStatusText('listening', 'idle', true)).toBe('Listening…')
    expect(talkStatusText('listening', 'speaking', true)).toBe('Speaking… talk to interrupt')
    expect(talkStatusText('transcribing', 'idle', true)).toBe('Writing down what you said…')
    expect(talkStatusText('idle', 'thinking', true)).toBe('Checking your notes…')
    expect(talkStatusText('idle', 'speaking', true)).toBe('Speaking…')
    expect(talkStatusText('idle', 'idle', true)).toBe('Ready')
    expect(talkStatusText('idle', 'idle', false)).toBe('')
  })
})

describe('Ask Talk (#426)', () => {
  it('shows Talk it through when Voice is off, explains, and opens Voice settings', async () => {
    const props = makeProps()
    render(<ChatView {...props} />)
    const btn = screen.getByRole('button', { name: 'Talk it through' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(props.onOpenVoiceSettings).toHaveBeenCalled()
    const setup = await screen.findByTestId('ask-talk-setup')
    expect(setup).toHaveTextContent(/turn on Voice study/i)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('ask-talk-setup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Talk it through' }))
    expect(await screen.findByTestId('ask-talk-setup')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Voice' }))
    // Default mock status can transcribe, so turning voice on starts the loop.
    await waitFor(() => expect(mics.length).toBeGreaterThan(0))
    expect(await screen.findByRole('button', { name: 'End conversation' })).toBeInTheDocument()
  })

  it('shows the speech-to-text hint when Voice is on but not ready', async () => {
    voiceOn(makeVoiceStatus({ canTranscribe: false, sttHint: 'Download lfm3-audio in Settings to listen.' }))
    const props = makeProps()
    render(<ChatView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' }))
    expect(props.onOpenVoiceSettings).toHaveBeenCalled()
    expect(await screen.findByTestId('ask-talk-unready')).toHaveTextContent(/Download lfm3-audio/)
    expect(screen.queryByRole('button', { name: 'Turn on Voice' })).not.toBeInTheDocument()
  })

  it('runs a hands-free conversation in the current thread until End conversation', async () => {
    voiceOn()
    const props = makeProps()
    render(<ChatView {...props} />)
    expect(await screen.findByTestId('mic-button')).toBeInTheDocument()
    const btn = await screen.findByRole('button', { name: 'Talk it through' })
    await act(async () => fireEvent.click(btn))
    await waitFor(() => expect(mics).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'End conversation' })).toBeInTheDocument()
    expect(screen.getByTestId('ask-talk-status')).toHaveTextContent(/Listening|Ready/)
    await speakTurn()
    await waitFor(() => expect(props.onSpokenTurn).toHaveBeenCalledWith('spoken answer'))
    await waitFor(() => expect(spoken).toContain('They make ATP.'))
    await waitFor(() => expect(mics).toHaveLength(2))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'End conversation' })))
    expect(await screen.findByRole('button', { name: 'Talk it through' })).toBeInTheDocument()
  })

  it('stops on a spoken “stop” and pauses after silence', async () => {
    const lkv = voiceOn()
    lkv.voice.transcribe.mockResolvedValue({ ok: true, text: 'stop' })
    render(<ChatView {...makeProps()} />)
    const btn = await screen.findByRole('button', { name: 'Talk it through' })
    await act(async () => fireEvent.click(btn))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    await waitFor(() => expect(spoken.join(' ')).toMatch(/Press Talk whenever/))
    expect(await screen.findByTestId('ask-talk-notice')).toHaveTextContent(/Press Talk whenever/)
    expect(await screen.findByRole('button', { name: 'Talk it through' })).toBeInTheDocument()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Talk it through' })))
    await waitFor(() => expect(mics.length).toBeGreaterThanOrEqual(2))
    const m = mics[mics.length - 1]
    await act(async () => {
      m.onLevel?.(0, 0)
      m.onLevel?.(0, 31000)
    })
    expect(await screen.findByText(/Paused: I didn’t hear anything/)).toBeInTheDocument()
    expect(await screen.findByText(/Press Talk to carry on/)).toBeInTheDocument()
  })

  it('sends a typed message as a talk turn while the conversation is running', async () => {
    voiceOn()
    const onSend = vi.fn()
    const onSpokenTurn = vi.fn().mockResolvedValue({ ok: true, content: 'A typed turn.', citationsJson: null, offline: false })
    const onChatInput = vi.fn()
    render(<ChatView {...makeProps({ chatInput: 'How does this work?', onChatInput, onSend, onSpokenTurn })} />)
    expect(await screen.findByTestId('mic-button')).toBeInTheDocument()
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    expect(await screen.findByRole('button', { name: 'End conversation' })).toBeInTheDocument()
    await waitFor(() => expect(mics).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSpokenTurn).toHaveBeenCalledWith('How does this work?'))
    expect(onSend).not.toHaveBeenCalled()
    expect(onChatInput).toHaveBeenCalledWith('')
    await waitFor(() => expect(spoken).toContain('A typed turn.'))
  })

  it('shows an error notice and an offline notice from a spoken turn', async () => {
    voiceOn()
    const onSpokenTurn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'provider down' })
      .mockResolvedValueOnce({ ok: true, content: 'Search hits only.', citationsJson: null, offline: true })
    render(<ChatView {...makeProps({ onSpokenTurn })} />)
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    expect(await screen.findByText('provider down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(mics.length).toBeGreaterThanOrEqual(2))
    await speakTurn()
    expect(await screen.findByText(/search results only/)).toBeInTheDocument()
    await waitFor(() => expect(spoken).toContain('Search hits only.'))
  })

  it('interrupts speech when the user starts talking', async () => {
    voiceOn()
    let resolve!: () => void
    const stop = vi.fn()
    speakUtterance = { done: new Promise<void>((r) => { resolve = r }), stop, resolve: () => resolve() }
    const onSpokenTurn = vi.fn().mockResolvedValue({ ok: true, content: 'A long answer.', citationsJson: null, offline: false })
    render(<ChatView {...makeProps({ onSpokenTurn })} />)
    expect(await screen.findByTestId('mic-button')).toBeInTheDocument()
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    await waitFor(() => expect(spoken).toContain('A long answer.'))
    await waitFor(() => expect(mics).toHaveLength(2))
    await act(async () => {
      mics[1].onLevel?.(0.3, 0)
      mics[1].onLevel?.(0.3, 400)
    })
    expect(stop).toHaveBeenCalled()
    speakUtterance = null
    resolve()
  })

  it('ends the conversation when the Ask session changes', async () => {
    voiceOn()
    const props = makeProps({ activeSessionId: 's_1' })
    const { rerender } = render(<ChatView {...props} />)
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    await waitFor(() => expect(mics).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'End conversation' })).toBeInTheDocument()
    rerender(<ChatView {...props} activeSessionId="s_2" />)
    expect(await screen.findByRole('button', { name: 'Talk it through' })).toBeInTheDocument()
  })

  it('reports a thrown spoken turn and a listen error, and ignores an empty transcript', async () => {
    const lkv = voiceOn()
    lkv.voice.transcribe
      .mockResolvedValueOnce({ ok: true, text: '   ' })
      .mockResolvedValueOnce({ ok: true, text: 'What is ATP?' })
    const onSpokenTurn = vi.fn().mockRejectedValueOnce(new Error('boom'))
    render(<ChatView {...makeProps({ onSpokenTurn })} />)
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    expect(onSpokenTurn).not.toHaveBeenCalled()
    await waitFor(() => expect(mics).toHaveLength(2))
    await speakTurn()
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('stops the loop when the microphone errors', async () => {
    voiceOn()
    micError = { name: 'NotFoundError' }
    render(<ChatView {...makeProps()} />)
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    expect(await screen.findByText(/No microphone was found/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Talk it through' })).toBeInTheDocument()
  })

  it('keeps the setup open when turning Voice on is not enough to talk, and the alert can be dismissed', async () => {
    lkvMock().voice.status.mockResolvedValue(makeVoiceStatus({ canTranscribe: false, sttHint: 'Need lfm3-audio first.' }))
    render(<ChatView {...makeProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Talk it through' }))
    expect(await screen.findByTestId('ask-talk-setup')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Voice' }))
    expect(await screen.findByTestId('ask-talk-unready')).toHaveTextContent(/Need lfm3-audio first/)
    expect(screen.queryByRole('button', { name: 'End conversation' })).not.toBeInTheDocument()
    const close = screen.getAllByRole('button', { name: 'Close' })[0]
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByTestId('ask-talk-setup')).not.toBeInTheDocument())
  })

  it('shows a fallback notice when the speech provider does not answer, and skips a void turn', async () => {
    voiceOn()
    fallbackWhy = 'timeout'
    const onSpokenTurn = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true, content: 'ATP.', citationsJson: null, offline: false })
    render(<ChatView {...makeProps({ onSpokenTurn })} />)
    expect(await screen.findByTestId('mic-button')).toBeInTheDocument()
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    await waitFor(() => expect(mics).toHaveLength(1))
    await speakTurn()
    expect(onSpokenTurn).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('ask-talk-notice')).not.toBeInTheDocument()
    await waitFor(() => expect(mics).toHaveLength(2))
    await speakTurn()
    expect(await screen.findByTestId('ask-talk-notice')).toHaveTextContent(/speech provider didn’t answer \(timeout\)/)
    await waitFor(() => expect(spoken).toContain('ATP.'))
  })

  it('sends from the composer with Enter, including during a conversation', async () => {
    voiceOn()
    const onSend = vi.fn()
    const onSpokenTurn = vi.fn().mockResolvedValue({ ok: true, content: 'Entered.', citationsJson: null, offline: false })
    const onChatInput = vi.fn()
    const { rerender } = render(
      <ChatView {...makeProps({ chatInput: 'Before talk', onChatInput, onSend, onSpokenTurn })} />,
    )
    const box = screen.getByLabelText('Ask a question')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)

    expect(await screen.findByTestId('mic-button')).toBeInTheDocument()
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Talk it through' })))
    expect(await screen.findByRole('button', { name: 'End conversation' })).toBeInTheDocument()
    rerender(<ChatView {...makeProps({ chatInput: 'During talk', onChatInput, onSend, onSpokenTurn })} />)
    fireEvent.keyDown(screen.getByLabelText('Ask a question'), { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(onSpokenTurn).toHaveBeenCalledWith('During talk'))
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})

describe('Voice settings focus (#426)', () => {
  it('scrolls the Voice section into view when autoFocus is set', async () => {
    voiceOn()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<VoiceSettings autoFocus />)
    expect(await screen.findByTestId('voice-settings')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    spy.mockRestore()
  })

  it('passes autoFocus through the AI providers dialog', async () => {
    voiceOn()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(
      <AiSettingsDialog
        open
        advanced={false}
        llmStatus={makeLlmStatus()}
        llmChecking={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onAddProvider={vi.fn()}
        onEditProvider={vi.fn()}
        onError={vi.fn()}
        onUseAdvanced={vi.fn()}
        focus="voice"
      />,
    )
    expect(await screen.findByTestId('voice-settings')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    spy.mockRestore()
  })
})
