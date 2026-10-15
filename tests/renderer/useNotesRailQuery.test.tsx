import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNotes } from '../../src/hooks/useNotes'
import { lkvMock, makeItem } from './lkv'

function makeDeps() {
  return {
    setBusy: vi.fn(),
    setError: vi.fn(),
    setStatusMsg: vi.fn(),
    advanced: true,
    setMode: vi.fn(),
  }
}

describe('useNotes rail query (#295)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    lkvMock().items.list.mockResolvedValue([makeItem('itm_1', { title: 'Alpha', body: '' })])
  })
  afterEach(() => vi.useRealTimers())

  it('passes the rail query to items.list (#295)', async () => {
    const lkv = lkvMock()
    const { result } = renderHook(() => useNotes(makeDeps()))
    // Mount does not fetch: the startup refresh (#292) owns that.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(lkv.items.list).not.toHaveBeenCalled()

    act(() => result.current.setRailQuery('alpha'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(lkv.items.list).toHaveBeenLastCalledWith({
      filters: { para: '', kind: '', status: '', project: '' },
      query: 'alpha',
    })
  })

  it('debounces a typing burst into one query (#295)', async () => {
    const lkv = lkvMock()
    const { result } = renderHook(() => useNotes(makeDeps()))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    lkv.items.list.mockClear()
    act(() => result.current.setRailQuery('a'))
    act(() => result.current.setRailQuery('al'))
    act(() => result.current.setRailQuery('alpha'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(lkv.items.list).toHaveBeenCalledTimes(1)
    expect(lkv.items.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'alpha' }),
    )
  })

  it('renders lightweight rows without note bodies (#295)', async () => {
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.setRailQuery('alpha'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ id: 'itm_1', title: 'Alpha', body: '' })
  })
})
