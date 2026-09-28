import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useProviders } from '../../src/hooks/useProviders'
import { makeLlmStatus } from './lkv'

describe('useProviders', () => {
  it('refreshes llm status on demand', async () => {
    const lkv = window.lkv as any
    lkv.llm.status.mockResolvedValue(makeLlmStatus({ message: 'online' }))
    const { result } = renderHook(() => useProviders())
    await act(async () => {
      await result.current.refreshLlm()
    })
    expect(result.current.llmStatus?.message).toBe('online')
  })

  it('falls back to an offline status when llm.status rejects', async () => {
    const lkv = window.lkv as any
    lkv.llm.status.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useProviders())
    await act(async () => {
      await result.current.refreshLlm()
    })
    expect(result.current.llmStatus?.message).toBe('AI offline — search still works')
  })

  it('rechecks and loads provider presets', async () => {
    const lkv = window.lkv as any
    lkv.providers.list.mockResolvedValue({ providers: [], selected: 'auto', presets: [{ id: 'openai' }] })
    const { result } = renderHook(() => useProviders())
    await act(async () => {
      await result.current.recheckLlm()
    })
    expect(lkv.providers.list).toHaveBeenCalled()
    expect(result.current.providerPresets).toEqual([{ id: 'openai' }])
  })

  it('opens the add-provider dialog with an optional preset', () => {
    const { result } = renderHook(() => useProviders())
    act(() => result.current.openAddProvider('openrouter'))
    expect(result.current.providerDialogOpen).toBe(true)
    expect(result.current.providerInitialPreset).toBe('openrouter')
    expect(result.current.editingProvider).toBeNull()
  })

  it('refreshes plugin state and rechecks on the change event', async () => {
    const lkv = window.lkv as any
    lkv.plugins.list.mockResolvedValue({ plugins: [], errors: [], pluginsDir: '', disabled: ['media-chat'] })
    const { result } = renderHook(() => useProviders())
    await waitFor(() => expect(result.current.disabledPlugins).toEqual(['media-chat']))
  })
})
