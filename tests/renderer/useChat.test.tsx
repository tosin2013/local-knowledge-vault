import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChat, type UseChatDeps } from '../../src/hooks/useChat'
import { makeMessage, makeProfile, makePrompt, makeSession } from './lkv'

function makeDeps(overrides: Partial<UseChatDeps> = {}): UseChatDeps {
  return {
    prompts: [],
    setBusy: vi.fn(),
    setError: vi.fn(),
    setStatusMsg: vi.fn(),
    setMode: vi.fn(),
    advanced: false,
    busy: false,
    ...overrides,
  }
}

describe('useChat', () => {
  it('refreshes sessions', async () => {
    const lkv = window.lkv as any
    lkv.chat.listSessions.mockResolvedValue([makeSession('s_1', 'My chat')])
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.refreshSessions()
    })
    expect(result.current.sessions).toEqual([makeSession('s_1', 'My chat')])
  })

  it('refreshes profiles', async () => {
    const lkv = window.lkv as any
    lkv.profiles.list.mockResolvedValue([makeProfile('prf_1')])
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.refreshProfiles()
    })
    expect(result.current.userProfiles).toEqual([makeProfile('prf_1')])
  })

  it('starts a new chat', async () => {
    const lkv = window.lkv as any
    lkv.chat.createSession.mockResolvedValue(makeSession('s_9', 'New chat'))
    const deps = makeDeps()
    const { result } = renderHook(() => useChat(deps))
    await act(async () => {
      await result.current.onNewChat()
    })
    expect(result.current.activeSessionId).toBe('s_9')
    expect(deps.setMode).toHaveBeenCalledWith('chat')
  })

  it('selects a session and loads messages', async () => {
    const lkv = window.lkv as any
    lkv.chat.listMessages.mockResolvedValue([makeMessage()])
    const deps = makeDeps()
    const { result } = renderHook(() => useChat(deps))
    await act(async () => {
      await result.current.onSelectSession('s_1')
    })
    expect(result.current.messages).toEqual([makeMessage()])
  })

  it('deletes a session', async () => {
    const lkv = window.lkv as any
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.onDeleteSession('s_1')
    })
    expect(lkv.chat.deleteSession).toHaveBeenCalledWith('s_1')
  })

  it('sends a chat message', async () => {
    const lkv = window.lkv as any
    lkv.chat.send.mockResolvedValue({ messages: [makeMessage()], session: makeSession('s_1'), offline: false })
    const { result } = renderHook(() => useChat(makeDeps()))
    act(() => result.current.setChatInput('hello'))
    await act(async () => {
      await result.current.onSendChat()
    })
    expect(lkv.chat.send).toHaveBeenCalled()
    expect(result.current.messages).toEqual([makeMessage()])
  })

  it('exports a citation pack', async () => {
    const lkv = window.lkv as any
    lkv.chat.listSessions.mockResolvedValue([makeSession('s_1')])
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.refreshSessions()
      await result.current.onSelectSession('s_1')
    })
    act(() => {
      result.current.setChatInput('hello')
    })
    await act(async () => {
      await result.current.onSendChat()
    })
    await act(async () => {
      await result.current.onExportCitationPack()
    })
    expect(lkv.citationPack.export).toHaveBeenCalled()
  })

  it('changes to a builtin profile', () => {
    const deps = makeDeps({ prompts: [makePrompt('prm_56ba1ab41bfe4042', 'Gorgias reader')] })
    const { result } = renderHook(() => useChat(deps))
    act(() => result.current.onProfileChange('gorgias'))
    expect(result.current.selectedProfileId).toBe('gorgias')
  })

  it('saves a user profile', async () => {
    const lkv = window.lkv as any
    lkv.profiles.create.mockResolvedValue(makeProfile('prf_new', { name: 'Saved' }))
    const deps = makeDeps({ prompts: [makePrompt('prm_1', 'Grounded default')] })
    const { result } = renderHook(() => useChat(deps))
    act(() => result.current.setProfileSaveName('Saved'))
    await act(async () => {
      await result.current.onSaveAsProfile()
    })
    expect(lkv.profiles.create).toHaveBeenCalled()
    expect(result.current.profileSaveOpen).toBe(false)
  })

  it('renames a user profile', async () => {
    const lkv = window.lkv as any
    lkv.profiles.list.mockResolvedValue([makeProfile('prf_1', { name: 'Old', prompt_id: 'prm_1' })])
    lkv.profiles.update.mockResolvedValue(makeProfile('prf_1', { name: 'Renamed' }))
    const deps = makeDeps({ prompts: [makePrompt('prm_1', 'Grounded default')] })
    const { result } = renderHook(() => useChat(deps))
    await act(async () => {
      await result.current.refreshProfiles()
    })
    act(() => result.current.onProfileChange('prf_1'))
    act(() => result.current.setProfileRenameName('Renamed'))
    await act(async () => {
      await result.current.onRenameProfile()
    })
    expect(lkv.profiles.update).toHaveBeenCalled()
  })

  it('deletes a user profile', async () => {
    const lkv = window.lkv as any
    lkv.profiles.list.mockResolvedValue([makeProfile('prf_1', { prompt_id: 'prm_1' })])
    const deps = makeDeps({ prompts: [makePrompt('prm_1', 'Grounded default')] })
    const { result } = renderHook(() => useChat(deps))
    await act(async () => {
      await result.current.refreshProfiles()
    })
    act(() => result.current.onProfileChange('prf_1'))
    await act(async () => {
      await result.current.onDeleteProfile()
    })
    expect(lkv.profiles.delete).toHaveBeenCalledWith('prf_1')
  })

  it('changes the personality while keeping notes-from', () => {
    const deps = makeDeps({ prompts: [makePrompt('prm_1')] })
    const { result } = renderHook(() => useChat(deps))
    act(() => result.current.onNotesFromChange('Work'))
    act(() => result.current.onChatPromptChange('prm_1'))
    expect(result.current.project).toBe('Work')
  })

  it('re-picks the profile when the selected prompt is deleted', () => {
    const prompts = [makePrompt('prm_1', 'Grounded default'), makePrompt('prm_2', 'Other')]
    const deps = makeDeps({ prompts })
    const { result } = renderHook(() => useChat(deps))
    act(() => result.current.onChatPromptChange('prm_2'))
    expect(result.current.selectedPromptId).toBe('prm_2')
    act(() => result.current.handlePromptDeleted('prm_2'))
    expect(result.current.selectedPromptId).toBe('prm_1')
  })

  it('hydrates the last profile when prompts are available', async () => {
    const lkv = window.lkv as any
    lkv.profiles.list.mockResolvedValue([])
    const prompts = [makePrompt('prm_1', 'Grounded default')]
    const { result } = renderHook(() => useChat(makeDeps({ prompts })))
    await act(async () => {
      await result.current.refreshProfiles()
    })
    await waitFor(() => expect(result.current.selectedPromptId).toBe('prm_1'))
    expect(result.current.selectedProfileId).toBe('grounded-helper')
  })

  it('defaults the first-run Ask scope to the Vault guide project', async () => {
    const lkv = window.lkv as any
    lkv.profiles.list.mockResolvedValue([])
    const prompts = [makePrompt('prm_1', 'Grounded default')]
    const { result } = renderHook(() => useChat(makeDeps({ prompts })))
    await act(async () => {
      await result.current.refreshProfiles()
    })
    await waitFor(() => expect(result.current.project).toBe('Vault guide'))
    expect(result.current.askEmpty.title).toBe('Ask about the Vault guide')
  })

  it('exposes the scope hint and ask-empty copy', () => {
    const prompts = [makePrompt('prm_1', 'Grounded default')]
    const { result } = renderHook(() => useChat(makeDeps({ prompts })))
    expect(result.current.askEmpty.title).toContain('Ask anything')
  })

  it('shows the user message optimistically before the reply arrives', async () => {
    const lkv = window.lkv as any
    let resolveSend!: (v: unknown) => void
    lkv.chat.send.mockImplementation(() => new Promise((r) => { resolveSend = r }))
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.onNewChat()
    })
    act(() => result.current.setChatInput('hello'))
    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.onSendChat()
    })
    expect(result.current.messages.some((m) => m.role === 'user' && m.content === 'hello')).toBe(true)
    expect(result.current.sending).toBe(true)
    await act(async () => {
      resolveSend({ messages: [makeMessage()], session: makeSession('s_1'), offline: false })
      await sendPromise
    })
    expect(result.current.messages).toEqual([makeMessage()])
  })

  it('does not overwrite another session when a reply arrives late', async () => {
    const lkv = window.lkv as any
    let resolveSend!: (v: unknown) => void
    lkv.chat.send.mockImplementation(() => new Promise((r) => { resolveSend = r }))
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.onNewChat()
    })
    act(() => result.current.setChatInput('hello'))
    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.onSendChat()
    })
    lkv.chat.listMessages.mockResolvedValue([makeMessage({ session_id: 's_2', content: 'other thread' })])
    await act(async () => {
      await result.current.onSelectSession('s_2')
    })
    await act(async () => {
      resolveSend({ messages: [makeMessage()], session: makeSession('s_1'), offline: false })
      await sendPromise
    })
    expect(result.current.messages).toEqual([
      makeMessage({ session_id: 's_2', content: 'other thread' }),
    ])
  })

  it('ignores a second send while one is in flight', async () => {
    const lkv = window.lkv as any
    let resolveSend!: (v: unknown) => void
    lkv.chat.send.mockImplementation(() => new Promise((r) => { resolveSend = r }))
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.onNewChat()
    })
    act(() => result.current.setChatInput('first'))
    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.onSendChat()
    })
    act(() => result.current.setChatInput('second'))
    await act(async () => {
      await result.current.onSendChat()
    })
    expect(lkv.chat.send).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveSend({ messages: [makeMessage()], session: makeSession('s_1'), offline: false })
      await sendPromise
    })
  })

  it('reports a new-chat failure instead of failing silently', async () => {
    const lkv = window.lkv as any
    lkv.chat.createSession.mockRejectedValue(new Error('boom'))
    const deps = makeDeps()
    const { result } = renderHook(() => useChat(deps))
    await act(async () => {
      await result.current.onNewChat()
    })
    expect(deps.setError).toHaveBeenCalledWith('boom')
  })

  it('reports a delete-session failure instead of failing silently', async () => {
    const lkv = window.lkv as any
    lkv.chat.deleteSession.mockRejectedValue(new Error('boom'))
    const deps = makeDeps()
    const { result } = renderHook(() => useChat(deps))
    await act(async () => {
      await result.current.onDeleteSession('s_1')
    })
    expect(deps.setError).toHaveBeenCalledWith('boom')
  })

  it('restores the question when a send fails', async () => {
    const lkv = window.lkv as any
    lkv.chat.send.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useChat(makeDeps()))
    await act(async () => {
      await result.current.onNewChat()
    })
    act(() => result.current.setChatInput('my question'))
    await act(async () => {
      await result.current.onSendChat()
    })
    expect(result.current.chatInput).toBe('my question')
    expect(result.current.messages).toEqual([])
  })
})
