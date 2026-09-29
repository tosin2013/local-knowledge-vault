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
    expect(lkv.items.trash).toHaveBeenCalledWith('itm_1')
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

  it('flags a note as missing when get returns null', async () => {
    const lkv = window.lkv as any
    lkv.items.get.mockResolvedValue(null)
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => {
      result.current.selectItem('itm_gone')
    })
    await waitFor(() => expect(result.current.noteMissing).toBe(true))
    expect(result.current.draft).toBeNull()
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

  it('opens a pre-filled draft (save answer as note)', () => {
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.openPrefilledDraft({ title: 'Saved answer', body: 'content', status: 'ai-draft' }))
    expect(result.current.isNewDraft).toBe(true)
    expect(result.current.peekEditing).toBe(true)
    expect(result.current.draft?.title).toBe('Saved answer')
    expect(result.current.draft?.status).toBe('ai-draft')
  })

  it('saves a new AI-draft answer still as ai-draft', async () => {
    const lkv = window.lkv as any
    lkv.items.create.mockImplementation((input: { status: string }) => Promise.resolve(makeItem('itm_new', input)))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.openPrefilledDraft({ title: 'A', body: 'b', status: 'ai-draft' }))
    await act(async () => {
      await result.current.onSave()
    })
    expect(lkv.items.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'ai-draft' }))
  })

  it('editing an existing AI draft saves it as active', async () => {
    const lkv = window.lkv as any
    lkv.items.get.mockResolvedValue(makeItem('itm_1', { status: 'ai-draft' }))
    lkv.items.update.mockResolvedValue(makeItem('itm_1', { status: 'active' }))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.selectItem('itm_1'))
    await waitFor(() => expect(result.current.draft?.id).toBe('itm_1'))
    act(() => result.current.patchDraft('body', 'edited'))
    await act(async () => {
      await result.current.onSave()
    })
    expect(lkv.items.update).toHaveBeenCalledWith('itm_1', expect.objectContaining({ status: 'active' }))
  })

  it('confirms an AI draft without editing', async () => {
    const lkv = window.lkv as any
    lkv.items.get.mockResolvedValue(makeItem('itm_1', { status: 'ai-draft' }))
    lkv.items.update.mockResolvedValue(makeItem('itm_1', { status: 'active' }))
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => result.current.selectItem('itm_1'))
    await waitFor(() => expect(result.current.draft?.id).toBe('itm_1'))
    await act(async () => {
      await result.current.confirmDraft()
    })
    expect(lkv.items.update).toHaveBeenCalledWith('itm_1', { status: 'active' })
  })

  it('hides transcript chunks by default and shows them on toggle', async () => {
    const lkv = window.lkv as any
    lkv.items.list.mockResolvedValue([
      makeItem('itm_1', { title: 'My note', kind: 'note' }),
      makeItem('itm_2', { title: 'Transcript', kind: 'transcript' }),
    ])
    const { result } = renderHook(() => useNotes(makeDeps()))
    await act(async () => {
      await result.current.refreshList()
    })
    expect(result.current.visibleItems.map((i) => i.id)).toEqual(['itm_1'])
    act(() => result.current.setShowTranscripts(true))
    expect(result.current.visibleItems.map((i) => i.id)).toEqual(['itm_1', 'itm_2'])
  })

  it('filters the rail list as you type', async () => {
    const lkv = window.lkv as any
    lkv.items.list.mockResolvedValue([
      makeItem('itm_1', { title: 'Alpha note' }),
      makeItem('itm_2', { title: 'Beta note' }),
    ])
    const { result } = renderHook(() => useNotes(makeDeps()))
    await act(async () => {
      await result.current.refreshList()
    })
    act(() => result.current.setRailQuery('alpha'))
    expect(result.current.visibleItems.map((i) => i.id)).toEqual(['itm_1'])
  })

  it('bulk-trashes selected notes', async () => {
    const lkv = window.lkv as any
    const { result } = renderHook(() => useNotes(makeDeps()))
    act(() => {
      result.current.toggleBulkSelect('itm_1')
      result.current.toggleBulkSelect('itm_2')
    })
    expect(result.current.bulkSelected).toEqual(new Set(['itm_1', 'itm_2']))
    await act(async () => {
      await result.current.bulkTrash()
    })
    expect(lkv.items.trash).toHaveBeenCalledWith('itm_1')
    expect(lkv.items.trash).toHaveBeenCalledWith('itm_2')
    expect(result.current.bulkSelected.size).toBe(0)
  })

  it('restores a trashed note and empties the trash', async () => {
    const lkv = window.lkv as any
    lkv.items.listTrashed.mockResolvedValue([makeItem('itm_1', { title: 'Trashed' })])
    const { result } = renderHook(() => useNotes(makeDeps()))
    await act(async () => {
      await result.current.refreshTrashed()
    })
    expect(result.current.trashed.map((i) => i.id)).toEqual(['itm_1'])
    await act(async () => {
      await result.current.restoreItem('itm_1')
    })
    expect(lkv.items.restore).toHaveBeenCalledWith('itm_1')
    await act(async () => {
      await result.current.emptyTrash()
    })
    expect(lkv.items.emptyTrash).toHaveBeenCalled()
  })
})
