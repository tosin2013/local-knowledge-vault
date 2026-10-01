import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AskGroundedResult, Item, ItemFilters, ProjectSummary, SearchHit } from '../../electron/types'
import {
  emptyFilters,
  isValidHttpUrl,
  makeNewDraftItem,
  NEW_DRAFT_ID,
  paraLabel,
} from '../domain'

export interface UseNotesDeps {
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setStatusMsg: (msg: string | null) => void
  advanced: boolean
  setMode: (mode: 'search' | 'chat' | 'prompts') => void
}

/** Owns the notes rail, Find search, and the note-peek editor. */
export function useNotes(deps: UseNotesDeps) {
  const { setBusy, setError, setStatusMsg, advanced, setMode } = deps

  const [items, setItems] = useState<Item[]>([])
  const [filters, setFilters] = useState<ItemFilters>(emptyFilters)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [isNewDraft, setIsNewDraft] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notePeekOpen, setNotePeekOpen] = useState(false)
  const [peekEditing, setPeekEditing] = useState(false)
  // True when the selected note id no longer resolves (deleted / re-ingested) — #125.
  const [noteMissing, setNoteMissing] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [askResult, setAskResult] = useState<AskGroundedResult | null>(null)
  const [importUrl, setImportUrl] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Rail display: hide transcript (source) chunks by default (#120), filter-as-you-type, sort.
  const [showTranscripts, setShowTranscripts] = useState(false)
  const [railQuery, setRailQuery] = useState('')
  const [railSort, setRailSort] = useState<'updated' | 'title' | 'created'>('updated')
  // Find "show more" pagination.
  const [findLimit, setFindLimit] = useState(20)
  // Trash (soft-delete) + rail bulk-select.
  const [trashed, setTrashed] = useState<Item[]>([])
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  // True while the first-run "Getting started" sample notes exist (#139).
  const [hasSamples, setHasSamples] = useState(false)
  // Total non-trashed notes (drives the genuinely-empty rail state, #189).
  const [count, setCount] = useState(0)

  const refreshList = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.items.list({ filters })
    setItems(list)
    if (window.lkv.items.count) {
      setCount(await window.lkv.items.count())
    }
  }, [filters])

  /** DB-backed project list (exact names + note counts) — the single source of truth. */
  const refreshProjects = useCallback(async () => {
    if (!window.lkv?.projects) return
    const list = await window.lkv.projects.list()
    setProjects(list)
  }, [])

  const runSearch = useCallback(async (textOverride?: string, limitOverride?: number) => {
    if (!window.lkv) return
    const text = textOverride !== undefined ? textOverride : searchText
    setBusy(true)
    setError(null)
    setAskResult(null)
    setMode('search')
    try {
      const res = await window.lkv.search.query({
        text,
        filters: {
          para: filters.para || undefined,
          kind: filters.kind || undefined,
          status: filters.status || undefined,
          project: filters.project || undefined,
        },
        limit: limitOverride ?? findLimit,
      })
      setHits(res.hits)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [searchText, filters, findLimit, setBusy, setError, setMode])

  /** "Show more" in Find: raise the cap and re-query. */
  const loadMoreHits = () => {
    const next = Math.min(findLimit + 20, 100)
    setFindLimit(next)
    void runSearch(undefined, next)
  }

  useEffect(() => {
    if (!selectedId || !window.lkv) {
      if (!isNewDraft) {
        setDraft(null)
        setDirty(false)
        setNoteMissing(false)
      }
      return
    }
    if (selectedId === NEW_DRAFT_ID || isNewDraft) {
      setNoteMissing(false)
      return
    }
    void window.lkv.items.get(selectedId).then((item) => {
      setDraft(item)
      setNoteMissing(!item)
      setDirty(false)
      setIsNewDraft(false)
    })
  }, [selectedId, isNewDraft])

  const openNotePeek = (id: string, opts?: { edit?: boolean }) => {
    if (id !== NEW_DRAFT_ID) {
      setIsNewDraft(false)
    }
    setSelectedId(id)
    setNoteMissing(false)
    setNotePeekOpen(true)
    setPeekEditing(opts?.edit ?? false)
  }

  /** Open note as peek; never steals Ask/Find pane. */
  const selectItem = (id: string, opts?: { edit?: boolean }) => {
    openNotePeek(id, opts)
  }

  const closeNotePeek = () => {
    if (dirty || isNewDraft) {
      const ok = confirm(
        isNewDraft
          ? 'Discard this new note without saving?'
          : 'Discard unsaved changes to this note?',
      )
      if (!ok) return
      setDirty(false)
    }
    setNotePeekOpen(false)
    setPeekEditing(false)
    setNoteMissing(false)
    if (isNewDraft) {
      setIsNewDraft(false)
      setSelectedId(null)
      setDraft(null)
    }
  }

  const onNewNote = () => {
    // Draft-only: no DB row until explicit Save (avoids blank "New note" list rows).
    const item = makeNewDraftItem()
    setIsNewDraft(true)
    setDraft(item)
    setSelectedId(NEW_DRAFT_ID)
    setNoteMissing(false)
    setDirty(false)
    setNotePeekOpen(true)
    setPeekEditing(true)
  }

  /** Open the note editor pre-filled (e.g. "Save as note" from an answer/moment). */
  const openPrefilledDraft = (fields: Partial<Item>) => {
    const item = { ...makeNewDraftItem(), ...fields }
    setIsNewDraft(true)
    setDraft(item)
    setSelectedId(NEW_DRAFT_ID)
    setNoteMissing(false)
    setDirty(true)
    setNotePeekOpen(true)
    setPeekEditing(true)
  }

  const onImportFromUrl = async () => {
    if (!window.lkv?.import?.fromUrl) return
    const url = importUrl.trim()
    if (!isValidHttpUrl(url)) {
      setError('Paste a full http:// or https:// URL to import')
      return
    }
    setImportBusy(true)
    setError(null)
    setStatusMsg(null)
    try {
      const res = await window.lkv.import.fromUrl(url)
      setImportUrl('')
      await refreshList()
      void refreshProjects()
      selectItem(res.item.id)
      const para = paraLabel(res.item.para)
      const kind = res.item.kind || 'article'
      setStatusMsg(`Imported · tagged as ${para} / ${kind}`)
      if (res.warning && advanced) {
        setError(res.warning)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(advanced ? msg : 'Could not import that link. Check the URL and try again.')
      if (advanced) {
        /* raw error already set */
      }
    } finally {
      setImportBusy(false)
    }
  }

  const onSave = async () => {
    if (!window.lkv || !draft) return
    setBusy(true)
    setError(null)
    try {
      const isNew = isNewDraft || draft.id === NEW_DRAFT_ID
      // Editing an already-saved AI draft confirms it (save as active). A brand-new
      // "Save as note" draft keeps its ai-draft status until the user confirms it.
      const status = !isNew && draft.status === 'ai-draft' && dirty ? 'active' : draft.status
      if (isNew) {
        const title = draft.title.trim() || 'Untitled'
        const created = await window.lkv.items.create({
          title,
          body: draft.body,
          summary: draft.summary,
          para: draft.para,
          kind: draft.kind || 'note',
          status: status || 'active',
          project: draft.project,
        })
        setIsNewDraft(false)
        setDraft(created)
        setSelectedId(created.id)
        setDirty(false)
        await refreshList()
        void refreshProjects()
        return
      }
      const updated = await window.lkv.items.update(draft.id, {
        title: draft.title.trim() || 'Untitled',
        body: draft.body,
        summary: draft.summary,
        para: draft.para,
        kind: draft.kind,
        status,
        project: draft.project,
      })
      setDraft(updated)
      setDirty(false)
      await refreshList()
      void refreshProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Delete a note by id (from the rail), with confirmation. */
  const deleteItemById = async (id: string) => {
    if (!window.lkv) return
    let title = id
    try {
      const item = await window.lkv.items.get(id)
      if (item) title = item.title
    } catch {
      /* fall back to id in the confirm message */
    }
    if (!confirm(`Delete "${title}"?`)) return
    await window.lkv.items.delete(id)
    if (selectedId === id) {
      setSelectedId(null)
      setDraft(null)
      setDirty(false)
      setNotePeekOpen(false)
      setPeekEditing(false)
    }
    await refreshList()
    void refreshProjects()
  }

  /** Promote an unconfirmed AI draft to a regular note (without editing). */
  const confirmDraft = async () => {
    if (!window.lkv || !draft || draft.status !== 'ai-draft' || draft.id === NEW_DRAFT_ID) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.lkv.items.update(draft.id, { status: 'active' })
      setDraft(updated)
      setDirty(false)
      await refreshList()
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (!window.lkv || !draft) return
    if (isNewDraft || draft.id === NEW_DRAFT_ID) {
      // Not in DB yet — just discard
      setIsNewDraft(false)
      setSelectedId(null)
      setDraft(null)
      setDirty(false)
      setNotePeekOpen(false)
      setPeekEditing(false)
      return
    }
    // Soft-delete to trash (reversible — no confirm needed).
    setError(null)
    try {
      await window.lkv.items.trash(draft.id)
      setSelectedId(null)
      setDraft(null)
      setDirty(false)
      setNotePeekOpen(false)
      setPeekEditing(false)
      await refreshList()
      void refreshProjects()
      void refreshTrashed()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** Refresh the trash list. */
  const refreshTrashed = async () => {
    if (!window.lkv?.items?.listTrashed) return
    setTrashed(await window.lkv.items.listTrashed())
  }

  /** Refresh whether the first-run "Getting started" samples still exist (#139). */
  const refreshSamples = async () => {
    if (!window.lkv?.items?.listSamples) {
      setHasSamples(false)
      return
    }
    try {
      const samples = await window.lkv.items.listSamples()
      setHasSamples(samples.length > 0)
    } catch {
      setHasSamples(false)
    }
  }

  /** Remove the "Getting started" sample notes in one action, after confirmation. */
  const removeSamples = async () => {
    if (!window.lkv?.items?.removeSamples) return
    if (!confirm('Remove the “Getting started” sample notes?')) return
    setBusy(true)
    setError(null)
    try {
      await window.lkv.items.removeSamples()
      setHasSamples(false)
      await refreshList()
      void refreshProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Toggle one note in the rail bulk-selection set. */
  const toggleBulkSelect = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Move every selected note to the trash. */
  const bulkTrash = async () => {
    if (!window.lkv?.items?.trash || bulkSelected.size === 0) return
    for (const id of bulkSelected) {
      await window.lkv.items.trash(id)
    }
    setBulkSelected(new Set())
    await refreshList()
    void refreshProjects()
    void refreshTrashed()
  }

  /** Restore a trashed note. */
  const restoreItem = async (id: string) => {
    if (!window.lkv?.items?.restore) return
    await window.lkv.items.restore(id)
    await refreshTrashed()
    await refreshList()
    void refreshProjects()
  }

  /** Permanently empty the trash. */
  const emptyTrash = async () => {
    if (!window.lkv?.items?.emptyTrash) return
    await window.lkv.items.emptyTrash()
    await refreshTrashed()
    await refreshList()
    void refreshProjects()
  }

  const patchDraft = <K extends keyof Item>(key: K, value: Item[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setDirty(true)
  }

  const copyItemId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      /* ignore */
    }
  }

  /** Rename a project across its notes + profiles, then refresh. */
  const renameProject = async (from: string, to: string) => {
    if (!window.lkv?.projects) return
    const res = await window.lkv.projects.rename(from, to)
    if ((filters.project ?? '') === from) setFilters((f) => ({ ...f, project: to }))
    await refreshList()
    await refreshProjects()
    return res
  }

  /** Merge `from` into `into` (reassign notes + profiles), then refresh. */
  const mergeProject = async (from: string, into: string) => {
    if (!window.lkv?.projects) return
    const res = await window.lkv.projects.merge(from, into)
    if ((filters.project ?? '') === from) setFilters((f) => ({ ...f, project: into }))
    await refreshList()
    await refreshProjects()
    return res
  }

  /** Delete a project and its notes, then refresh. */
  const deleteProject = async (name: string) => {
    if (!window.lkv?.projects) return
    const res = await window.lkv.projects.delete(name)
    if ((filters.project ?? '') === name) setFilters((f) => ({ ...f, project: '' }))
    await refreshList()
    await refreshProjects()
    return res
  }

  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (filters.para) parts.push(paraLabel(filters.para))
    if (filters.kind) parts.push(filters.kind)
    if (filters.status) parts.push(filters.status)
    if (filters.project) parts.push(filters.project)
    return parts.length ? parts.join(' · ') : 'All notes'
  }, [filters])

  /** Rail list: hide transcript chunks by default, filter-as-you-type, sort. */
  const visibleItems = useMemo(() => {
    let list = items
    if (!showTranscripts) list = list.filter((it) => it.kind !== 'transcript')
    const q = railQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (it) =>
          it.title.toLowerCase().includes(q) ||
          (it.body ?? '').toLowerCase().includes(q) ||
          (it.summary ?? '').toLowerCase().includes(q) ||
          (it.project ?? '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    if (railSort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else if (railSort === 'created') sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
    else sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return sorted
  }, [items, showTranscripts, railQuery, railSort])

  return {
    items,
    visibleItems,
    /** True when the vault has zero non-trashed notes (#189 empty state). */
    isEmpty: count === 0,
    showTranscripts,
    setShowTranscripts,
    railQuery,
    setRailQuery,
    railSort,
    setRailSort,
    findLimit,
    hasMore: hits.length >= findLimit && findLimit < 100,
    filters,
    setFilters,
    selectedId,
    draft,
    dirty,
    isNewDraft,
    notePeekOpen,
    peekEditing,
    noteMissing,
    setPeekEditing,
    searchText,
    setSearchText,
    hits,
    askResult,
    importUrl,
    setImportUrl,
    importBusy,
    projects,
    filtersOpen,
    setFiltersOpen,
    filterSummary,
    projectOptions: projects.map((p) => p.name),
    refreshList,
    refreshProjects,
    runSearch,
    loadMoreHits,
    onNewNote,
    openPrefilledDraft,
    onImportFromUrl,
    onSave,
    confirmDraft,
    onDelete,
    deleteItemById,
    trashed,
    refreshTrashed,
    hasSamples,
    refreshSamples,
    removeSamples,
    bulkSelected,
    toggleBulkSelect,
    bulkTrash,
    restoreItem,
    emptyTrash,
    renameProject,
    mergeProject,
    deleteProject,
    patchDraft,
    copyItemId,
    selectItem,
    closeNotePeek,
  }
}
