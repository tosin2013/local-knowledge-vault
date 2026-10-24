import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CssBaseline, Paper, ThemeProvider, Typography } from '@mui/material'
import { listPlugins } from './plugins/registry'
import { OPEN_PLUGIN_EVENT } from './plugins/media-chat/bookmarks'
import { ProviderDialog } from './components/ai/ProviderDialog'
import { aiChipLabel } from './components/ai/FirstRunLocalCard'
import { personalityDisplayName, AI_DRAFT_STATUS, provenanceHeader, type ImportStatusAction, type Mode } from './domain'
import type { Citation, ProviderConfig } from '../electron/types'
import { useUi } from './hooks/useUi'
import { useProviders } from './hooks/useProviders'
import { useNotes } from './hooks/useNotes'
import { usePrompts } from './hooks/usePrompts'
import { useChat } from './hooks/useChat'
import { TopBar } from './features/TopBar'
import { NotesRail } from './features/NotesRail'
import { FindPanel } from './features/FindPanel'
import { ChatView } from './features/ChatView'
import { PromptsView } from './features/PromptsView'
import { NotePeek } from './features/NotePeek'
import { AiSettingsDialog } from './features/AiSettingsDialog'
import { ContentChrome } from './features/ContentChrome'
import { StudyTab } from './features/study/StudyTab'
import { legacyStudySection, type StudySection } from './features/study/sections'
import { ManageProjectsDialog } from './features/ManageProjectsDialog'
import { TrashDialog } from './features/TrashDialog'
import { UpdateNotice } from './components/updates/UpdateNotice'

export default function App() {
  // Cross-cutting navigation / notification state.
  const [mode, setMode] = useState<Mode>('chat')
  const [activePluginId, setActivePluginId] = useState<string | null>(null)
  const [studySection, setStudySection] = useState<StudySection>('home')
  const [pluginsMenuAnchor, setPluginsMenuAnchor] = useState<null | HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsgState] = useState<string | null>(null)
  // Post-import "Move N notes" offer (#276); rendered inside the status toast.
  const [statusAction, setStatusAction] = useState<ImportStatusAction | null>(null)
  const [manageProjectsOpen, setManageProjectsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  // One stable status setter for every caller (notes/chat hooks, job progress):
  // clearing the status line also clears a stale move offer (#276).
  const setStatusMsg = useCallback((msg: string | null) => {
    setStatusMsgState(msg)
    if (!msg) setStatusAction(null)
  }, [])

  // Focus targets for the app menu / keyboard shortcuts (⌘F search, ⌘K ask).
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const composerRef = useRef<HTMLInputElement | null>(null)

  const ui = useUi()
  const providers = useProviders()

  // Late-bound so usePrompts (which runs before useChat) can reach the chat-owned
  // "re-pick profile after a prompt is deleted" handler.
  const onPromptDeletedRef = useRef<(deletedId: string) => void>(() => {})

  const notes = useNotes({
    setBusy,
    setError,
    setStatusMsg,
    setStatusAction,
    advanced: ui.advanced,
    setMode,
  })
  const prompts = usePrompts({
    setBusy,
    advanced: ui.advanced,
    setMode,
    onPromptDeleted: (deletedId) => onPromptDeletedRef.current(deletedId),
  })
  const chat = useChat({
    prompts: prompts.prompts,
    setBusy,
    setError,
    setStatusMsg,
    setMode,
    advanced: ui.advanced,
    busy,
  })
  onPromptDeletedRef.current = chat.handlePromptDeleted

  const hasApi = typeof window !== 'undefined' && !!window.lkv

  useEffect(() => {
    if (!hasApi) return
    // Startup refreshes: a background failure must surface as a visible error
    // rather than an unhandled rejection (#40).
    const report = (p: Promise<unknown>) =>
      p.catch((e) => setError(e instanceof Error ? e.message : String(e)))
    report(notes.refreshList())
    report(notes.refreshProjects())
    report(notes.refreshTrashed())
    report(notes.refreshSamples())
    report(providers.refreshLlm())
    report(chat.refreshSessions())
    report(prompts.refreshPrompts())
    report(chat.refreshProfiles())
  }, [
    hasApi,
    notes.refreshList,
    notes.refreshProjects,
    notes.refreshTrashed,
    notes.refreshSamples,
    providers.refreshLlm,
    chat.refreshSessions,
    prompts.refreshPrompts,
    chat.refreshProfiles,
  ])

  // llm:status polling lives in its own effect so the startup refreshes above can
  // never clear and restart the interval (#292).
  useEffect(() => {
    if (!hasApi) return
    const t = setInterval(() => void providers.refreshLlm(), 15000)
    return () => clearInterval(t)
  }, [hasApi, providers.refreshLlm])

  // Long-job progress (imports, enrollment — #298) shows in the status line so
  // the UI proves it is alive while the worker churns.
  useEffect(() => {
    if (!hasApi) return
    return window.lkv.jobs.onJobProgress((p) => {
      setStatusMsg(`${p.label}: ${p.done} / ${p.total}`)
    })
  }, [hasApi])

  // When left-rail filters change while Find is showing an active query, re-run search.
  useEffect(() => {
    if (mode !== 'search') return
    if (!notes.searchText.trim() && !notes.filters.para && !notes.filters.kind && !notes.filters.status && !notes.filters.project) {
      return
    }
    // Always re-query when filters change in Find mode (including empty text + filters only).
    const t = setTimeout(() => {
      void notes.runSearch()
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only filters/mode, not every searchText keystroke
  }, [notes.filters.para, notes.filters.kind, notes.filters.status, notes.filters.project, mode])

  // Simple mode hides the Personalities (prompts) pane.
  useEffect(() => {
    if (!ui.advanced && mode === 'prompts') setMode('chat')
  }, [ui.advanced, mode])

  /** Jump to Ask (chat) tab, optionally prefill from top search. */
  const goAskAi = useCallback(() => {
    if (notes.searchText.trim()) {
      chat.setChatInput(notes.searchText.trim())
    }
    setMode('chat')
  }, [notes.searchText, chat.setChatInput])

  // Latest handlers so the one-time menu subscription never goes stale.
  const newNoteRef = useRef(notes.onNewNote)
  newNoteRef.current = notes.onNewNote

  // Application menu accelerators (⌘N new note, ⌘F find, ⌘K ask).
  useEffect(() => {
    if (!window.lkv?.app?.onMenuAction) return
    return window.lkv.app.onMenuAction((action) => {
      if (action === 'new-note') {
        newNoteRef.current()
      } else if (action === 'find') {
        searchInputRef.current?.focus()
      } else if (action === 'ask') {
        setMode('chat')
        window.setTimeout(() => composerRef.current?.focus(), 0)
      }
    })
  }, [])

  const aiReady = providers.llmStatus?.active != null
  const aiStatusText = aiChipLabel(providers.llmStatus, ui.advanced)
  const showFirstRun = !!providers.llmStatus?.needsSetup
  const showSmallHint = !!providers.llmStatus?.active?.smallModel && !providers.smallHintDismissed
  const visiblePlugins = useMemo(
    () => listPlugins().filter((p) => !providers.disabledPlugins.includes(p.id)),
    [providers.disabledPlugins],
  )

  /**
   * Open a built-in panel. Study, Review and Test to notes are no longer add-ons
   * (#260): their old ids open the matching Study tab section instead, so a stale
   * id can never land on "Unknown plugin". The Study tab never consults the
   * disabled-plugin list, so a saved `study`/`review`/`test-to-notes` entry there
   * is simply ignored.
   */
  const openPlugin = useCallback((id: string) => {
    const section = legacyStudySection(id)
    if (section) {
      setActivePluginId(null)
      setStudySection(section)
      setMode('study')
      return
    }
    setActivePluginId(id)
    setMode('chat')
  }, [])
  // #334: other views (a Study card made from a video bookmark) ask the app to
  // open a plugin, e.g. Media chat at the bookmarked moment.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id?: unknown }>).detail?.id
      if (typeof id === 'string' && id) openPlugin(id)
    }
    window.addEventListener(OPEN_PLUGIN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PLUGIN_EVENT, onOpen)
  }, [openPlugin])
  const quickAsks = useMemo(
    () =>
      providers.pluginContribs.promptPacks
        .flatMap((pack) => pack.prompts.slice(0, 6).map((q) => ({ q, pack: pack.name })))
        .slice(0, 8),
    [providers.pluginContribs],
  )

  // Stable handlers for the memoized children: a keystroke in the top search,
  // the Ask composer or the note editor must not re-render the others (#293).
  const handleRunSearch = useCallback(() => void notes.runSearch(), [notes.runSearch])
  const handleAiSettings = useCallback(() => providers.setAiSettingsOpen(true), [providers.setAiSettingsOpen])
  const handleRecheck = useCallback(() => void providers.recheckLlm(), [providers.recheckLlm])
  const handlePersonalities = useCallback(() => {
    setActivePluginId(null)
    setMode('prompts')
  }, [])
  const handleSelectPlugin = useCallback(
    (id: string) => {
      setPluginsMenuAnchor(null)
      openPlugin(id)
    },
    [openPlugin],
  )
  const handleAdvanced = useCallback(
    (v: boolean) => ui.setUiModePersist(v ? 'advanced' : 'simple'),
    [ui.setUiModePersist],
  )
  const handleTheme = useCallback(
    () => ui.setThemePersist(ui.theme === 'blink' ? 'blink-light' : 'blink'),
    [ui.setThemePersist, ui.theme],
  )
  const handleProject = useCallback(
    (project: string) => notes.setFilters((f) => ({ ...f, project })),
    [notes.setFilters],
  )
  const handleManageProjects = useCallback(() => setManageProjectsOpen(true), [])
  const handleDeleteItem = useCallback((id: string) => void notes.deleteItemById(id), [notes.deleteItemById])
  const handleBulkTrash = useCallback(() => void notes.bulkTrash(), [notes.bulkTrash])
  const handleOpenTrash = useCallback(() => setTrashOpen(true), [])
  const handleRemoveSamples = useCallback(() => void notes.removeSamples(), [notes.removeSamples])
  const handleImport = useCallback(() => void notes.onImportFromUrl(), [notes.onImportFromUrl])
  const handleImportMarkdown = useCallback(() => void notes.onImportMarkdown(), [notes.onImportMarkdown])
  const handleImportBook = useCallback(() => void notes.onImportBook(), [notes.onImportBook])
  const handleImportProject = useCallback(
    (project: string) => notes.setImportProject(project),
    [notes.setImportProject],
  )
  const handleBulkMove = useCallback(
    (project: string) => void notes.bulkMove(project),
    [notes.bulkMove],
  )
  // The toast's Move button (the move itself already happened in MoveNotesAction).
  const handleMoveNotes = useCallback(
    (project: string, count: number) => {
      setStatusMsg(`Moved ${count} note${count === 1 ? '' : 's'} to "${project}"`)
      void notes.refreshList()
      void notes.refreshProjects()
    },
    [notes.refreshList, notes.refreshProjects, setStatusMsg],
  )
  const handleToggleMode = useCallback(
    (v: Mode) => {
      setActivePluginId(null)
      setMode(v)
    },
    [],
  )
  const handleClearPlugin = useCallback(() => setActivePluginId(null), [])
  const handleClosePlugin = useCallback(() => {
    setActivePluginId(null)
    setMode('chat')
  }, [])
  const handleDismissStatus = useCallback(() => setStatusMsg(null), [])
  const handleDismissError = useCallback(() => setError(null), [])
  const handleOpenNote = useCallback((id: string) => notes.selectItem(id), [notes.selectItem])
  const handleEditProvider = useCallback(
    (p: ProviderConfig) => {
      providers.setEditingProvider(p)
      providers.setProviderDialogOpen(true)
    },
    [providers.setEditingProvider, providers.setProviderDialogOpen],
  )
  const handleAddProvider = providers.openAddProvider
  const handleDismissSmallHint = useCallback(() => providers.setSmallHintDismissed(true), [providers.setSmallHintDismissed])
  const handleOpenRename = useCallback(() => {
    if (chat.selectedUserProfile) {
      chat.setProfileRenameName(chat.selectedUserProfile.name)
      chat.setProfileRenameOpen(true)
      chat.setProfileSaveOpen(false)
    }
  }, [chat.selectedUserProfile, chat.setProfileRenameName, chat.setProfileRenameOpen, chat.setProfileSaveOpen])
  const handleRename = useCallback(() => void chat.onRenameProfile(), [chat.onRenameProfile])
  const handleRenameCancel = useCallback(() => chat.setProfileRenameOpen(false), [chat.setProfileRenameOpen])
  const handleDeleteProfile = useCallback(() => void chat.onDeleteProfile(), [chat.onDeleteProfile])
  const handleChatPrompt = useCallback(
    (promptId: string) => chat.onChatPromptChange(promptId),
    [chat.onChatPromptChange],
  )
  const handleNotesFrom = useCallback(
    (project: string) => chat.onNotesFromChange(project),
    [chat.onNotesFromChange],
  )
  const handleOpenProfileSave = useCallback(() => {
    const prompt = prompts.prompts.find((p) => p.id === chat.selectedPromptId)
    const persona = prompt ? personalityDisplayName(prompt) : 'Custom'
    const proj = chat.project.trim()
    chat.setProfileSaveName(proj ? `${persona} · ${proj}` : persona)
    chat.setProfileSaveOpen(true)
    chat.setProfileRenameOpen(false)
  }, [prompts.prompts, chat.selectedPromptId, chat.project, chat.setProfileSaveName, chat.setProfileSaveOpen, chat.setProfileRenameOpen])
  const handleSaveAsProfile = useCallback(() => void chat.onSaveAsProfile(), [chat.onSaveAsProfile])
  const handleProfileSaveCancel = useCallback(() => chat.setProfileSaveOpen(false), [chat.setProfileSaveOpen])
  const handleSend = useCallback(() => void chat.onSendChat(), [chat.onSendChat])
  const handleNewChat = useCallback(() => void chat.onNewChat(), [chat.onNewChat])
  const handleExportCitationPack = useCallback(() => void chat.onExportCitationPack(), [chat.onExportCitationPack])
  const handleSelectSession = useCallback((id: string) => void chat.onSelectSession(id), [chat.onSelectSession])
  const handleDeleteSession = useCallback((id: string) => void chat.onDeleteSession(id), [chat.onDeleteSession])
  const handleSaveAsNote = useCallback(
    (content: string, cites: Citation[]) => {
      const title = (content.trim().split(/[?!.\n]/)[0] || 'Saved answer').slice(0, 60)
      notes.openPrefilledDraft({
        title,
        body: provenanceHeader({ citedIds: cites.map((c) => c.id) }) + content,
        kind: 'note',
        para: 'resources',
        status: AI_DRAFT_STATUS,
        project: chat.project.trim() || null,
      })
    },
    [notes.openPrefilledDraft, chat.project],
  )
  const handleUseInAsk = useCallback(
    (promptId: string) => {
      chat.onChatPromptChange(promptId)
      setMode('chat')
    },
    [chat.onChatPromptChange],
  )
  const handleDeletePrompt = useCallback(() => void prompts.onDeletePrompt(), [prompts.onDeletePrompt])
  const handleSavePrompt = useCallback(() => void prompts.onSavePrompt(), [prompts.onSavePrompt])
  const handleExportPrompt = useCallback((target: 'file' | 'clipboard') => void prompts.onExportPrompt(target), [prompts.onExportPrompt])
  const handleImportPrompt = useCallback(() => void prompts.onImportPrompt(), [prompts.onImportPrompt])

  if (!hasApi) {
    return (
      <ThemeProvider theme={ui.muiTheme}>
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
    <ThemeProvider theme={ui.muiTheme}>
      <CssBaseline />
      <Box className={`app ${ui.advanced ? 'ui-advanced' : 'ui-simple'}`} sx={{ bgcolor: 'background.default' }}>
        <TopBar
          advanced={ui.advanced}
          mode={mode}
          activePluginId={activePluginId}
          pluginsMenuAnchor={pluginsMenuAnchor}
          visiblePlugins={visiblePlugins}
          aiStatusText={aiStatusText}
          llmStatus={providers.llmStatus}
          aiReady={aiReady}
          theme={ui.theme}
          searchText={notes.searchText}
          busy={busy}
          searchInputRef={searchInputRef}
          onSearchText={notes.setSearchText}
          onRunSearch={handleRunSearch}
          onAiSettings={handleAiSettings}
          onRecheck={handleRecheck}
          onPersonalities={handlePersonalities}
          onPluginsMenu={setPluginsMenuAnchor}
          onSelectPlugin={handleSelectPlugin}
          onAdvanced={handleAdvanced}
          onTheme={handleTheme}
        />

        <Box className="main">
          <NotesRail
            advanced={ui.advanced}
            items={notes.visibleItems}
            isEmpty={notes.isEmpty}
            selectedId={notes.selectedId}
            filters={notes.filters}
            projectOptions={notes.projectOptions}
            filterSummary={notes.filterSummary}
            filtersOpen={notes.filtersOpen}
            importUrl={notes.importUrl}
            importProject={notes.importProject}
            importBusy={notes.importBusy}
            importMarkdownBusy={notes.importMarkdownBusy}
            importBookBusy={notes.importBookBusy}
            busy={busy}
            railQuery={notes.railQuery}
            railSort={notes.railSort}
            showTranscripts={notes.showTranscripts}
            onNewNote={notes.onNewNote}
            onNewProject={notes.onNewProject}
            onImportUrl={notes.setImportUrl}
            onImportProject={handleImportProject}
            onImport={handleImport}
            onImportMarkdown={handleImportMarkdown}
            onImportBook={handleImportBook}
            onProject={handleProject}
            onManageProjects={handleManageProjects}
            onDeleteItem={handleDeleteItem}
            onRailQuery={notes.setRailQuery}
            onRailSort={notes.setRailSort}
            onShowTranscripts={notes.setShowTranscripts}
            onOpenTrash={handleOpenTrash}
            hasSamples={notes.hasSamples}
            onRemoveSamples={handleRemoveSamples}
            bulkSelected={notes.bulkSelected}
            onToggleBulk={notes.toggleBulkSelect}
            onBulkTrash={handleBulkTrash}
            onBulkMove={handleBulkMove}
            onFilters={notes.setFilters}
            onFiltersOpen={notes.setFiltersOpen}
            onSelect={notes.selectItem}
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
              statusAction={statusAction}
              onMoveNotes={handleMoveNotes}
              error={error}
              onToggleMode={handleToggleMode}
              onClearPlugin={handleClearPlugin}
              onClosePlugin={handleClosePlugin}
              onDismissStatus={handleDismissStatus}
              onDismissError={handleDismissError}
              onOpenNote={handleOpenNote}
              onNewDraft={notes.openPrefilledDraft}
            />

            {!activePluginId && mode === 'search' && (
              <FindPanel
                advanced={ui.advanced}
                askResult={notes.askResult}
                hits={notes.hits}
                searchText={notes.searchText}
                filters={notes.filters}
                filterSummary={notes.filterSummary}
                hasMore={notes.hasMore}
                onSelect={notes.selectItem}
                onAskInstead={goAskAi}
                onShowMore={notes.loadMoreHits}
              />
            )}

            {!activePluginId && mode === 'study' && (
              <StudyTab
                section={studySection}
                onSection={setStudySection}
                onOpenNote={handleOpenNote}
                onNewDraft={notes.openPrefilledDraft}
              />
            )}

            {!activePluginId && mode === 'chat' && (
              <ChatView
                advanced={ui.advanced}
                busy={busy}
                sending={chat.sending}
                llmStatus={providers.llmStatus}
                llmChecking={providers.llmChecking}
                showFirstRun={showFirstRun}
                showSmallHint={showSmallHint}
                askEmpty={chat.askEmpty}
                quickAsks={quickAsks}
                messages={chat.messages}
                chatOffline={chat.chatOffline}
                threadEndRef={chat.threadEndRef}
                selectedProfileId={chat.selectedProfileId}
                userProfiles={chat.userProfiles}
                selectedUserProfile={chat.selectedUserProfile}
                prompts={prompts.prompts}
                selectedPromptId={chat.selectedPromptId}
                projectOptions={notes.projectOptions}
                notesFrom={chat.project}
                profileRenameOpen={chat.profileRenameOpen}
                profileRenameName={chat.profileRenameName}
                profileSaveOpen={chat.profileSaveOpen}
                profileSaveName={chat.profileSaveName}
                profileBusy={chat.profileBusy}
                askCustomizeOpen={chat.askCustomizeOpen}
                filterSummary={notes.filterSummary}
                stayingInGorgias={chat.stayingInGorgias}
                scopeCoupleHint={chat.scopeCoupleHint}
                chatInput={chat.chatInput}
                chatPlaceholder={chat.chatPlaceholder}
                composerRef={composerRef}
                sessions={chat.sessions}
                activeSessionId={chat.activeSessionId}
                onRecheck={handleRecheck}
                onAddProvider={handleAddProvider}
                onEditProvider={handleEditProvider}
                onError={setError}
                onDismissSmallHint={handleDismissSmallHint}
                onChatInput={chat.setChatInput}
                onSelectNote={notes.selectItem}
                onProfileChange={chat.onProfileChange}
                onOpenRename={handleOpenRename}
                onRenameName={chat.setProfileRenameName}
                onRename={handleRename}
                onRenameCancel={handleRenameCancel}
                onDeleteProfile={handleDeleteProfile}
                onAskCustomize={chat.setAskCustomizeOpen}
                onChatPrompt={handleChatPrompt}
                onNotesFrom={handleNotesFrom}
                onOpenProfileSave={handleOpenProfileSave}
                onProfileSaveName={chat.setProfileSaveName}
                onSaveAsProfile={handleSaveAsProfile}
                onProfileSaveCancel={handleProfileSaveCancel}
                onSend={handleSend}
                onNewChat={handleNewChat}
                onExportCitationPack={handleExportCitationPack}
                onSaveAsNote={handleSaveAsNote}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
              />
            )}

            {!activePluginId && mode === 'prompts' && (
              <PromptsView
                advanced={ui.advanced}
                busy={busy}
                prompts={prompts.prompts}
                editingPrompt={prompts.editingPrompt}
                promptBodyOpen={prompts.promptBodyOpen}
                promptDraft={prompts.promptDraft}
                promptDirty={prompts.promptDirty}
                onNewPrompt={prompts.onNewPrompt}
                onSelectPrompt={prompts.onSelectPrompt}
                onDraft={prompts.setPromptDraft}
                onDirty={prompts.setPromptDirty}
                onBodyOpen={prompts.setPromptBodyOpen}
                onUseInAsk={handleUseInAsk}
                onDeletePrompt={handleDeletePrompt}
                onSavePrompt={handleSavePrompt}
                onExportPrompt={handleExportPrompt}
                onImportPrompt={handleImportPrompt}
                shareNotice={prompts.shareNotice}
              />
            )}

            <NotePeek
              open={notes.notePeekOpen}
              isNewDraft={notes.isNewDraft}
              draft={notes.draft}
              peekEditing={notes.peekEditing}
              dirty={notes.dirty}
              busy={busy}
              advanced={ui.advanced}
              projectOptions={notes.projectOptions}
              noteMissing={notes.noteMissing}
              onClose={notes.closeNotePeek}
              onEdit={notes.setPeekEditing}
              onPatch={notes.patchDraft}
              onSave={() => void notes.onSave()}
              onDelete={() => void notes.onDelete()}
              onConfirmDraft={(ownWords) => void notes.confirmDraft(ownWords)}
              onCopyId={(id) => void notes.copyItemId(id)}
            />
          </Box>
        </Box>

        <ManageProjectsDialog
          open={manageProjectsOpen}
          projects={notes.projects}
          busy={busy}
          onClose={() => setManageProjectsOpen(false)}
          onRename={(from, to) => void notes.renameProject(from, to)}
          onMerge={(from, into) => void notes.mergeProject(from, into)}
          onDelete={(name) => void notes.deleteProject(name)}
          onSetExamDate={(name, date) => void notes.setProjectExamDate(name, date)}
        />

        <TrashDialog
          open={trashOpen}
          items={notes.trashed}
          busy={busy}
          onClose={() => setTrashOpen(false)}
          onRestore={(id) => void notes.restoreItem(id)}
          onEmpty={() => void notes.emptyTrash()}
        />

        <ProviderDialog
          open={providers.providerDialogOpen}
          presets={providers.providerPresets}
          editing={providers.editingProvider}
          initialPresetId={providers.providerInitialPreset}
          keyStorage={providers.llmStatus?.keyStorage}
          onClose={() => providers.setProviderDialogOpen(false)}
          onSaved={(cfg) => {
            providers.setProviderDialogOpen(false)
            setStatusMsg(`Saved provider “${cfg.label}”.`)
            void providers.recheckLlm()
          }}
        />
        <AiSettingsDialog
          open={providers.aiSettingsOpen}
          advanced={ui.advanced}
          llmStatus={providers.llmStatus}
          llmChecking={providers.llmChecking}
          onClose={() => providers.setAiSettingsOpen(false)}
          onRefresh={handleRecheck}
          onAddProvider={handleAddProvider}
          onEditProvider={handleEditProvider}
          onError={setError}
          onUseAdvanced={() => ui.setUiModePersist('advanced')}
        />
        <UpdateNotice />
      </Box>
    </ThemeProvider>
  )
}
