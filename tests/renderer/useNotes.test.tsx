import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNotes, type UseNotesDeps } from '../../src/hooks/useNotes'
import { makeHit, makeImportResult, makeItem } from './lkv'

function makeDeps(overrides: Partial<UseNotesDeps> = {}): UseNotesDeps {
  return {
    setBusy: vi.fn(),
    setError: vi.fn(),
    setStatusMsg: vi.fn(),
    advanced: false,
    setMode: vi.fn(),
    ...overrides,
  }
}

describe('useNotes', () => {
  it('refreshes the list', async () => {
    const lkv = window.lkv as any
    lkv.items.list.mockResolvedValue([makeItem('itm_1')])
    const { result } = renderHook(() => useNotes(makeDeps()))
    await act(async () => {
      await result.current.refreshList()
    })
    expect(result.current.items).toEqual([makeItem('itm_1')])
  })

  it('runs a search', async () => {
    const lkv = window.lkv as any
    lkv.search.query.mockResolvedValue({ hits: [makeHit('itm_1')] })
    const deps = makeDeps()
    const { result } = renderHook(() => useNotes(deps))
    await act(async () => {
      await result.current.runSearch('query')
    })
    expect(deps.setMode).toHaveBeenCalledWith('search')
    expect(result.current.hits).toEqual([makeHit('itm_1')])
  })

  it('creates a new draft', () => {
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.onNewNote())
    expect(result.current.isNewDraft).toBe(true)
    expect(result.current.notePeekOpen).toBe(true)
    expect(result.current.peekEditing).toBe(true)
  })

  it('saves a new note', async () => {
    const lkv = window.lkv as any
    lkv.items.create.mockResolvedValue(makeItem('itm_created', { title: 'Saved' }))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.onNewNote())
    await act(async () => {
      await result.current.onSave()
    })
    expect(lkv.items.create).toHaveBeenCalled()
    expect(result.current.isNewDraft).toBe(false)
  })

  it('saves an existing note via update', async () => {
    const lkv = window.lkv as any
    lkv.items.get.mockResolvedValue(makeItem('itm_1', { title: 'Before' }))
    lkv.items.update.mockResolvedValue(makeItem('itm_1', { title: 'Updated' }))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => {
      result.current.selectItem('itm_1')
    })
    await waitFor(() => expect(result.current.draft?.id).toBe('itm_1'))
    act(() => {
      result.current.patchDraft('title', 'Updated')
    })
    await act(async () => {
      await result.current.onSave()
    })
    expect(lkv.items.update).toHaveBeenCalledWith('itm_1', expect.objectContaining({ title: 'Updated' }))
  })

  it('deletes a note', async () => {
    const lkv = window.lkv as any
    lkv.items.get.mockResolvedValue(makeItem('itm_1'))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => {
      result.current.selectItem('itm_1')
    })
    await waitFor(() => expect(result.current.draft?.id).toBe('itm_1'))
    await act(async () => {
      await result.current.onDelete()
    })
    expect(lkv.items.delete).toHaveBeenCalledWith('itm_1')
  })

  it('imports from a URL', async () => {
    const lkv = window.lkv as any
    lkv.import.fromUrl.mockResolvedValue(makeImportResult())
    const deps = makeDeps()
    const { result } = renderHook(() => useNotes(deps))
    act(() => result.current.setImportUrl('https://example.com/article'))
    await act(async () => {
      await result.current.onImportFromUrl()
    })
    expect(lkv.import.fromUrl).toHaveBeenCalledWith('https://example.com/article')
    expect(deps.setStatusMsg).toHaveBeenCalled()
  })

  it('rejects an invalid import URL', async () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useNotes(deps))
    act(() => result.current.setImportUrl('not a url'))
    await act(async () => {
      await result.current.onImportFromUrl()
    })
    expect(deps.setError).toHaveBeenCalledWith('Paste a full http:// or https:// URL to import')
  })

  it('patches the draft and marks it dirty', async () => {
    const lkv = window.lkv as any
    lkv.items.get.mockResolvedValue(makeItem('itm_1'))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => {
      result.current.selectItem('itm_1')
    })
    await waitFor(() => expect(result.current.draft?.id).toBe('itm_1'))
    act(() => result.current.patchDraft('body', 'new body'))
    expect(result.current.draft?.body).toBe('new body')
    expect(result.current.dirty).toBe(true)
  })

  it('loads projects from the projects API', async () => {
    const lkv = window.lkv as any
    lkv.projects.list.mockResolvedValue([
      { name: 'Work', count: 2 },
      { name: 'Home', count: 1 },
    ])
    const { result } = renderHook(() => useNotes(makeDeps()))
    await act(async () => {
      await result.current.refreshProjects()
    })
    expect(result.current.projectOptions).toEqual(['Work', 'Home'])
    expect(result.current.projects).toEqual([
      { name: 'Work', count: 2 },
      { name: 'Home', count: 1 },
    ])
  })
})
