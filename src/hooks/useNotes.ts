import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * Owns the notes rail, Find search, and the note-peek editor.
 *
 * Every function is `useCallback`-wrapped with a stable identity wherever its
 * dependencies change rarely, so memoized children (NotesRail, ChatView …) can
 * bail out on keystrokes that do not concern them (#293). A keystroke in the
 * note editor only changes `draft`/`dirty`; one in the top search only
 * `searchText`; one in the Ask composer only `chatInput`.
 */
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
  const [importMarkdownBusy, setImportMarkdownBusy] = useState(false)
  const [importBookBusy, setImportBookBusy] = useState(false)
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
  // True while the first-run "Vault guide" notes exist (#163).
  const [hasSamples, setHasSamples] = useState(false)
  // Total non-trashed notes (drives the genuinely-empty rail state, #189).
  const [count, setCount] = useState(0)

  // The rail query rides a ref so refreshList's identity stays stable per
  // keystroke — a `railQuery` dep here would re-run App's startup effect and
  // refetch everything on every key (#292, #295).
  const railQueryRef = useRef(railQuery)
  railQueryRef.current = railQuery

  const refreshList = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.items.list({ filters, query: railQueryRef.current })
    setItems(list)
    if (window.lkv.items.count) {
      setCount(await window.lkv.items.count())
    }
  }, [filters])

  // Rail filter-as-you-type: debounce the SQL query by 150 ms (#295).
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshList(), 150)
    return () => window.clearTimeout(timer)
  }, [railQuery, refreshList])

  /** DB-backed project list (exact names + note counts) — the single source of truth. */
  const refreshProjects = useCallback(async () => {
    if (!window.lkv?.projects) return
    const list = await window.lkv.projects.list()
    setProjects(list)
  }, [])

  /** Refresh the trash list. Stable identity: it is a startup-effect dep (#292). */
  const refreshTrashed = useCallback(async () => {
    if (!window.lkv?.items?.listTrashed) return
    setTrashed(await window.lkv.items.listTrashed())
  }, [])

  /** Refresh whether the first-run "Vault guide" notes still exist (#163). Stable identity: it is a startup-effect dep (#292). */
  const refreshSamples = useCallback(async () => {
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
  const loadMoreHits = useCallback(() => {
    const next = Math.min(findLimit + 20, 100)
    setFindLimit(next)
    void runSearch(undefined, next)
  }, [findLimit, runSearch])

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

  const openNotePeek = useCallback((id: string, opts?: { edit?: boolean }) => {
    if (id !== NEW_DRAFT_ID) {
      setIsNewDraft(false)
    }
    setSelectedId(id)
    setNoteMissing(false)
    setNotePeekOpen(true)
    setPeekEditing(opts?.edit ?? false)
  }, [])

  /** Open note as peek; never steals Ask/Find pane. */
  const selectItem = useCallback(
    (id: string, opts?: { edit?: boolean }) => {
      openNotePeek(id, opts)
    },
    [openNotePeek],
  )

  const closeNotePeek = useCallback(() => {
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
  }, [dirty, isNewDraft])

  const onNewNote = useCallback(() => {
    // Draft-only: no DB row until explicit Save (avoids blank "New note" list rows).
    const item = makeNewDraftItem()
    setIsNewDraft(true)
    setDraft(item)
    setSelectedId(NEW_DRAFT_ID)
    setNoteMissing(false)
    setDirty(false)
    setNotePeekOpen(true)
    setPeekEditing(true)
  }, [])

  /** Open the note editor pre-filled (e.g. "Save as note" from an answer/moment). */
  const openPrefilledDraft = useCallback((fields: Partial<Item>) => {
    const item = { ...makeNewDraftItem(), ...fields }
    setIsNewDraft(true)
    setDraft(item)
    setSelectedId(NEW_DRAFT_ID)
    setNoteMissing(false)
    setDirty(true)
    setNotePeekOpen(true)
    setPeekEditing(true)
  }, [])

  /** First-class "New project": open a new-note draft pre-filled with that project (#163). */
  const onNewProject = useCallback(
    (name: string) => {
      openPrefilledDraft({ project: name.trim() })
    },
    [openPrefilledDraft],
  )

  const onImportFromUrl = useCallback(async () => {
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
  }, [importUrl, advanced, refreshList, refreshProjects, selectItem, setError, setStatusMsg])

  /** Import Markdown / Obsidian notes from a folder chosen in a native dialog. */
  const onImportMarkdown = useCallback(async () => {
    if (!window.lkv?.import?.fromMarkdown) return
    setImportMarkdownBusy(true)
    setError(null)
    setStatusMsg(null)
    try {
      const res = await window.lkv.import.fromMarkdown()
      if (res.canceled) return
      await refreshList()
      void refreshProjects()
      if (res.imported > 0) {
        const skipped = res.skipped > 0 ? ` · ${res.skipped} skipped` : ''
        setStatusMsg(`Imported ${res.imported} Markdown note${res.imported === 1 ? '' : 's'}${skipped}`)
      } else {
        setStatusMsg('No Markdown notes found to import.')
      }
      if (res.errors.length && advanced) {
        setError(res.errors.join('\n'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(advanced ? msg : 'Could not import that folder.')
    } finally {
      setImportMarkdownBusy(false)
    }
  }, [advanced, refreshList, refreshProjects, setError, setStatusMsg])

  /** Import a local EPUB / text-layer PDF as book notes (native file picker). */
  const onImportBook = useCallback(async () => {
    if (!window.lkv?.import?.fromBook) return
    setImportBookBusy(true)
    setError(null)
    setStatusMsg(null)
    try {
      const res = await window.lkv.import.fromBook()
      if (res.canceled) return
      await refreshList()
      void refreshProjects()
      const project = res.project ? `"${res.project}"` : 'the book'
      if (res.imported > 0) {
        const skipped = res.skipped > 0 ? ` · ${res.skipped} skipped` : ''
        setStatusMsg(
          `Imported ${res.imported} note${res.imported === 1 ? '' : 's'} from ${project}${skipped}`,
        )
      } else {
        setStatusMsg(`No readable text found in ${project}.`)
      }
      if (res.emptyPages && res.emptyPages > 0 && advanced) {
        setError(
          `${res.emptyPages} page${res.emptyPages === 1 ? '' : 's'} had no text layer ` +
            `(likely scanned). OCR isn't supported yet, so those pages were skipped.`,
        )
      }
      if (res.errors.length && advanced) {
        setError(res.errors.join('\n'))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(advanced ? msg : 'Could not import that book or PDF.')
    } finally {
      setImportBookBusy(false)
    }
  }, [advanced, refreshList, refreshProjects, setError, setStatusMsg])

  const onSave = useCallback(async () => {
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
  }, [draft, isNewDraft, dirty, refreshList, refreshProjects, setBusy, setError])

  /** Delete a note by id (from the rail), with confirmation. */
  const deleteItemById = useCallback(
    async (id: string) => {
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
    },
    [selectedId, refreshList, refreshProjects],
  )

  /** Promote an unconfirmed AI draft to a regular note; requires an edit or a one-line summary (#217). */
  const confirmDraft = useCallback(
    async (ownWords?: string) => {
      if (!window.lkv || !draft || draft.status !== 'ai-draft' || draft.id === NEW_DRAFT_ID) return
      const note = (ownWords ?? '').trim()
      // A one-click confirm is not enough: the user must edit the draft or restate
      // it in their own words (generation effect).
      if (!note && !dirty) return
      setBusy(true)
      setError(null)
      try {
        const patch: { status: string; body?: string } = { status: 'active' }
        if (note) patch.body = `In my own words: ${note}\n\n${draft.body}`
        const updated = await window.lkv.items.update(draft.id, patch)
        setDraft(updated)
        setDirty(false)
        await refreshList()
      } finally {
        setBusy(false)
      }
    },
    [draft, dirty, refreshList, setBusy, setError],
  )

  const onDelete = useCallback(async () => {
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
  }, [draft, isNewDraft, refreshList, refreshProjects, refreshTrashed, setError])

  /** Remove the "Vault guide" notes in one action, after confirmation. */
  const removeSamples = useCallback(async () => {
    if (!window.lkv?.items?.removeSamples) return
    if (!confirm('Remove the “Vault guide” notes?')) return
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
  }, [refreshList, refreshProjects, setBusy, setError])

  /** Toggle one note in the rail bulk-selection set. */
  const toggleBulkSelect = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Move every selected note to the trash. */
  const bulkTrash = useCallback(async () => {
    if (!window.lkv?.items?.trash || bulkSelected.size === 0) return
    for (const id of bulkSelected) {
      await window.lkv.items.trash(id)
    }
    setBulkSelected(new Set())
    await refreshList()
    void refreshProjects()
    void refreshTrashed()
  }, [bulkSelected, refreshList, refreshProjects, refreshTrashed])

  /** Restore a trashed note. */
  const restoreItem = useCallback(
    async (id: string) => {
      if (!window.lkv?.items?.restore) return
      await window.lkv.items.restore(id)
      await refreshTrashed()
      await refreshList()
      void refreshProjects()
    },
    [refreshTrashed, refreshList, refreshProjects],
  )

  /** Permanently empty the trash. */
  const emptyTrash = useCallback(async () => {
    if (!window.lkv?.items?.emptyTrash) return
    await window.lkv.items.emptyTrash()
    await refreshTrashed()
    await refreshList()
    void refreshProjects()
  }, [refreshTrashed, refreshList, refreshProjects])

  const patchDraft = useCallback(<K extends keyof Item>(key: K, value: Item[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setDirty(true)
  }, [])

  const copyItemId = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      /* ignore */
    }
  }, [])

  /** Rename a project across its notes + profiles, then refresh. */
  const renameProject = useCallback(
    async (from: string, to: string) => {
      if (!window.lkv?.projects) return
      const res = await window.lkv.projects.rename(from, to)
      if ((filters.project ?? '') === from) setFilters((f) => ({ ...f, project: to }))
      await refreshList()
      await refreshProjects()
      return res
    },
    [filters, refreshList, refreshProjects],
  )

  /** Merge `from` into `into` (reassign notes + profiles), then refresh. */
  const mergeProject = useCallback(
    async (from: string, into: string) => {
      if (!window.lkv?.projects) return
      const res = await window.lkv.projects.merge(from, into)
      if ((filters.project ?? '') === from) setFilters((f) => ({ ...f, project: into }))
      await refreshList()
      await refreshProjects()
      return res
    },
    [filters, refreshList, refreshProjects],
  )

  /** Delete a project and its notes, then refresh. */
  const deleteProject = useCallback(
    async (name: string) => {
      if (!window.lkv?.projects) return
      const res = await window.lkv.projects.delete(name)
      if ((filters.project ?? '') === name) setFilters((f) => ({ ...f, project: '' }))
      await refreshList()
      await refreshProjects()
      return res
    },
    [filters, refreshList, refreshProjects],
  )

  /** Set or clear a project's exam date (#261), then refresh the project list. */
  const setProjectExamDate = useCallback(
    async (name: string, examDate: string | null) => {
      if (!window.lkv?.projects?.setExamDate) return
      try {
        const res = await window.lkv.projects.setExamDate(name, examDate)
        await refreshProjects()
        return res
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshProjects, setError],
  )

  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (filters.para) parts.push(paraLabel(filters.para))
    if (filters.kind) parts.push(filters.kind)
    if (filters.status) parts.push(filters.status)
    if (filters.project) parts.push(filters.project)
    return parts.length ? parts.join(' · ') : 'All notes'
  }, [filters])

  /** Rail project dropdown options — memoized so its identity is stable (#293). */
  const projectOptions = useMemo(() => projects.map((p) => p.name), [projects])

  /**
   * Rail list: hide transcript chunks by default; filter-as-you-type happens in
   * SQLite (`items.list({ filters, query })`, #295), sort stays local.
   */
  const visibleItems = useMemo(() => {
    let list = items
    if (!showTranscripts) list = list.filter((it) => it.kind !== 'transcript')
    const sorted = [...list]
    if (railSort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    else if (railSort === 'created') sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
    else sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return sorted
  }, [items, showTranscripts, railSort])

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
    importMarkdownBusy,
    importBookBusy,
    projects,
    filtersOpen,
    setFiltersOpen,
    filterSummary,
    projectOptions,
    refreshList,
    refreshProjects,
    runSearch,
    loadMoreHits,
    onNewNote,
    openPrefilledDraft,
    onNewProject,
    onImportFromUrl,
    onImportMarkdown,
    onImportBook,
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
    setProjectExamDate,
    patchDraft,
    copyItemId,
    selectItem,
    closeNotePeek,
  }
}
