import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useChat, type UseChatDeps } from '../../src/hooks/useChat'
import { makeMessage, makeProfile, makePrompt, makeSession } from './lkv'

function makeDeps(overrides: Partial<UseChatDeps> = {}): UseChatDeps {
  return {
    prompts: [],
    filters: { para: '', kind: '', status: '', project: '' },
    setFilters: vi.fn(),
    setKnownProjects: vi.fn(),
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
    const deps = makeDeps({ prompts: [makePrompt('prm_1')], filters: { para: '', kind: '', status: '', project: 'Work' } })
    const { result } = renderHook(() => useChat(deps))
    act(() => result.current.onChatPromptChange('prm_1'))
    expect(deps.setFilters).toHaveBeenCalled()
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

  it('exposes the scope hint and ask-empty copy', () => {
    const prompts = [makePrompt('prm_1', 'Grounded default')]
    const { result } = renderHook(() => useChat(makeDeps({ prompts, filters: { para: '', kind: '', status: '', project: '' } })))
    expect(result.current.askEmpty.title).toContain('Ask anything')
  })
})
