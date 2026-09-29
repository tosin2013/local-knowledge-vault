import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ChatView, type ChatViewProps } from '../../src/features/ChatView'
import { makeLlmStatus, makeMessage, makeProfile, makePrompt, makeSession } from './lkv'

function makeProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  const threadEndRef = { current: null } as React.RefObject<HTMLDivElement | null>
  return {
    advanced: false,
    busy: false,
    llmStatus: makeLlmStatus(),
    llmChecking: false,
    showFirstRun: false,
    showSmallHint: false,
    askEmpty: { title: 'Ask anything', body: 'Example question' },
    quickAsks: [{ q: 'What did I write about habits?', pack: 'demo' }],
    messages: [],
    chatOffline: false,
    threadEndRef,
    selectedProfileId: 'grounded-helper',
    userProfiles: [],
    selectedUserProfile: undefined,
    prompts: [],
    selectedPromptId: '',
    projectOptions: [],
    notesFrom: '',
    profileRenameOpen: false,
    profileRenameName: '',
    profileSaveOpen: false,
    profileSaveName: '',
    profileBusy: false,
    askCustomizeOpen: false,
    filterSummary: 'All notes',
    stayingInGorgias: false,
    scopeCoupleHint: null,
    chatInput: '',
    chatPlaceholder: 'Ask about your notes…',
    sessions: [],
    activeSessionId: null,
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
    onNewChat: vi.fn(),
    onExportCitationPack: vi.fn(),
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    ...overrides,
  }
}

describe('ChatView', () => {
  it('renders the empty state with quick asks', () => {
    const props = makeProps()
    render(<ChatView {...props} />)
    expect(screen.getByText('Ask anything')).toBeInTheDocument()
    expect(screen.getByText('Example question')).toBeInTheDocument()
    fireEvent.click(screen.getByText('What did I write about habits?'))
    expect(props.onChatInput).toHaveBeenCalledWith('What did I write about habits?')
  })

  it('renders messages with citation chips', () => {
    const props = makeProps({ messages: [makeMessage({ content: 'Hello', citations_json: JSON.stringify([{ id: 'itm_1', title: 'Note A' }]) })] })
    render(<ChatView {...props} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Note A'))
    expect(props.onSelectNote).toHaveBeenCalledWith('itm_1')
  })

  it('sends a message', () => {
    const props = makeProps({ chatInput: 'hello' })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(props.onSend).toHaveBeenCalled()
  })

  it('creates a new chat and lists sessions', () => {
    const props = makeProps({ sessions: [makeSession('s_1', 'My chat')], activeSessionId: 's_1' })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByText('New chat'))
    expect(props.onNewChat).toHaveBeenCalled()
    fireEvent.click(screen.getByText('My chat'))
    expect(props.onSelectSession).toHaveBeenCalledWith('s_1')
  })

  it('deletes a session', () => {
    const props = makeProps({ sessions: [makeSession('s_1', 'My chat')], activeSessionId: 's_1' })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByLabelText('Delete session'))
    expect(props.onDeleteSession).toHaveBeenCalledWith('s_1')
  })

  it('exports a citation pack', () => {
    const props = makeProps({ sessions: [makeSession('s_1')], activeSessionId: 's_1', messages: [makeMessage()] })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export citation pack' }))
    expect(props.onExportCitationPack).toHaveBeenCalled()
  })

  it('changes profile and opens customize', () => {
    const props = makeProps({ prompts: [makePrompt('prm_1')] })
    render(<ChatView {...props} />)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Profile' }))
    fireEvent.click(screen.getByRole('option', { name: 'Custom' }))
    expect(props.onProfileChange).toHaveBeenCalledWith('custom')
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
    expect(props.onAskCustomize).toHaveBeenCalledWith(true)
  })

  it('renames a user profile', () => {
    const profile = makeProfile('prf_1', { name: 'Work persona' })
    const props = makeProps({ selectedProfileId: 'prf_1', selectedUserProfile: profile, userProfiles: [profile] })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByText('Rename'))
    expect(props.onOpenRename).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Delete'))
    expect(props.onDeleteProfile).toHaveBeenCalled()
  })

  it('saves a profile from customize', () => {
    const props = makeProps({ askCustomizeOpen: true })
    render(<ChatView {...props} />)
    fireEvent.click(screen.getByText('Save as profile…'))
    expect(props.onOpenProfileSave).toHaveBeenCalled()
  })

  it('shows the providers panel in advanced mode', () => {
    const props = makeProps({ advanced: true, llmStatus: makeLlmStatus() })
    render(<ChatView {...props} />)
    expect(screen.getByText('AI providers')).toBeInTheDocument()
  })

  it('shows the first-run card and small model hint', () => {
    const active = { id: 'ollama', label: 'Ollama', kind: 'ollama' as const, local: true, model: 'qwen3:1b', smallModel: true }
    const props = makeProps({
      showFirstRun: true,
      llmStatus: makeLlmStatus(),
      showSmallHint: true,
    })
    render(<ChatView {...props} />)
    expect(screen.getByTestId('first-run-local-card')).toBeInTheDocument()
  })

  it('shows the chat-offline notice', () => {
    render(<ChatView {...makeProps({ chatOffline: true })} />)
    expect(screen.getByText(/AI unavailable/)).toBeInTheDocument()
  })

  it('shows the scope couple hint', () => {
    render(<ChatView {...makeProps({ scopeCoupleHint: 'Notes scope unchanged', stayingInGorgias: false })} />)
    expect(screen.getAllByText('Notes scope unchanged').length).toBeGreaterThan(0)
  })

  it('labels the Ask composer for screen readers', () => {
    render(<ChatView {...makeProps()} />)
    expect(screen.getByLabelText('Ask a question')).toBeInTheDocument()
  })
})
