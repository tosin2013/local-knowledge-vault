import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AskGroundedResult, Item, ItemFilters, SearchHit } from '../../electron/types'
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
  const [searchText, setSearchText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [askResult, setAskResult] = useState<AskGroundedResult | null>(null)
  const [importUrl, setImportUrl] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [knownProjects, setKnownProjects] = useState<string[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)

  const refreshList = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.items.list({ filters })
    setItems(list)
  }, [filters])

  const runSearch = useCallback(async (textOverride?: string) => {
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
        limit: 20,
      })
      setHits(res.hits)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [searchText, filters, setBusy, setError, setMode])

  useEffect(() => {
    if (!selectedId || !window.lkv) {
      if (!isNewDraft) {
        setDraft(null)
        setDirty(false)
      }
      return
    }
    if (selectedId === NEW_DRAFT_ID || isNewDraft) {
      return
    }
    void window.lkv.items.get(selectedId).then((item) => {
      setDraft(item)
      setDirty(false)
      setIsNewDraft(false)
    })
  }, [selectedId, isNewDraft])

  useEffect(() => {
    setKnownProjects((prev) => {
      const names = new Set(prev)
      let changed = false
      for (const it of items) {
        const p = it.project?.trim()
        if (p && !names.has(p)) {
          names.add(p)
          changed = true
        }
      }
      const current = filters.project?.trim()
      if (current && !names.has(current)) {
        names.add(current)
        changed = true
      }
      if (!changed) return prev
      return Array.from(names).sort((a, b) => a.localeCompare(b))
    })
  }, [items, filters.project])

  const openNotePeek = (id: string, opts?: { edit?: boolean }) => {
    if (id !== NEW_DRAFT_ID) {
      setIsNewDraft(false)
    }
    setSelectedId(id)
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
    setDirty(false)
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
      if (isNewDraft || draft.id === NEW_DRAFT_ID) {
        const title = draft.title.trim() || 'Untitled'
        const created = await window.lkv.items.create({
          title,
          body: draft.body,
          summary: draft.summary,
          para: draft.para,
          kind: draft.kind || 'note',
          status: draft.status || 'active',
          project: draft.project,
        })
        setIsNewDraft(false)
        setDraft(created)
        setSelectedId(created.id)
        setDirty(false)
        await refreshList()
        return
      }
      const updated = await window.lkv.items.update(draft.id, {
        title: draft.title.trim() || 'Untitled',
        body: draft.body,
        summary: draft.summary,
        para: draft.para,
        kind: draft.kind,
        status: draft.status,
        project: draft.project,
      })
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
    if (!confirm(`Delete “${draft.title}”?`)) return
    await window.lkv.items.delete(draft.id)
    setSelectedId(null)
    setDraft(null)
    setDirty(false)
    setNotePeekOpen(false)
    setPeekEditing(false)
    await refreshList()
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

  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (filters.para) parts.push(paraLabel(filters.para))
    if (filters.kind) parts.push(filters.kind)
    if (filters.status) parts.push(filters.status)
    if (filters.project) parts.push(filters.project)
    return parts.length ? parts.join(' · ') : 'All notes'
  }, [filters])

  return {
    items,
    filters,
    setFilters,
    selectedId,
    draft,
    dirty,
    isNewDraft,
    notePeekOpen,
    peekEditing,
    setPeekEditing,
    searchText,
    setSearchText,
    hits,
    askResult,
    importUrl,
    setImportUrl,
    importBusy,
    knownProjects,
    setKnownProjects,
    filtersOpen,
    setFiltersOpen,
    filterSummary,
    projectOptions: knownProjects,
    refreshList,
    runSearch,
    onNewNote,
    onImportFromUrl,
    onSave,
    onDelete,
    patchDraft,
    copyItemId,
    selectItem,
    closeNotePeek,
  }
}
