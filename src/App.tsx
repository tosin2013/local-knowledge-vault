import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Collapse,
  CssBaseline,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Drawer,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  ThemeProvider,
  Toolbar,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SendIcon from '@mui/icons-material/Send'
import AddIcon from '@mui/icons-material/Add'
import LightModeIcon from '@mui/icons-material/LightMode'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import CloseIcon from '@mui/icons-material/Close'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import ExtensionIcon from '@mui/icons-material/Extension'
import { createM3Theme } from './theme/m3Theme'
import { listPlugins, getPlugin } from './plugins/registry'
import type {
  AskGroundedResult,
  ChatMessage,
  ChatProfile,
  ChatSession,
  Citation,
  Item,
  ItemFilters,
  LlmProviderChoice,
  LlmSettingsPublic,
  LlmStatus,
  Para,
  Prompt,
  SearchHit,
} from '../electron/types'

type Mode = 'search' | 'chat' | 'prompts'
type UiMode = 'simple' | 'advanced'

const PARA_OPTIONS: Array<Para | ''> = ['', 'projects', 'areas', 'resources', 'archives']
const KIND_OPTIONS = ['', 'note', 'book', 'article', 'docs', 'blog', 'reference', 'transcript']
const STATUS_OPTIONS = ['', 'active', 'archived']

const PARA_LABELS: Record<string, string> = {
  projects: 'Projects',
  areas: 'Areas',
  resources: 'Resources',
  archives: 'Archive',
}

const UI_MODE_KEY = 'lkv.uiMode'
const THEME_KEY = 'lkv.theme'
const LAST_PROFILE_KEY = 'lkv.lastProfile'

/** Built-in chat profiles: Personality + Notes from (+ optional bind). */
type BuiltinChatProfileId = 'grounded-helper' | 'gorgias'
/** Builtins, Custom, or a user profile id (`prf_…`). */
type ChatProfileId = BuiltinChatProfileId | 'custom' | string

type LastProfileState = {
  profileId: ChatProfileId
  promptId: string
  project: string
}

type BuiltinProfile = {
  id: BuiltinChatProfileId
  name: string
  /** Fixed prompt id when known (Gorgias reader). */
  promptId?: string
  /** Match seeded grounded prompt by name. */
  promptNames?: string[]
  project: string
}

const BUILTIN_PROFILE_IDS: BuiltinChatProfileId[] = ['grounded-helper', 'gorgias']

function isBuiltinProfileId(id: string): id is BuiltinChatProfileId {
  return (BUILTIN_PROFILE_IDS as string[]).includes(id)
}

const BUILTIN_PROFILES: BuiltinProfile[] = [
  {
    id: 'grounded-helper',
    name: 'Grounded helper',
    promptNames: ['Grounded default', 'Grounded helper'],
    project: '',
  },
  {
    id: 'gorgias',
    name: 'Gorgias',
    promptId: 'prm_56ba1ab41bfe4042',
    promptNames: ['Gorgias reader'],
    project: 'Gorgias',
  },
]

/** Legacy localStorage values: blink = dark, blink-light = light. */
type ThemeMode = 'blink' | 'blink-light'

function loadUiMode(): UiMode {
  try {
    const v = localStorage.getItem(UI_MODE_KEY)
    return v === 'advanced' ? 'advanced' : 'simple'
  } catch {
    return 'simple'
  }
}

function loadTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'blink-light' ? 'blink-light' : 'blink'
  } catch {
    return 'blink'
  }
}

function applyTheme(theme: ThemeMode) {
  const scheme = theme === 'blink-light' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-color-scheme', scheme)
  document.documentElement.style.colorScheme = scheme
}

function paraLabel(para: string): string {
  return PARA_LABELS[para] ?? para
}

const emptyFilters = (): ItemFilters => ({
  para: '',
  kind: '',
  status: '',
  project: '',
})

/** Local-only id for an unsaved new note (no DB row yet). */
const NEW_DRAFT_ID = '__draft_new__'

function isValidHttpUrl(raw: string): boolean {
  const s = raw.trim()
  if (!/^https?:\/\//i.test(s)) return false
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function makeNewDraftItem(): Item {
  const ts = new Date().toISOString()
  return {
    id: NEW_DRAFT_ID,
    title: '',
    summary: null,
    body: '',
    para: 'resources',
    kind: 'note',
    status: 'active',
    project: null,
    created_at: ts,
    updated_at: ts,
  }
}

function parseCitations(json: string | null): Citation[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as Citation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const GORGIAS_READER_PROMPT_ID = 'prm_56ba1ab41bfe4042'
const GORGIAS_PROJECT = 'Gorgias'
const GORGIAS_READER_NAME = 'Gorgias reader'
const GROUNDED_DEFAULT_NAMES = ['Grounded default', 'Grounded helper']

function isGorgiasReaderPrompt(promptId: string, prompts: Prompt[]): boolean {
  if (!promptId) return false
  if (promptId === GORGIAS_READER_PROMPT_ID) return true
  return prompts.some((p) => p.id === promptId && p.name === GORGIAS_READER_NAME)
}

function findGroundedDefaultPrompt(prompts: Prompt[]): Prompt | undefined {
  return prompts.find((p) => GROUNDED_DEFAULT_NAMES.includes(p.name)) ?? prompts[0]
}

function resolveProfilePromptId(profile: BuiltinProfile, prompts: Prompt[]): string | undefined {
  if (profile.promptId && prompts.some((p) => p.id === profile.promptId)) {
    return profile.promptId
  }
  if (profile.promptNames?.length) {
    const byName = prompts.find((p) => profile.promptNames!.includes(p.name))
    if (byName) return byName.id
  }
  if (profile.promptId) return profile.promptId
  return findGroundedDefaultPrompt(prompts)?.id
}

function personalityDisplayName(p: Prompt): string {
  if (p.name === 'Grounded default') return 'Grounded helper'
  return p.name
}


function titleFromFirstQuestion(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  const cut = cleaned.split(/[?!.\n]/)[0]?.trim() || cleaned
  const base = cut.length >= 12 ? cut : cleaned
  return base.length > 48 ? base.slice(0, 45).trimEnd() + '…' : base
}

function askEmptyStateCopy(
  profileId: ChatProfileId,
  prompts: Prompt[],
  selectedPromptId: string,
  project: string,
  userProfiles: ChatProfile[] = [],
): { title: string; body: string } {
  const proj = (project ?? '').trim()
  if (
    profileId === 'gorgias' ||
    (proj === GORGIAS_PROJECT && isGorgiasReaderPrompt(selectedPromptId, prompts))
  ) {
    return {
      title: "You're talking with Gorgias",
      body: 'Answers come only from those notes.',
    }
  }
  if (profileId === 'grounded-helper') {
    return {
      title: 'Ask anything grounded in your notes',
      body: 'Example: What did I write about habits?',
    }
  }
  const user = userProfiles.find((p) => p.id === profileId)
  if (user) {
    const prompt = prompts.find((p) => p.id === selectedPromptId)
    const persona = prompt ? personalityDisplayName(prompt) : 'missing personality'
    const scope = proj ? `notes from “${proj}”` : 'all notes'
    const broken = !prompt
    return {
      title: broken ? `${user.name} · personality missing` : user.name,
      body: broken
        ? 'This profile’s personality was deleted — pick another or delete the profile.'
        : `Answers use the “${persona}” personality and ${scope}.`,
    }
  }
  const prompt = prompts.find((p) => p.id === selectedPromptId)
  const name = prompt ? personalityDisplayName(prompt) : 'Custom'
  const scope = proj ? `notes from “${proj}”` : 'all notes'
  return {
    title: `Custom · ${name}`,
    body: `Answers use the “${name}” personality and ${scope}.`,
  }
}

function matchProfileId(
  promptId: string,
  project: string,
  prompts: Prompt[],
  userProfiles: ChatProfile[] = [],
): ChatProfileId {
  const proj = (project ?? '').trim()
  for (const profile of BUILTIN_PROFILES) {
    const resolved = resolveProfilePromptId(profile, prompts)
    if (!resolved || resolved !== promptId) continue
    if ((profile.project ?? '').trim() === proj) return profile.id
  }
  for (const profile of userProfiles) {
    if (profile.prompt_id === promptId && (profile.project ?? '').trim() === proj) {
      return profile.id
    }
  }
  return 'custom'
}

function loadLastProfile(): LastProfileState | null {
  try {
    const raw = localStorage.getItem(LAST_PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastProfileState>
    if (!parsed || typeof parsed !== 'object') return null
    const profileId = parsed.profileId
    if (typeof profileId !== 'string' || !profileId.trim()) return null
    // Builtins, custom, or user profile ids (e.g. prf_…)
    return {
      profileId,
      promptId: typeof parsed.promptId === 'string' ? parsed.promptId : '',
      project: typeof parsed.project === 'string' ? parsed.project : '',
    }
  } catch {
    return null
  }
}

function saveLastProfile(state: LastProfileState) {
  try {
    localStorage.setItem(LAST_PROFILE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

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
  const [llmSettings, setLlmSettingsState] = useState<LlmSettingsPublic | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [groqApiKeyDraft, setGroqApiKeyDraft] = useState('')
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [groqApiKeyBusy, setGroqApiKeyBusy] = useState(false)
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
      const [status, settings] = await Promise.all([
        window.lkv.llm.status(),
        window.lkv.llm.getSettings(),
      ])
      setLlmStatus(status)
      setLlmSettingsState(settings)
    } catch {
      setLlmStatus({
        ollama: { ok: false, error: 'unavailable' },
        grok: { ok: false, hasKey: false, error: 'unavailable' },
        groq: { ok: false, hasKey: false, error: 'unavailable' },
        active: null,
        message: 'AI offline — search still works',
      })
    }
  }, [])

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
  const aiStatusText = advanced
    ? llmStatus == null
      ? 'AI: …'
      : llmStatus.message
    : llmStatus == null
      ? 'AI: …'
      : aiReady
        ? 'AI: ready'
        : 'AI: not available — search still works'

  const saveLlmSettings = async (patch: {
    provider?: LlmProviderChoice
    grokEnabled?: boolean
    grokModel?: string
    groqEnabled?: boolean
    groqModel?: string
  }) => {
    if (!window.lkv?.llm) return
    const next = await window.lkv.llm.setSettings(patch)
    setLlmSettingsState(next)
    await refreshLlm()
  }

  const onSaveApiKey = async () => {
    if (!window.lkv?.llm) return
    setApiKeyBusy(true)
    try {
      const trimmed = apiKeyDraft.trim()
      const res = await window.lkv.llm.setApiKey(trimmed || null)
      setApiKeyDraft('')
      setLlmSettingsState((s) => (s ? { ...s, hasKey: res.hasKey } : s))
      await refreshLlm()
    } finally {
      setApiKeyBusy(false)
    }
  }

  const onClearApiKey = async () => {
    if (!window.lkv?.llm) return
    setApiKeyBusy(true)
    try {
      const res = await window.lkv.llm.setApiKey(null)
      setApiKeyDraft('')
      setLlmSettingsState((s) => (s ? { ...s, hasKey: res.hasKey } : s))
      await refreshLlm()
    } finally {
      setApiKeyBusy(false)
    }
  }

  const onSaveGroqApiKey = async () => {
    if (!window.lkv?.llm) return
    setGroqApiKeyBusy(true)
    try {
      const trimmed = groqApiKeyDraft.trim()
      const res = await window.lkv.llm.setGroqApiKey(trimmed || null)
      setGroqApiKeyDraft('')
      setLlmSettingsState((s) => (s ? { ...s, hasGroqKey: res.hasGroqKey } : s))
      await refreshLlm()
    } finally {
      setGroqApiKeyBusy(false)
    }
  }

  const onClearGroqApiKey = async () => {
    if (!window.lkv?.llm) return
    setGroqApiKeyBusy(true)
    try {
      const res = await window.lkv.llm.setGroqApiKey(null)
      setGroqApiKeyDraft('')
      setLlmSettingsState((s) => (s ? { ...s, hasGroqKey: res.hasGroqKey } : s))
      await refreshLlm()
    } finally {
      setGroqApiKeyBusy(false)
    }
  }

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

  const showExtraFilters = advanced || filtersOpen

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box className={`app ${advanced ? 'ui-advanced' : 'ui-simple'}`} sx={{ bgcolor: 'background.default' }}>
        <AppBar position="sticky" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', color: 'text.primary' }}>
          <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 56, px: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ flexShrink: 0 }}>
              <Box
                className="vault-mark"
                aria-hidden
                sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}
              >
                <svg width="22" height="22" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3.5" y="5" width="21" height="18" rx="3.5" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M9 5v18M14 10.5h6.5M14 14.5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </Box>
              <Box sx={{ minWidth: 0, lineHeight: 1.15 }}>
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  Vault
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ letterSpacing: 0.4 }}>
                  Local knowledge
                </Typography>
              </Box>
            </Stack>

            <Box sx={{ flex: 1, minWidth: 0, px: 1, display: 'flex', justifyContent: 'center' }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search your notes…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) void runSearch()
                }}
                aria-label="Search notes"
                sx={{ maxWidth: 560, '& .MuiOutlinedInput-root': { borderRadius: 999 } }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => void runSearch()}
                        disabled={busy}
                        sx={{ mr: -0.5, borderRadius: 999 }}
                      >
                        Search
                      </Button>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
              <Chip
                size="small"
                label={aiStatusText}
                color={llmStatus == null ? 'default' : aiReady ? 'success' : 'warning'}
                variant={llmStatus == null ? 'outlined' : 'filled'}
                title={advanced ? (llmStatus?.message ?? 'AI status') : 'Local or Grok AI when configured'}
                sx={{ maxWidth: 220 }}
              />
              {advanced && (
                <Button
                  size="small"
                  variant={mode === 'prompts' ? 'contained' : 'outlined'}
                  color="primary"
                  onClick={() => {
                    setActivePluginId(null)
                    setMode('prompts')
                  }}
                >
                  Personalities
                </Button>
              )}
              <Button
                size="small"
                variant={activePluginId ? 'contained' : 'outlined'}
                color="primary"
                startIcon={<ExtensionIcon fontSize="small" />}
                onClick={(e) => setPluginsMenuAnchor(e.currentTarget)}
                aria-haspopup="true"
                aria-expanded={Boolean(pluginsMenuAnchor)}
              >
                Plugins
              </Button>
              <Menu
                anchorEl={pluginsMenuAnchor}
                open={Boolean(pluginsMenuAnchor)}
                onClose={() => setPluginsMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                {listPlugins().map((plug) => (
                  <MenuItem
                    key={plug.id}
                    selected={activePluginId === plug.id}
                    onClick={() => {
                      setPluginsMenuAnchor(null)
                      setActivePluginId(plug.id)
                      setMode('chat')
                    }}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={600}>
                        {plug.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 280 }}>
                        {plug.description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Menu>
              <FormControlLabel
                control={
                  <Switch
                    checked={advanced}
                    onChange={(e) => setUiModePersist(e.target.checked ? 'advanced' : 'simple')}
                    size="small"
                  />
                }
                label={<Typography variant="caption" color="text.secondary">Advanced</Typography>}
                title="Show developer details and fuller filters"
                sx={{ m: 0, ml: 0.5 }}
              />
              <IconButton
                size="small"
                onClick={() => setThemePersist(theme === 'blink' ? 'blink-light' : 'blink')}
                title={theme === 'blink' ? 'Switch to light' : 'Switch to dark'}
                aria-label="Toggle color theme"
                sx={{ border: 1, borderColor: 'divider', borderRadius: 3 }}
              >
                {theme === 'blink' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Stack>
          </Toolbar>
        </AppBar>

        <Box className="main">
          <Paper
            component="aside"
            className="sidebar"
            square
            sx={{ bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', borderRadius: 0 }}
          >
            <Stack spacing={1.25} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Button
                fullWidth
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => onNewNote()}
              >
                New note
              </Button>

              {advanced && (
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    Add from URL
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                    Public https pages / articles. Import enables when the URL looks like https://… — may take a few seconds.
                  </Typography>
                  <Stack direction="row" spacing={0.75}>
                    <TextField
                      size="small"
                      fullWidth
                      type="url"
                      placeholder="https://…"
                      value={importUrl}
                      disabled={importBusy || busy}
                      onChange={(e) => setImportUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (isValidHttpUrl(importUrl)) void onImportFromUrl()
                        }
                      }}
                      aria-label="URL to import"
                    />
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={importBusy || busy || !isValidHttpUrl(importUrl)}
                      onClick={() => void onImportFromUrl()}
                      sx={{ flexShrink: 0 }}
                      title={
                        isValidHttpUrl(importUrl)
                          ? 'Fetch and save as a note'
                          : 'Paste a full http:// or https:// URL to enable Import'
                      }
                    >
                      {importBusy ? '…' : 'Import'}
                    </Button>
                  </Stack>
                </Stack>
              )}

              <FormControl fullWidth size="small">
                <InputLabel id="project-filter-label">Project</InputLabel>
                <Select
                  labelId="project-filter-label"
                  label="Project"
                  value={filters.project ?? ''}
                  onChange={(e) => onNotesFromChange(String(e.target.value))}
                  aria-label="Filter notes by project"
                >
                  <MenuItem value="">All projects</MenuItem>
                  {projectOptions.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {advanced && (
                <Stack direction="row" flexWrap="wrap" gap={0.75} role="group" aria-label="Note group">
                  <Chip
                    size="small"
                    label="All"
                    color={!filters.para ? 'primary' : 'default'}
                    variant={!filters.para ? 'filled' : 'outlined'}
                    onClick={() => setFilters((f) => ({ ...f, para: '' }))}
                  />
                  {(['projects', 'areas', 'resources', 'archives'] as Para[]).map((p) => (
                    <Chip
                      key={p}
                      size="small"
                      label={paraLabel(p)}
                      color={filters.para === p ? 'primary' : 'default'}
                      variant={filters.para === p ? 'filled' : 'outlined'}
                      onClick={() => setFilters((f) => ({ ...f, para: f.para === p ? '' : p }))}
                    />
                  ))}
                </Stack>
              )}

              {!advanced && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setFiltersOpen((o) => !o)}
                  aria-expanded={filtersOpen}
                  startIcon={filtersOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ justifyContent: 'flex-start', opacity: 0.8 }}
                >
                  More filters
                </Button>
              )}

              {showExtraFilters && (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="kind-filter-label">Type</InputLabel>
                    <Select
                      labelId="kind-filter-label"
                      label="Type"
                      value={filters.kind ?? ''}
                      onChange={(e) => setFilters((f) => ({ ...f, kind: String(e.target.value) }))}
                    >
                      {KIND_OPTIONS.map((k) => (
                        <MenuItem key={k || 'any'} value={k}>
                          {k ? k : 'any'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="status-filter-label">Status</InputLabel>
                    <Select
                      labelId="status-filter-label"
                      label="Status"
                      value={filters.status ?? ''}
                      onChange={(e) => setFilters((f) => ({ ...f, status: String(e.target.value) }))}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <MenuItem key={s || 'any'} value={s}>
                          {s ? s : 'any'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {advanced && (
                    <FormControl size="small" fullWidth sx={{ gridColumn: '1 / -1' }}>
                      <InputLabel id="para-filter-label">PARA</InputLabel>
                      <Select
                        labelId="para-filter-label"
                        label="PARA"
                        value={filters.para ?? ''}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            para: e.target.value as ItemFilters['para'],
                          }))
                        }
                      >
                        {PARA_OPTIONS.map((p) => (
                          <MenuItem key={p || 'any'} value={p}>
                            {p ? p : 'any'}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              )}

              <Typography variant="caption" color="text.secondary">
                {filterSummary} · {items.length} notes
              </Typography>
            </Stack>

            <Box className="note-list" sx={{ p: 1 }}>
              {items.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', p: 2 }}>
                  No notes match filters.
                </Typography>
              )}
              <List dense disablePadding>
                {items.map((it) => (
                  <ListItemButton
                    key={it.id}
                    selected={selectedId === it.id}
                    onClick={() => selectItem(it.id)}
                    onDoubleClick={() => selectItem(it.id, { edit: true })}
                    sx={{
                      mb: 0.5,
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      borderRadius: 3,
                      borderLeft: selectedId === it.id ? 3 : 0,
                      borderColor: 'primary.main',
                    }}
                  >
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {it.title}
                    </Typography>
                    <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                      <Chip size="small" label={paraLabel(it.para)} color="primary" variant="outlined" />
                      <Chip size="small" label={it.kind} variant="outlined" />
                      {it.project && <Chip size="small" label={it.project} variant="outlined" />}
                    </Stack>
                  </ListItemButton>
                ))}
              </List>
            </Box>
          </Paper>

          <Box
            component="section"
            className="content"
            sx={{ bgcolor: 'background.default', position: 'relative' }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ m: 1.5, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={mode === 'search' || mode === 'chat' ? mode : null}
                onChange={(_e, v) => {
                  if (v === 'search' || v === 'chat') {
                    setActivePluginId(null)
                    setMode(v)
                  }
                }}
                aria-label="Primary mode"
                sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 999, p: 0.25 }}
              >
                <ToggleButton value="search" aria-label="Find">
                  Find
                </ToggleButton>
                <ToggleButton value="chat" aria-label="Ask">
                  Ask
                </ToggleButton>
              </ToggleButtonGroup>
              {mode === 'prompts' && <Chip size="small" variant="outlined" label="Personalities" />}
              {activePluginId && (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={getPlugin(activePluginId)?.name ?? 'Plugin'}
                  onDelete={() => setActivePluginId(null)}
                />
              )}
            </Stack>

            {statusMsg && (
              <Box sx={{ px: 2, pt: 1 }}>
                <Alert
                  severity="success"
                  action={
                    <IconButton size="small" aria-label="Dismiss" onClick={() => setStatusMsg(null)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  {statusMsg}
                </Alert>
              </Box>
            )}

            {error && (
              <Box sx={{ px: 2, pt: 1 }}>
                <Alert
                  severity="error"
                  action={
                    <IconButton size="small" aria-label="Dismiss error" onClick={() => setError(null)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  {error}
                </Alert>
              </Box>
            )}

            {activePluginId && (() => {
              const plug = getPlugin(activePluginId)
              if (!plug) {
                return (
                  <Alert severity="warning" sx={{ m: 2 }}>
                    Unknown plugin
                  </Alert>
                )
              }
              const PluginView = plug.render
              return (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'auto',
                  }}
                >
                  <PluginView
                    onOpenNote={(id) => selectItem(id)}
                    onClose={() => {
                      setActivePluginId(null)
                      setMode('chat')
                    }}
                  />
                </Box>
              )
            })()}

            {!activePluginId && mode === 'search' && (
              <Box className="panel" sx={{ p: 2 }}>
                {askResult && (
                  <>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      Answer
                    </Typography>
                    {askResult.offline && (
                      <Alert severity="warning" sx={{ mb: 1.5 }}>
                        AI unavailable — search hits still shown.
                      </Alert>
                    )}
                    <Paper sx={{ p: 2, mb: 1.5, borderRadius: 4, bgcolor: 'background.paper', whiteSpace: 'pre-wrap' }}>
                      <Typography variant="body2">{askResult.answer}</Typography>
                    </Paper>
                    {askResult.citations.length > 0 && (
                      <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          From your notes
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
                          {askResult.citations.map((c) => (
                            <Chip
                              key={c.id}
                              label={c.title}
                              color="primary"
                              variant="outlined"
                              onClick={() => selectItem(c.id)}
                              title={advanced ? c.id : c.title}
                            />
                          ))}
                        </Stack>
                      </>
                    )}
                  </>
                )}

                <Typography variant="subtitle1" fontWeight={600} sx={{ mt: askResult ? 1 : 0, mb: 0.5 }}>
                  {hits.length > 0 ? `Results (${hits.length})` : 'Results'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25 }}>
                  {filterSummary === 'All notes'
                    ? 'All notes'
                    : `Filtering by ${filterSummary}`}
                </Typography>
                {hits.length === 0 ? (
                  <Stack alignItems="center" spacing={1.5} sx={{ p: 4, color: 'text.secondary' }}>
                    <Typography variant="body2">
                      {searchText.trim() || filters.para || filters.kind || filters.status || filters.project
                        ? 'No notes match these filters'
                        : 'Search to find notes, or switch to Ask with your question.'}
                    </Typography>
                    <Button variant="contained" onClick={goAskAi}>
                      Ask instead
                    </Button>
                  </Stack>
                ) : (
                  <Stack spacing={1}>
                    {hits.map((h) => (
                      <Paper
                        key={h.id}
                        component="button"
                        onClick={() => selectItem(h.id)}
                        sx={{
                          p: 1.5,
                          textAlign: 'left',
                          cursor: 'pointer',
                          borderRadius: 4,
                          border: 1,
                          borderColor: 'divider',
                          bgcolor: 'background.paper',
                          '&:hover': { borderColor: 'primary.main' },
                        }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          {h.title}{' '}
                          <Typography component="span" variant="caption" color="text.secondary" fontWeight={400}>
                            {advanced && <>score {h.score.toFixed(2)} · </>}
                            {paraLabel(h.para)}
                          </Typography>
                        </Typography>
                        <Typography className="snippet" variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {h.snippet}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Box>
            )}

            {!activePluginId && mode === 'chat' && (
              <Box className="chat-layout">
                <Box className="chat-main">
                  {advanced && llmSettings && (
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
                      <details>
                        <summary
                          style={{
                            cursor: 'pointer',
                            padding: '8px 12px',
                            fontSize: 12,
                            listStyle: 'none',
                          }}
                        >
                          AI settings
                          {llmStatus && (
                            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                              · {llmStatus.message}
                            </Typography>
                          )}
                        </summary>
                        <Stack spacing={1} sx={{ px: 1.5, pb: 1.5, maxWidth: 480 }}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={llmSettings.groqEnabled}
                                onChange={(e) => void saveLlmSettings({ groqEnabled: e.target.checked })}
                                size="small"
                              />
                            }
                            label={<Typography variant="body2">Enable Groq (console.groq.com)</Typography>}
                          />
                          <FormControlLabel
                            control={
                              <Switch
                                checked={llmSettings.grokEnabled}
                                onChange={(e) => void saveLlmSettings({ grokEnabled: e.target.checked })}
                                size="small"
                              />
                            }
                            label={<Typography variant="body2">Enable Grok (xAI)</Typography>}
                          />
                          <FormControl size="small" sx={{ maxWidth: 280 }}>
                            <InputLabel id="llm-provider-label">Provider</InputLabel>
                            <Select
                              labelId="llm-provider-label"
                              label="Provider"
                              value={llmSettings.provider}
                              onChange={(e) =>
                                void saveLlmSettings({
                                  provider: e.target.value as LlmProviderChoice,
                                })
                              }
                            >
                              <MenuItem value="auto">Auto</MenuItem>
                              <MenuItem value="ollama">Ollama</MenuItem>
                              <MenuItem value="groq">Groq</MenuItem>
                              <MenuItem value="grok">Grok (xAI)</MenuItem>
                            </Select>
                          </FormControl>
                          {llmStatus && (
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                              <Chip
                                size="small"
                                label={`Ollama: ${llmStatus.ollama.ok ? 'Ready' : 'Offline'}`}
                                color={llmStatus.ollama.ok ? 'success' : 'default'}
                                variant="outlined"
                              />
                              <Chip
                                size="small"
                                label={`Groq: ${
                                  !llmSettings.groqEnabled
                                    ? 'Off'
                                    : llmStatus.groq.hasKey
                                      ? llmStatus.groq.ok
                                        ? 'Ready'
                                        : 'Offline'
                                      : 'Needs key'
                                }`}
                                color={
                                  llmSettings.groqEnabled && llmStatus.groq.ok
                                    ? 'success'
                                    : llmSettings.groqEnabled && !llmStatus.groq.hasKey
                                      ? 'warning'
                                      : 'default'
                                }
                                variant="outlined"
                              />
                              <Chip
                                size="small"
                                label={`Grok: ${
                                  !llmSettings.grokEnabled
                                    ? 'Off'
                                    : llmStatus.grok.hasKey
                                      ? llmStatus.grok.ok
                                        ? 'Ready'
                                        : 'Offline'
                                      : 'Needs key'
                                }`}
                                color={
                                  llmSettings.grokEnabled && llmStatus.grok.ok
                                    ? 'success'
                                    : llmSettings.grokEnabled && !llmStatus.grok.hasKey
                                      ? 'warning'
                                      : 'default'
                                }
                                variant="outlined"
                              />
                            </Stack>
                          )}
                          {llmSettings.groqEnabled && (
                            <>
                              <TextField
                                label="Groq model"
                                value={llmSettings.groqModel}
                                onChange={(e) =>
                                  setLlmSettingsState((s) => (s ? { ...s, groqModel: e.target.value } : s))
                                }
                                onBlur={(e) => {
                                  const v = e.target.value.trim() || 'openai/gpt-oss-20b'
                                  void saveLlmSettings({ groqModel: v })
                                }}
                                placeholder="openai/gpt-oss-20b"
                                sx={{ maxWidth: 280 }}
                              />
                              <TextField
                                type="password"
                                label={`Groq API key (${llmSettings.hasGroqKey ? 'Key saved' : 'No key'})`}
                                value={groqApiKeyDraft}
                                onChange={(e) => setGroqApiKeyDraft(e.target.value)}
                                placeholder={llmSettings.hasGroqKey ? '•••••••• (enter to replace)' : 'Paste key'}
                                autoComplete="off"
                                sx={{ maxWidth: 280 }}
                              />
                              <Stack direction="row" spacing={1} sx={{ maxWidth: 280 }}>
                                <Button
                                  size="small"
                                  variant="contained"
                                  fullWidth
                                  disabled={groqApiKeyBusy || !groqApiKeyDraft.trim()}
                                  onClick={() => void onSaveGroqApiKey()}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  fullWidth
                                  disabled={groqApiKeyBusy || !llmSettings.hasGroqKey}
                                  onClick={() => void onClearGroqApiKey()}
                                >
                                  Clear
                                </Button>
                              </Stack>
                            </>
                          )}
                          {llmSettings.grokEnabled && (
                            <>
                              <TextField
                                label="Grok model (xAI)"
                                value={llmSettings.grokModel}
                                onChange={(e) =>
                                  setLlmSettingsState((s) => (s ? { ...s, grokModel: e.target.value } : s))
                                }
                                onBlur={(e) => {
                                  const v = e.target.value.trim() || 'grok-4.3'
                                  void saveLlmSettings({ grokModel: v })
                                }}
                                placeholder="grok-4.3"
                                sx={{ maxWidth: 280 }}
                              />
                              <TextField
                                type="password"
                                label={`xAI Grok API key (${llmSettings.hasKey ? 'Key saved' : 'No key'})`}
                                value={apiKeyDraft}
                                onChange={(e) => setApiKeyDraft(e.target.value)}
                                placeholder={llmSettings.hasKey ? '•••••••• (enter to replace)' : 'Paste key'}
                                autoComplete="off"
                                sx={{ maxWidth: 280 }}
                              />
                              <Stack direction="row" spacing={1} sx={{ maxWidth: 280 }}>
                                <Button
                                  size="small"
                                  variant="contained"
                                  fullWidth
                                  disabled={apiKeyBusy || !apiKeyDraft.trim()}
                                  onClick={() => void onSaveApiKey()}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  fullWidth
                                  disabled={apiKeyBusy || !llmSettings.hasKey}
                                  onClick={() => void onClearApiKey()}
                                >
                                  Clear
                                </Button>
                              </Stack>
                            </>
                          )}
                        </Stack>
                      </details>
                    </Box>
                  )}

                  <Box className="chat-thread" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: 'background.default' }}>
                    {messages.length === 0 && (
                      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Paper sx={{ p: 4, maxWidth: 520, textAlign: 'center', borderRadius: 5 }}>
                          <Typography variant="h6" color="primary" gutterBottom>
                            {askEmpty.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {askEmpty.body}
                          </Typography>
                        </Paper>
                      </Box>
                    )}
                    {messages.map((m) => {
                      const cites = m.role === 'assistant' ? parseCitations(m.citations_json) : []
                      const isUser = m.role === 'user'
                      const isSystem = m.role === 'system'
                      return (
                        <Box
                          key={m.id}
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: isUser ? 'flex-end' : 'flex-start',
                            opacity: isSystem ? 0.85 : 1,
                          }}
                        >
                          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.25, textTransform: 'capitalize' }}>
                            {m.role}
                          </Typography>
                          <Paper
                            sx={{
                              px: 2,
                              py: 1.25,
                              maxWidth: '85%',
                              borderRadius: 4,
                              bgcolor: isUser
                                ? 'primary.main'
                                : isSystem
                                  ? 'action.selected'
                                  : 'background.paper',
                              color: isUser ? 'primary.contrastText' : 'text.primary',
                              border: isUser ? 0 : 1,
                              borderColor: 'divider',
                            }}
                          >
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                              {m.content}
                            </Typography>
                            {cites.length > 0 && (
                              <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
                                {cites.map((c) => (
                                  <Chip
                                    key={c.id}
                                    size="small"
                                    label={c.title}
                                    color="primary"
                                    variant={isUser ? 'filled' : 'outlined'}
                                    onClick={() => selectItem(c.id)}
                                    title={advanced ? c.id : c.title}
                                    sx={isUser ? { bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit' } : undefined}
                                  />
                                ))}
                              </Stack>
                            )}
                          </Paper>
                        </Box>
                      )
                    })}
                    {chatOffline && (
                      <Alert severity="warning">
                        AI unavailable — your message was saved; reply is a status notice.
                      </Alert>
                    )}
                    <div ref={threadEndRef} />
                  </Box>

                  <Paper
                    square
                    className="chat-composer"
                    sx={{
                      borderTop: 1,
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                      p: 1.5,
                      borderRadius: 0,
                      flexShrink: 0,
                    }}
                  >
                    <Stack spacing={1.25}>
                      <Stack direction="row" spacing={1} alignItems="flex-end" flexWrap="wrap">
                        <FormControl size="small" sx={{ flex: 1, minWidth: 192, maxWidth: 320 }}>
                          <InputLabel id="chat-profile-label">Profile</InputLabel>
                          <Select
                            labelId="chat-profile-label"
                            label="Profile"
                            value={
                              selectedProfileId === 'custom' ||
                              isBuiltinProfileId(selectedProfileId) ||
                              userProfiles.some((p) => p.id === selectedProfileId)
                                ? selectedProfileId
                                : 'custom'
                            }
                            onChange={(e) => onProfileChange(String(e.target.value))}
                            aria-label="Chat profile"
                          >
                            {BUILTIN_PROFILES.map((p) => (
                              <MenuItem key={p.id} value={p.id}>
                                {p.name}
                              </MenuItem>
                            ))}
                            {userProfiles.map((p) => {
                              const broken = !prompts.some((pr) => pr.id === p.prompt_id)
                              return (
                                <MenuItem key={p.id} value={p.id}>
                                  {broken ? `${p.name} (broken)` : p.name}
                                </MenuItem>
                              )
                            })}
                            <MenuItem value="custom">Custom</MenuItem>
                          </Select>
                        </FormControl>
                        {selectedUserProfile && !profileRenameOpen && (
                          <Stack direction="row" spacing={0.5} sx={{ pb: 0.25 }}>
                            <Button
                              size="small"
                              disabled={profileBusy}
                              onClick={() => {
                                setProfileRenameName(selectedUserProfile.name)
                                setProfileRenameOpen(true)
                                setProfileSaveOpen(false)
                              }}
                            >
                              Rename
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              disabled={profileBusy}
                              onClick={() => void onDeleteProfile()}
                            >
                              Delete
                            </Button>
                          </Stack>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          aria-expanded={askCustomizeOpen}
                          onClick={() => setAskCustomizeOpen((o) => !o)}
                          endIcon={askCustomizeOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        >
                          Customize
                        </Button>
                        {advanced && (
                          <Typography variant="caption" color="text.secondary" sx={{ pb: 1, whiteSpace: 'nowrap' }}>
                            {filterSummary}
                          </Typography>
                        )}
                      </Stack>

                      {profileRenameOpen && selectedUserProfile && (
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <TextField
                            size="small"
                            sx={{ flex: 1, minWidth: 160 }}
                            value={profileRenameName}
                            onChange={(e) => setProfileRenameName(e.target.value)}
                            placeholder="Profile name"
                            aria-label="Rename profile"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                void onRenameProfile()
                              }
                              if (e.key === 'Escape') setProfileRenameOpen(false)
                            }}
                            autoFocus
                          />
                          <Button
                            variant="contained"
                            size="small"
                            disabled={profileBusy || !profileRenameName.trim()}
                            onClick={() => void onRenameProfile()}
                          >
                            Save
                          </Button>
                          <Button size="small" disabled={profileBusy} onClick={() => setProfileRenameOpen(false)}>
                            Cancel
                          </Button>
                        </Stack>
                      )}

                      {(stayingInGorgias || scopeCoupleHint) && (
                        <Typography variant="caption" color="text.secondary">
                          {stayingInGorgias ? 'Staying in Gorgias notes' : scopeCoupleHint}
                        </Typography>
                      )}

                      <Collapse in={askCustomizeOpen}>
                        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                          <Stack spacing={1.25}>
                            {scopeCoupleHint && (
                              <Typography variant="caption" color="text.secondary">
                                {scopeCoupleHint}
                              </Typography>
                            )}
                            <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
                              <FormControl size="small" sx={{ flex: 1, minWidth: 160 }}>
                                <InputLabel id="personality-label">Personality</InputLabel>
                                <Select
                                  labelId="personality-label"
                                  label="Personality"
                                  value={
                                    selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || ''
                                  }
                                  onChange={(e) => onChatPromptChange(String(e.target.value))}
                                >
                                  {prompts.map((p) => (
                                    <MenuItem key={p.id} value={p.id}>
                                      {personalityDisplayName(p)}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                              <FormControl size="small" sx={{ flex: 1, minWidth: 160 }}>
                                <InputLabel id="notes-from-label">Notes from</InputLabel>
                                <Select
                                  labelId="notes-from-label"
                                  label="Notes from"
                                  value={filters.project ?? ''}
                                  onChange={(e) => onNotesFromChange(String(e.target.value))}
                                >
                                  <MenuItem value="">All</MenuItem>
                                  {projectOptions.map((name) => (
                                    <MenuItem key={name} value={name}>
                                      {name}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            </Stack>
                            <Divider />
                            {!profileSaveOpen ? (
                              <Button
                                size="small"
                                disabled={profileBusy}
                                onClick={() => {
                                  const prompt = prompts.find((p) => p.id === selectedPromptId)
                                  const persona = prompt ? personalityDisplayName(prompt) : 'Custom'
                                  const proj = (filters.project ?? '').trim()
                                  setProfileSaveName(proj ? `${persona} · ${proj}` : persona)
                                  setProfileSaveOpen(true)
                                  setProfileRenameOpen(false)
                                }}
                                sx={{ alignSelf: 'flex-start' }}
                              >
                                Save as profile…
                              </Button>
                            ) : (
                              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                <TextField
                                  size="small"
                                  sx={{ flex: 1, minWidth: 160 }}
                                  value={profileSaveName}
                                  onChange={(e) => setProfileSaveName(e.target.value)}
                                  placeholder="Profile name"
                                  aria-label="New profile name"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      void onSaveAsProfile()
                                    }
                                    if (e.key === 'Escape') setProfileSaveOpen(false)
                                  }}
                                  autoFocus
                                />
                                <Button
                                  variant="contained"
                                  size="small"
                                  disabled={profileBusy || !profileSaveName.trim()}
                                  onClick={() => void onSaveAsProfile()}
                                >
                                  Save
                                </Button>
                                <Button size="small" disabled={profileBusy} onClick={() => setProfileSaveOpen(false)}>
                                  Cancel
                                </Button>
                              </Stack>
                            )}
                          </Stack>
                        </Paper>
                      </Collapse>

                      <Stack direction="row" spacing={1} alignItems="flex-end">
                        <TextField
                          fullWidth
                          multiline
                          minRows={3}
                          maxRows={8}
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder={chatPlaceholder}
                          disabled={busy}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void onSendChat()
                            }
                          }}
                        />
                        <IconButton
                          color="primary"
                          disabled={busy || !chatInput.trim()}
                          onClick={() => void onSendChat()}
                          aria-label={busy ? 'Sending' : 'Send'}
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            borderRadius: 4,
                            width: 48,
                            height: 48,
                            '&:hover': { bgcolor: 'primary.dark' },
                            '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                          }}
                        >
                          <SendIcon />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </Paper>
                </Box>

                <Paper
                  component="aside"
                  className="chat-sessions"
                  square
                  sx={{ bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider', borderRadius: 0 }}
                >
                  <Stack spacing={1} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <Button
                      fullWidth
                      size="small"
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => void onNewChat()}
                    >
                      New chat
                    </Button>
                    {advanced ? (
                      <Button
                        fullWidth
                        size="small"
                        variant="outlined"
                        startIcon={<FileDownloadIcon />}
                        disabled={busy || !activeSessionId || messages.length === 0}
                        onClick={() => void onExportCitationPack()}
                        aria-label="Export citation pack"
                      >
                        Export citation pack
                      </Button>
                    ) : (
                      <Button
                        fullWidth
                        size="small"
                        variant="outlined"
                        startIcon={<FileDownloadIcon />}
                        disabled={busy || !activeSessionId || messages.length === 0}
                        onClick={() => void onExportCitationPack()}
                        aria-label="Export citation pack"
                      >
                        Export pack
                      </Button>
                    )}
                    <Typography variant="caption" color="text.secondary" title="Brainstorm mode not in this slice">
                      Answers from your notes
                      {advanced && <span> · Coming soon: brainstorm</span>}
                    </Typography>
                  </Stack>
                  <Box className="session-list" sx={{ p: 1 }}>
                    {sessions.length === 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', p: 1.5 }}>
                        No chats yet.
                      </Typography>
                    )}
                    <List dense disablePadding>
                      {sessions.map((s) => (
                        <ListItemButton
                          key={s.id}
                          selected={activeSessionId === s.id}
                          onClick={() => void onSelectSession(s.id)}
                          sx={{
                            mb: 0.25,
                            borderRadius: 3,
                            borderLeft: activeSessionId === s.id ? 3 : 0,
                            borderColor: 'primary.main',
                            pr: 0.5,
                          }}
                        >
                          <ListItemText
                            primary={s.title}
                            primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true }}
                          />
                          <IconButton
                            size="small"
                            aria-label="Delete session"
                            title="Delete session"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onDeleteSession(s.id)
                            }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </ListItemButton>
                      ))}
                    </List>
                  </Box>
                </Paper>
              </Box>
            )}

            {!activePluginId && mode === 'prompts' && (
              <Box className="prompts-layout">
                <Paper
                  component="aside"
                  className="prompt-list-pane"
                  square
                  sx={{ bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider', borderRadius: 0 }}
                >
                  <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <Button
                      fullWidth
                      size="small"
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={onNewPrompt}
                    >
                      New personality
                    </Button>
                  </Box>
                  <Box className="session-list" sx={{ p: 1 }}>
                    {prompts.length === 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', p: 1.5 }}>
                        No personalities yet.
                      </Typography>
                    )}
                    <List dense disablePadding>
                      {prompts.map((p) => (
                        <ListItemButton
                          key={p.id}
                          selected={editingPrompt?.id === p.id}
                          onClick={() => onSelectPrompt(p)}
                          sx={{
                            mb: 0.25,
                            borderRadius: 3,
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            borderLeft: editingPrompt?.id === p.id ? 3 : 0,
                            borderColor: 'primary.main',
                          }}
                        >
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {personalityDisplayName(p)}
                          </Typography>
                          {p.description && (
                            <Typography variant="caption" color="text.secondary">
                              {p.description}
                            </Typography>
                          )}
                        </ListItemButton>
                      ))}
                    </List>
                  </Box>
                </Paper>
                <Box className="panel" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {!editingPrompt && !promptBodyOpen ? (
                    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Paper sx={{ p: 4, maxWidth: 420, textAlign: 'center', borderRadius: 5 }}>
                        <Typography variant="h6" color="primary" gutterBottom>
                          Personalities
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Pick how Ask should answer. You can add your own personalities.
                        </Typography>
                      </Paper>
                    </Box>
                  ) : (
                    <>
                      <Typography variant="h6">
                        {editingPrompt ? personalityDisplayName(editingPrompt) : 'New personality'}
                      </Typography>
                      <TextField
                        fullWidth
                        label="Name"
                        value={promptDraft.name}
                        onChange={(e) => {
                          setPromptDraft((d) => ({ ...d, name: e.target.value }))
                          setPromptDirty(true)
                        }}
                        placeholder="e.g. Concise bullets"
                      />
                      <TextField
                        fullWidth
                        label="Description"
                        value={promptDraft.description}
                        onChange={(e) => {
                          setPromptDraft((d) => ({ ...d, description: e.target.value }))
                          setPromptDirty(true)
                        }}
                        placeholder="Optional short description"
                      />

                      {!advanced && !promptBodyOpen ? (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="body2" color="text.secondary" paragraph>
                            {editingPrompt
                              ? 'This personality is ready to use in Ask. Open Edit to change how it answers.'
                              : 'Add a name, then Edit to write the personality instructions.'}
                          </Typography>
                          <Button variant="outlined" size="small" onClick={() => setPromptBodyOpen(true)}>
                            Edit
                          </Button>
                          {editingPrompt && (
                            <Button
                              variant="contained"
                              size="small"
                              sx={{ ml: 1 }}
                              onClick={() => {
                                onChatPromptChange(editingPrompt.id)
                                setMode('chat')
                              }}
                            >
                              Use in Ask
                            </Button>
                          )}
                        </Box>
                      ) : (
                        <>
                          <TextField
                            fullWidth
                            multiline
                            minRows={10}
                            label="Instructions"
                            value={promptDraft.body}
                            onChange={(e) => {
                              setPromptDraft((d) => ({ ...d, body: e.target.value }))
                              setPromptDirty(true)
                            }}
                            placeholder="Additional guidance merged with grounded citation rules…"
                            InputProps={{ sx: { fontFamily: 'monospace', fontSize: 13 } }}
                          />
                          <Typography variant="caption" color="text.secondary">
                            Answers still come from your notes. These instructions only change tone and format.
                          </Typography>
                          <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                            {editingPrompt && (
                              <Button color="error" variant="outlined" onClick={() => void onDeletePrompt()}>
                                Delete
                              </Button>
                            )}
                            {!advanced && (
                              <Button onClick={() => setPromptBodyOpen(false)}>Done editing</Button>
                            )}
                            <Button
                              variant="contained"
                              disabled={
                                busy || !promptDirty || !promptDraft.name.trim() || !promptDraft.body.trim()
                              }
                              onClick={() => void onSavePrompt()}
                            >
                              Save
                            </Button>
                          </Stack>
                        </>
                      )}
                    </>
                  )}
                </Box>
              </Box>
            )}

            {/* Note peek: Ask/Find stay home; note overlays center+sessions */}
            <Drawer
              anchor="right"
              open={notePeekOpen}
              onClose={() => closeNotePeek()}
              variant="temporary"
              ModalProps={{
                keepMounted: true,
                disablePortal: true,
                sx: { position: 'absolute' },
              }}
              slotProps={{
                backdrop: {
                  sx: {
                    position: 'absolute',
                    bgcolor: 'rgba(0, 0, 0, 0.28)',
                  },
                },
              }}
              PaperProps={{
                sx: {
                  position: 'absolute',
                  width: { xs: '100%', sm: 420, md: 480 },
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                },
              }}
              aria-label="Note peek"
            >
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
              >
                <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }} noWrap>
                  {isNewDraft || draft?.id === NEW_DRAFT_ID
                    ? 'New note'
                    : peekEditing
                      ? 'Editing note'
                      : 'Viewing note'}
                </Typography>
                {!peekEditing && draft && (
                  <Button
                    size="small"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => setPeekEditing(true)}
                  >
                    Edit
                  </Button>
                )}
                <IconButton size="small" aria-label="Close note peek" onClick={() => closeNotePeek()}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Box className="panel" sx={{ p: 2, flex: 1, minHeight: 0, overflow: 'auto' }}>
                {!draft ? (
                  <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      Loading note…
                    </Typography>
                  </Box>
                ) : (
                  <Box className="editor">
                    <TextField
                      fullWidth
                      value={draft.title}
                      onChange={(e) => patchDraft('title', e.target.value)}
                      placeholder="Title"
                      InputProps={{ readOnly: !peekEditing }}
                    />
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
                      <FormControl fullWidth size="small" disabled={!peekEditing}>
                        <InputLabel id="peek-para-label">Group</InputLabel>
                        <Select
                          labelId="peek-para-label"
                          label="Group"
                          value={draft.para}
                          onChange={(e) => patchDraft('para', e.target.value as Para)}
                        >
                          {PARA_OPTIONS.filter(Boolean).map((p) => (
                            <MenuItem key={p} value={p}>
                              {paraLabel(p as string)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        label="Type"
                        size="small"
                        value={draft.kind}
                        onChange={(e) => patchDraft('kind', e.target.value)}
                        InputProps={{ readOnly: !peekEditing }}
                      />
                      <TextField
                        label="Status"
                        size="small"
                        value={draft.status}
                        onChange={(e) => patchDraft('status', e.target.value)}
                        InputProps={{ readOnly: !peekEditing }}
                      />
                      <TextField
                        label="Project"
                        size="small"
                        value={draft.project ?? ''}
                        onChange={(e) => patchDraft('project', e.target.value || null)}
                        InputProps={{ readOnly: !peekEditing }}
                      />
                    </Box>
                    <TextField
                      fullWidth
                      label="Summary"
                      size="small"
                      value={draft.summary ?? ''}
                      onChange={(e) => patchDraft('summary', e.target.value || null)}
                      InputProps={{ readOnly: !peekEditing }}
                    />
                    <TextField
                      className="body-field"
                      fullWidth
                      multiline
                      minRows={12}
                      value={draft.body}
                      onChange={(e) => patchDraft('body', e.target.value)}
                      placeholder="Write your note…"
                      InputProps={{ readOnly: !peekEditing }}
                      sx={{ flex: 1, '& .MuiInputBase-root': { alignItems: 'flex-start' } }}
                    />
                    <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" color="text.secondary" sx={{ mr: 'auto' }}>
                        {advanced && !isNewDraft && draft.id !== NEW_DRAFT_ID && (
                          <>
                            <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                              {draft.id}
                            </Box>
                            <Button size="small" onClick={() => void copyItemId(draft.id)}>
                              Copy id
                            </Button>
                            {' · '}
                          </>
                        )}
                        {isNewDraft || draft.id === NEW_DRAFT_ID
                          ? dirty
                            ? 'Draft — not saved yet'
                            : 'Draft — save to add to your vault'
                          : peekEditing
                            ? dirty
                              ? 'Unsaved changes'
                              : 'Saved'
                            : 'Read-only'}
                      </Typography>
                      {peekEditing && (
                        <>
                          {!isNewDraft && draft.id !== NEW_DRAFT_ID && (
                            <Button color="error" variant="outlined" onClick={() => void onDelete()}>
                              Delete
                            </Button>
                          )}
                          <Button
                            variant="contained"
                            disabled={busy || (!dirty && !isNewDraft && draft.id !== NEW_DRAFT_ID)}
                            onClick={() => void onSave()}
                          >
                            Save
                          </Button>
                        </>
                      )}
                    </Stack>
                  </Box>
                )}
              </Box>
            </Drawer>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  )
}
