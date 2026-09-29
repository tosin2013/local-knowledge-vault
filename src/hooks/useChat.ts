import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  ChatMessage,
  ChatProfile,
  ChatSession,
  ItemFilters,
  Prompt,
} from '../../electron/types'
import {
  askEmptyStateCopy,
  BUILTIN_PROFILES,
  findGroundedDefaultPrompt,
  GORGIAS_PROJECT,
  isBuiltinProfileId,
  isGorgiasReaderPrompt,
  loadLastProfile,
  matchProfileId,
  resolveProfilePromptId,
  saveLastProfile,
  titleFromFirstQuestion,
  type ChatProfileId,
} from '../domain'

export interface UseChatDeps {
  prompts: Prompt[]
  filters: ItemFilters
  setFilters: Dispatch<SetStateAction<ItemFilters>>
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setStatusMsg: (msg: string | null) => void
  setMode: (mode: 'search' | 'chat' | 'prompts') => void
  advanced: boolean
  busy: boolean
}

/** Owns chat sessions/messages and the Personality + Project profile state. */
export function useChat(deps: UseChatDeps) {
  const {
    prompts,
    filters,
    setFilters,
    setBusy,
    setError,
    setStatusMsg,
    setMode,
    advanced,
    busy,
  } = deps

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

  // User chat profiles (Personality + Project)
  const [userProfiles, setUserProfiles] = useState<ChatProfile[]>([])
  const [profileSaveOpen, setProfileSaveOpen] = useState(false)
  const [profileSaveName, setProfileSaveName] = useState('')
  const [profileRenameOpen, setProfileRenameOpen] = useState(false)
  const [profileRenameName, setProfileRenameName] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [askCustomizeOpen, setAskCustomizeOpen] = useState(false)

  const persistProfile = useCallback(
    (profileId: ChatProfileId, promptId: string, project: string) => {
      setSelectedProfileId(profileId)
      saveLastProfile({ profileId, promptId, project })
    },
    [],
  )

  const refreshSessions = useCallback(async () => {
    if (!window.lkv) return
    const list = await window.lkv.chat.listSessions()
    setSessions(list)
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

  // Restore last Profile (Personality + Project) once prompts (+ profiles) are available.
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
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    // Advanced keeps Customize open; Simple hides Personality / Project by default.
    setAskCustomizeOpen(advanced)
  }, [advanced])

  const onNewChat = async () => {
    if (!window.lkv) return
    const session = await window.lkv.chat.createSession({ mode: 'grounded' })
    await refreshSessions()
    setActiveSessionId(session.id)
    setMessages([])
    setChatOffline(false)
    setMode('chat')
    // New sessions keep the last Profile (Personality + Project).
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
    // Keep Project independent when only Personality changes (avoid surprising scope jumps).
    const nextProject = filters.project ?? ''
    applyPromptAndProject(promptId, nextProject)
  }

  /** Short hint when Personality / Profile would or did affect note scope. */
  const scopeCoupleHint = useMemo(() => {
    if (isGorgiasReaderPrompt(selectedPromptId, prompts)) {
      if (projectIsGorgias) {
        return 'Gorgias reader · notes limited to project Gorgias'
      }
      return 'Gorgias reader often pairs with project Gorgias — answers use all your notes'
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
      return 'Answers use all your notes'
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

  /** Re-pick the active profile after the currently-selected prompt is deleted. */
  const handlePromptDeleted = (deletedId: string) => {
    if (selectedPromptId !== deletedId) return
    const remaining = prompts.filter((p) => p.id !== deletedId)
    const grounded = findGroundedDefaultPrompt(remaining)
    const nextId = grounded?.id || remaining[0]?.id || ''
    const project = (filters.project ?? '').trim()
    setSelectedPromptId(nextId)
    persistProfile(matchProfileId(nextId, project, remaining), nextId, project)
  }

  return {
    sessions,
    activeSessionId,
    messages,
    chatInput,
    setChatInput,
    selectedPromptId,
    selectedProfileId,
    userProfiles,
    selectedUserProfile,
    profileSaveOpen,
    setProfileSaveOpen,
    profileSaveName,
    setProfileSaveName,
    profileRenameOpen,
    setProfileRenameOpen,
    profileRenameName,
    setProfileRenameName,
    profileBusy,
    askCustomizeOpen,
    setAskCustomizeOpen,
    chatOffline,
    threadEndRef,
    stayingInGorgias,
    scopeCoupleHint,
    askEmpty,
    chatPlaceholder,
    refreshSessions,
    refreshProfiles,
    onNewChat,
    onSelectSession,
    onDeleteSession,
    onExportCitationPack,
    onSendChat,
    onProfileChange,
    onSaveAsProfile,
    onRenameProfile,
    onDeleteProfile,
    onChatPromptChange,
    onNotesFromChange,
    handlePromptDeleted,
  }
}
