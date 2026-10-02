import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePrompts, type UsePromptsDeps } from '../../src/hooks/usePrompts'
import { lkvMock, makePrompt } from './lkv'

function makeDeps(overrides: Partial<UsePromptsDeps> = {}): UsePromptsDeps {
  return {
    setBusy: vi.fn(),
    advanced: false,
    setMode: vi.fn(),
    onPromptDeleted: vi.fn(),
    ...overrides,
  }
}

describe('usePrompts', () => {
  it('refreshes prompts', async () => {
    const lkv = lkvMock()
    lkv.prompts.list.mockResolvedValue([makePrompt('prm_1', 'Grounded default')])
    const { result } = renderHook(() => usePrompts(makeDeps()))
    await act(async () => {
      await result.current.refreshPrompts()
    })
    expect(result.current.prompts).toEqual([makePrompt('prm_1', 'Grounded default')])
  })

  it('starts a new prompt', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => usePrompts(deps))
    act(() => result.current.onNewPrompt())
    expect(deps.setMode).toHaveBeenCalledWith('prompts')
    expect(result.current.promptBodyOpen).toBe(true)
  })

  it('selects a prompt into the editor', () => {
    const { result } = renderHook(() => usePrompts(makeDeps()))
    act(() => result.current.onSelectPrompt(makePrompt('prm_1', 'Concise', 'Be concise')))
    expect(result.current.editingPrompt?.id).toBe('prm_1')
    expect(result.current.promptDraft.name).toBe('Concise')
  })

  it('creates a prompt on save', async () => {
    const lkv = lkvMock()
    lkv.prompts.create.mockResolvedValue(makePrompt('prm_new', 'New', 'Body'))
    const { result } = renderHook(() => usePrompts(makeDeps()))
    act(() => result.current.setPromptDraft({ name: 'New', body: 'Body', description: '' }))
    await act(async () => {
      await result.current.onSavePrompt()
    })
    expect(lkv.prompts.create).toHaveBeenCalledWith({ name: 'New', body: 'Body', description: null })
  })

  it('updates an existing prompt on save', async () => {
    const lkv = lkvMock()
    lkv.prompts.update.mockResolvedValue(makePrompt('prm_1', 'Updated', 'Body'))
    const { result } = renderHook(() => usePrompts(makeDeps()))
    act(() => result.current.onSelectPrompt(makePrompt('prm_1', 'Old', 'Body')))
    act(() => result.current.setPromptDraft({ name: 'Updated', body: 'Body', description: '' }))
    await act(async () => {
      await result.current.onSavePrompt()
    })
    expect(lkv.prompts.update).toHaveBeenCalledWith('prm_1', { name: 'Updated', body: 'Body', description: null })
  })

  it('deletes a prompt and notifies', async () => {
    const lkv = lkvMock()
    const deps = makeDeps()
    const { result } = renderHook(() => usePrompts(deps))
    act(() => result.current.onSelectPrompt(makePrompt('prm_1', 'Old', 'Body')))
    await act(async () => {
      await result.current.onDeletePrompt()
    })
    expect(lkv.prompts.delete).toHaveBeenCalledWith('prm_1')
    expect(deps.onPromptDeleted).toHaveBeenCalledWith('prm_1')
  })

  it('does not save a blank prompt', async () => {
    const lkv = lkvMock()
    const { result } = renderHook(() => usePrompts(makeDeps()))
    await act(async () => {
      await result.current.onSavePrompt()
    })
    expect(lkv.prompts.create).not.toHaveBeenCalled()
  })
})
