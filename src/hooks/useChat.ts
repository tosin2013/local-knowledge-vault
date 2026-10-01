import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatMessage,
  ChatProfile,
  ChatSession,
  Prompt,
} from '../../electron/types'
import {
  askEmptyStateCopy,
  findGroundedDefaultPrompt,
  GORGIAS_PROJECT,
  isBuiltinProfileId,
  isGorgiasReaderPrompt,
  listBuiltinProfiles,
  loadLastProfile,
  matchProfileId,
  resolveProfilePromptId,
  saveLastProfile,
  titleFromFirstQuestion,
  VAULT_GUIDE_PROJECT,
  type ChatProfileId,
} from '../domain'

export interface UseChatDeps {
  prompts: Prompt[]
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
  // Ask note scope, decoupled from the notes-rail project filter (#123).
  const [project, setProject] = useState<string>('')
  const [profileHydrated, setProfileHydrated] = useState(false)
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [chatOffline, setChatOffline] = useState(false)
  // Per-action busy state for chat sends, so a shared `busy` flag cleared by a
  // concurrent Find search can't re-enable Send mid-request (#39).
  const [sending, setSending] = useState(false)
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  // Synchronous mirror of the active session, so an in-flight reply can check
  // whether the user switched sessions before applying the result (#39).
  const activeSessionIdRef = useRef<string | null>(null)

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
    let nextProject = ''
    let profileId: ChatProfileId = 'grounded-helper'

    if (saved) {
      const savedPromptOk = saved.promptId && prompts.some((p) => p.id === saved.promptId)
      if (isBuiltinProfileId(saved.profileId)) {
        const builtin = listBuiltinProfiles(prompts).find((p) => p.id === saved.profileId)
        if (builtin) {
          promptId = resolveProfilePromptId(builtin, prompts) || grounded?.id || ''
          // Keep a saved project when the builtin has none of its own (so the
          // first-run "Vault guide" scope survives restarts), otherwise use the
          // builtin's fixed project (e.g. Gorgias).
          nextProject = builtin.project || (saved.project ?? '')
          profileId = builtin.id
        }
      } else if (saved.profileId !== 'custom') {
        const user = userProfiles.find((p) => p.id === saved.profileId)
        if (user) {
          const promptOk = prompts.some((p) => p.id === user.prompt_id)
          promptId = promptOk
            ? user.prompt_id
            : grounded?.id || prompts[0]?.id || ''
          nextProject = user.project
          profileId = user.id
        }
      }
      if (!promptId && savedPromptOk) {
        promptId = saved.promptId
        nextProject = saved.project ?? ''
        profileId = matchProfileId(promptId, nextProject, prompts, userProfiles)
      }
    }

    if (!promptId) {
      promptId = grounded?.id || prompts[0]?.id || ''
      // First run has no saved profile: start scoped to the self-documenting
      // guide so there is a concrete project to explore (#163).
      nextProject = VAULT_GUIDE_PROJECT
      profileId = 'grounded-helper'
    }

    setSelectedPromptId(promptId)
    setProject(nextProject)
    persistProfile(profileId, promptId, nextProject)
    setProfileHydrated(true)
  }, [prompts, userProfiles, profilesLoaded, profileHydrated, persistProfile])

  // If the selected user profile was deleted, fall back to Custom.
  useEffect(() => {
    if (!profileHydrated) return
    if (isBuiltinProfileId(selectedProfileId) || selectedProfileId === 'custom') return
    if (userProfiles.some((p) => p.id === selectedProfileId)) return
    persistProfile('custom', selectedPromptId, project)
  }, [
    profileHydrated,
    selectedProfileId,
    userProfiles,
    selectedPromptId,
    project,
    persistProfile,
  ])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    // Advanced keeps Customize open; Simple hides Personality / Project by default.
    setAskCustomizeOpen(advanced)
  }, [advanced])

  const onNewChat = async () => {
    if (!window.lkv) return
    setError(null)
    try {
      const session = await window.lkv.chat.createSession({ mode: 'grounded' })
      await refreshSessions()
      setActiveSessionId(session.id)
      setMessages([])
      setChatOffline(false)
      setMode('chat')
      // New sessions keep the last Profile (Personality + Project).
      const promptId =
        selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
      const nextProject = project
      if (promptId) {
        persistProfile(
          matchProfileId(promptId, nextProject, prompts),
          promptId,
          nextProject,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
    setError(null)
    try {
      await window.lkv.chat.deleteSession(id)
      if (activeSessionId === id) {
        setActiveSessionId(null)
        setMessages([])
      }
      await refreshSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
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
            ? listBuiltinProfiles(prompts).find((p) => p.id === selectedProfileId)?.name
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
    if (!window.lkv || !chatInput.trim() || sending) return
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
      activeSessionIdRef.current = sessionId
      await refreshSessions()
    }
    activeSessionIdRef.current = sessionId
    setChatInput('')
    setSending(true)
    setBusy(true)
    setError(null)
    setChatOffline(false)
    // Render the user's message immediately rather than waiting for the reply.
    const optimisticId = `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        session_id: sessionId,
        role: 'user',
        content: text,
        citations_json: null,
        hits_json: null,
        provider_json: null,
        created_at: new Date().toISOString(),
      },
    ])
    try {
      const res = await window.lkv.chat.send({
        sessionId,
        text,
        filters: { project },
        promptId:
          selectedPromptId ||
          findGroundedDefaultPrompt(prompts)?.id ||
          undefined,
        limit: 8,
      })
      // Late-reply guard: a reply for a session the user has since left must
      // not overwrite the messages of the session they are now viewing.
      if (activeSessionIdRef.current === sessionId) {
        setMessages(res.messages)
      }
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
      // A failed send must not lose the question: roll back the optimistic
      // bubble and put the text back in the composer (#128).
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setChatInput(text)
    } finally {
      setSending(false)
      setBusy(false)
    }
  }

  const gorgiasReaderSelected = isGorgiasReaderPrompt(selectedPromptId, prompts)
  const projectIsGorgias = project.trim() === GORGIAS_PROJECT
  const stayingInGorgias = gorgiasReaderSelected && projectIsGorgias

  const applyPromptAndProject = (promptId: string, projectValue: string, profileId?: ChatProfileId) => {
    const nextPrompt =
      promptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    const nextProject = projectValue ?? ''
    setSelectedPromptId(nextPrompt)
    setProject(nextProject)
    const matched =
      profileId ?? matchProfileId(nextPrompt, nextProject, prompts, userProfiles)
    persistProfile(matched, nextPrompt, nextProject)
  }

  const onProfileChange = (profileId: string) => {
    if (profileId === 'custom') {
      const nextProject = project
      const promptId =
        selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
      persistProfile('custom', promptId, nextProject)
      return
    }
    const builtin = listBuiltinProfiles(prompts).find((p) => p.id === profileId)
    if (builtin) {
      const promptId = resolveProfilePromptId(builtin, prompts) || ''
      applyPromptAndProject(promptId, builtin.project, builtin.id)
      return
    }
    const user = userProfiles.find((p) => p.id === profileId)
    if (!user) return
    const promptOk = prompts.some((p) => p.id === user.prompt_id)
    const promptId = promptOk
      ? user.prompt_id
      : findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    if (!promptOk) {
      setStatusMsg(`Profile “${user.name}” personality missing — using default.`)
    }
    applyPromptAndProject(promptId, user.project, user.id)
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
        project,
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
    const nextProject = project
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
      if (proj && project.trim() === proj) {
        return `This also limits notes to project ${proj}`
      }
    }
    if (selectedProfileId === 'grounded-helper' && !project.trim()) {
      return 'Answers use all your notes'
    }
    return null
  }, [
    selectedPromptId,
    prompts,
    projectIsGorgias,
    selectedProfileId,
    selectedUserProfile,
    project,
  ])

  const onNotesFromChange = (projectValue: string) => {
    const promptId =
      selectedPromptId || findGroundedDefaultPrompt(prompts)?.id || prompts[0]?.id || ''
    applyPromptAndProject(promptId, projectValue)
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
        project,
        userProfiles,
      ),
    [selectedProfileId, prompts, selectedPromptId, project, userProfiles],
  )

  /** Re-pick the active profile after the currently-selected prompt is deleted. */
  const handlePromptDeleted = (deletedId: string) => {
    if (selectedPromptId !== deletedId) return
    const remaining = prompts.filter((p) => p.id !== deletedId)
    const grounded = findGroundedDefaultPrompt(remaining)
    const nextId = grounded?.id || remaining[0]?.id || ''
    const nextProject = project.trim()
    setSelectedPromptId(nextId)
    persistProfile(matchProfileId(nextId, nextProject, remaining), nextId, nextProject)
  }

  return {
    sessions,
    activeSessionId,
    messages,
    chatInput,
    setChatInput,
    selectedPromptId,
    selectedProfileId,
    project,
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
    sending,
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
