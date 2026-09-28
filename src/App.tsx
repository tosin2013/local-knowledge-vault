import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CssBaseline, Paper, ThemeProvider, Typography } from '@mui/material'
import { createM3Theme } from './theme/m3Theme'
import { listPlugins } from './plugins/registry'
import { PLUGINS_CHANGED_EVENT, usePluginContributions } from './plugins/contrib'
import { ProviderDialog } from './components/ai/ProviderDialog'
import { aiChipLabel } from './components/ai/FirstRunLocalCard'
import {
  applyTheme,
  askEmptyStateCopy,
  BUILTIN_PROFILES,
  emptyFilters,
  findGroundedDefaultPrompt,
  GORGIAS_PROJECT,
  isBuiltinProfileId,
  isGorgiasReaderPrompt,
  isValidHttpUrl,
  loadLastProfile,
  loadTheme,
  loadUiMode,
  makeNewDraftItem,
  matchProfileId,
  NEW_DRAFT_ID,
  paraLabel,
  personalityDisplayName,
  resolveProfilePromptId,
  saveLastProfile,
  THEME_KEY,
  titleFromFirstQuestion,
  UI_MODE_KEY,
  type ChatProfileId,
  type Mode,
  type ThemeMode,
  type UiMode,
} from './domain'
import { TopBar } from './features/TopBar'
import { NotesRail } from './features/NotesRail'
import { FindPanel } from './features/FindPanel'
import { ChatView } from './features/ChatView'
import { PromptsView } from './features/PromptsView'
import { NotePeek } from './features/NotePeek'
import { AiSettingsDialog } from './features/AiSettingsDialog'
import { ContentChrome } from './features/ContentChrome'
import type {
  AskGroundedResult,
  ChatMessage,
  ChatProfile,
  ChatSession,
  Item,
  ItemFilters,
  LlmStatus,
  Prompt,
  ProviderConfig,
  ProviderPresetInfo,
  SearchHit,
} from '../electron/types'

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [filters, setFilters] = useState<ItemFilters>(emptyFilters)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [mode, setMode] = useState<Mode>('chat')
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const [pluginsMenuAnchor, setPluginsMenuAnchor] = useState<null | HTMLElement>(null)
  const [searchText, setSearchText] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [askResult, setAskResult] = useState<AskGroundedResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null)
  const [llmChecking, setLlmChecking] = useState(false)
  const [providerPresets, setProviderPresets] = useState<ProviderPresetInfo[]>([])
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null)
  const [providerInitialPreset, setProviderInitialPreset] = useState<string | undefined>(undefined)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [smallHintDismissed, setSmallHintDismissed] = useState(false)
  const [disabledPlugins, setDisabledPlugins] = useState<string[]>([])
  const pluginContribs = usePluginContributions()
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [importUrl, setImportUrl] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  /** True while editing a note that has no DB row yet. */
  const [isNewDraft, setIsNewDraft] = useState(false)
  /** Note peek overlay — Ask/Find stay mounted; notes open beside/over chat. */
  const [notePeekOpen, setNotePeekOpen] = useState(false)
  const [peekEditing, setPeekEditing] = useState(false)
  const [uiMode, setUiMode] = useState<UiMode>(() => loadUiMode())
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [askCustomizeOpen, setAskCustomizeOpen] = useState(false)
  const [promptBodyOpen, setPromptBodyOpen] = useState(false)

  // Chat state
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [selectedProfileId, setSelectedProfileId] = useState<ChatProfileId>('grounded-helper')
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [chatOffline, setChatOffline] = useState(false)
  const threadEndRef = useRef<HTMLDivElement | null>(null)

  // Prompts state
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [promptDraft, setPromptDraft] = useState({ name: '', body: '', description: '' })
  const [promptDirty, setPromptDirty] = useState(false)
  /** Distinct project names seen across item refreshes (so Notes from stays useful when filtered). */
  const [knownProjects, setKnownProjects] = useState<string[]>([])

  // User chat profiles (Personality + Notes from)
  const [userProfiles, setUserProfiles] = useState<ChatProfile[]>([])
  const [profileSaveOpen, setProfileSaveOpen] = useState(false)
  const [profileSaveName, setProfileSaveName] = useState('')
  const [profileRenameOpen, setProfileRenameOpen] = useState(false)
  const [profileRenameName, setProfileRenameName] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)

  const advanced = uiMode === 'advanced'
  const hasApi = typeof window !== 'undefined' && !!window.lkv

  const setUiModePersist = (next: UiMode) => {
    setUiMode(next)
    try {
      localStorage.setItem(UI_MODE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const setThemePersist = (next: ThemeMode) => {
    setTheme(next)
    applyTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const persistProfile = useCallback(
    (profileId: ChatProfileId, promptId: string, project: string) => {
      setSelectedProfileId(profileId)
      saveLastProfile({ profileId, promptId, project })
    },
    [],
  )

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const refreshList = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.items.list({ filters })
    setItems(list)
  }, [filters])

  const refreshLlm = useCallback(async () => {
    if (!window.lkv?.llm) return
    try {
      const status = await window.lkv.llm.status()
      setLlmStatus(status)
    } catch {
      setLlmStatus({
        selected: 'auto',
        active: null,
        message: 'AI offline — search still works',
        providers: [],
        needsSetup: false,
        recommendedLocalModel: {
          name: 'qwen3:8b',
          command: 'ollama pull qwen3:8b',
          why: 'Small (~5 GB) and good at following citation rules.',
        },
      })
    }
  }, [])

  /** Manual re-check (first-run card / provider panel) with a visible busy state. */
  const recheckLlm = useCallback(async () => {
    setLlmChecking(true)
    try {
      await refreshLlm()
      if (window.lkv?.providers) {
        const r = await window.lkv.providers.list()
        setProviderPresets(r.presets)
      }
    } finally {
      setLlmChecking(false)
    }
  }, [refreshLlm])

  const refreshPluginState = useCallback(async () => {
    if (!window.lkv?.plugins) return
    try {
      const r = await window.lkv.plugins.list()
      setDisabledPlugins(r.disabled)
      const pr = await window.lkv.providers.list()
      setProviderPresets(pr.presets)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshPluginState()
    const onChange = () => {
      void refreshPluginState()
      void refreshLlm()
    }
    window.addEventListener(PLUGINS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(PLUGINS_CHANGED_EVENT, onChange)
  }, [refreshPluginState, refreshLlm])

  const openAddProvider = (presetId?: string) => {
    setEditingProvider(null)
    setProviderInitialPreset(presetId)
    setProviderDialogOpen(true)
  }

  const refreshSessions = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.chat.listSessions()
    setSessions(list)
  }, [])

  const refreshPrompts = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.prompts.list()
    setPrompts(list)
  }, [])

  const refreshProfiles = useCallback(async () => {
    if (!window.lkv?.profiles) {
      setProfilesLoaded(true)
      return
    }
    try {
      const list = await window.lkv.profiles.list()
      setUserProfiles(list)
    } finally {
      setProfilesLoaded(true)
    }
  }, [])

  const loadMessages = useCallback(async (sessionId: string) => {
    if (!window.lkv) return
    const msgs = await window.lkv.chat.listMessages(sessionId)
    setMessages(msgs)
  }, [])

  useEffect(() => {
    if (!hasApi) return
    void refreshList()
    void refreshLlm()
    void refreshSessions()
    void refreshPrompts()
    void refreshProfiles()
    const t = setInterval(() => void refreshLlm(), 15000)
    return () => clearInterval(t)
  }, [hasApi, refreshList, refreshLlm, refreshSessions, refreshPrompts, refreshProfiles])

  // Restore last Profile (Personality + Notes from) once prompts (+ profiles) are available.
  useEffect(() => {
    if (profileHydrated || prompts.length === 0 || !profilesLoaded) return
    const grounded = findGroundedDefaultPrompt(prompts)
    const saved = loadLastProfile()
    let promptId = ''
    let project = ''
    let profileId: ChatProfileId = 'grounded-helper'

    if (saved) {
      const savedPromptOk = saved.promptId && prompts.some((p) => p.id === saved.promptId)
      if (isBuiltinProfileId(saved.profileId)) {
        const builtin = BUILTIN_PROFILES.find((p) => p.id === saved.profileId)
        if (builtin) {
          promptId = resolveProfilePromptId(builtin, prompts) || grounded?.id || ''
          project = builtin.project
          profileId = builtin.id
        }
      } else if (saved.profileId !== 'custom') {
        const user = userProfiles.find((p) => p.id === saved.profileId)
        if (user) {
          const promptOk = prompts.some((p) => p.id === user.prompt_id)
          promptId = promptOk
            ? user.prompt_id
            : grounded?.id || prompts[0]?.id || ''
          project = user.project
          profileId = user.id
          if (project) {
            setKnownProjects((prev) =>
              prev.includes(project) ? prev : [...prev, project].sort((a, b) => a.localeCompare(b)),
            )
          }
        }
      }
      if (!promptId && savedPromptOk) {
        promptId = saved.promptId
        project = saved.project ?? ''
        profileId = matchProfileId(promptId, project, prompts, userProfiles)
      }
    }

    if (!promptId) {
      promptId = grounded?.id || prompts[0]?.id || ''
      project = ''
      profileId = 'grounded-helper'
    }

    setSelectedPromptId(promptId)
    setFilters((f) => ({ ...f, project }))
    persistProfile(profileId, promptId, project)
    setProfileHydrated(true)
  }, [prompts, userProfiles, profilesLoaded, profileHydrated, persistProfile])

  // If the selected user profile was deleted, fall back to Custom.
  useEffect(() => {
    if (!profileHydrated) return
    if (isBuiltinProfileId(selectedProfileId) || selectedProfileId === 'custom') return
    if (userProfiles.some((p) => p.id === selectedProfileId)) return
    persistProfile('custom', selectedPromptId, filters.project ?? '')
  }, [
    profileHydrated,
    selectedProfileId,
    userProfiles,
    selectedPromptId,
    filters.project,
    persistProfile,
  ])

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
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    if (advanced) setPromptBodyOpen(true)
  }, [advanced])

  useEffect(() => {
    // Advanced keeps Customize open; Simple hides Personality / Notes from by default.
    setAskCustomizeOpen(advanced)
  }, [advanced])

  useEffect(() => {
    if (!advanced && mode === 'prompts') setMode('chat')
  }, [advanced, mode])

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
  }, [searchText, filters])

  // When left-rail filters change while Find is showing an active query, re-run search.
  useEffect(() => {
    if (mode !== 'search') return
    if (!searchText.trim() && !filters.para && !filters.kind && !filters.status && !filters.project) {
      return
    }
    // Always re-query when filters change in Find mode (including empty text + filters only).
    const t = setTimeout(() => {
      void runSearch()
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only filters/mode, not every searchText keystroke
  }, [filters.para, filters.kind, filters.status, filters.project, mode])

  /** Jump to Ask (chat) tab, optionally prefill from top search. */
  const goAskAi = () => {
    if (searchText.trim()) {
      setChatInput(searchText.trim())
    }
    setMode('chat')
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

  // ---- Chat handlers ----

  const onNewChat = async () => {
    if (!window.lkv) return
    const session = await window.lkv.chat.createSession({ mode: 'grounded' })
    await refreshSessions()
    setActiveSessionId(session.id)
    setMessages([])
    setChatOffline(false)
    setMode('chat')
    // New sessions keep the last Profile (Personality + Notes from).
    const promptId =
      selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    const project = filters.project ?? ''
    if (promptId) {
      persistProfile(
        matchProfileId(promptId, project, prompts),
        promptId,
        project,
      )
    }
  }

  const onSelectSession = async (id: string) => {
    setActiveSessionId(id)
    setChatOffline(false)
    setMode('chat')
    await loadMessages(id)
  }

  const onDeleteSession = async (id: string) => {
    if (!window.lkv) return
    if (!confirm('Delete this chat session?')) return
    await window.lkv.chat.deleteSession(id)
    if (activeSessionId === id) {
      setActiveSessionId(null)
      setMessages([])
    }
    await refreshSessions()
  }

  const onExportCitationPack = async () => {
    if (!window.lkv || !activeSessionId) return
    if (messages.length === 0) {
      setError('This chat has no messages to export yet.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const profileHint =
        selectedProfileId === 'custom'
          ? 'Custom'
          : isBuiltinProfileId(selectedProfileId)
            ? BUILTIN_PROFILES.find((p) => p.id === selectedProfileId)?.name
            : userProfiles.find((p) => p.id === selectedProfileId)?.name
      const res = await window.lkv.citationPack.export({
        sessionId: activeSessionId,
        profileHint: profileHint || undefined,
      })
      if (res.canceled) return
      const where = res.zipPath || res.path || res.folderPath || 'disk'
      const notes = res.noteCount ?? 0
      const missing = res.missingCount ?? 0
      setStatusMsg(
        missing > 0
          ? `Citation pack exported (${notes} notes, ${missing} missing) → ${where}`
          : `Citation pack exported (${notes} notes) → ${where}`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export citation pack')
    } finally {
      setBusy(false)
    }
  }

  const onSendChat = async () => {
    if (!window.lkv || !chatInput.trim()) return
    const text = chatInput.trim()
    let sessionId = activeSessionId
    const existing = sessionId ? sessions.find((s) => s.id === sessionId) : null
    const untitled =
      !existing ||
      !existing.title.trim() ||
      existing.title.trim().toLowerCase() === 'new chat' ||
      existing.title.trim().toLowerCase() === 'untitled'
    if (!sessionId) {
      const session = await window.lkv.chat.createSession({
        mode: 'grounded',
        title: titleFromFirstQuestion(text),
      })
      sessionId = session.id
      setActiveSessionId(sessionId)
      await refreshSessions()
    }
    setChatInput('')
    setBusy(true)
    setError(null)
    setChatOffline(false)
    try {
      const res = await window.lkv.chat.send({
        sessionId,
        text,
        filters,
        promptId:
          selectedPromptId ||
          findGroundedDefaultPrompt(prompts)?.id ||
          undefined,
        limit: 8,
      })
      setMessages(res.messages)
      setChatOffline(!!res.offline)
      // Belt-and-suspenders: rename untitled sessions from the first question
      if (
        untitled &&
        sessionId &&
        messages.length === 0 &&
        window.lkv.chat.updateSessionTitle
      ) {
        await window.lkv.chat.updateSessionTitle(sessionId, titleFromFirstQuestion(text))
      }
      await refreshSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // ---- Prompt handlers ----

  const onNewPrompt = () => {
    setEditingPrompt(null)
    setPromptDraft({ name: '', body: '', description: '' })
    setPromptDirty(false)
    setPromptBodyOpen(true)
    setMode('prompts')
  }

  const onSelectPrompt = (p: Prompt) => {
    setEditingPrompt(p)
    setPromptDraft({
      name: p.name,
      body: p.body,
      description: p.description ?? '',
    })
    setPromptDirty(false)
    setPromptBodyOpen(advanced)
  }

  const onSavePrompt = async () => {
    if (!window.lkv || !promptDraft.name.trim() || !promptDraft.body.trim()) return
    setBusy(true)
    try {
      if (editingPrompt) {
        const updated = await window.lkv.prompts.update(editingPrompt.id, {
          name: promptDraft.name,
          body: promptDraft.body,
          description: promptDraft.description || null,
        })
        setEditingPrompt(updated)
      } else {
        const created = await window.lkv.prompts.create({
          name: promptDraft.name,
          body: promptDraft.body,
          description: promptDraft.description || null,
        })
        setEditingPrompt(created)
      }
      setPromptDirty(false)
      await refreshPrompts()
    } finally {
      setBusy(false)
    }
  }

  const onDeletePrompt = async () => {
    if (!window.lkv || !editingPrompt) return
    if (!confirm(`Delete prompt “${editingPrompt.name}”?`)) return
    await window.lkv.prompts.delete(editingPrompt.id)
    if (selectedPromptId === editingPrompt.id) {
      const remaining = prompts.filter((p) => p.id !== editingPrompt.id)
      const grounded = findGroundedDefaultPrompt(remaining)
      const nextId = grounded?.id || remaining[0]?.id || ''
      const project = (filters.project ?? '').trim()
      setSelectedPromptId(nextId)
      persistProfile(matchProfileId(nextId, project, remaining), nextId, project)
    }
    setEditingPrompt(null)
    setPromptDraft({ name: '', body: '', description: '' })
    setPromptDirty(false)
    setPromptBodyOpen(false)
    await refreshPrompts()
  }

  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (filters.para) parts.push(paraLabel(filters.para))
    if (filters.kind) parts.push(filters.kind)
    if (filters.status) parts.push(filters.status)
    if (filters.project) parts.push(filters.project)
    return parts.length ? parts.join(' · ') : 'All notes'
  }, [filters])

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

  const projectOptions = knownProjects

  const gorgiasReaderSelected = isGorgiasReaderPrompt(selectedPromptId, prompts)
  const projectIsGorgias = (filters.project ?? '').trim() === GORGIAS_PROJECT
  const stayingInGorgias = gorgiasReaderSelected && projectIsGorgias

  const applyPromptAndProject = (promptId: string, project: string, profileId?: ChatProfileId) => {
    const nextPrompt =
      promptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    const nextProject = project ?? ''
    setSelectedPromptId(nextPrompt)
    setFilters((f) => ((f.project ?? '') === nextProject ? f : { ...f, project: nextProject }))
    const matched =
      profileId ?? matchProfileId(nextPrompt, nextProject, prompts, userProfiles)
    persistProfile(matched, nextPrompt, nextProject)
  }

  const onProfileChange = (profileId: string) => {
    if (profileId === 'custom') {
      const project = filters.project ?? ''
      const promptId =
        selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
      persistProfile('custom', promptId, project)
      return
    }
    const builtin = BUILTIN_PROFILES.find((p) => p.id === profileId)
    if (builtin) {
      const promptId = resolveProfilePromptId(builtin, prompts) || ''
      const project = builtin.project
      if (project) {
        setKnownProjects((prev) =>
          prev.includes(project) ? prev : [...prev, project].sort((a, b) => a.localeCompare(b)),
        )
      }
      applyPromptAndProject(promptId, project, builtin.id)
      return
    }
    const user = userProfiles.find((p) => p.id === profileId)
    if (!user) return
    const promptOk = prompts.some((p) => p.id === user.prompt_id)
    const promptId = promptOk
      ? user.prompt_id
      : findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    const project = user.project
    if (project) {
      setKnownProjects((prev) =>
        prev.includes(project) ? prev : [...prev, project].sort((a, b) => a.localeCompare(b)),
      )
    }
    if (!promptOk) {
      setStatusMsg(`Profile “${user.name}” personality missing — using default.`)
    }
    applyPromptAndProject(promptId, project, user.id)
  }

  const selectedUserProfile = userProfiles.find((p) => p.id === selectedProfileId)

  const onSaveAsProfile = async () => {
    if (!window.lkv?.profiles || profileBusy) return
    const name = profileSaveName.trim()
    if (!name) {
      setError('Enter a profile name')
      return
    }
    const promptId =
      selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    if (!promptId) {
      setError('Pick a personality before saving a profile')
      return
    }
    setProfileBusy(true)
    setError(null)
    try {
      const created = await window.lkv.profiles.create({
        name,
        promptId,
        project: filters.project ?? '',
      })
      await refreshProfiles()
      applyPromptAndProject(created.prompt_id, created.project, created.id)
      setProfileSaveOpen(false)
      setProfileSaveName('')
      setStatusMsg(
        created.name !== name
          ? `Saved as “${created.name}” (name was taken)`
          : `Saved profile “${created.name}”`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile')
    } finally {
      setProfileBusy(false)
    }
  }

  const onRenameProfile = async () => {
    if (!window.lkv?.profiles || !selectedUserProfile || profileBusy) return
    const name = profileRenameName.trim()
    if (!name) {
      setError('Enter a profile name')
      return
    }
    setProfileBusy(true)
    setError(null)
    try {
      const updated = await window.lkv.profiles.update(selectedUserProfile.id, { name })
      await refreshProfiles()
      setProfileRenameOpen(false)
      setProfileRenameName('')
      if (updated) {
        setStatusMsg(
          updated.name !== name
            ? `Renamed to “${updated.name}” (name was taken)`
            : `Renamed to “${updated.name}”`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rename profile')
    } finally {
      setProfileBusy(false)
    }
  }

  const onDeleteProfile = async () => {
    if (!window.lkv?.profiles || !selectedUserProfile || profileBusy) return
    const name = selectedUserProfile.name
    if (!window.confirm(`Delete profile “${name}”?`)) return
    setProfileBusy(true)
    setError(null)
    try {
      await window.lkv.profiles.delete(selectedUserProfile.id)
      await refreshProfiles()
      const grounded = findGroundedDefaultPrompt(prompts)
      const promptId = grounded?.id || prompts[0]?.id || selectedPromptId
      applyPromptAndProject(promptId, '', 'grounded-helper')
      setProfileRenameOpen(false)
      setStatusMsg(`Deleted profile “${name}”`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete profile')
    } finally {
      setProfileBusy(false)
    }
  }

  const onChatPromptChange = (promptId: string) => {
    // Keep Notes-from independent when only Personality changes (avoid surprising scope jumps).
    const nextProject = filters.project ?? ''
    applyPromptAndProject(promptId, nextProject)
  }

  /** Short hint when Personality / Profile would or did affect note scope. */
  const scopeCoupleHint = useMemo(() => {
    if (isGorgiasReaderPrompt(selectedPromptId, prompts)) {
      if (projectIsGorgias) {
        return 'Gorgias reader · notes limited to project Gorgias'
      }
      return 'Gorgias reader often pairs with project Gorgias — Notes scope unchanged'
    }
    if (selectedProfileId === 'gorgias' || (selectedUserProfile && selectedUserProfile.project.trim())) {
      const proj =
        selectedProfileId === 'gorgias'
          ? GORGIAS_PROJECT
          : selectedUserProfile?.project.trim() || ''
      if (proj && (filters.project ?? '').trim() === proj) {
        return `This also limits notes to project ${proj}`
      }
    }
    if (selectedProfileId === 'grounded-helper' && !(filters.project ?? '').trim()) {
      return 'Notes scope unchanged'
    }
    return null
  }, [
    selectedPromptId,
    prompts,
    projectIsGorgias,
    selectedProfileId,
    selectedUserProfile,
    filters.project,
  ])

  const onNotesFromChange = (project: string) => {
    const promptId =
      selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    applyPromptAndProject(promptId, project)
  }

  const chatPlaceholder = projectIsGorgias
    ? 'Ask about Gorgias… (Enter to send, Shift+Enter for newline)'
    : 'Ask about your notes… (Enter to send, Shift+Enter for newline)'

  const askEmpty = useMemo(
    () =>
      askEmptyStateCopy(
        selectedProfileId,
        prompts,
        selectedPromptId,
        filters.project ?? '',
        userProfiles,
      ),
    [selectedProfileId, prompts, selectedPromptId, filters.project, userProfiles],
  )

  const aiReady = llmStatus?.active != null
  const aiStatusText = aiChipLabel(llmStatus, advanced)
  const showFirstRun = !!llmStatus?.needsSetup
  const showSmallHint = !!llmStatus?.active?.smallModel && !smallHintDismissed
  const visiblePlugins = listPlugins().filter((p) => !disabledPlugins.includes(p.id))
  const quickAsks = pluginContribs.promptPacks.flatMap((pack) =>
    pack.prompts.slice(0, 6).map((q) => ({ q, pack: pack.name })),
  ).slice(0, 8)

  const muiTheme = useMemo(
    () => createM3Theme(theme === 'blink-light' ? 'light' : 'dark'),
    [theme],
  )

  if (!hasApi) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 4,
            bgcolor: 'background.default',
          }}
        >
          <Paper sx={{ p: 4, maxWidth: 420, borderRadius: 5, textAlign: 'center' }}>
            <Typography variant="h5" color="primary" fontWeight={600} gutterBottom>
              Vault
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Run inside Electron (`npm run dev`) so the preload API is available.
            </Typography>
          </Paper>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box className={`app ${advanced ? 'ui-advanced' : 'ui-simple'}`} sx={{ bgcolor: 'background.default' }}>
        <TopBar
          advanced={advanced}
          mode={mode}
          activePluginId={activePluginId}
          pluginsMenuAnchor={pluginsMenuAnchor}
          visiblePlugins={visiblePlugins}
          aiStatusText={aiStatusText}
          llmStatus={llmStatus}
          aiReady={aiReady}
          theme={theme}
          searchText={searchText}
          busy={busy}
          onSearchText={setSearchText}
          onRunSearch={() => void runSearch()}
          onAiSettings={() => setAiSettingsOpen(true)}
          onRecheck={() => void recheckLlm()}
          onPersonalities={() => {
            setActivePluginId(null)
            setMode('prompts')
          }}
          onPluginsMenu={setPluginsMenuAnchor}
          onSelectPlugin={(id) => {
            setPluginsMenuAnchor(null)
            setActivePluginId(id)
            setMode('chat')
          }}
          onAdvanced={(v) => setUiModePersist(v ? 'advanced' : 'simple')}
          onTheme={() => setThemePersist(theme === 'blink' ? 'blink-light' : 'blink')}
        />

        <Box className="main">
          <NotesRail
            advanced={advanced}
            items={items}
            selectedId={selectedId}
            filters={filters}
            projectOptions={projectOptions}
            filterSummary={filterSummary}
            filtersOpen={filtersOpen}
            importUrl={importUrl}
            importBusy={importBusy}
            busy={busy}
            onNewNote={onNewNote}
            onImportUrl={setImportUrl}
            onImport={() => void onImportFromUrl()}
            onProject={onNotesFromChange}
            onFilters={setFilters}
            onFiltersOpen={setFiltersOpen}
            onSelect={selectItem}
          />

          <Box
            component="section"
            className="content"
            sx={{ bgcolor: 'background.default', position: 'relative' }}
          >
            <ContentChrome
              mode={mode}
              activePluginId={activePluginId}
              statusMsg={statusMsg}
              error={error}
              onToggleMode={(v) => {
                setActivePluginId(null)
                setMode(v)
              }}
              onClearPlugin={() => setActivePluginId(null)}
              onClosePlugin={() => {
                setActivePluginId(null)
                setMode('chat')
              }}
              onDismissStatus={() => setStatusMsg(null)}
              onDismissError={() => setError(null)}
              onOpenNote={(id) => selectItem(id)}
            />

            {!activePluginId && mode === 'search' && (
              <FindPanel
                advanced={advanced}
                askResult={askResult}
                hits={hits}
                searchText={searchText}
                filters={filters}
                filterSummary={filterSummary}
                onSelect={selectItem}
                onAskInstead={goAskAi}
              />
            )}

            {!activePluginId && mode === 'chat' && (
              <ChatView
                advanced={advanced}
                busy={busy}
                llmStatus={llmStatus}
                llmChecking={llmChecking}
                showFirstRun={showFirstRun}
                showSmallHint={showSmallHint}
                askEmpty={askEmpty}
                quickAsks={quickAsks}
                messages={messages}
                chatOffline={chatOffline}
                threadEndRef={threadEndRef}
                selectedProfileId={selectedProfileId}
                userProfiles={userProfiles}
                selectedUserProfile={selectedUserProfile}
                prompts={prompts}
                selectedPromptId={selectedPromptId}
                projectOptions={projectOptions}
                notesFrom={filters.project ?? ''}
                profileRenameOpen={profileRenameOpen}
                profileRenameName={profileRenameName}
                profileSaveOpen={profileSaveOpen}
                profileSaveName={profileSaveName}
                profileBusy={profileBusy}
                askCustomizeOpen={askCustomizeOpen}
                filterSummary={filterSummary}
                stayingInGorgias={stayingInGorgias}
                scopeCoupleHint={scopeCoupleHint}
                chatInput={chatInput}
                chatPlaceholder={chatPlaceholder}
                sessions={sessions}
                activeSessionId={activeSessionId}
                onRecheck={() => void recheckLlm()}
                onAddProvider={openAddProvider}
                onEditProvider={(p) => {
                  setEditingProvider(p)
                  setProviderDialogOpen(true)
                }}
                onError={setError}
                onDismissSmallHint={() => setSmallHintDismissed(true)}
                onChatInput={setChatInput}
                onSelectNote={selectItem}
                onProfileChange={onProfileChange}
                onOpenRename={() => {
                  if (selectedUserProfile) {
                    setProfileRenameName(selectedUserProfile.name)
                    setProfileRenameOpen(true)
                    setProfileSaveOpen(false)
                  }
                }}
                onRenameName={setProfileRenameName}
                onRename={() => void onRenameProfile()}
                onRenameCancel={() => setProfileRenameOpen(false)}
                onDeleteProfile={() => void onDeleteProfile()}
                onAskCustomize={setAskCustomizeOpen}
                onChatPrompt={onChatPromptChange}
                onNotesFrom={onNotesFromChange}
                onOpenProfileSave={() => {
                  const prompt = prompts.find((p) => p.id === selectedPromptId)
                  const persona = prompt ? personalityDisplayName(prompt) : 'Custom'
                  const proj = (filters.project ?? '').trim()
                  setProfileSaveName(proj ? `${persona} · ${proj}` : persona)
                  setProfileSaveOpen(true)
                  setProfileRenameOpen(false)
                }}
                onProfileSaveName={setProfileSaveName}
                onSaveAsProfile={() => void onSaveAsProfile()}
                onProfileSaveCancel={() => setProfileSaveOpen(false)}
                onSend={() => void onSendChat()}
                onNewChat={() => void onNewChat()}
                onExportCitationPack={() => void onExportCitationPack()}
                onSelectSession={(id) => void onSelectSession(id)}
                onDeleteSession={(id) => void onDeleteSession(id)}
              />
            )}

            {!activePluginId && mode === 'prompts' && (
              <PromptsView
                advanced={advanced}
                busy={busy}
                prompts={prompts}
                editingPrompt={editingPrompt}
                promptBodyOpen={promptBodyOpen}
                promptDraft={promptDraft}
                promptDirty={promptDirty}
                onNewPrompt={onNewPrompt}
                onSelectPrompt={onSelectPrompt}
                onDraft={setPromptDraft}
                onDirty={setPromptDirty}
                onBodyOpen={setPromptBodyOpen}
                onUseInAsk={(promptId) => {
                  onChatPromptChange(promptId)
                  setMode('chat')
                }}
                onDeletePrompt={() => void onDeletePrompt()}
                onSavePrompt={() => void onSavePrompt()}
              />
            )}

            <NotePeek
              open={notePeekOpen}
              isNewDraft={isNewDraft}
              draft={draft}
              peekEditing={peekEditing}
              dirty={dirty}
              busy={busy}
              advanced={advanced}
              onClose={closeNotePeek}
              onEdit={setPeekEditing}
              onPatch={patchDraft}
              onSave={() => void onSave()}
              onDelete={() => void onDelete()}
              onCopyId={(id) => void copyItemId(id)}
            />
          </Box>
        </Box>

        <ProviderDialog
          open={providerDialogOpen}
          presets={providerPresets}
          editing={editingProvider}
          initialPresetId={providerInitialPreset}
          onClose={() => setProviderDialogOpen(false)}
          onSaved={(cfg) => {
            setProviderDialogOpen(false)
            setStatusMsg(`Saved provider “${cfg.label}”.`)
            void recheckLlm()
          }}
        />
        <AiSettingsDialog
          open={aiSettingsOpen}
          advanced={advanced}
          llmStatus={llmStatus}
          llmChecking={llmChecking}
          onClose={() => setAiSettingsOpen(false)}
          onRefresh={() => void recheckLlm()}
          onAddProvider={openAddProvider}
          onEditProvider={(p) => {
            setEditingProvider(p)
            setProviderDialogOpen(true)
          }}
          onError={setError}
          onUseAdvanced={() => setUiModePersist('advanced')}
        />
      </Box>
    </ThemeProvider>
  )
}
