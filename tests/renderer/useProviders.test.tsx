import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useProviders } from '../../src/hooks/useProviders'
import { lkvMock, makeLlmStatus, makePreset } from './lkv'

describe('useProviders', () => {
  it('refreshes llm status on demand', async () => {
    const lkv = lkvMock()
    lkv.llm.status.mockResolvedValue(makeLlmStatus({ message: 'online' }))
    const { result } = renderHook(() => useProviders())
    await act(async () => {
      await result.current.refreshLlm()
    })
    expect(result.current.llmStatus?.message).toBe('online')
  })

  it('falls back to an offline status when llm.status rejects', async () => {
    const lkv = lkvMock()
    lkv.llm.status.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useProviders())
    await act(async () => {
      await result.current.refreshLlm()
    })
    expect(result.current.llmStatus?.message).toBe('AI offline — search still works')
  })

  it('rechecks and loads provider presets', async () => {
    const lkv = lkvMock()
    lkv.providers.list.mockResolvedValue({ providers: [], selected: 'auto', presets: [makePreset('openai')] })
    const { result } = renderHook(() => useProviders())
    await act(async () => {
      await result.current.recheckLlm()
    })
    expect(lkv.providers.list).toHaveBeenCalled()
    expect(result.current.providerPresets).toEqual([makePreset('openai')])
  })

  it('opens the add-provider dialog with an optional preset', () => {
    const { result } = renderHook(() => useProviders())
    act(() => result.current.openAddProvider('openrouter'))
    expect(result.current.providerDialogOpen).toBe(true)
    expect(result.current.providerInitialPreset).toBe('openrouter')
    expect(result.current.editingProvider).toBeNull()
  })

  it('refreshes plugin state and rechecks on the change event', async () => {
    const lkv = lkvMock()
    lkv.plugins.list.mockResolvedValue({ plugins: [], errors: [], pluginsDir: '', disabled: ['media-chat'] })
    const { result } = renderHook(() => useProviders())
    await waitFor(() => expect(result.current.disabledPlugins).toEqual(['media-chat']))
  })
})
