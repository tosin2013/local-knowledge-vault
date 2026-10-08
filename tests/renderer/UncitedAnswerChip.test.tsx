import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { UncitedAnswerChip } from '../../src/components/ai/UncitedAnswerChip'
import { ChatView, type ChatViewProps } from '../../src/features/ChatView'
import { makeLlmStatus, makeMessage } from './lkv'

// #235 / #248: "No notes cited" is per-message metadata (messages.uncited), shown as a chip.
// It must never be part of the answer text, and honest "not in your notes" answers are not flagged.

function chatProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  const noop = vi.fn()
  return {
    advanced: false, busy: false, sending: false, llmStatus: makeLlmStatus(), llmChecking: false,
    showFirstRun: false, showSmallHint: false, askEmpty: { title: 'Ask anything', body: '' }, quickAsks: [],
    messages: [], chatOffline: false, threadEndRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    selectedProfileId: 'grounded-helper', userProfiles: [], selectedUserProfile: undefined, prompts: [],
    selectedPromptId: '', projectOptions: [], notesFrom: '', profileRenameOpen: false, profileRenameName: '',
    profileSaveOpen: false, profileSaveName: '', profileBusy: false, askCustomizeOpen: false,
    filterSummary: 'All notes', stayingInGorgias: false, scopeCoupleHint: null, chatInput: '',
    chatPlaceholder: 'Ask about your notes…', sessions: [], activeSessionId: null,
    onRecheck: noop, onAddProvider: noop, onEditProvider: noop, onError: noop, onDismissSmallHint: noop,
    onChatInput: noop, onSelectNote: noop, onProfileChange: noop, onOpenRename: noop, onRenameName: noop,
    onRename: noop, onRenameCancel: noop, onDeleteProfile: noop, onAskCustomize: noop, onChatPrompt: noop,
    onNotesFrom: noop, onOpenProfileSave: noop, onProfileSaveName: noop, onSaveAsProfile: noop,
    onProfileSaveCancel: noop, onSend: noop, onNewChat: noop, onExportCitationPack: noop,
    onSaveAsNote: vi.fn(), onSelectSession: noop, onDeleteSession: noop,
    ...overrides,
  }
}

describe('UncitedAnswerChip', () => {
  it('shows a "No notes cited" chip with an explanation when uncited is true', () => {
    render(<UncitedAnswerChip uncited />)
    const chip = screen.getByTestId('uncited-answer-chip')
    expect(chip).toHaveTextContent('No notes cited')
    expect(chip.getAttribute('aria-label')).toMatch(/cites none of your notes/i)
  })

  it('renders nothing when uncited is false or missing', () => {
    const { container, rerender } = render(<UncitedAnswerChip uncited={false} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<UncitedAnswerChip />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('ChatView and the uncited flag', () => {
  it('flags an uncited answer with the chip, not by changing its text', () => {
    const onSaveAsNote = vi.fn()
    const content = 'Habits compound over time.'
    render(<ChatView {...chatProps({
      onSaveAsNote,
      messages: [makeMessage({ content, citations_json: null, uncited: true })],
    })} />)
    expect(screen.getByTestId('uncited-answer-chip')).toBeInTheDocument()
    const answer = screen.getByText(content)
    expect(answer.textContent).toBe(content)
    expect(answer.textContent).not.toMatch(/No notes cited/)
    fireEvent.click(screen.getByRole('button', { name: 'Save as note' }))
    expect(onSaveAsNote).toHaveBeenCalledWith(content, [])
  })

  it('does not flag an honest "not in your notes" answer', () => {
    render(<ChatView {...chatProps({
      messages: [makeMessage({ content: "I couldn't find that in your notes.", citations_json: null, uncited: false })],
    })} />)
    expect(screen.getByText("I couldn't find that in your notes.")).toBeInTheDocument()
    expect(screen.queryByTestId('uncited-answer-chip')).not.toBeInTheDocument()
    expect(screen.queryByText(/No notes cited/)).not.toBeInTheDocument()
  })

  it('does not flag a cited answer', () => {
    render(<ChatView {...chatProps({ messages: [makeMessage()] })} />)
    expect(screen.getByText('[1] Note title')).toBeInTheDocument()
    expect(screen.queryByTestId('uncited-answer-chip')).not.toBeInTheDocument()
  })
})
